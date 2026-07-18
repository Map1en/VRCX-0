use super::*;

impl RuntimeHostState {
    pub fn set_event_sink<S>(&self, sink: S)
    where
        S: RuntimeEventSink + 'static,
    {
        self.runtime_context
            .event_bus
            .set_sink(RuntimeHostEventSink::new(
                self.backend_runtime.clone(),
                self.profile_extension.clone(),
                sink,
            ));
    }

    pub fn snapshot_backend_runtime(&self) -> BackendRuntimeSnapshot {
        self.backend_runtime.snapshot()
    }
}
