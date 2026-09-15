use std::collections::BTreeMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::{mpsc, oneshot};
use vrcx_0_application_activity::notification::{
    config_bool, extract_file_id, extract_file_version, fallback_file_version,
    load_notification_locale, normalize_avatar_image_url_128, render_delivery, NotificationConfig,
    OverlayLocale, RealtimeUserImageResolverSlot, RenderedNotification,
};
use vrcx_0_application_activity::{
    OverlayActivityDelivery, OverlayActivitySink, OverlayActivitySnapshot, OverlayActivitySurface,
};
use vrcx_0_application_core::{HostSessionRuntime, ImageCache, RuntimeAuthScope, TaskSupervisor};
use vrcx_0_host_desktop::tts::TtsEngine;
use vrcx_0_persistence::{config::ConfigRepository, DatabaseService};

use crate::privacy_lock::PrivacyLockRuntime;

use super::desktop::{send_desktop_notification, DesktopNotificationAction, DesktopNotifier};
use super::overlay_transport::OverlayNotificationTransport;
use super::tts::{notification_tts_memo_actor_user_id, send_tts_notification};
use super::{
    decide_notification_plan, load_preferences, NotificationDeliveryGameState,
    NotificationDeliveryPlan, NotificationDeliveryPreferences, NotificationDoNotDisturbRuntime,
};
use vrcx_0_core::json::JsonExt;
use vrcx_0_core::OwnerId;

const NOTIFICATION_IMAGE_FIRST_SEND_BUDGET: Duration = Duration::from_secs(1);

pub struct NotificationDispatcher {
    session: HostSessionRuntime,
    auth_scope: RuntimeAuthScope,
    config: ConfigRepository,
    notification_config: Arc<dyn NotificationConfig>,
    image_cache: Arc<ImageCache>,
    realtime_user_image_resolver: RealtimeUserImageResolverSlot,
    output: Arc<NotificationOutputContext>,
    completion_tx: mpsc::UnboundedSender<NotificationCompletion>,
    next_sequence: AtomicU64,
    tasks: TaskSupervisor,
}

pub struct NotificationDispatcherDeps {
    pub session: HostSessionRuntime,
    pub auth_scope: RuntimeAuthScope,
    pub config: ConfigRepository,
    pub db: Arc<DatabaseService>,
    pub image_cache: Arc<ImageCache>,
    pub realtime_user_image_resolver: RealtimeUserImageResolverSlot,
    pub desktop: Arc<dyn DesktopNotifier>,
    pub tts: Arc<dyn TtsEngine>,
    pub tasks: TaskSupervisor,
    pub do_not_disturb: NotificationDoNotDisturbRuntime,
    pub privacy_lock: Arc<PrivacyLockRuntime>,
}

struct NotificationOutputContext {
    overlay_transport: OverlayNotificationTransport,
    db: Arc<DatabaseService>,
    desktop: Arc<dyn DesktopNotifier>,
    tts: Arc<dyn TtsEngine>,
    do_not_disturb: NotificationDoNotDisturbRuntime,
    privacy_lock: Arc<PrivacyLockRuntime>,
}

struct NotificationJob {
    delivery: OverlayActivityDelivery,
    preferences: NotificationDeliveryPreferences,
    plan: NotificationDeliveryPlan,
    locale: OverlayLocale,
    current_user_id: String,
}

struct PreparedNotification {
    delivery: OverlayActivityDelivery,
    preferences: NotificationDeliveryPreferences,
    plan: NotificationDeliveryPlan,
    render: RenderedNotification,
    locale: OverlayLocale,
    local_image: Option<String>,
    desktop_action: Option<DesktopNotificationAction>,
}

enum NotificationCompletion {
    Ready {
        sequence: u64,
        notification: Box<PreparedNotification>,
    },
    Skip {
        sequence: u64,
    },
}

struct OrderedDeliveryBuffer<T> {
    next_sequence: u64,
    pending: BTreeMap<u64, Option<T>>,
}

impl<T> OrderedDeliveryBuffer<T> {
    fn new(next_sequence: u64) -> Self {
        Self {
            next_sequence,
            pending: BTreeMap::new(),
        }
    }

    fn push(&mut self, sequence: u64, value: Option<T>) -> Vec<T> {
        if sequence < self.next_sequence {
            return Vec::new();
        }
        self.pending.insert(sequence, value);
        let mut ready = Vec::new();
        while let Some(value) = self.pending.remove(&self.next_sequence) {
            self.next_sequence = self.next_sequence.saturating_add(1);
            if let Some(value) = value {
                ready.push(value);
            }
        }
        ready
    }
}

impl NotificationDispatcher {
    pub fn new(deps: NotificationDispatcherDeps) -> Self {
        let notification_config: Arc<dyn NotificationConfig> = Arc::new(
            vrcx_0_outbound_adapters::LocalNotificationConfig::new(deps.config.clone()),
        );
        let output = Arc::new(NotificationOutputContext {
            overlay_transport: OverlayNotificationTransport::new(),
            db: deps.db,
            desktop: deps.desktop,
            tts: deps.tts,
            do_not_disturb: deps.do_not_disturb,
            privacy_lock: deps.privacy_lock,
        });
        let (completion_tx, completion_rx) = mpsc::unbounded_channel();
        let worker_output = Arc::clone(&output);
        deps.tasks.spawn(async move {
            run_ordered_output(completion_rx, worker_output).await;
        });
        Self {
            session: deps.session,
            auth_scope: deps.auth_scope,
            config: deps.config,
            notification_config,
            image_cache: deps.image_cache,
            realtime_user_image_resolver: deps.realtime_user_image_resolver,
            output,
            completion_tx,
            next_sequence: AtomicU64::new(0),
            tasks: deps.tasks,
        }
    }
}

impl OverlayActivitySink for NotificationDispatcher {
    fn emit_overlay_activity_snapshot(&self, _snapshot: OverlayActivitySnapshot) {}

    fn emit_overlay_activity_delivery(&self, delivery: OverlayActivityDelivery) {
        let preferences = load_preferences(&self.config);
        let game = load_game_state(&self.session, &self.config);
        let plan = plan_allowed_by_suppressors(
            decide_notification_plan(&delivery, &preferences, &game),
            &self.output,
        );
        if !plan.has_local_transport() {
            return;
        }
        let locale = load_notification_locale(self.notification_config.as_ref());
        let (endpoint, current_user_id) = notification_session_identity(&self.auth_scope);
        let sequence = self.next_sequence.fetch_add(1, Ordering::Relaxed);
        let priority = delivery.entry.activity_type == "OnPlayerJoining";
        let mut delivery = delivery;
        if !priority {
            apply_cached_actor_image(
                &mut delivery,
                &endpoint,
                &current_user_id,
                config_bool(
                    self.notification_config.as_ref(),
                    "displayVRCPlusIconsAsAvatar",
                    true,
                ),
                &self.realtime_user_image_resolver,
            );
        }
        let job = NotificationJob {
            delivery,
            preferences,
            plan,
            locale,
            current_user_id,
        };

        if priority {
            let render = render_delivery(
                &job.delivery,
                job.locale,
                job.preferences.show_instance_id_in_location,
            );
            let prepared = prepare_rendered_notification(job, render, None);
            dispatch_prepared_notification(&prepared, self.output.as_ref());
            let _ = self
                .completion_tx
                .send(NotificationCompletion::Skip { sequence });
            return;
        }

        let image_cache = Arc::clone(&self.image_cache);
        let tasks = self.tasks.clone();
        let completion_tx = self.completion_tx.clone();
        self.tasks.spawn(async move {
            let notification = prepare_notification(job, image_cache, tasks).await;
            let _ = completion_tx.send(NotificationCompletion::Ready {
                sequence,
                notification: Box::new(notification),
            });
        });
    }
}

async fn run_ordered_output(
    mut completion_rx: mpsc::UnboundedReceiver<NotificationCompletion>,
    output: Arc<NotificationOutputContext>,
) {
    let mut buffer = OrderedDeliveryBuffer::new(0);
    while let Some(completion) = completion_rx.recv().await {
        let (sequence, notification) = match completion {
            NotificationCompletion::Ready {
                sequence,
                notification,
            } => (sequence, Some(notification)),
            NotificationCompletion::Skip { sequence } => (sequence, None),
        };
        for notification in buffer.push(sequence, notification) {
            dispatch_prepared_notification(&notification, output.as_ref());
        }
    }
}

async fn prepare_notification(
    job: NotificationJob,
    image_cache: Arc<ImageCache>,
    tasks: TaskSupervisor,
) -> PreparedNotification {
    let needs_local_image = job.preferences.image_notifications && job.plan.needs_local_image();
    let render = render_delivery(
        &job.delivery,
        job.locale,
        job.preferences.show_instance_id_in_location,
    );
    let local_image = if needs_local_image {
        resolve_local_image_with_budget(&tasks, image_cache, &render.image_url).await
    } else {
        None
    };
    prepare_rendered_notification(job, render, local_image)
}

fn prepare_rendered_notification(
    job: NotificationJob,
    render: RenderedNotification,
    local_image: Option<String>,
) -> PreparedNotification {
    let owner_user_id = OwnerId::new(job.current_user_id);
    let desktop_action = if job.delivery.entry.activity_type == "group.instanceOpened" {
        DesktopNotificationAction::open_group_profile(
            &owner_user_id,
            &job.delivery.entry.payload.trimmed_text("groupId"),
        )
    } else {
        DesktopNotificationAction::open_user_profile(
            &owner_user_id,
            &job.delivery.entry.actor_user_id,
        )
    };
    PreparedNotification {
        delivery: job.delivery,
        preferences: job.preferences,
        plan: job.plan,
        render,
        locale: job.locale,
        local_image,
        desktop_action,
    }
}

fn plan_without_suppressed_surfaces(
    plan: NotificationDeliveryPlan,
    suppresses: impl Fn(OverlayActivitySurface) -> bool,
) -> NotificationDeliveryPlan {
    let mut plan = plan;
    if suppresses(OverlayActivitySurface::Desktop) {
        plan.desktop = false;
    }
    if suppresses(OverlayActivitySurface::Vr) {
        plan.xs = false;
        plan.ovrt = false;
        plan.ovrt_hud = false;
        plan.ovrt_wrist = false;
    }
    if suppresses(OverlayActivitySurface::Tts) {
        plan.tts = false;
    }
    plan
}

fn plan_allowed_by_suppressors(
    plan: NotificationDeliveryPlan,
    output: &NotificationOutputContext,
) -> NotificationDeliveryPlan {
    plan_without_suppressed_surfaces(plan, |surface| {
        output.do_not_disturb.suppresses(surface) || output.privacy_lock.suppresses(surface)
    })
}

fn dispatch_prepared_notification(
    notification: &PreparedNotification,
    output: &NotificationOutputContext,
) {
    let plan = plan_allowed_by_suppressors(notification.plan, output);
    if plan.tts {
        let user_memo = notification_tts_memo_actor_user_id(
            &notification.delivery,
            &notification.render,
            &notification.preferences,
            notification.locale,
        )
        .and_then(|actor_user_id| load_user_memo(output.db.as_ref(), actor_user_id));
        send_tts_notification(
            output.tts.as_ref(),
            &notification.delivery,
            &notification.render,
            &notification.preferences,
            notification.locale,
            user_memo.as_deref(),
        );
    }
    let local_image = notification.local_image.as_deref();
    if plan.desktop {
        send_desktop_notification(
            output.desktop.as_ref(),
            &notification.render,
            &notification.delivery.entry.activity_type,
            &notification.delivery.entry.content.group_name,
            &notification.preferences,
            local_image,
            notification.desktop_action.as_ref(),
        );
    }
    output.overlay_transport.send(
        plan,
        &notification.render,
        &notification.preferences,
        local_image,
    );
}

fn load_user_memo(db: &DatabaseService, actor_user_id: &str) -> Option<String> {
    let actor_user_id = actor_user_id.trim();
    if actor_user_id.is_empty() {
        return None;
    }
    match vrcx_0_persistence::memos::memo_get_user(db, actor_user_id.to_string()) {
        Ok(Some(memo)) => Some(memo.memo),
        Ok(None) => None,
        Err(error) => {
            tracing::debug!("failed to load TTS nickname memo: {error}");
            None
        }
    }
}

fn apply_cached_actor_image(
    delivery: &mut OverlayActivityDelivery,
    endpoint: &str,
    current_user_id: &str,
    allow_user_icon: bool,
    resolver: &RealtimeUserImageResolverSlot,
) {
    if !delivery.entry.content.image_url.trim().is_empty() {
        return;
    }
    let actor_user_id = delivery.entry.actor_user_id.trim();
    if !actor_user_id.starts_with("usr_") || actor_user_id == current_user_id.trim() {
        return;
    }
    if let Some(image_url) = resolver.cached_url(endpoint, actor_user_id, allow_user_icon) {
        delivery.entry.content.image_url = normalize_avatar_image_url_128(&image_url, endpoint);
    }
}

fn notification_session_identity(auth_scope: &RuntimeAuthScope) -> (String, String) {
    let auth_scope = auth_scope.snapshot();
    if auth_scope.active {
        return (auth_scope.endpoint, auth_scope.current_user_id);
    }
    Default::default()
}

fn load_game_state(
    session: &HostSessionRuntime,
    config: &ConfigRepository,
) -> NotificationDeliveryGameState {
    let snapshot = session.snapshot();
    NotificationDeliveryGameState {
        is_game_running: snapshot.is_game_running,
        is_steamvr_running: snapshot.is_steamvr_running,
        is_game_no_vr: config.get_bool("isGameNoVR", false).unwrap_or(false),
    }
}

#[derive(Clone)]
struct LocalImageRequest {
    url: String,
    file_id: String,
    version: String,
}

fn local_image_request(image_url: &str) -> Option<LocalImageRequest> {
    let url = image_url.trim();
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return None;
    }
    let file_id = extract_file_id(url)?;
    let version = extract_file_version(url, &file_id).unwrap_or_else(|| fallback_file_version(url));
    if version.is_empty() {
        return None;
    }
    Some(LocalImageRequest {
        url: url.to_string(),
        file_id,
        version,
    })
}

async fn resolve_local_image_with_budget(
    tasks: &TaskSupervisor,
    image_cache: Arc<ImageCache>,
    image_url: &str,
) -> Option<String> {
    let request = local_image_request(image_url)?;
    let (result_tx, result_rx) = oneshot::channel();
    tasks.spawn(async move {
        let result = fetch_local_image(image_cache, request).await;
        let _ = result_tx.send(result);
    });
    tokio::time::timeout(NOTIFICATION_IMAGE_FIRST_SEND_BUDGET, result_rx)
        .await
        .ok()
        .and_then(Result::ok)
        .flatten()
}

async fn fetch_local_image(
    image_cache: Arc<ImageCache>,
    request: LocalImageRequest,
) -> Option<String> {
    image_cache
        .get_image(&request.url, &request.file_id, &request.version)
        .await
        .ok()
}

#[cfg(test)]
mod tests;
