use std::sync::Arc;

use vrcx_0_application_core::{BackendRuntime, BackendRuntimeTelemetry, RuntimeEventSink};

use crate::RuntimeHostProfileExtension;

pub struct RuntimeHostEventSink<S> {
    backend_runtime: BackendRuntime,
    profile_extension: Option<Arc<dyn RuntimeHostProfileExtension>>,
    inner: S,
}

impl<S> RuntimeHostEventSink<S> {
    pub fn new(
        backend_runtime: BackendRuntime,
        profile_extension: Option<Arc<dyn RuntimeHostProfileExtension>>,
        inner: S,
    ) -> Self {
        Self {
            backend_runtime,
            profile_extension,
            inner,
        }
    }
}

impl<S> RuntimeHostEventSink<S>
where
    S: RuntimeEventSink,
{
    fn emit_fallback_backend_runtime_telemetry(&self, payload: serde_json::Value) {
        let kind = payload
            .get("kind")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("runtimeTelemetry")
            .to_string();
        let detail = payload
            .get("detail")
            .and_then(serde_json::Value::as_str)
            .or_else(|| {
                payload
                    .get("messageType")
                    .and_then(serde_json::Value::as_str)
            })
            .map(str::to_string)
            .or_else(|| {
                payload
                    .get("count")
                    .and_then(serde_json::Value::as_u64)
                    .map(|count| count.to_string())
            })
            .unwrap_or_else(|| payload.to_string());
        let telemetry = BackendRuntimeTelemetry {
            kind,
            detail,
            snapshot: self.backend_runtime.snapshot(),
        };
        match serde_json::to_value(telemetry) {
            Ok(payload) => self.inner.emit("backendRuntimeTelemetry", payload),
            Err(error) => tracing::warn!(
                error = %error,
                "failed to serialize fallback backend runtime telemetry"
            ),
        }
    }
}

impl<S> RuntimeEventSink for RuntimeHostEventSink<S>
where
    S: RuntimeEventSink,
{
    fn emit(&self, event: &str, payload: serde_json::Value) {
        if let Some(extension) = &self.profile_extension {
            extension.observe_runtime_event(event, &payload);
        }

        if event == "backendRuntimeTelemetry" {
            if serde_json::from_value::<BackendRuntimeTelemetry>(payload.clone()).is_ok() {
                self.inner.emit(event, payload);
                return;
            }
            if payload.get("snapshot").is_some() {
                self.emit_fallback_backend_runtime_telemetry(payload);
                return;
            }
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
            self.emit_fallback_backend_runtime_telemetry(payload);
        }
    }
}

#[cfg(test)]
mod tests;
