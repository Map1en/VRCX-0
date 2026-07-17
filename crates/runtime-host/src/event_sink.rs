use std::sync::Arc;

use vrcx_0_application::{BackendRuntime, RuntimeEventSink};

use crate::context::RuntimeHostContext;

pub struct RuntimeHostEventSink<S> {
    backend_runtime: BackendRuntime,
    context: Arc<RuntimeHostContext>,
    inner: S,
}

impl<S> RuntimeHostEventSink<S> {
    pub fn new(
        backend_runtime: BackendRuntime,
        context: Arc<RuntimeHostContext>,
        inner: S,
    ) -> Self {
        Self {
            backend_runtime,
            context,
            inner,
        }
    }
}

impl<S> RuntimeEventSink for RuntimeHostEventSink<S>
where
    S: RuntimeEventSink,
{
    fn emit(&self, event: &str, payload: serde_json::Value) {
        self.context.observe_runtime_event(event, &payload);

        if event == "backendRuntimeTelemetry" && payload.get("snapshot").is_some() {
            self.inner.emit(event, payload);
            return;
        }

        let telemetry = self.backend_runtime.observe_runtime_event(event, &payload);
        if event != "backendRuntimeTelemetry" {
            self.inner.emit(event, payload.clone());
        }

        if let Some(telemetry) = telemetry {
            match serde_json::to_value(telemetry) {
                Ok(payload) => self.inner.emit("backendRuntimeTelemetry", payload),
                Err(error) => tracing::warn!(
                    error = %error,
                    "failed to serialize backend runtime telemetry"
                ),
            }
        } else if event == "backendRuntimeTelemetry" {
            self.inner.emit(event, payload);
        }
    }
}

#[cfg(test)]
mod tests;
