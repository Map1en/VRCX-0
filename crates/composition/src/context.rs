use std::sync::Arc;
use std::time::Duration;

use vrcx_0_application::auth::{
    AuthCredentialStore, AuthSessionCookies, LoginApi, LoginSessionRuntime,
    NonInteractiveAuthRuntime,
};
use vrcx_0_application::avatars::AvatarModerationRuntime;
use vrcx_0_application::favorites::{
    FavoriteMutationCoordinator, FavoriteMutationRuntimeDeps, FavoriteRemote, FavoriteStore,
};
use vrcx_0_application::profile::VrcStatusService;
use vrcx_0_application::social::{
    ModerationSyncRuntime, MutualGraphFetchRuntime, PrintCleanupQueue,
};
use vrcx_0_application_activity::notification::{
    load_overlay_activity_filters, save_notification_activity_filters,
    save_overlay_activity_preference_filters, AuthWebhookEvent, AuthWebhookQueue,
    AuthWebhookQueueDeps, NotificationActivityFiltersSetInput, NotificationConfig,
    NotificationWebhookSink, NotificationWebhookSinkDeps, OverlayActivityPreferenceFilters,
    UserImageCache, WebhookDeliveryMonitor, WebhookDeliverySnapshot,
};
use vrcx_0_application_activity::{
    OverlayActivityRuntime, OverlayActivitySink, OverlayActivitySinkRegistry,
};
use vrcx_0_application_core::RemoteMutationGate;
use vrcx_0_application_core::{
    AvatarCache, HostSessionRuntime, ImageCache, InstanceDwellRegistry,
    RealtimeNotificationProjectionObserver, RealtimeNotificationProjectionObserverRegistry,
    RuntimeAuthScope, RuntimeBackgroundJobs, RuntimeDiagnostics, RuntimeEventBus, RuntimeLifecycle,
    RuntimeSyncEngine, TaskSupervisor, WebClient, WorldCache,
};
use vrcx_0_persistence::config::ConfigRepository;
use vrcx_0_persistence::DatabaseService;

const AVATAR_CACHE_WORKING_CAPACITY: u64 = 32;
const AVATAR_CACHE_WORKING_TTL: Duration = Duration::from_secs(2 * 60);
const WORLD_CACHE_WORKING_CAPACITY: u64 = 64;
const WORLD_CACHE_WORKING_TTL: Duration = Duration::from_secs(30 * 60);

#[derive(Clone)]
pub(crate) struct RuntimeHostContext {
    pub(crate) db: Arc<DatabaseService>,
    pub(crate) web: Arc<WebClient>,
    pub(crate) image_cache: Arc<ImageCache>,
    pub(crate) event_bus: RuntimeEventBus,
    pub(crate) runtime: RuntimeLifecycle,
    pub(crate) background_jobs: RuntimeBackgroundJobs,
    pub(crate) sync: RuntimeSyncEngine,
    pub(crate) diagnostics: RuntimeDiagnostics,
    pub(crate) tasks: TaskSupervisor,
    pub(crate) session: HostSessionRuntime,
    pub(crate) auth_scope: RuntimeAuthScope,
    pub(crate) print_cleanup: PrintCleanupQueue,
    pub(crate) print_adapter: Arc<vrcx_0_outbound_adapters::LocalPrintAdapter>,
    pub(crate) mutual_graph_fetch: MutualGraphFetchRuntime,
    pub(crate) moderation_sync: ModerationSyncRuntime,
    pub(crate) remote_mutations: Arc<RemoteMutationGate>,
    pub(crate) favorite_mutations: FavoriteMutationCoordinator,
    pub(crate) favorite_store: Arc<dyn FavoriteStore>,
    pub(crate) favorite_remote: Arc<dyn FavoriteRemote>,
    pub(crate) vrc_status: VrcStatusService,
    pub(crate) login_session: LoginSessionRuntime,
    pub(crate) auth_credentials: Arc<dyn AuthCredentialStore>,
    pub(crate) login_api: Arc<dyn LoginApi>,
    pub(crate) auth_cookies: Arc<dyn AuthSessionCookies>,
    pub(crate) noninteractive_auth: NonInteractiveAuthRuntime,
    pub(crate) avatar_cache: Arc<AvatarCache>,
    pub(crate) avatar_moderation: AvatarModerationRuntime,
    pub(crate) world_cache: Arc<WorldCache>,
    pub(crate) instance_dwell: Arc<InstanceDwellRegistry>,
    pub(crate) config: ConfigRepository,
    notification_config: Arc<dyn NotificationConfig>,
    overlay_activity: OverlayActivityRuntime,
    overlay_activity_sinks: OverlayActivitySinkRegistry,
    notification_projection_observers: RealtimeNotificationProjectionObserverRegistry,
    auth_webhook_queue: AuthWebhookQueue,
    webhook_delivery_monitor: WebhookDeliveryMonitor,
}

#[derive(Clone)]
pub struct RuntimeHostDesktopAssemblyDeps {
    context: Arc<RuntimeHostContext>,
}

impl RuntimeHostDesktopAssemblyDeps {
    pub fn new(
        db: Arc<DatabaseService>,
        web: Arc<WebClient>,
        image_cache: Arc<ImageCache>,
    ) -> Self {
        Self::from_context(Arc::new(RuntimeHostContext::new(db, web, image_cache)))
    }

    pub(crate) fn from_context(context: Arc<RuntimeHostContext>) -> Self {
        Self { context }
    }

    pub fn config(&self) -> &ConfigRepository {
        self.context.config()
    }

    pub fn database(&self) -> &Arc<DatabaseService> {
        self.context.database()
    }

    pub fn web_client(&self) -> &Arc<WebClient> {
        self.context.web_client()
    }

    pub fn image_cache(&self) -> &Arc<ImageCache> {
        self.context.image_cache()
    }

    pub fn event_bus(&self) -> &RuntimeEventBus {
        self.context.event_bus()
    }

    pub fn lifecycle(&self) -> &RuntimeLifecycle {
        self.context.lifecycle()
    }

    pub fn background_jobs(&self) -> &RuntimeBackgroundJobs {
        self.context.background_jobs()
    }

    pub fn sync(&self) -> &RuntimeSyncEngine {
        self.context.sync()
    }

    pub fn diagnostics(&self) -> &RuntimeDiagnostics {
        self.context.diagnostics()
    }

    pub fn tasks(&self) -> &TaskSupervisor {
        self.context.tasks()
    }

    pub fn session(&self) -> &HostSessionRuntime {
        self.context.session()
    }

    pub fn auth_scope(&self) -> &RuntimeAuthScope {
        self.context.auth_scope()
    }

    pub fn mutual_graph_fetch(&self) -> &MutualGraphFetchRuntime {
        self.context.mutual_graph_fetch()
    }

    pub fn moderation_sync(&self) -> &ModerationSyncRuntime {
        self.context.moderation_sync()
    }

    pub fn remote_mutations(&self) -> &Arc<RemoteMutationGate> {
        self.context.remote_mutations()
    }

    pub fn favorite_mutations(&self) -> &FavoriteMutationCoordinator {
        self.context.favorite_mutations()
    }

    pub fn auth_credentials(&self) -> &dyn AuthCredentialStore {
        self.context.auth_credentials()
    }

    pub fn vrc_status(&self) -> &VrcStatusService {
        self.context.vrc_status()
    }

    pub fn avatar_cache(&self) -> &Arc<AvatarCache> {
        self.context.avatar_cache()
    }

    pub fn avatar_moderation(&self) -> &AvatarModerationRuntime {
        self.context.avatar_moderation()
    }

    pub fn world_cache(&self) -> &Arc<WorldCache> {
        self.context.world_cache()
    }

    pub fn instance_dwell(&self) -> &Arc<InstanceDwellRegistry> {
        self.context.instance_dwell()
    }

    pub fn overlay_activity(&self) -> OverlayActivityRuntime {
        self.context.overlay_activity()
    }

    pub fn add_overlay_activity_sink(&self, sink: Arc<dyn OverlayActivitySink>) {
        self.context.add_overlay_activity_sink(sink);
    }

    pub fn overlay_activity_sink_registry(&self) -> OverlayActivitySinkRegistry {
        self.context.overlay_activity_sink_registry()
    }

    pub fn add_realtime_notification_projection_observer(
        &self,
        observer: Arc<dyn RealtimeNotificationProjectionObserver>,
    ) {
        self.context
            .add_realtime_notification_projection_observer(observer);
    }

    pub fn realtime_notification_projection_observer_registry(
        &self,
    ) -> RealtimeNotificationProjectionObserverRegistry {
        self.context
            .realtime_notification_projection_observer_registry()
    }

    pub fn notification_config(&self) -> Arc<dyn NotificationConfig> {
        self.context.notification_config()
    }

    pub fn enqueue_auth_webhook(&self, event: AuthWebhookEvent) {
        self.context.enqueue_auth_webhook(event);
    }

    pub fn webhook_delivery_snapshot(&self) -> WebhookDeliverySnapshot {
        self.context.webhook_delivery_snapshot()
    }

    pub fn reload_overlay_activity_filters(&self) {
        self.context.reload_overlay_activity_filters();
    }

    pub fn set_overlay_activity_preference_filters(
        &self,
        filters: OverlayActivityPreferenceFilters,
    ) -> crate::Result<()> {
        self.context
            .set_overlay_activity_preference_filters(filters)
    }

    pub fn set_notification_activity_filters(
        &self,
        input: NotificationActivityFiltersSetInput,
    ) -> crate::Result<()> {
        self.context.set_notification_activity_filters(input)
    }
}

impl RuntimeHostContext {
    pub(crate) fn new(
        db: Arc<DatabaseService>,
        web: Arc<WebClient>,
        image_cache: Arc<ImageCache>,
    ) -> Self {
        let config = ConfigRepository::new(Arc::clone(&db));
        let notification_config: Arc<dyn NotificationConfig> = Arc::new(
            vrcx_0_outbound_adapters::LocalNotificationConfig::new(config.clone()),
        );
        let auth_credentials: Arc<dyn AuthCredentialStore> = Arc::new(
            vrcx_0_outbound_adapters::LocalAuthCredentialStore::from_repository(config.clone()),
        );
        let login_api: Arc<dyn LoginApi> = Arc::new(vrcx_0_outbound_adapters::VrchatLoginApi::new(
            Arc::clone(&web),
        ));
        let auth_cookies: Arc<dyn AuthSessionCookies> = Arc::new(
            vrcx_0_outbound_adapters::WebAuthSessionCookies::new(Arc::clone(&web)),
        );
        let noninteractive_auth = NonInteractiveAuthRuntime::new(Arc::new(
            vrcx_0_outbound_adapters::LocalNonInteractiveAuthActions::new(
                Arc::clone(&web),
                Arc::clone(&auth_credentials),
            ),
        ));
        let event_bus = RuntimeEventBus::new();
        let diagnostics = RuntimeDiagnostics::new();
        let sync = RuntimeSyncEngine::new();
        let auth_scope = RuntimeAuthScope::new();
        let tasks = TaskSupervisor::new();
        let session = HostSessionRuntime::new();
        let avatar_cache = Arc::new(AvatarCache::new(
            vrcx_0_outbound_adapters::LocalAvatarCacheAdapter::new(
                Arc::clone(&db),
                AVATAR_CACHE_WORKING_CAPACITY,
                AVATAR_CACHE_WORKING_TTL,
            ),
        ));
        let world_cache = Arc::new(WorldCache::new(
            vrcx_0_outbound_adapters::LocalWorldCacheAdapter::new(
                Arc::clone(&db),
                WORLD_CACHE_WORKING_CAPACITY,
                WORLD_CACHE_WORKING_TTL,
            ),
        ));
        let overlay_activity = OverlayActivityRuntime::with_filters(load_overlay_activity_filters(
            notification_config.as_ref(),
        ));
        let overlay_activity_sinks = OverlayActivitySinkRegistry::default();
        let notification_projection_observers =
            RealtimeNotificationProjectionObserverRegistry::default();
        let notification_user_image_cache = Arc::new(UserImageCache::new());
        let webhook_delivery_monitor = WebhookDeliveryMonitor::default();
        let notification_remote =
            Arc::new(vrcx_0_outbound_adapters::VrchatNotificationRemote::new(
                Arc::clone(&web),
                Arc::clone(&world_cache),
            ));
        let notification_webhook_transport = Arc::new(
            vrcx_0_outbound_adapters::LocalNotificationWebhookTransport::new(Arc::clone(&web)),
        );
        let auth_webhook_queue = AuthWebhookQueue::new(AuthWebhookQueueDeps {
            config: Arc::clone(&notification_config),
            webhook_transport: notification_webhook_transport.clone(),
            diagnostics: diagnostics.clone(),
            monitor: webhook_delivery_monitor.clone(),
            tasks: tasks.clone(),
        });
        let vrc_status = VrcStatusService::new(
            Arc::new(vrcx_0_outbound_adapters::VrcStatusRemoteAdapter::new(
                Arc::clone(&web),
            )),
            event_bus.clone(),
        );
        overlay_activity_sinks.add(Arc::new(NotificationWebhookSink::new(
            NotificationWebhookSinkDeps {
                session: session.clone(),
                config: Arc::clone(&notification_config),
                remote: notification_remote,
                webhook_transport: notification_webhook_transport,
                user_image_cache: Arc::clone(&notification_user_image_cache),
                diagnostics: diagnostics.clone(),
                monitor: webhook_delivery_monitor.clone(),
                tasks: tasks.clone(),
            },
        )));
        overlay_activity.set_sink(overlay_activity_sinks.clone());
        let mutual_graph_fetch = MutualGraphFetchRuntime::with_event_bus(event_bus.clone());
        let remote_mutations = Arc::new(RemoteMutationGate::default());
        let print_adapter = Arc::new(vrcx_0_outbound_adapters::LocalPrintAdapter::new(
            Arc::clone(&db),
            Arc::clone(&web),
        ));
        let favorite_store: Arc<dyn FavoriteStore> = Arc::new(
            vrcx_0_outbound_adapters::LocalFavoriteStore::new(Arc::clone(&db)),
        );
        let favorite_remote: Arc<dyn FavoriteRemote> =
            Arc::new(vrcx_0_outbound_adapters::VrchatFavoriteRemote::new(
                Arc::clone(&web),
                diagnostics.clone(),
                sync.clone(),
            ));
        let favorite_mutations = FavoriteMutationCoordinator::new(
            Arc::clone(&favorite_store),
            Arc::clone(&favorite_remote),
            FavoriteMutationRuntimeDeps::new(
                diagnostics.clone(),
                sync.clone(),
                event_bus.clone(),
                auth_scope.clone(),
                Arc::clone(&remote_mutations),
            ),
        );
        Self {
            db,
            web,
            image_cache,
            event_bus,
            runtime: RuntimeLifecycle::new(),
            background_jobs: RuntimeBackgroundJobs::new(),
            sync,
            diagnostics,
            tasks,
            session,
            auth_scope,
            print_cleanup: PrintCleanupQueue::new(),
            print_adapter,
            mutual_graph_fetch,
            moderation_sync: ModerationSyncRuntime::new(),
            remote_mutations,
            favorite_mutations,
            favorite_store,
            favorite_remote,
            vrc_status,
            login_session: LoginSessionRuntime::new(),
            auth_credentials,
            login_api,
            auth_cookies,
            noninteractive_auth,
            avatar_cache,
            avatar_moderation: AvatarModerationRuntime::new(),
            world_cache,
            instance_dwell: Arc::new(InstanceDwellRegistry::new()),
            config,
            notification_config,
            overlay_activity,
            overlay_activity_sinks,
            notification_projection_observers,
            auth_webhook_queue,
            webhook_delivery_monitor,
        }
    }

    pub fn config(&self) -> &ConfigRepository {
        &self.config
    }

    pub fn database(&self) -> &Arc<DatabaseService> {
        &self.db
    }

    pub fn web_client(&self) -> &Arc<WebClient> {
        &self.web
    }

    pub fn image_cache(&self) -> &Arc<ImageCache> {
        &self.image_cache
    }

    pub fn event_bus(&self) -> &RuntimeEventBus {
        &self.event_bus
    }

    pub fn lifecycle(&self) -> &RuntimeLifecycle {
        &self.runtime
    }

    pub fn background_jobs(&self) -> &RuntimeBackgroundJobs {
        &self.background_jobs
    }

    pub fn sync(&self) -> &RuntimeSyncEngine {
        &self.sync
    }

    pub fn diagnostics(&self) -> &RuntimeDiagnostics {
        &self.diagnostics
    }

    pub fn tasks(&self) -> &TaskSupervisor {
        &self.tasks
    }

    pub fn session(&self) -> &HostSessionRuntime {
        &self.session
    }

    pub fn auth_scope(&self) -> &RuntimeAuthScope {
        &self.auth_scope
    }

    pub fn mutual_graph_fetch(&self) -> &MutualGraphFetchRuntime {
        &self.mutual_graph_fetch
    }

    pub fn moderation_sync(&self) -> &ModerationSyncRuntime {
        &self.moderation_sync
    }

    pub fn remote_mutations(&self) -> &Arc<RemoteMutationGate> {
        &self.remote_mutations
    }

    pub fn favorite_mutations(&self) -> &FavoriteMutationCoordinator {
        &self.favorite_mutations
    }

    pub fn auth_credentials(&self) -> &dyn AuthCredentialStore {
        self.auth_credentials.as_ref()
    }

    pub fn vrc_status(&self) -> &VrcStatusService {
        &self.vrc_status
    }

    pub fn avatar_cache(&self) -> &Arc<AvatarCache> {
        &self.avatar_cache
    }

    pub fn avatar_moderation(&self) -> &AvatarModerationRuntime {
        &self.avatar_moderation
    }

    pub fn world_cache(&self) -> &Arc<WorldCache> {
        &self.world_cache
    }

    pub fn instance_dwell(&self) -> &Arc<InstanceDwellRegistry> {
        &self.instance_dwell
    }

    pub fn overlay_activity(&self) -> OverlayActivityRuntime {
        self.overlay_activity.clone()
    }

    pub fn add_overlay_activity_sink(&self, sink: Arc<dyn OverlayActivitySink>) {
        self.overlay_activity_sinks.add(sink);
    }

    pub fn overlay_activity_sink_registry(&self) -> OverlayActivitySinkRegistry {
        self.overlay_activity_sinks.clone()
    }

    pub fn add_realtime_notification_projection_observer(
        &self,
        observer: Arc<dyn RealtimeNotificationProjectionObserver>,
    ) {
        self.notification_projection_observers.add(observer);
    }

    pub fn realtime_notification_projection_observer_registry(
        &self,
    ) -> RealtimeNotificationProjectionObserverRegistry {
        self.notification_projection_observers.clone()
    }

    pub fn notification_config(&self) -> Arc<dyn NotificationConfig> {
        Arc::clone(&self.notification_config)
    }

    pub fn enqueue_auth_webhook(&self, event: AuthWebhookEvent) {
        self.auth_webhook_queue.enqueue(event);
    }

    pub fn webhook_delivery_snapshot(&self) -> WebhookDeliverySnapshot {
        self.webhook_delivery_monitor.snapshot()
    }

    pub fn reload_overlay_activity_filters(&self) {
        self.overlay_activity
            .set_filters(load_overlay_activity_filters(
                self.notification_config.as_ref(),
            ));
    }

    pub fn set_overlay_activity_preference_filters(
        &self,
        filters: OverlayActivityPreferenceFilters,
    ) -> crate::Result<()> {
        save_overlay_activity_preference_filters(self.notification_config.as_ref(), filters)?;
        self.reload_overlay_activity_filters();
        Ok(())
    }

    pub fn set_notification_activity_filters(
        &self,
        input: NotificationActivityFiltersSetInput,
    ) -> crate::Result<()> {
        save_notification_activity_filters(self.notification_config.as_ref(), input)?;
        self.reload_overlay_activity_filters();
        Ok(())
    }
}
