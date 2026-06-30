use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{json, Value};
use vrcx_0_application::{
    HostSessionRuntime, ImageCache, OverlayActivityDelivery, OverlayActivitySink,
    OverlayActivitySnapshot, RuntimeDiagnostics, RuntimeEventBus, TaskSupervisor, WebClient,
    WorldCache,
};
use vrcx_0_core::location::{
    format_display_location, is_meaningful_world_name, parse_location, ParsedLocation,
};
use vrcx_0_core::vrchat_endpoints::VRCHAT_SITE_ORIGIN;
use vrcx_0_host::overlay_notifications::{send_xs_notification, OvrToolkit};
use vrcx_0_persistence::config::ConfigRepository;
use vrcx_0_persistence::worlds::world_cache_get;
use vrcx_0_persistence::DatabaseService;
use vrcx_0_vrchat_client::avatars::avatar_file_get_input;
use vrcx_0_vrchat_client::http_api::ApiScope;
use vrcx_0_vrchat_client::web_client::WebExecuteRequest;

use crate::notification::user_image::UserImageCache;
use crate::vr_overlay::{
    discord_embed_kind, discord_title_key, DiscordEmbedKind, OverlayLocale, OverlayLocalizer,
};

const APP_LANGUAGE_CONFIG_KEY: &str = "appLanguage";
const WEBHOOK_TIMEOUT: Duration = Duration::from_secs(10);
const OVERLAY_NOTIFICATION_APP_TITLE: &str = "VRCX-0";
const WEBHOOK_RETRY_DELAYS: &[Duration] = &[Duration::from_millis(750), Duration::from_secs(2)];
const DEFAULT_WEBHOOK_FIELDS: &[&str] = &[
    "version",
    "event",
    "category",
    "title",
    "message",
    "user",
    "location",
    "locationId",
    "worldId",
    "worldName",
    "timestamp",
    "localTime",
];

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NotificationDeliveryPreferences {
    pub desktop_toast: String,
    pub desktop_notification_sound: bool,
    pub notification_tts: String,
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
}

impl Default for NotificationDeliveryPreferences {
    fn default() -> Self {
        Self {
            desktop_toast: "Never".into(),
            desktop_notification_sound: false,
            notification_tts: "Never".into(),
            xs_notifications: true,
            ovrt_hud_notifications: true,
            ovrt_wrist_notifications: false,
            image_notifications: true,
            notification_timeout_ms: 3000,
            notification_opacity_percent: 100,
            webhook_enabled: false,
            webhook_url: String::new(),
            webhook_format: "generic".into(),
            webhook_fields: default_webhook_fields(),
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
    let tts = (delivery.desktop || delivery.vr)
        && should_play_for_condition(&preferences.notification_tts, game);

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

pub struct NotificationDispatcher {
    session: HostSessionRuntime,
    config: ConfigRepository,
    db: Arc<DatabaseService>,
    image_cache: Arc<ImageCache>,
    ovrt: Arc<OvrToolkit>,
    web: Arc<WebClient>,
    world_cache: Arc<WorldCache>,
    user_image_cache: Arc<UserImageCache>,
    desktop: Arc<dyn DesktopNotifier>,
    event_bus: RuntimeEventBus,
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
    pub desktop: Arc<dyn DesktopNotifier>,
    pub event_bus: RuntimeEventBus,
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
            desktop: deps.desktop,
            event_bus: deps.event_bus,
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
        let allow_user_icon = config_bool(&self.config, "displayVRCPlusIconsAsAvatar", true);
        let desktop = Arc::clone(&self.desktop);
        let event_bus = self.event_bus.clone();
        let diagnostics = self.diagnostics.clone();

        self.tasks.spawn(async move {
            let mut delivery = delivery;
            resolve_delivery_world_name(
                world_cache.as_ref(),
                web.as_ref(),
                &endpoint,
                &mut delivery,
            )
            .await;
            if preferences.image_notifications && plan.needs_local_image() {
                resolve_delivery_actor_image(
                    user_image_cache.as_ref(),
                    web.as_ref(),
                    db.as_ref(),
                    &endpoint,
                    allow_user_icon,
                    &current_user_id,
                    &mut delivery,
                )
                .await;
            }
            let is_discord = plan.webhook && preferences.webhook_format == "discord";
            if is_discord {
                resolve_delivery_avatar_name(web.as_ref(), db.as_ref(), &endpoint, &mut delivery)
                    .await;
            }
            let mut render = render_delivery(&delivery, locale);
            if is_discord {
                let (actor_image_url, world_image_url) = tokio::join!(
                    resolve_actor_icon_url(
                        user_image_cache.as_ref(),
                        web.as_ref(),
                        db.as_ref(),
                        &endpoint,
                        allow_user_icon,
                        &delivery,
                    ),
                    resolve_world_thumbnail_url(
                        world_cache.as_ref(),
                        db.as_ref(),
                        web.as_ref(),
                        &endpoint,
                        &delivery,
                    ),
                );
                render.actor_image_url = actor_image_url;
                render.world_image_url = world_image_url;
            }
            dispatch_rendered_notification(
                delivery,
                preferences,
                plan,
                render,
                locale,
                image_cache,
                ovrt,
                web,
                desktop,
                event_bus,
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
    image_cache: Arc<ImageCache>,
    ovrt: Arc<OvrToolkit>,
    web: Arc<WebClient>,
    desktop: Arc<dyn DesktopNotifier>,
    event_bus: RuntimeEventBus,
    diagnostics: RuntimeDiagnostics,
) {
    if plan.tts {
        event_bus.emit("notificationTts", render.tts_payload(&delivery));
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
        send_webhook_with_retry(&web, &diagnostics, &delivery, &render, &preferences, locale).await;
    }
}

#[derive(Clone, Debug)]
struct RenderedNotification {
    title: String,
    body: String,
    text: String,
    display_location: String,
    image_url: String,
    actor_image_url: String,
    world_image_url: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct OverlayRenderedNotification<'a> {
    title: &'static str,
    text: &'a str,
}

impl RenderedNotification {
    fn tts_payload(&self, delivery: &OverlayActivityDelivery) -> Value {
        json!({
            "sourceId": &delivery.entry.source_id,
            "activityType": &delivery.entry.activity_type,
            "desktop": delivery.desktop,
            "vr": delivery.vr,
            "title": &self.title,
            "body": &self.body,
            "text": &self.text,
            "imageUrl": &self.image_url,
            "actorUserId": &delivery.entry.actor_user_id,
        })
    }
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
    delivery: &mut OverlayActivityDelivery,
) {
    if is_meaningful_world_name(&delivery.entry.content.world_name) {
        return;
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
        return;
    }
    let Some(name) = world_cache.resolve_name(web, endpoint, &world_id).await else {
        return;
    };
    let parsed = parse_location(&delivery.entry.content.location);
    let display_location =
        format_display_location(&parsed, &name, &delivery.entry.content.group_name);
    delivery.entry.content.world_name = name;
    if !display_location.trim().is_empty() {
        delivery.entry.content.display_location = display_location;
    }
}

async fn resolve_delivery_actor_image(
    user_image_cache: &UserImageCache,
    web: &WebClient,
    db: &DatabaseService,
    endpoint: &str,
    allow_user_icon: bool,
    current_user_id: &str,
    delivery: &mut OverlayActivityDelivery,
) {
    let Some(actor_user_id) = delivery_actor_image_user_id(delivery, current_user_id) else {
        return;
    };
    let Some(image_url) = user_image_cache
        .resolve(web, db, endpoint, actor_user_id, allow_user_icon)
        .await
    else {
        return;
    };
    delivery.entry.content.image_url = image_url;
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

async fn resolve_delivery_avatar_name(
    web: &WebClient,
    db: &DatabaseService,
    endpoint: &str,
    delivery: &mut OverlayActivityDelivery,
) {
    if delivery.entry.activity_type != "AvatarChange" {
        return;
    }
    if !delivery.entry.content.avatar_name.trim().is_empty() {
        return;
    }
    let Some(file_id) = extract_file_id(&delivery.entry.content.image_url) else {
        return;
    };
    let Ok((_, request)) = avatar_file_get_input(endpoint.to_string(), file_id) else {
        return;
    };
    let response = match tokio::time::timeout(
        WEBHOOK_TIMEOUT,
        web.execute_api(request, ApiScope::Vrchat, db),
    )
    .await
    {
        Ok(Ok(response)) => response,
        _ => return,
    };
    if !(200..=299).contains(&response.status) {
        return;
    }
    let Ok(value) = serde_json::from_str::<Value>(&response.data) else {
        return;
    };
    if let Some(file_name) = value.get("name").and_then(Value::as_str) {
        if let Some(name) = avatar_name_from_file_name(file_name) {
            delivery.entry.content.avatar_name = name;
        }
    }
}

fn avatar_name_from_file_name(file_name: &str) -> Option<String> {
    let lower = file_name.to_ascii_lowercase();
    let start = lower.find("avatar - ")? + "avatar - ".len();
    let end = lower.rfind(" - image -")?;
    if end < start {
        return None;
    }
    let name = file_name[start..end].trim();
    (!name.is_empty()).then(|| name.to_string())
}

async fn resolve_actor_icon_url(
    user_image_cache: &UserImageCache,
    web: &WebClient,
    db: &DatabaseService,
    endpoint: &str,
    allow_user_icon: bool,
    delivery: &OverlayActivityDelivery,
) -> String {
    let actor = delivery.entry.actor_user_id.trim();
    if actor.is_empty() {
        return String::new();
    }
    user_image_cache
        .resolve(web, db, endpoint, actor, allow_user_icon)
        .await
        .unwrap_or_default()
}

async fn resolve_world_thumbnail_url(
    world_cache: &WorldCache,
    db: &DatabaseService,
    web: &WebClient,
    endpoint: &str,
    delivery: &OverlayActivityDelivery,
) -> String {
    let content = &delivery.entry.content;
    let explicit = content.world_id.trim();
    let world_id = if explicit.is_empty() {
        parse_location(&content.location).world_id
    } else {
        explicit.to_string()
    };
    if world_id.is_empty() {
        return String::new();
    }
    let _ = world_cache.resolve_name(web, endpoint, &world_id).await;
    match world_cache_get(db, world_id.clone()) {
        Ok(Some(world)) => {
            let thumbnail = world.thumbnail_image_url.trim();
            if thumbnail.is_empty() {
                world.image_url.trim().to_string()
            } else {
                thumbnail.to_string()
            }
        }
        Ok(None) => String::new(),
        Err(error) => {
            tracing::warn!(world_id = %world_id, "world thumbnail lookup failed: {error}");
            String::new()
        }
    }
}

fn render_delivery(
    delivery: &OverlayActivityDelivery,
    locale: OverlayLocale,
) -> RenderedNotification {
    let localizer = OverlayLocalizer::new(locale);
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
        actor_image_url: String::new(),
        world_image_url: String::new(),
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

fn load_preferences(config: &ConfigRepository) -> NotificationDeliveryPreferences {
    NotificationDeliveryPreferences {
        desktop_toast: config_string(config, "desktopToast", "Never"),
        desktop_notification_sound: config_bool(config, "desktopNotificationSound", false),
        notification_tts: config_string(config, "notificationTTS", "Never"),
        xs_notifications: config_bool_with_legacy(config, "xsNotifications", true),
        ovrt_hud_notifications: config_bool_with_legacy(config, "ovrtHudNotifications", true),
        ovrt_wrist_notifications: config_bool_with_legacy(config, "ovrtWristNotifications", false),
        image_notifications: config_bool_with_legacy(config, "imageNotifications", true),
        notification_timeout_ms: config_int_with_legacy(config, "notificationTimeout", 3000),
        notification_opacity_percent: config_int_with_legacy(config, "notificationOpacity", 100),
        webhook_enabled: config_bool(config, "webhookEnabled", false),
        webhook_url: config_string(config, "webhookUrl", ""),
        webhook_format: normalize_webhook_format(&config_string(
            config,
            "webhookFormat",
            "generic",
        )),
        webhook_fields: parse_webhook_fields(&config_string(config, "webhookFields", "")),
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

fn config_string(config: &ConfigRepository, key: &str, default_value: &str) -> String {
    config
        .get_string(key, default_value)
        .unwrap_or_else(|_| default_value.to_string())
}

fn config_bool(config: &ConfigRepository, key: &str, default_value: bool) -> bool {
    config.get_bool(key, default_value).unwrap_or(default_value)
}

fn config_bool_with_legacy(config: &ConfigRepository, key: &str, default_value: bool) -> bool {
    if config.get_raw(key).ok().flatten().is_some() {
        return config_bool(config, key, default_value);
    }
    if let Some(legacy_key) = legacy_overlay_notification_key(key) {
        if config.get_raw(legacy_key).ok().flatten().is_some() {
            return config_bool(config, legacy_key, default_value);
        }
    }
    default_value
}

fn config_int_with_legacy(config: &ConfigRepository, key: &str, default_value: i32) -> i32 {
    if let Some(raw) = config.get_raw(key).ok().flatten() {
        return parse_config_int(&raw, default_value);
    }
    if let Some(legacy_key) = legacy_overlay_notification_key(key) {
        if let Some(raw) = config.get_raw(legacy_key).ok().flatten() {
            return parse_config_int(&raw, default_value);
        }
    }
    default_value
}

fn parse_config_int(value: &str, default_value: i32) -> i32 {
    value.trim().parse::<i32>().unwrap_or(default_value)
}

fn legacy_overlay_notification_key(key: &str) -> Option<&'static str> {
    match key {
        "xsNotifications" => Some("VRCX-0_xsNotifications"),
        "ovrtHudNotifications" => Some("VRCX-0_ovrtHudNotifications"),
        "ovrtWristNotifications" => Some("VRCX-0_ovrtWristNotifications"),
        "imageNotifications" => Some("VRCX-0_imageNotifications"),
        "notificationTimeout" => Some("VRCX-0_notificationTimeout"),
        "notificationOpacity" => Some("VRCX-0_notificationOpacity"),
        _ => None,
    }
}

fn normalize_webhook_format(value: &str) -> String {
    if value == "discord" {
        "discord".into()
    } else {
        "generic".into()
    }
}

fn default_webhook_fields() -> Vec<String> {
    DEFAULT_WEBHOOK_FIELDS
        .iter()
        .map(|field| (*field).to_string())
        .collect()
}

pub fn parse_webhook_fields(value: &str) -> Vec<String> {
    let fields = value.trim();
    if fields.is_empty() {
        return default_webhook_fields();
    }
    let parsed = if fields.starts_with('[') {
        serde_json::from_str::<Vec<String>>(fields).unwrap_or_default()
    } else {
        fields.split(',').map(str::to_string).collect()
    };
    let mut selected = Vec::new();
    for field in parsed {
        let field = field.trim();
        if is_default_webhook_field(field) && !selected.iter().any(|item| item == field) {
            selected.push(field.to_string());
        }
    }
    if selected.is_empty() {
        default_webhook_fields()
    } else {
        selected
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

fn extract_file_id(value: &str) -> Option<String> {
    let start = value.find("file_")?;
    let id = value[start..]
        .chars()
        .take_while(|ch| ch.is_ascii_alphanumeric() || *ch == '-' || *ch == '_')
        .collect::<String>();
    (!id.is_empty()).then_some(id)
}

fn extract_file_version(value: &str, file_id: &str) -> Option<String> {
    let marker = format!("/{file_id}/");
    let start = value.find(&marker)? + marker.len();
    let version = value[start..]
        .chars()
        .take_while(|ch| ch.is_ascii_digit())
        .collect::<String>();
    (!version.is_empty()).then_some(version)
}

fn fallback_file_version(value: &str) -> String {
    value
        .split('/')
        .next_back()
        .unwrap_or_default()
        .split('?')
        .next()
        .unwrap_or_default()
        .to_string()
}

async fn send_webhook_with_retry(
    web: &WebClient,
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
    let payload = webhook_payload(
        delivery,
        render,
        &preferences.webhook_format,
        &preferences.webhook_fields,
        locale,
    );
    let body = match serde_json::to_string(&payload) {
        Ok(body) => body,
        Err(error) => {
            diagnostics.record_command("notificationWebhook", "error", error.to_string());
            return;
        }
    };
    let mut last_error = String::new();
    for attempt in 0..=WEBHOOK_RETRY_DELAYS.len() {
        match send_webhook_once(web, url, &body).await {
            Ok(status) if (200..=399).contains(&status) => return,
            Ok(status) => {
                last_error = format!("HTTP {status}");
                if !webhook_status_retryable(status) {
                    break;
                }
            }
            Err(error) => {
                last_error = error;
            }
        }
        if let Some(delay) = WEBHOOK_RETRY_DELAYS.get(attempt) {
            tokio::time::sleep(*delay).await;
        }
    }
    diagnostics.record_command(
        "notificationWebhook",
        "error",
        format!("{}: {last_error}", delivery.entry.activity_type),
    );
    tracing::warn!(
        activity_type = %delivery.entry.activity_type,
        error = %last_error,
        "webhook notification delivery failed"
    );
}

async fn send_webhook_once(web: &WebClient, url: &str, body: &str) -> Result<i32, String> {
    let mut request = WebExecuteRequest::new(url.to_string(), "POST".to_string());
    request
        .headers
        .push(("Content-Type".into(), "application/json".into()));
    request.body = Some(body.to_string());
    match tokio::time::timeout(WEBHOOK_TIMEOUT, web.execute(request)).await {
        Ok(Ok((status, _data))) => Ok(status),
        Ok(Err(error)) => Err(error.to_string()),
        Err(_) => Err("timeout".into()),
    }
}

fn webhook_status_retryable(status: i32) -> bool {
    matches!(status, 408 | 409 | 425 | 429 | 500..=599 | -1)
}

fn webhook_payload(
    delivery: &OverlayActivityDelivery,
    render: &RenderedNotification,
    format: &str,
    fields: &[String],
    locale: OverlayLocale,
) -> Value {
    if format == "discord" {
        return discord_webhook_payload(delivery, render, locale);
    }
    let entry = &delivery.entry;
    let payload = json!({
        "version": 1,
        "event": &entry.activity_type,
        "category": entry.category,
        "title": &render.title,
        "message": &render.text,
        "user": {
            "id": &entry.actor_user_id,
            "displayName": &entry.actor_display_name,
        },
        "location": &render.display_location,
        "locationId": &entry.content.location,
        "worldId": &entry.content.world_id,
        "worldName": &entry.content.world_name,
        "timestamp": &entry.created_at,
        "localTime": webhook_local_time_string(&entry.created_at),
    });
    filter_generic_webhook_payload(payload, fields)
}

pub fn filter_generic_webhook_payload(payload: Value, fields: &[String]) -> Value {
    let Some(object) = payload.as_object() else {
        return payload;
    };

    let mut filtered = serde_json::Map::new();
    if fields.is_empty() {
        for field in DEFAULT_WEBHOOK_FIELDS {
            insert_generic_webhook_field(&mut filtered, object, field);
        }
    } else {
        for field in fields {
            let field = field.as_str();
            if is_default_webhook_field(field) {
                insert_generic_webhook_field(&mut filtered, object, field);
            }
        }
    }
    Value::Object(filtered)
}

fn insert_generic_webhook_field(
    target: &mut serde_json::Map<String, Value>,
    source: &serde_json::Map<String, Value>,
    field: &str,
) {
    if let Some(value) = source.get(field) {
        target.insert(field.to_string(), value.clone());
    }
}

fn is_default_webhook_field(field: &str) -> bool {
    DEFAULT_WEBHOOK_FIELDS.contains(&field)
}

pub fn webhook_local_time_string(created_at: &str) -> String {
    chrono::DateTime::parse_from_rfc3339(created_at)
        .map(|value| {
            value
                .with_timezone(&chrono::Local)
                .format("%Y-%m-%d %H:%M:%S")
                .to_string()
        })
        .unwrap_or_default()
}

fn discord_webhook_payload(
    delivery: &OverlayActivityDelivery,
    render: &RenderedNotification,
    locale: OverlayLocale,
) -> Value {
    let entry = &delivery.entry;
    if discord_title_key(&entry.activity_type).is_none() {
        return discord_legacy_embed(delivery, render);
    }
    let localizer = OverlayLocalizer::new(locale);
    let parsed = parse_location(&entry.content.location);

    let mut title = localizer.discord_title(&entry.activity_type, &entry.actor_display_name);
    if title.trim().is_empty() {
        title = render.text.clone();
    }

    let mut description = String::new();
    match discord_embed_kind(&entry.activity_type) {
        DiscordEmbedKind::Invite => {
            let message = entry.content.detail.trim();
            if !message.is_empty() && message != render.display_location.trim() {
                description.push_str(&format!("\u{300c}{message}\u{300d}"));
            }
        }
        DiscordEmbedKind::Gps => {
            let content = &entry.content;
            let target = if !content.world_name.trim().is_empty() {
                content.world_name.trim()
            } else if !render.display_location.trim().is_empty() {
                render.display_location.trim()
            } else if !render.body.trim().is_empty() {
                render.body.trim()
            } else {
                render.text.trim()
            };
            if !target.is_empty() {
                description.push_str(&format!("\u{2192} {target}"));
            }
        }
        DiscordEmbedKind::Status => {
            let status = localizer.status_text(&entry.content.status);
            if !status.is_empty() {
                description.push_str(&status);
            }
        }
        DiscordEmbedKind::AvatarChange => {
            let avatar = entry.content.avatar_name.trim();
            if !avatar.is_empty() {
                description.push_str(avatar);
            }
        }
        DiscordEmbedKind::Other => {}
    }

    let author = build_discord_author(entry, render);

    // footer is only for actual instances; non-world events (login etc.) get none
    let mut footer = String::new();
    if !parsed.instance_name.is_empty() {
        footer.push_str(&format!("#{}", parsed.instance_name));
        let access = localizer.access_label(&entry.content.location);
        if !access.is_empty() {
            footer.push_str(&format!(" - {access}"));
        }
        if let Some(flag) = region_flag_emoji(&parsed.region) {
            footer.push_str(&format!(" {flag}"));
        }
    }

    let thumbnail_url = if render.world_image_url.trim().is_empty() {
        render.image_url.trim()
    } else {
        render.world_image_url.trim()
    };
    let thumbnail = if thumbnail_url.is_empty() {
        json!({})
    } else {
        json!({ "url": thumbnail_url })
    };

    let mut embed = serde_json::Map::new();
    embed.insert("title".into(), Value::String(title));
    if !description.is_empty() {
        embed.insert("description".into(), Value::String(description));
    }
    let url = launch_url(&parsed);
    if !url.is_empty() {
        embed.insert("url".into(), Value::String(url));
    }
    if !author.is_empty() {
        embed.insert("author".into(), Value::Object(author));
    }
    if !footer.is_empty() {
        embed.insert("footer".into(), json!({ "text": footer }));
    }
    embed.insert("timestamp".into(), Value::String(entry.created_at.clone()));
    embed.insert("thumbnail".into(), thumbnail);

    json!({
        "content": null,
        "embeds": [Value::Object(embed)],
    })
}

fn launch_url(parsed: &ParsedLocation) -> String {
    if parsed.world_id.is_empty() || parsed.instance_id.is_empty() {
        return String::new();
    }
    let mut url = format!(
        "{VRCHAT_SITE_ORIGIN}/home/launch?worldId={}&instanceId={}",
        parsed.world_id, parsed.instance_id
    );
    if !parsed.short_name.is_empty() {
        url.push_str("&shortName=");
        url.push_str(&parsed.short_name);
    }
    url
}

fn build_discord_author(
    entry: &vrcx_0_application::OverlayActivityEntry,
    render: &RenderedNotification,
) -> serde_json::Map<String, Value> {
    let mut author = serde_json::Map::new();
    if !entry.actor_display_name.trim().is_empty() {
        author.insert(
            "name".into(),
            Value::String(entry.actor_display_name.clone()),
        );
    }
    if !entry.actor_user_id.trim().is_empty() {
        author.insert(
            "url".into(),
            Value::String(format!(
                "{VRCHAT_SITE_ORIGIN}/home/user/{}",
                entry.actor_user_id
            )),
        );
    }
    if !render.actor_image_url.trim().is_empty() {
        author.insert(
            "icon_url".into(),
            Value::String(render.actor_image_url.clone()),
        );
    }
    author
}

fn discord_legacy_embed(
    delivery: &OverlayActivityDelivery,
    render: &RenderedNotification,
) -> Value {
    let entry = &delivery.entry;
    let description = if !render.body.trim().is_empty() {
        String::new()
    } else if !render.display_location.trim().is_empty() {
        format!("\u{2192} {}", render.display_location)
    } else if !entry.content.world_name.trim().is_empty() {
        format!("\u{2192} {}", entry.content.world_name)
    } else {
        String::new()
    };
    let thumbnail = if render.image_url.trim().is_empty() {
        json!({})
    } else {
        json!({ "url": render.image_url })
    };
    let author = build_discord_author(entry, render);
    // the author header already shows the actor name, so prefer the body alone
    // and fall back to the combined title+body text when there's no author/body
    let title = if author.is_empty() || render.body.trim().is_empty() {
        render.text.clone()
    } else {
        render.body.clone()
    };
    let mut embed = serde_json::Map::new();
    if !author.is_empty() {
        embed.insert("author".into(), Value::Object(author));
    }
    embed.insert("title".into(), Value::String(title));
    if !description.is_empty() {
        embed.insert("description".into(), Value::String(description));
    }
    embed.insert("thumbnail".into(), thumbnail);
    embed.insert("timestamp".into(), Value::String(entry.created_at.clone()));
    json!({
        "content": null,
        "embeds": [embed],
    })
}

fn region_flag_emoji(region: &str) -> Option<&'static str> {
    match region.trim().to_ascii_lowercase().as_str() {
        "us" | "use" | "usw" => Some("\u{1F1FA}\u{1F1F8}"),
        "eu" => Some("\u{1F1EA}\u{1F1FA}"),
        "jp" => Some("\u{1F1EF}\u{1F1F5}"),
        _ => None,
    }
}

fn non_empty(value: &str) -> Option<&str> {
    let value = value.trim();
    (!value.is_empty()).then_some(value)
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use vrcx_0_application::{
        OverlayActivityActorRelation, OverlayActivityCategory, OverlayActivityContent,
        OverlayActivityDelivery, OverlayActivityEntry,
    };

    use crate::vr_overlay::OverlayLocale;

    use super::{
        avatar_name_from_file_name, delivery_actor_image_user_id, overlay_notification_render,
        parse_webhook_fields, render_delivery, webhook_payload, RenderedNotification,
    };

    #[test]
    fn generic_webhook_payload_exposes_location_id_and_local_time() {
        let payload = webhook_payload(
            &delivery(),
            &rendered(),
            "generic",
            &["location".into(), "locationId".into(), "localTime".into()],
            OverlayLocale::En,
        );

        assert_eq!(
            payload.get("location").and_then(|value| value.as_str()),
            Some("Named World public")
        );
        assert_eq!(
            payload.get("locationId").and_then(|value| value.as_str()),
            Some("wrld_named:123")
        );
        let local_time = payload
            .get("localTime")
            .and_then(|value| value.as_str())
            .expect("localTime");
        assert_eq!(local_time.len(), "2026-06-18 17:30:00".len());
        assert!(payload.get("timestamp").is_none());
        assert!(payload.get("worldName").is_none());
    }

    #[test]
    fn generic_webhook_fields_ignore_localized_names() {
        let fields = parse_webhook_fields(r#"["locationId","位置","タイトル"]"#);
        let payload = webhook_payload(
            &delivery(),
            &rendered(),
            "generic",
            &fields,
            OverlayLocale::En,
        );

        assert_eq!(payload.as_object().unwrap().len(), 1);
        assert_eq!(
            payload.get("locationId").and_then(|value| value.as_str()),
            Some("wrld_named:123")
        );
        assert!(payload.get("位置").is_none());
        assert!(payload.get("タイトル").is_none());
    }

    #[test]
    fn overlay_notification_render_uses_app_title_and_combined_text() {
        let render = rendered();

        let overlay = overlay_notification_render(&render);

        assert_eq!(overlay.title, "VRCX-0");
        assert_eq!(overlay.text, "Traveler joined Named World");
        assert_eq!(render.title, "Traveler");
    }

    #[test]
    fn delivery_actor_image_user_id_skips_current_user_actor() {
        let mut delivery = delivery();
        delivery.entry.actor_user_id = "usr_self".into();

        assert_eq!(delivery_actor_image_user_id(&delivery, "usr_self"), None);

        delivery.entry.actor_user_id = "usr_sender".into();
        assert_eq!(
            delivery_actor_image_user_id(&delivery, "usr_self"),
            Some("usr_sender")
        );

        delivery.entry.content.image_url = "https://images.example/existing.png".into();
        assert_eq!(delivery_actor_image_user_id(&delivery, "usr_self"), None);
    }

    #[test]
    fn render_delivery_localizes_location_access_labels() {
        let mut delivery = delivery();
        delivery.entry.actor_display_name = "Traveler".into();
        delivery.entry.content.location =
            "wrld_named:123~group(grp_a)~groupAccessType(plus)".into();
        delivery.entry.content.world_name = "Group World".into();
        delivery.entry.content.group_name = "Group Name".into();
        delivery.entry.content.title = text("", "Traveler", json!({}));
        delivery.entry.content.body = text(
            "notifications.gps",
            "is in Group World groupPlus(Group Name)",
            json!({ "location": "Group World groupPlus(Group Name)" }),
        );

        let render = render_delivery(&delivery, OverlayLocale::ZhCn);

        assert_eq!(
            render.text,
            "Traveler 现在位于 Group World 群组+(Group Name)"
        );
        assert_eq!(render.display_location, "Group World 群组+(Group Name)");
    }

    #[test]
    fn generic_webhook_location_uses_localized_access_label() {
        let mut delivery = delivery();
        delivery.entry.content.location =
            "wrld_named:123~group(grp_a)~groupAccessType(plus)".into();
        delivery.entry.content.world_name = "Group World".into();
        delivery.entry.content.group_name = "Group Name".into();
        delivery.entry.content.display_location = "Group World groupPlus(Group Name)".into();

        let render = render_delivery(&delivery, OverlayLocale::ZhCn);
        let payload = webhook_payload(
            &delivery,
            &render,
            "generic",
            &["location".into()],
            OverlayLocale::En,
        );

        assert_eq!(
            payload.get("location").and_then(|value| value.as_str()),
            Some("Group World 群组+(Group Name)")
        );
    }

    #[test]
    fn discord_webhook_payload_builds_rich_invite_embed() {
        let mut delivery = delivery();
        delivery.entry.activity_type = "invite".into();
        delivery.entry.actor_display_name = "Example".into();
        delivery.entry.actor_user_id = "usr_abcdefg".into();
        delivery.entry.created_at = "2026-06-29T08:11:00.000Z".into();
        delivery.entry.content.location = "wrld_114514:810~private(usr_abcdefg)~region(jp)".into();
        delivery.entry.content.world_id = "wrld_114514".into();
        delivery.entry.content.world_name = "for Two".into();
        delivery.entry.content.detail = "プラベいこ♡".into();
        delivery.entry.content.image_url =
            "https://api.vrchat.cloud/api/1/image/file_fallback/1/256".into();

        let mut render = render_delivery(&delivery, OverlayLocale::En);
        render.actor_image_url = "https://api.vrchat.cloud/api/1/image/file_icon/2/256".into();
        render.world_image_url = "https://api.vrchat.cloud/api/1/file/file_world/8/file".into();

        let payload = webhook_payload(&delivery, &render, "discord", &[], OverlayLocale::En);
        let embed = &payload["embeds"][0];

        assert_eq!(embed["title"].as_str(), Some("Example's invite"));
        assert_eq!(embed["description"].as_str(), Some("「プラベいこ♡」"));
        assert_eq!(
            embed["url"].as_str(),
            Some(
                "https://vrchat.com/home/launch?worldId=wrld_114514&instanceId=810~private(usr_abcdefg)~region(jp)"
            )
        );
        assert_eq!(embed["author"]["name"].as_str(), Some("Example"));
        assert_eq!(
            embed["author"]["url"].as_str(),
            Some("https://vrchat.com/home/user/usr_abcdefg")
        );
        assert_eq!(
            embed["author"]["icon_url"].as_str(),
            Some("https://api.vrchat.cloud/api/1/image/file_icon/2/256")
        );
        assert_eq!(embed["footer"]["text"].as_str(), Some("#810 - Invite 🇯🇵"));
        assert_eq!(
            embed["timestamp"].as_str(),
            Some("2026-06-29T08:11:00.000Z")
        );
        assert_eq!(
            embed["thumbnail"]["url"].as_str(),
            Some("https://api.vrchat.cloud/api/1/file/file_world/8/file")
        );
    }

    #[test]
    fn discord_webhook_payload_gps_uses_location_title_without_message() {
        let mut delivery = delivery();
        delivery.entry.activity_type = "GPS".into();
        delivery.entry.actor_display_name = "Traveler".into();
        delivery.entry.content.location =
            "wrld_named:810~private(usr_x)~canRequestInvite~region(jp)".into();
        delivery.entry.content.world_id = "wrld_named".into();
        delivery.entry.content.world_name = "Named World".into();
        delivery.entry.content.detail = "Named World invite+".into();

        let render = render_delivery(&delivery, OverlayLocale::Ja);
        let payload = webhook_payload(&delivery, &render, "discord", &[], OverlayLocale::Ja);
        let embed = &payload["embeds"][0];

        assert_eq!(embed["title"].as_str(), Some("Traveler が移動しました"));
        assert_eq!(embed["description"].as_str(), Some("→ Named World"));
        assert_eq!(
            embed["footer"]["text"].as_str(),
            Some("#810 - インバイト+ 🇯🇵")
        );
    }

    #[test]
    fn discord_webhook_payload_status_uses_status_title_and_target() {
        let mut delivery = delivery();
        delivery.entry.activity_type = "Status".into();
        delivery.entry.actor_display_name = "Traveler".into();
        delivery.entry.content.location = String::new();
        delivery.entry.content.world_id = String::new();
        delivery.entry.content.world_name = String::new();
        delivery.entry.content.status = "join me".into();

        let render = render_delivery(&delivery, OverlayLocale::Ja);
        let payload = webhook_payload(&delivery, &render, "discord", &[], OverlayLocale::Ja);
        let embed = &payload["embeds"][0];

        assert_eq!(
            embed["title"].as_str(),
            Some("Traveler がステータスを変更しました")
        );
        assert_eq!(embed["description"].as_str(), Some("だれでもおいで"));
        assert!(embed.get("footer").is_none());
    }

    #[test]
    fn discord_webhook_payload_avatar_change_uses_rich_title_and_name() {
        let mut delivery = delivery();
        delivery.entry.activity_type = "AvatarChange".into();
        delivery.entry.actor_display_name = "Traveler".into();
        delivery.entry.content.location = String::new();
        delivery.entry.content.world_id = String::new();
        delivery.entry.content.world_name = String::new();
        delivery.entry.content.avatar_name = "Maple".into();

        let render = render_delivery(&delivery, OverlayLocale::Ja);
        let payload = webhook_payload(&delivery, &render, "discord", &[], OverlayLocale::Ja);
        let embed = &payload["embeds"][0];

        assert_eq!(
            embed["title"].as_str(),
            Some("Traveler がアバターを変更しました")
        );
        assert_eq!(embed["description"].as_str(), Some("Maple"));
        assert!(embed.get("footer").is_none());
    }

    #[test]
    fn discord_webhook_payload_offline_uses_rich_title_without_world_name() {
        let mut delivery = delivery();
        delivery.entry.activity_type = "Offline".into();
        delivery.entry.actor_display_name = "Traveler".into();
        delivery.entry.content.location = String::new();
        delivery.entry.content.world_id = String::new();
        delivery.entry.content.world_name = String::new();

        let render = render_delivery(&delivery, OverlayLocale::Ja);
        let payload = webhook_payload(&delivery, &render, "discord", &[], OverlayLocale::Ja);
        let embed = &payload["embeds"][0];

        assert_eq!(embed["author"]["name"].as_str(), Some("Traveler"));
        assert_eq!(
            embed["title"].as_str(),
            Some("Traveler がログアウトしました")
        );
        assert!(embed.get("description").is_none());
        assert!(embed.get("footer").is_none());
    }

    #[test]
    fn discord_webhook_payload_online_uses_rich_title() {
        let mut delivery = delivery();
        delivery.entry.activity_type = "Online".into();
        delivery.entry.actor_display_name = "Traveler".into();
        delivery.entry.content.location = String::new();
        delivery.entry.content.world_id = String::new();
        delivery.entry.content.world_name = String::new();

        let render = render_delivery(&delivery, OverlayLocale::Ja);
        let payload = webhook_payload(&delivery, &render, "discord", &[], OverlayLocale::Ja);
        let embed = &payload["embeds"][0];

        assert_eq!(embed["author"]["name"].as_str(), Some("Traveler"));
        assert_eq!(embed["title"].as_str(), Some("Traveler がログインしました"));
        assert!(embed.get("footer").is_none());
    }

    #[test]
    fn discord_webhook_payload_falls_back_to_legacy_for_unsupported_type() {
        let mut delivery = delivery();
        delivery.entry.activity_type = "Bio".into();
        delivery.entry.actor_display_name = "Traveler".into();

        let render = render_delivery(&delivery, OverlayLocale::Ja);
        let payload = webhook_payload(&delivery, &render, "discord", &[], OverlayLocale::Ja);
        let embed = &payload["embeds"][0];

        assert_eq!(embed["author"]["name"].as_str(), Some("Traveler"));
        assert!(embed.get("footer").is_none());
    }

    #[test]
    fn avatar_name_from_file_name_extracts_name() {
        let raw = "Avatar - Name - Image - 2022․3․22f1_1_standalonewindows_Release";
        assert_eq!(avatar_name_from_file_name(raw).as_deref(), Some("Name"));
        assert_eq!(avatar_name_from_file_name("just a name"), None);
    }

    fn rendered() -> RenderedNotification {
        RenderedNotification {
            title: "Traveler".into(),
            body: "joined Named World".into(),
            text: "Traveler joined Named World".into(),
            display_location: "Named World public".into(),
            image_url: String::new(),
            actor_image_url: String::new(),
            world_image_url: String::new(),
        }
    }

    fn delivery() -> OverlayActivityDelivery {
        OverlayActivityDelivery {
            entry: OverlayActivityEntry {
                sequence: 1,
                source_id: "game-log:join".into(),
                activity_type: "OnPlayerJoined".into(),
                category: OverlayActivityCategory::CurrentInstance,
                created_at: "2026-06-18T08:30:00.000Z".into(),
                actor_user_id: "usr_traveler".into(),
                actor_display_name: "Traveler".into(),
                content: OverlayActivityContent {
                    location: "wrld_named:123".into(),
                    world_id: "wrld_named".into(),
                    display_location: "Named World public".into(),
                    world_name: "Named World".into(),
                    ..OverlayActivityContent::default()
                },
                actor_relation: OverlayActivityActorRelation::None,
                payload: json!({}),
            },
            desktop: false,
            vr: false,
            webhook: true,
        }
    }

    fn text(
        key: &str,
        fallback: &str,
        params: serde_json::Value,
    ) -> vrcx_0_application::OverlayActivityText {
        vrcx_0_application::OverlayActivityText {
            key: key.into(),
            fallback: fallback.into(),
            params,
        }
    }
}
