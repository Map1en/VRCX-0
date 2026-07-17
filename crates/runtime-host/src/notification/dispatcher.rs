use std::borrow::Cow;
use std::sync::{Arc, Mutex};
use vrcx_0_application::{
    HostSessionRuntime, ImageCache, OverlayActivityDelivery, OverlayActivitySink,
    OverlayActivitySnapshot, RealtimeHostRuntime, RuntimeDiagnostics, TaskSupervisor, WebClient,
    WorldCache,
};
use vrcx_0_core::location::{format_display_location, is_meaningful_world_name, parse_location};
use vrcx_0_host::overlay_notifications::{send_xs_notification, OvrToolkit};
use vrcx_0_host::tts::TtsEngine;
use vrcx_0_persistence::config::ConfigRepository;
use vrcx_0_persistence::DatabaseService;

use super::discord::{build_discord_payload, DiscordDeps};
use super::image_file::{extract_file_id, extract_file_version, fallback_file_version};
use super::rendered::RenderedNotification;
use super::webhook::send_json_webhook_with_retry;
use crate::notification::user_image::{normalize_avatar_image_url_128, UserImageCache};
use crate::vr_overlay::{OverlayLocale, OverlayLocalizer};

mod generic_webhook;
mod preferences;

use generic_webhook::{default_webhook_fields, generic_webhook_payload};
pub use generic_webhook::{filter_generic_webhook_payload, webhook_local_time_string};
#[cfg(test)]
use preferences::config_tts_name_mode;
pub use preferences::parse_webhook_fields;
use preferences::{config_bool, load_preferences};

const APP_LANGUAGE_CONFIG_KEY: &str = "appLanguage";
const OVERLAY_NOTIFICATION_APP_TITLE: &str = "VRCX-0";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NotificationDeliveryPreferences {
    pub desktop_toast: String,
    pub desktop_notification_sound: bool,
    pub notification_tts: String,
    pub notification_tts_name_mode: String,
    pub notification_tts_voice_native: String,
    pub xs_notifications: bool,
    pub ovrt_hud_notifications: bool,
    pub ovrt_wrist_notifications: bool,
    pub image_notifications: bool,
    pub notification_timeout_ms: i32,
    pub notification_opacity_percent: i32,
    pub webhook_enabled: bool,
    pub webhook_url: String,
    pub webhook_format: String,
    pub webhook_fields: Vec<String>,
    pub show_instance_id_in_location: bool,
}

impl Default for NotificationDeliveryPreferences {
    fn default() -> Self {
        Self {
            desktop_toast: "Never".into(),
            desktop_notification_sound: false,
            notification_tts: "Never".into(),
            notification_tts_name_mode: "username".into(),
            notification_tts_voice_native: String::new(),
            xs_notifications: false,
            ovrt_hud_notifications: false,
            ovrt_wrist_notifications: false,
            image_notifications: true,
            notification_timeout_ms: 3000,
            notification_opacity_percent: 100,
            webhook_enabled: false,
            webhook_url: String::new(),
            webhook_format: "generic".into(),
            webhook_fields: default_webhook_fields(),
            show_instance_id_in_location: false,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct NotificationDeliveryGameState {
    pub is_game_running: bool,
    pub is_steamvr_running: bool,
    pub is_game_no_vr: bool,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct NotificationDeliveryPlan {
    pub desktop: bool,
    pub xs: bool,
    pub ovrt: bool,
    pub ovrt_hud: bool,
    pub ovrt_wrist: bool,
    pub webhook: bool,
    pub tts: bool,
}

impl NotificationDeliveryPlan {
    fn is_empty(self) -> bool {
        !self.desktop && !self.xs && !self.ovrt && !self.webhook && !self.tts
    }

    fn needs_local_image(self) -> bool {
        self.desktop || self.xs || self.ovrt
    }
}

pub fn decide_notification_plan(
    delivery: &OverlayActivityDelivery,
    preferences: &NotificationDeliveryPreferences,
    game: &NotificationDeliveryGameState,
) -> NotificationDeliveryPlan {
    let desktop = delivery.desktop && should_play_for_condition(&preferences.desktop_toast, game);
    let vr = delivery.vr && game.is_steamvr_running;
    let xs = vr && preferences.xs_notifications;
    let ovrt_hud = vr && preferences.ovrt_hud_notifications;
    let ovrt_wrist = vr && preferences.ovrt_wrist_notifications;
    let ovrt = ovrt_hud || ovrt_wrist;
    let webhook = delivery.webhook
        && preferences.webhook_enabled
        && !preferences.webhook_url.trim().is_empty();
    let tts = delivery.tts && should_play_for_condition(&preferences.notification_tts, game);

    NotificationDeliveryPlan {
        desktop,
        xs,
        ovrt,
        ovrt_hud,
        ovrt_wrist,
        webhook,
        tts,
    }
}

pub trait DesktopNotifier: Send + Sync {
    fn show(
        &self,
        title: &str,
        body: Option<&str>,
        image: Option<&str>,
        play_sound: bool,
    ) -> Result<(), String>;
}

#[derive(Clone, Default)]
pub struct DesktopNotifierSlot {
    inner: Arc<Mutex<Option<Arc<dyn DesktopNotifier>>>>,
}

impl DesktopNotifierSlot {
    pub fn set(&self, notifier: Arc<dyn DesktopNotifier>) {
        match self.inner.lock() {
            Ok(mut slot) => {
                *slot = Some(notifier);
            }
            Err(error) => {
                tracing::warn!("failed to set desktop notification bridge: {error}");
            }
        }
    }
}

impl DesktopNotifier for DesktopNotifierSlot {
    fn show(
        &self,
        title: &str,
        body: Option<&str>,
        image: Option<&str>,
        play_sound: bool,
    ) -> Result<(), String> {
        let notifier = self
            .inner
            .lock()
            .map_err(|error| format!("desktop notification bridge lock poisoned: {error}"))?
            .clone();
        let Some(notifier) = notifier else {
            return Ok(());
        };
        notifier.show(title, body, image, play_sound)
    }
}

#[derive(Clone, Default)]
pub struct RealtimeUserImageResolverSlot {
    inner: Arc<Mutex<Option<Arc<RealtimeHostRuntime>>>>,
}

impl RealtimeUserImageResolverSlot {
    pub fn set(&self, runtime: Arc<RealtimeHostRuntime>) {
        match self.inner.lock() {
            Ok(mut slot) => {
                *slot = Some(runtime);
            }
            Err(error) => {
                tracing::warn!("failed to set realtime user image resolver bridge: {error}");
            }
        }
    }

    pub(crate) fn cached_url(
        &self,
        endpoint: &str,
        user_id: &str,
        allow_user_icon: bool,
    ) -> Option<String> {
        let runtime = self.inner.lock().ok()?.clone()?;
        runtime.cached_user_notification_image_url(endpoint, user_id, allow_user_icon)
    }
}

pub struct NotificationDispatcher {
    session: HostSessionRuntime,
    config: ConfigRepository,
    db: Arc<DatabaseService>,
    image_cache: Arc<ImageCache>,
    ovrt: Arc<OvrToolkit>,
    web: Arc<WebClient>,
    world_cache: Arc<WorldCache>,
    user_image_cache: Arc<UserImageCache>,
    realtime_user_image_resolver: RealtimeUserImageResolverSlot,
    desktop: Arc<dyn DesktopNotifier>,
    tts: Arc<dyn TtsEngine>,
    diagnostics: RuntimeDiagnostics,
    tasks: TaskSupervisor,
}

pub struct NotificationDispatcherDeps {
    pub session: HostSessionRuntime,
    pub config: ConfigRepository,
    pub db: Arc<DatabaseService>,
    pub image_cache: Arc<ImageCache>,
    pub web: Arc<WebClient>,
    pub world_cache: Arc<WorldCache>,
    pub realtime_user_image_resolver: RealtimeUserImageResolverSlot,
    pub desktop: Arc<dyn DesktopNotifier>,
    pub tts: Arc<dyn TtsEngine>,
    pub diagnostics: RuntimeDiagnostics,
    pub tasks: TaskSupervisor,
}

impl NotificationDispatcher {
    pub fn new(deps: NotificationDispatcherDeps) -> Self {
        Self {
            session: deps.session,
            config: deps.config,
            db: deps.db,
            image_cache: deps.image_cache,
            ovrt: Arc::new(OvrToolkit::new()),
            web: deps.web,
            world_cache: deps.world_cache,
            user_image_cache: Arc::new(UserImageCache::new()),
            realtime_user_image_resolver: deps.realtime_user_image_resolver,
            desktop: deps.desktop,
            tts: deps.tts,
            diagnostics: deps.diagnostics,
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
        if plan.is_empty() {
            return;
        }
        let locale = load_locale(&self.config);
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
        let ovrt = Arc::clone(&self.ovrt);
        let web = Arc::clone(&self.web);
        let db = Arc::clone(&self.db);
        let user_image_cache = Arc::clone(&self.user_image_cache);
        let realtime_user_image_resolver = self.realtime_user_image_resolver.clone();
        let allow_user_icon = config_bool(&self.config, "displayVRCPlusIconsAsAvatar", true);
        let desktop = Arc::clone(&self.desktop);
        let tts = Arc::clone(&self.tts);
        let diagnostics = self.diagnostics.clone();

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
            dispatch_rendered_notification(
                delivery,
                preferences,
                plan,
                render,
                locale,
                world_cache,
                image_cache,
                user_image_cache,
                ovrt,
                web,
                db,
                endpoint,
                allow_user_icon,
                desktop,
                tts,
                diagnostics,
            )
            .await;
        });
    }
}

#[allow(clippy::too_many_arguments)]
async fn dispatch_rendered_notification(
    delivery: OverlayActivityDelivery,
    preferences: NotificationDeliveryPreferences,
    plan: NotificationDeliveryPlan,
    render: RenderedNotification,
    locale: OverlayLocale,
    world_cache: Arc<WorldCache>,
    image_cache: Arc<ImageCache>,
    user_image_cache: Arc<UserImageCache>,
    ovrt: Arc<OvrToolkit>,
    web: Arc<WebClient>,
    db: Arc<DatabaseService>,
    endpoint: String,
    allow_user_icon: bool,
    desktop: Arc<dyn DesktopNotifier>,
    tts: Arc<dyn TtsEngine>,
    diagnostics: RuntimeDiagnostics,
) {
    if plan.tts {
        let text = notification_tts_text(db.as_ref(), &delivery, &render, &preferences, locale);
        if let Err(error) = tts.speak(&text, non_empty(&preferences.notification_tts_voice_native))
        {
            tracing::warn!("[TTS] notification speak failed: {error}");
        }
    }

    let local_image = if plan.needs_local_image() && preferences.image_notifications {
        resolve_local_image(image_cache.as_ref(), &render.image_url).await
    } else {
        None
    };
    let local_image_ref = local_image.as_deref();
    let timeout_seconds = (preferences.notification_timeout_ms.max(0) / 1000).max(0);
    let opacity = (preferences.notification_opacity_percent.clamp(0, 100) as f64) / 100.0;
    let overlay_render = overlay_notification_render(&render);

    if plan.desktop {
        if let Err(error) = desktop.show(
            &render.title,
            non_empty(&render.body),
            local_image_ref,
            preferences.desktop_notification_sound,
        ) {
            tracing::warn!("[Desktop] notification send failed: {error}");
        }
    }

    if plan.xs {
        if let Err(error) = send_xs_notification(
            overlay_render.title,
            overlay_render.text,
            timeout_seconds,
            opacity,
            local_image_ref,
        ) {
            tracing::warn!("[XSOverlay] notification send failed: {error}");
        }
    }

    if plan.ovrt {
        ovrt.send_notification(
            plan.ovrt_hud,
            plan.ovrt_wrist,
            overlay_render.title,
            overlay_render.text,
            timeout_seconds,
            opacity,
            local_image_ref,
        );
    }

    if plan.webhook {
        let discord_deps = DiscordDeps {
            world_cache: world_cache.as_ref(),
            user_image_cache: user_image_cache.as_ref(),
            web: web.as_ref(),
            db: db.as_ref(),
            endpoint: &endpoint,
            allow_user_icon,
        };
        send_webhook_with_retry(
            &discord_deps,
            &diagnostics,
            &delivery,
            &render,
            &preferences,
            locale,
        )
        .await;
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct OverlayRenderedNotification<'a> {
    title: &'static str,
    text: &'a str,
}

fn overlay_notification_render(render: &RenderedNotification) -> OverlayRenderedNotification<'_> {
    OverlayRenderedNotification {
        title: OVERLAY_NOTIFICATION_APP_TITLE,
        text: &render.text,
    }
}

async fn resolve_delivery_world_name(
    world_cache: &WorldCache,
    web: &WebClient,
    endpoint: &str,
    delivery: &OverlayActivityDelivery,
) -> Option<(String, String)> {
    if is_meaningful_world_name(&delivery.entry.content.world_name) {
        return None;
    }
    let world_id = {
        let content = &delivery.entry.content;
        let explicit = content.world_id.trim();
        if explicit.is_empty() {
            parse_location(&content.location).world_id
        } else {
            explicit.to_string()
        }
    };
    if world_id.is_empty() {
        return None;
    }
    let name = world_cache.resolve_name(web, endpoint, &world_id).await?;
    let parsed = parse_location(&delivery.entry.content.location);
    let display_location =
        format_display_location(&parsed, &name, &delivery.entry.content.group_name);
    Some((name, display_location))
}

#[allow(clippy::too_many_arguments)]
async fn resolve_delivery_actor_image(
    user_image_cache: &UserImageCache,
    web: &WebClient,
    db: &DatabaseService,
    endpoint: &str,
    allow_user_icon: bool,
    current_user_id: &str,
    realtime_user_image_resolver: &RealtimeUserImageResolverSlot,
    delivery: &OverlayActivityDelivery,
) -> Option<String> {
    let actor_user_id = delivery_actor_image_user_id(delivery, current_user_id)?;
    if let Some(image_url) = realtime_user_image_resolver
        .cached_url(endpoint, actor_user_id, allow_user_icon)
        .map(|url| normalize_avatar_image_url_128(&url, endpoint))
    {
        return Some(image_url);
    }
    user_image_cache
        .resolve(web, db, endpoint, actor_user_id, allow_user_icon)
        .await
}

fn delivery_actor_image_user_id<'a>(
    delivery: &'a OverlayActivityDelivery,
    current_user_id: &str,
) -> Option<&'a str> {
    if !delivery.entry.content.image_url.trim().is_empty() {
        return None;
    }
    let actor_user_id = delivery.entry.actor_user_id.trim();
    if !actor_user_id.starts_with("usr_") {
        return None;
    }
    let current_user_id = current_user_id.trim();
    if !current_user_id.is_empty() && actor_user_id == current_user_id {
        return None;
    }
    Some(actor_user_id)
}

fn render_delivery(
    delivery: &OverlayActivityDelivery,
    locale: OverlayLocale,
    show_instance_id: bool,
) -> RenderedNotification {
    let localizer = OverlayLocalizer::with_instance_id(locale, show_instance_id);
    let entry = &delivery.entry;
    let title = localizer.activity_text(
        &entry.content.title,
        &entry.content.location,
        &entry.content.world_name,
        &entry.content.group_name,
    );
    let body = localizer.activity_text(
        &entry.content.body,
        &entry.content.location,
        &entry.content.world_name,
        &entry.content.group_name,
    );
    let text = combine_text(&title, &body);
    let display_location = localizer.display_location(
        &entry.content.location,
        &entry.content.world_name,
        &entry.content.group_name,
    );
    RenderedNotification {
        title,
        body,
        text,
        display_location,
        image_url: entry.content.image_url.clone(),
    }
}

fn combine_text(title: &str, body: &str) -> String {
    let title = title.trim();
    let body = body.trim();
    match (title.is_empty(), body.is_empty()) {
        (false, false) => format!("{title} {body}"),
        (false, true) => title.to_string(),
        (true, false) => body.to_string(),
        (true, true) => String::new(),
    }
}

fn notification_tts_text(
    db: &DatabaseService,
    delivery: &OverlayActivityDelivery,
    render: &RenderedNotification,
    preferences: &NotificationDeliveryPreferences,
    locale: OverlayLocale,
) -> String {
    let render = if preferences.show_instance_id_in_location {
        Cow::Owned(render_delivery(delivery, locale, false))
    } else {
        Cow::Borrowed(render)
    };
    let name_mode = notification_tts_name_mode(&preferences.notification_tts_name_mode);
    if name_mode == "username" {
        return render.text.clone();
    }
    let title = render.title.trim();
    let actor_user_id = delivery.entry.actor_user_id.trim();
    if title.is_empty() || actor_user_id.is_empty() {
        return render.text.clone();
    }
    let Some(memo_first_line) = user_memo_first_line(db, actor_user_id) else {
        return render.text.clone();
    };
    let replacement = match name_mode {
        "note" => memo_first_line,
        "usernameAndNote" => format!("{title}, {memo_first_line}"),
        _ => return render.text.clone(),
    };
    render.text.replacen(title, &replacement, 1)
}

fn notification_tts_name_mode(value: &str) -> &'static str {
    match value {
        "note" => "note",
        "usernameAndNote" => "usernameAndNote",
        _ => "username",
    }
}

fn user_memo_first_line(db: &DatabaseService, actor_user_id: &str) -> Option<String> {
    match vrcx_0_persistence::memos::memo_get_user(db, actor_user_id.to_string()) {
        Ok(Some(memo)) => memo
            .memo
            .lines()
            .next()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string),
        Ok(None) => None,
        Err(error) => {
            tracing::debug!("failed to load TTS nickname memo: {error}");
            None
        }
    }
}

fn should_play_for_condition(condition: &str, game: &NotificationDeliveryGameState) -> bool {
    match condition {
        "Always" => true,
        "Inside VR" => game.is_steamvr_running,
        "Outside VR" => !game.is_steamvr_running,
        "Game Closed" => !game.is_game_running,
        "Game Running" => game.is_game_running,
        "Desktop Mode" => game.is_game_no_vr && game.is_game_running,
        _ => false,
    }
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

fn load_locale(config: &ConfigRepository) -> OverlayLocale {
    config
        .get_string(APP_LANGUAGE_CONFIG_KEY, "en")
        .map(|value| OverlayLocale::from_config(&value))
        .unwrap_or_default()
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

async fn send_webhook_with_retry(
    discord_deps: &DiscordDeps<'_>,
    diagnostics: &RuntimeDiagnostics,
    delivery: &OverlayActivityDelivery,
    render: &RenderedNotification,
    preferences: &NotificationDeliveryPreferences,
    locale: OverlayLocale,
) {
    let url = preferences.webhook_url.trim();
    if url.is_empty() {
        return;
    }
    let payload = if preferences.webhook_format == "discord" {
        build_discord_payload(discord_deps, delivery, render, locale).await
    } else {
        generic_webhook_payload(delivery, render, &preferences.webhook_fields)
    };
    send_json_webhook_with_retry(
        discord_deps.web,
        diagnostics,
        url,
        payload,
        "notificationWebhook",
        &delivery.entry.activity_type,
    )
    .await;
}

fn non_empty(value: &str) -> Option<&str> {
    let value = value.trim();
    (!value.is_empty()).then_some(value)
}

#[cfg(test)]
mod tests;
