use super::{BackendRuntimeSnapshot, RuntimeEventSink, RuntimeHostState};
use vrcx_0_application_core::BackendRuntimeStatusPublisher;

impl RuntimeHostState {
    pub fn set_event_sink<S>(&self, sink: S)
    where
        S: RuntimeEventSink + 'static,
    {
        self.runtime_context.event_bus.set_sink(sink);
    }

    pub fn snapshot_backend_runtime(&self) -> BackendRuntimeSnapshot {
        self.backend_runtime.snapshot()
    }

    pub fn publish_game_log_persisted(&self, count: u64) {
        BackendRuntimeStatusPublisher::new(
            self.backend_runtime.clone(),
            self.runtime_context.event_bus.clone(),
        )
        .publish_game_log_persisted(count);
    }
}
