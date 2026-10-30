use std::sync::{Arc, Mutex};

use vrcx_0_application::auth::AuthCredentialStore;
use vrcx_0_application_activity::notification::{
    apply_location_notification_rules, extract_file_version, fallback_file_version,
    load_overlay_activity_filters, rename_local_favorite_group_in_activity_filters,
    CachedNotificationUserImageResolver, NotificationConfig, NotificationRemoteFuture,
    NotificationResolver,
};
use vrcx_0_application_activity::{ActivityRouter, ActivitySink, ActivitySinkRegistry};
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
use vrcx_0_core::files::extract_file_id;
use vrcx_0_core::friends::StateBucket;
use vrcx_0_host_desktop::tts::{SystemTtsEngine, TtsEngine};
#[cfg(any(windows, target_os = "linux"))]
use vrcx_0_overlay_runtime::VrOverlayRuntimeServices;
use vrcx_0_persistence::{config::ConfigRepository, DatabaseService};

use crate::game_isolation::GameIsolationRuntime;
use crate::host_actions::RuntimeHost;
use crate::notification::{
    migrate_legacy_overlay_notification_keys, seed_hmd_notifications_default, DesktopNotifier,
    DesktopNotifierSlot, LocalNotificationPolicy, NotificationDispatcher,
    NotificationDispatcherDeps, NotificationDoNotDisturbRuntime, RealtimeNotificationIndicator,
};
use crate::privacy_lock::PrivacyLockRuntime;

const AVATAR_PREFETCH_MAX_PATCHES: usize = 8;

pub(crate) struct DesktopRuntimeServicesDeps {
    pub db: Arc<DatabaseService>,
    pub web: Arc<WebClient>,
    pub image_cache: Arc<ImageCache>,
    pub config: ConfigRepository,
    pub notification_config: Arc<dyn NotificationConfig>,
    pub notification_resolver: Arc<NotificationResolver>,
    pub auth_credentials: Arc<dyn AuthCredentialStore>,
    pub auth_scope: RuntimeAuthScope,
    pub session: HostSessionRuntime,
    pub world_cache: Arc<WorldCache>,
    pub tasks: TaskSupervisor,
    pub event_bus: RuntimeEventBus,
    pub activity_router: ActivityRouter,
    pub activity_sinks: ActivitySinkRegistry,
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
    event_bus: RuntimeEventBus,
    activity_router: ActivityRouter,
    activity_sinks: ActivitySinkRegistry,
    notification_do_not_disturb: NotificationDoNotDisturbRuntime,
    game_isolation: GameIsolationRuntime,
    notification_indicator: Arc<RealtimeNotificationIndicator>,
    privacy_lock: Arc<PrivacyLockRuntime>,
    notification_policy: Arc<LocalNotificationPolicy>,
    pub host: RuntimeHost,
    tts: Arc<dyn TtsEngine>,
    notification_desktop_notifier: DesktopNotifierSlot,
    notification_resolver: Arc<NotificationResolver>,
    realtime_user_image_resolver_owner: Mutex<Option<Arc<dyn CachedNotificationUserImageResolver>>>,
    game_log_snapshot: RuntimeSnapshotStore,
    now_playing: Arc<Mutex<Arc<NowPlayingSnapshot>>>,
}

impl DesktopRuntimeServices {
    pub(crate) fn new(deps: DesktopRuntimeServicesDeps) -> vrcx_0_application_core::Result<Self> {
        if let Err(error) = migrate_legacy_overlay_notification_keys(&deps.config) {
            tracing::warn!(error = %error, "failed to migrate legacy overlay notification keys");
        }
        if let Err(error) = seed_hmd_notifications_default(&deps.config) {
            tracing::warn!(error = %error, "failed to seed HMD notification preference");
        }
        let tts: Arc<dyn TtsEngine> = Arc::new(SystemTtsEngine::new());
        let notification_desktop_notifier = DesktopNotifierSlot::default();
        let host = RuntimeHost::new();
        deps.auth_scope
            .add_vrchat_auth_failure_observer(Arc::new(host.clone()));
        let notification_do_not_disturb = NotificationDoNotDisturbRuntime::new(
            deps.config.clone(),
            deps.event_bus.clone(),
            host.clone(),
            deps.tasks.clone(),
        )?;
        let game_isolation =
            GameIsolationRuntime::new(deps.config.clone(), deps.event_bus.clone(), host.clone())?;
        let privacy_lock = Arc::new(PrivacyLockRuntime::new(
            deps.auth_credentials,
            deps.event_bus.clone(),
            deps.web.proxy_url().map(str::to_string),
        )?);
        deps.auth_scope.add_observer(privacy_lock.clone());
        let notification_policy = Arc::new(LocalNotificationPolicy::new(
            deps.config.clone(),
            deps.session.clone(),
            notification_do_not_disturb.clone(),
            privacy_lock.clone(),
            game_isolation.clone(),
        ));
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
        let notification_sink: Arc<dyn ActivitySink> =
            Arc::new(NotificationDispatcher::new(NotificationDispatcherDeps {
                auth_scope: deps.auth_scope.clone(),
                db: Arc::clone(&deps.db),
                image_cache: Arc::clone(&deps.image_cache),
                resolver: Arc::clone(&deps.notification_resolver),
                desktop: Arc::new(notification_desktop_notifier.clone()),
                tts: Arc::clone(&tts),
                tasks: deps.tasks.clone(),
                policy: Arc::clone(&notification_policy),
            }));
        deps.activity_sinks.add(notification_sink);
        Ok(Self {
            web: deps.web,
            image_cache: deps.image_cache,
            config: deps.config,
            notification_config: deps.notification_config,
            auth_scope: deps.auth_scope,
            session: deps.session,
            world_cache: deps.world_cache,
            tasks: deps.tasks,
            event_bus: deps.event_bus,
            activity_router: deps.activity_router,
            activity_sinks: deps.activity_sinks,
            notification_do_not_disturb,
            game_isolation,
            notification_indicator,
            privacy_lock,
            notification_policy,
            host,
            tts,
            notification_desktop_notifier,
            notification_resolver: deps.notification_resolver,
            realtime_user_image_resolver_owner: Mutex::new(None),
            game_log_snapshot: RuntimeSnapshotStore::default(),
            now_playing: Arc::new(Mutex::new(Arc::new(NowPlayingSnapshot::default()))),
        })
    }

    pub fn rename_local_favorite_group_in_activity_filters(
        &self,
        group_name: &str,
        new_group_name: &str,
    ) -> vrcx_0_application_core::Result<()> {
        rename_local_favorite_group_in_activity_filters(
            self.notification_config.as_ref(),
            group_name,
            new_group_name,
        )?;
        self.reload_overlay_activity_filters();
        Ok(())
    }

    pub fn reload_overlay_activity_filters(&self) {
        self.activity_router
            .set_filters(load_overlay_activity_filters(
                self.notification_config.as_ref(),
            ));
        apply_location_notification_rules(&self.activity_router, self.notification_config.as_ref());
    }

    pub fn set_overlay_activity_extra_sink(&self, extra_sink: Arc<dyn ActivitySink>) {
        self.activity_sinks.add(extra_sink);
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

    pub fn attach_realtime_runtime(&self, realtime_runtime: &Arc<RealtimeHostRuntime>) {
        self.notification_policy.attach_realtime(realtime_runtime);
        let resolver: Arc<dyn CachedNotificationUserImageResolver> = Arc::new(
            vrcx_0_outbound_adapters::RealtimeNotificationUserImageResolver::new(realtime_runtime),
        );
        self.notification_resolver.attach_realtime(&resolver);
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

    pub fn activity_router(&self) -> ActivityRouter {
        self.activity_router.clone()
    }

    pub fn tts(&self) -> Arc<dyn TtsEngine> {
        Arc::clone(&self.tts)
    }

    pub fn notification_do_not_disturb(&self) -> NotificationDoNotDisturbRuntime {
        self.notification_do_not_disturb.clone()
    }

    pub fn game_isolation(&self) -> GameIsolationRuntime {
        self.game_isolation.clone()
    }

    pub fn event_bus(&self) -> RuntimeEventBus {
        self.event_bus.clone()
    }

    pub fn activity_sinks(&self) -> ActivitySinkRegistry {
        self.activity_sinks.clone()
    }

    pub fn privacy_lock(&self) -> Arc<PrivacyLockRuntime> {
        Arc::clone(&self.privacy_lock)
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
            | GameLogSideEffectEvent::GameNoVr(_) => {}
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
        for patch in &projection.patches {
            if patch.presence.view.section() != StateBucket::Online {
                continue;
            }
            let user_id = patch.user_id.as_str();
            if !user_id.starts_with("usr_") {
                continue;
            }
            let Some(normalized) = self.notification_resolver.friend_image(&endpoint, user_id)
            else {
                continue;
            };
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

    fn activity_router(&self) -> ActivityRouter {
        self.activity_router.clone()
    }

    fn hmd_notifications_allowed(&self) -> bool {
        self.notification_policy.hmd_allowed()
    }

    fn notification_friend_image(&self, endpoint: &str, user_id: &str) -> Option<String> {
        self.notification_resolver.friend_image(endpoint, user_id)
    }

    fn cached_notification_group_name(&self, group_id: &str) -> Option<String> {
        self.notification_resolver.cached_group_name(group_id)
    }

    fn notification_group_name<'a>(
        &'a self,
        endpoint: &'a str,
        group_id: &'a str,
    ) -> NotificationRemoteFuture<'a, String> {
        Box::pin(self.notification_resolver.group_name(endpoint, group_id))
    }

    fn set_hmd_afk(&self, is_hmd_afk: bool) {
        self.session.set_hmd_afk(is_hmd_afk);
    }

    fn game_log_snapshot(&self) -> RuntimeSnapshot {
        DesktopRuntimeServices::game_log_snapshot(self)
            .as_ref()
            .clone()
    }

    fn now_playing(&self) -> NowPlayingSnapshot {
        DesktopRuntimeServices::now_playing(self).as_ref().clone()
    }

    fn game_started_at(&self) -> Option<String> {
        let session = self.session.snapshot();
        session
            .last_game_started_at
            .filter(|_| session.is_game_running)
    }
}

#[cfg(test)]
mod tests;
