use std::sync::Arc;

use vrcx_0_application_activity::{
    OverlayActivityDelivery, OverlayActivitySink, OverlayActivitySnapshot,
};
use vrcx_0_application_core::{
    HostSessionRuntime, ImageCache, TaskSupervisor, WebClient, WorldCache,
};
use vrcx_0_host_desktop::tts::TtsEngine;
use vrcx_0_persistence::{config::ConfigRepository, DatabaseService};
use vrcx_0_runtime_host::notification::{
    config_bool, decide_notification_plan, extract_file_id, extract_file_version,
    fallback_file_version, load_notification_locale, load_preferences, render_delivery,
    resolve_delivery_actor_image, resolve_delivery_world_name, NotificationDeliveryGameState,
    NotificationDeliveryPlan, NotificationDeliveryPreferences, OverlayLocale,
    RealtimeUserImageResolverSlot, RenderedNotification, UserImageCache,
};

use super::desktop::{send_desktop_notification, DesktopNotifier};
use super::overlay_transport::OverlayNotificationTransport;
use super::tts::send_tts_notification;

pub struct NotificationDispatcher {
    session: HostSessionRuntime,
    config: ConfigRepository,
    db: Arc<DatabaseService>,
    image_cache: Arc<ImageCache>,
    overlay_transport: Arc<OverlayNotificationTransport>,
    web: Arc<WebClient>,
    world_cache: Arc<WorldCache>,
    user_image_cache: Arc<UserImageCache>,
    realtime_user_image_resolver: RealtimeUserImageResolverSlot,
    desktop: Arc<dyn DesktopNotifier>,
    tts: Arc<dyn TtsEngine>,
    tasks: TaskSupervisor,
}

pub struct NotificationDispatcherDeps {
    pub session: HostSessionRuntime,
    pub config: ConfigRepository,
    pub db: Arc<DatabaseService>,
    pub image_cache: Arc<ImageCache>,
    pub web: Arc<WebClient>,
    pub world_cache: Arc<WorldCache>,
    pub user_image_cache: Arc<UserImageCache>,
    pub realtime_user_image_resolver: RealtimeUserImageResolverSlot,
    pub desktop: Arc<dyn DesktopNotifier>,
    pub tts: Arc<dyn TtsEngine>,
    pub tasks: TaskSupervisor,
}

impl NotificationDispatcher {
    pub fn new(deps: NotificationDispatcherDeps) -> Self {
        Self {
            session: deps.session,
            config: deps.config,
            db: deps.db,
            image_cache: deps.image_cache,
            overlay_transport: Arc::new(OverlayNotificationTransport::new()),
            web: deps.web,
            world_cache: deps.world_cache,
            user_image_cache: deps.user_image_cache,
            realtime_user_image_resolver: deps.realtime_user_image_resolver,
            desktop: deps.desktop,
            tts: deps.tts,
            tasks: deps.tasks,
        }
    }
}

impl OverlayActivitySink for NotificationDispatcher {
    fn emit_overlay_activity_snapshot(&self, _snapshot: OverlayActivitySnapshot) {}

    fn emit_overlay_activity_delivery(&self, delivery: OverlayActivityDelivery) {
        let preferences = load_preferences(&self.config);
        let game = load_game_state(&self.session, &self.config);
        let plan = decide_notification_plan(&delivery, &preferences, &game);
        if !plan.has_local_transport() {
            return;
        }
        let locale = load_notification_locale(&self.config);
        let realtime_context = self.session.snapshot().realtime_context;
        let endpoint = realtime_context
            .as_ref()
            .map(|context| context.endpoint.clone())
            .unwrap_or_default();
        let current_user_id = realtime_context
            .map(|context| context.current_user_id)
            .unwrap_or_default();
        let world_cache = Arc::clone(&self.world_cache);
        let image_cache = Arc::clone(&self.image_cache);
        let overlay_transport = Arc::clone(&self.overlay_transport);
        let web = Arc::clone(&self.web);
        let db = Arc::clone(&self.db);
        let user_image_cache = Arc::clone(&self.user_image_cache);
        let realtime_user_image_resolver = self.realtime_user_image_resolver.clone();
        let allow_user_icon = config_bool(&self.config, "displayVRCPlusIconsAsAvatar", true);
        let desktop = Arc::clone(&self.desktop);
        let tts = Arc::clone(&self.tts);

        self.tasks.spawn(async move {
            let mut delivery = delivery;
            let needs_local_image = preferences.image_notifications && plan.needs_local_image();
            let world_name_result = resolve_delivery_world_name(
                world_cache.as_ref(),
                web.as_ref(),
                &endpoint,
                &delivery,
            );
            let actor_image_result = async {
                if !needs_local_image {
                    return None;
                }
                resolve_delivery_actor_image(
                    user_image_cache.as_ref(),
                    web.as_ref(),
                    db.as_ref(),
                    &endpoint,
                    allow_user_icon,
                    &current_user_id,
                    &realtime_user_image_resolver,
                    &delivery,
                )
                .await
            };
            let (world_name_result, actor_image_result) =
                tokio::join!(world_name_result, actor_image_result);
            if let Some((world_name, display_location)) = world_name_result {
                delivery.entry.content.world_name = world_name;
                if !display_location.trim().is_empty() {
                    delivery.entry.content.display_location = display_location;
                }
            }
            if let Some(image_url) = actor_image_result {
                delivery.entry.content.image_url = image_url;
            }
            let render =
                render_delivery(&delivery, locale, preferences.show_instance_id_in_location);
            dispatch_local_notification(
                &delivery,
                &preferences,
                plan,
                &render,
                locale,
                image_cache.as_ref(),
                overlay_transport.as_ref(),
                db.as_ref(),
                desktop.as_ref(),
                tts.as_ref(),
            )
            .await;
        });
    }
}

#[allow(clippy::too_many_arguments)]
async fn dispatch_local_notification(
    delivery: &OverlayActivityDelivery,
    preferences: &NotificationDeliveryPreferences,
    plan: NotificationDeliveryPlan,
    render: &RenderedNotification,
    locale: OverlayLocale,
    image_cache: &ImageCache,
    overlay_transport: &OverlayNotificationTransport,
    db: &DatabaseService,
    desktop: &dyn DesktopNotifier,
    tts: &dyn TtsEngine,
) {
    if plan.tts {
        send_tts_notification(tts, db, delivery, render, preferences, locale);
    }

    let local_image = if plan.needs_local_image() && preferences.image_notifications {
        resolve_local_image(image_cache, &render.image_url).await
    } else {
        None
    };
    let local_image = local_image.as_deref();

    if plan.desktop {
        send_desktop_notification(desktop, render, preferences, local_image);
    }
    overlay_transport.send(plan, render, preferences, local_image);
}

fn load_game_state(
    session: &HostSessionRuntime,
    config: &ConfigRepository,
) -> NotificationDeliveryGameState {
    let snapshot = session.snapshot();
    NotificationDeliveryGameState {
        is_game_running: snapshot.is_game_running,
        is_steamvr_running: snapshot.is_steamvr_running,
        is_game_no_vr: config_bool(config, "isGameNoVR", false),
    }
}

async fn resolve_local_image(image_cache: &ImageCache, image_url: &str) -> Option<String> {
    let url = image_url.trim();
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return None;
    }
    let file_id = extract_file_id(url)?;
    let version = extract_file_version(url, &file_id).unwrap_or_else(|| fallback_file_version(url));
    if version.is_empty() {
        return None;
    }
    image_cache.get_image(url, &file_id, &version).await.ok()
}

#[cfg(test)]
mod tests;
