use std::sync::{Arc, Mutex};

use vrcx_0_application_activity::notification::{
    extract_file_id, extract_file_version, fallback_file_version, load_overlay_activity_filters,
    normalize_avatar_image_url_128, CachedNotificationUserImageResolver, NotificationConfig,
    RealtimeUserImageResolverSlot,
};
use vrcx_0_application_activity::{
    OverlayActivityRuntime, OverlayActivitySink, OverlayActivitySinkRegistry,
    OverlayActivitySurface,
};
use vrcx_0_application_core::{
    FriendProjection, HostSessionRuntime, ImageCache,
    RealtimeNotificationProjectionObserverRegistry, RuntimeAuthScope, RuntimeEventBus,
    TaskSupervisor, WebClient, WorldCache,
};
use vrcx_0_application_game::{
    GameLogSideEffectEvent, GameLogSideEffectObserver, NowPlayingSnapshot, RuntimeSnapshot,
    RuntimeSnapshotStore,
};
use vrcx_0_application_realtime::{FriendProjectionObserver, RealtimeHostRuntime};
use vrcx_0_core::friends::StateBucket;
use vrcx_0_host_desktop::tts::{SystemTtsEngine, TtsEngine};
#[cfg(any(windows, target_os = "linux"))]
use vrcx_0_overlay_runtime::VrOverlayRuntimeServices;
use vrcx_0_persistence::{config::ConfigRepository, DatabaseService};

use crate::host_actions::RuntimeHost;
use crate::notification::{
    seed_hmd_notifications_default, DesktopNotifier, DesktopNotifierSlot, NotificationDispatcher,
    NotificationDispatcherDeps, NotificationDoNotDisturbRuntime, RealtimeNotificationIndicator,
};

const AVATAR_PREFETCH_MAX_PATCHES: usize = 8;

pub(crate) struct DesktopRuntimeServicesDeps {
    pub db: Arc<DatabaseService>,
    pub web: Arc<WebClient>,
    pub image_cache: Arc<ImageCache>,
    pub config: ConfigRepository,
    pub notification_config: Arc<dyn NotificationConfig>,
    pub auth_scope: RuntimeAuthScope,
    pub session: HostSessionRuntime,
    pub world_cache: Arc<WorldCache>,
    pub tasks: TaskSupervisor,
    pub event_bus: RuntimeEventBus,
    pub overlay_activity: OverlayActivityRuntime,
    pub overlay_activity_sinks: OverlayActivitySinkRegistry,
    pub notification_projection_observers: RealtimeNotificationProjectionObserverRegistry,
}

pub struct DesktopRuntimeServices {
    web: Arc<WebClient>,
    image_cache: Arc<ImageCache>,
    config: ConfigRepository,
    notification_config: Arc<dyn NotificationConfig>,
    auth_scope: RuntimeAuthScope,
    session: HostSessionRuntime,
    world_cache: Arc<WorldCache>,
    tasks: TaskSupervisor,
    overlay_activity: OverlayActivityRuntime,
    overlay_activity_sinks: OverlayActivitySinkRegistry,
    notification_do_not_disturb: NotificationDoNotDisturbRuntime,
    notification_indicator: Arc<RealtimeNotificationIndicator>,
    pub host: RuntimeHost,
    tts: Arc<dyn TtsEngine>,
    notification_desktop_notifier: DesktopNotifierSlot,
    realtime_user_image_resolver: RealtimeUserImageResolverSlot,
    realtime_user_image_resolver_owner: Mutex<Option<Arc<dyn CachedNotificationUserImageResolver>>>,
    game_log_snapshot: RuntimeSnapshotStore,
    now_playing: Arc<Mutex<Arc<NowPlayingSnapshot>>>,
}

impl DesktopRuntimeServices {
    pub(crate) fn new(deps: DesktopRuntimeServicesDeps) -> vrcx_0_application_core::Result<Self> {
        if let Err(error) = seed_hmd_notifications_default(&deps.config) {
            tracing::warn!(error = %error, "failed to seed HMD notification preference");
        }
        let tts: Arc<dyn TtsEngine> = Arc::new(SystemTtsEngine::new());
        let notification_desktop_notifier = DesktopNotifierSlot::default();
        let realtime_user_image_resolver = RealtimeUserImageResolverSlot::default();
        let notification_do_not_disturb = NotificationDoNotDisturbRuntime::new(
            deps.config.clone(),
            deps.event_bus,
            deps.tasks.clone(),
        )?;
        let host = RuntimeHost::new();
        let notification_indicator = Arc::new(RealtimeNotificationIndicator::new(
            Arc::clone(&deps.db),
            deps.config.clone(),
            deps.auth_scope.clone(),
            host.clone(),
            deps.tasks.clone(),
        ));
        deps.notification_projection_observers
            .add(notification_indicator.clone());
        deps.auth_scope.add_observer(notification_indicator.clone());
        let notification_sink: Arc<dyn OverlayActivitySink> =
            Arc::new(NotificationDispatcher::new(NotificationDispatcherDeps {
                session: deps.session.clone(),
                auth_scope: deps.auth_scope.clone(),
                config: deps.config.clone(),
                db: Arc::clone(&deps.db),
                image_cache: Arc::clone(&deps.image_cache),
                realtime_user_image_resolver: realtime_user_image_resolver.clone(),
                desktop: Arc::new(notification_desktop_notifier.clone()),
                tts: Arc::clone(&tts),
                tasks: deps.tasks.clone(),
                do_not_disturb: notification_do_not_disturb.clone(),
            }));
        deps.overlay_activity_sinks.add(notification_sink);
        Ok(Self {
            web: deps.web,
            image_cache: deps.image_cache,
            config: deps.config,
            notification_config: deps.notification_config,
            auth_scope: deps.auth_scope,
            session: deps.session,
            world_cache: deps.world_cache,
            tasks: deps.tasks,
            overlay_activity: deps.overlay_activity,
            overlay_activity_sinks: deps.overlay_activity_sinks,
            notification_do_not_disturb,
            notification_indicator,
            host,
            tts,
            notification_desktop_notifier,
            realtime_user_image_resolver,
            realtime_user_image_resolver_owner: Mutex::new(None),
            game_log_snapshot: RuntimeSnapshotStore::default(),
            now_playing: Arc::new(Mutex::new(Arc::new(NowPlayingSnapshot::default()))),
        })
    }

    pub fn reload_overlay_activity_filters(&self) {
        self.overlay_activity
            .set_filters(load_overlay_activity_filters(
                self.notification_config.as_ref(),
            ));
    }

    pub fn set_overlay_activity_extra_sink(&self, extra_sink: Arc<dyn OverlayActivitySink>) {
        self.overlay_activity_sinks.add(extra_sink);
    }

    pub fn set_notification_desktop_notifier(&self, desktop: Arc<dyn DesktopNotifier>) {
        self.notification_desktop_notifier.set(desktop);
    }

    pub fn set_frontend_tray_notification(&self, notify: bool) {
        self.notification_indicator.set_frontend_notify(notify);
    }

    pub fn refresh_tray_notification(&self) {
        self.notification_indicator.refresh();
    }

    pub fn set_realtime_user_image_resolver(&self, realtime_runtime: &Arc<RealtimeHostRuntime>) {
        let resolver: Arc<dyn CachedNotificationUserImageResolver> = Arc::new(
            vrcx_0_outbound_adapters::RealtimeNotificationUserImageResolver::new(realtime_runtime),
        );
        self.realtime_user_image_resolver.set(&resolver);
        match self.realtime_user_image_resolver_owner.lock() {
            Ok(mut owner) => *owner = Some(resolver),
            Err(error) => tracing::warn!(
                error = %error,
                "failed to retain realtime notification image resolver"
            ),
        }
    }

    pub fn game_log_snapshot_handle(&self) -> RuntimeSnapshotStore {
        self.game_log_snapshot.clone()
    }

    pub fn game_log_snapshot(&self) -> Arc<RuntimeSnapshot> {
        self.game_log_snapshot.snapshot()
    }

    pub fn now_playing(&self) -> Arc<NowPlayingSnapshot> {
        self.now_playing
            .lock()
            .map(|snapshot| Arc::clone(&snapshot))
            .unwrap_or_else(|_| Arc::new(NowPlayingSnapshot::default()))
    }

    pub fn overlay_activity(&self) -> OverlayActivityRuntime {
        self.overlay_activity.clone()
    }

    pub fn tts(&self) -> Arc<dyn TtsEngine> {
        Arc::clone(&self.tts)
    }

    pub fn notification_do_not_disturb(&self) -> NotificationDoNotDisturbRuntime {
        self.notification_do_not_disturb.clone()
    }

    fn observe_game_log_side_effect(&self, event: &GameLogSideEffectEvent) {
        match event {
            GameLogSideEffectEvent::NowPlaying(payload) => match self.now_playing.lock() {
                Ok(mut current) => {
                    Arc::make_mut(&mut current).apply(payload);
                }
                Err(error) => {
                    tracing::warn!("failed to lock now playing snapshot: {error}");
                }
            },
            GameLogSideEffectEvent::NowPlayingReset(_) => match self.now_playing.lock() {
                Ok(mut current) => {
                    *current = Arc::new(NowPlayingSnapshot::default());
                }
                Err(error) => {
                    tracing::warn!("failed to lock now playing snapshot: {error}");
                }
            },
            GameLogSideEffectEvent::ScreenshotProcessed(_)
            | GameLogSideEffectEvent::GameNoVr(_)
            | GameLogSideEffectEvent::Notification(_) => {}
        }
    }

    fn prefetch_online_friend_avatars(&self, projection: &FriendProjection) {
        if projection.patches.len() > AVATAR_PREFETCH_MAX_PATCHES {
            return;
        }
        let Some(endpoint) = self
            .session
            .snapshot()
            .realtime_context
            .map(|context| context.endpoint)
            .filter(|endpoint| !endpoint.is_empty())
        else {
            return;
        };
        let allow_user_icon = self
            .config
            .get_bool("displayVRCPlusIconsAsAvatar", true)
            .unwrap_or(true);
        for patch in &projection.patches {
            if !StateBucket::Online.matches(&patch.patch.state) {
                continue;
            }
            let user_id = patch.user_id.as_str();
            if !user_id.starts_with("usr_") {
                continue;
            }
            let Some(raw_url) =
                self.realtime_user_image_resolver
                    .cached_url(&endpoint, user_id, allow_user_icon)
            else {
                continue;
            };
            let normalized = normalize_avatar_image_url_128(&raw_url, &endpoint);
            let Some(file_id) = extract_file_id(&normalized) else {
                continue;
            };
            let version = extract_file_version(&normalized, &file_id)
                .unwrap_or_else(|| fallback_file_version(&normalized));
            if version.is_empty() {
                continue;
            }
            let image_cache = Arc::clone(&self.image_cache);
            self.tasks.spawn(async move {
                let _ = image_cache.get_image(&normalized, &file_id, &version).await;
            });
        }
    }
}

impl GameLogSideEffectObserver for DesktopRuntimeServices {
    fn on_game_log_side_effect(&self, event: &GameLogSideEffectEvent) {
        self.observe_game_log_side_effect(event);
    }
}

impl FriendProjectionObserver for DesktopRuntimeServices {
    fn on_friend_projection(&self, projection: &FriendProjection) {
        self.prefetch_online_friend_avatars(projection);
    }
}

#[cfg(any(windows, target_os = "linux"))]
impl VrOverlayRuntimeServices for DesktopRuntimeServices {
    fn config(&self) -> &ConfigRepository {
        &self.config
    }

    fn web_client(&self) -> &Arc<WebClient> {
        &self.web
    }

    fn auth_scope(&self) -> &RuntimeAuthScope {
        &self.auth_scope
    }

    fn world_cache(&self) -> &Arc<WorldCache> {
        &self.world_cache
    }

    fn tasks(&self) -> &TaskSupervisor {
        &self.tasks
    }

    fn overlay_activity(&self) -> OverlayActivityRuntime {
        self.overlay_activity.clone()
    }

    fn hmd_notifications_allowed(&self) -> bool {
        !self
            .notification_do_not_disturb
            .suppresses(OverlayActivitySurface::Hmd)
    }

    fn game_log_snapshot(&self) -> RuntimeSnapshot {
        DesktopRuntimeServices::game_log_snapshot(self)
            .as_ref()
            .clone()
    }
}

#[cfg(test)]
mod tests;
