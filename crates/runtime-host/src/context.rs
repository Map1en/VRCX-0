use std::sync::{Arc, Mutex};
use std::time::Duration;

use vrcx_0_application::{
    LoginSessionRuntime, MutualGraphFetchRuntime, PrintCleanupQueue, VrcStatusService,
};
use vrcx_0_application_activity::{
    OverlayActivityDelivery, OverlayActivityRuntime, OverlayActivitySink, OverlayActivitySnapshot,
    RuntimeOverlayActivityEventBusExt,
};
use vrcx_0_application_core::{
    HostSessionRuntime, ImageCache, RuntimeAuthScope, RuntimeBackgroundJobs, RuntimeDiagnostics,
    RuntimeEventBus, RuntimeLifecycle, RuntimeSyncEngine, TaskSupervisor, WebClient, WorldCache,
};
use vrcx_0_persistence::config::ConfigRepository;
use vrcx_0_persistence::DatabaseService;

use crate::notification::{
    load_overlay_activity_filters, NotificationWebhookSink, NotificationWebhookSinkDeps,
    UserImageCache,
};

const WORLD_CACHE_WORKING_CAPACITY: u64 = 512;
const WORLD_CACHE_WORKING_TTL: Duration = Duration::from_secs(30 * 60);

#[derive(Clone, Default)]
struct OverlayActivityFanoutSink {
    sinks: Arc<Mutex<Vec<Arc<dyn OverlayActivitySink>>>>,
}

impl OverlayActivityFanoutSink {
    fn add(&self, sink: Arc<dyn OverlayActivitySink>) {
        match self.sinks.lock() {
            Ok(mut sinks) => sinks.push(sink),
            Err(error) => tracing::warn!("failed to lock overlay activity sinks: {error}"),
        }
    }

    fn sinks(&self) -> Vec<Arc<dyn OverlayActivitySink>> {
        self.sinks
            .lock()
            .map(|sinks| sinks.clone())
            .unwrap_or_else(|error| {
                tracing::warn!("failed to lock overlay activity sinks: {error}");
                Vec::new()
            })
    }
}

impl OverlayActivitySink for OverlayActivityFanoutSink {
    fn emit_overlay_activity_snapshot(&self, snapshot: OverlayActivitySnapshot) {
        for sink in self.sinks() {
            sink.emit_overlay_activity_snapshot(snapshot.clone());
        }
    }

    fn emit_overlay_activity_delivery(&self, delivery: OverlayActivityDelivery) {
        for sink in self.sinks() {
            sink.emit_overlay_activity_delivery(delivery.clone());
        }
    }
}

#[derive(Clone)]
struct OverlayActivityRuntimeEventSink {
    event_bus: RuntimeEventBus,
}

impl OverlayActivitySink for OverlayActivityRuntimeEventSink {
    fn emit_overlay_activity_snapshot(&self, snapshot: OverlayActivitySnapshot) {
        self.event_bus.emit_overlay_activity_snapshot(snapshot);
    }
}

#[derive(Clone)]
pub struct RuntimeHostContext {
    pub db: Arc<DatabaseService>,
    pub web: Arc<WebClient>,
    pub image_cache: Arc<ImageCache>,
    pub event_bus: RuntimeEventBus,
    pub runtime: RuntimeLifecycle,
    pub background_jobs: RuntimeBackgroundJobs,
    pub sync: RuntimeSyncEngine,
    pub diagnostics: RuntimeDiagnostics,
    pub tasks: TaskSupervisor,
    pub session: HostSessionRuntime,
    pub auth_scope: RuntimeAuthScope,
    pub print_cleanup: PrintCleanupQueue,
    pub mutual_graph_fetch: MutualGraphFetchRuntime,
    pub vrc_status: VrcStatusService,
    pub login_session: LoginSessionRuntime,
    pub world_cache: Arc<WorldCache>,
    pub config: ConfigRepository,
    overlay_activity: OverlayActivityRuntime,
    overlay_activity_sinks: OverlayActivityFanoutSink,
    notification_user_image_cache: Arc<UserImageCache>,
}

impl RuntimeHostContext {
    pub fn new(
        db: Arc<DatabaseService>,
        web: Arc<WebClient>,
        image_cache: Arc<ImageCache>,
    ) -> Self {
        let config = ConfigRepository::new(Arc::clone(&db));
        let event_bus = RuntimeEventBus::new();
        let diagnostics = RuntimeDiagnostics::new();
        let tasks = TaskSupervisor::new();
        let session = HostSessionRuntime::new();
        let world_cache = Arc::new(WorldCache::new(
            Arc::clone(&db),
            WORLD_CACHE_WORKING_CAPACITY,
            WORLD_CACHE_WORKING_TTL,
        ));
        let overlay_activity =
            OverlayActivityRuntime::with_filters(load_overlay_activity_filters(&config));
        let overlay_activity_sinks = OverlayActivityFanoutSink::default();
        let notification_user_image_cache = Arc::new(UserImageCache::new());
        let vrc_status = VrcStatusService::new(Arc::clone(&web), event_bus.clone());
        overlay_activity_sinks.add(Arc::new(OverlayActivityRuntimeEventSink {
            event_bus: event_bus.clone(),
        }));
        overlay_activity_sinks.add(Arc::new(NotificationWebhookSink::new(
            NotificationWebhookSinkDeps {
                session: session.clone(),
                config: config.clone(),
                db: Arc::clone(&db),
                web: Arc::clone(&web),
                world_cache: Arc::clone(&world_cache),
                user_image_cache: Arc::clone(&notification_user_image_cache),
                diagnostics: diagnostics.clone(),
                tasks: tasks.clone(),
            },
        )));
        overlay_activity.set_sink(overlay_activity_sinks.clone());
        let mutual_graph_fetch = MutualGraphFetchRuntime::with_event_bus(event_bus.clone());
        Self {
            db,
            web,
            image_cache,
            event_bus,
            runtime: RuntimeLifecycle::new(),
            background_jobs: RuntimeBackgroundJobs::new(),
            sync: RuntimeSyncEngine::new(),
            diagnostics,
            tasks,
            session,
            auth_scope: RuntimeAuthScope::new(),
            print_cleanup: PrintCleanupQueue::new(),
            mutual_graph_fetch,
            vrc_status,
            login_session: LoginSessionRuntime::new(),
            world_cache,
            config,
            overlay_activity,
            overlay_activity_sinks,
            notification_user_image_cache,
        }
    }

    pub fn config(&self) -> &ConfigRepository {
        &self.config
    }

    pub fn overlay_activity(&self) -> OverlayActivityRuntime {
        self.overlay_activity.clone()
    }

    pub fn add_overlay_activity_sink(&self, sink: Arc<dyn OverlayActivitySink>) {
        self.overlay_activity_sinks.add(sink);
    }

    pub fn notification_user_image_cache(&self) -> Arc<UserImageCache> {
        Arc::clone(&self.notification_user_image_cache)
    }

    pub fn reload_overlay_activity_filters(&self) {
        self.overlay_activity
            .set_filters(load_overlay_activity_filters(&self.config));
    }
}
