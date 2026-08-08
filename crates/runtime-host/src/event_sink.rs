use std::any::Any;
use std::sync::{Arc, Weak};

use vrcx_0_application_core::{
    BackendRuntime, BackendRuntimeSnapshot, BackendRuntimeTelemetry, RealtimeProjectionSync,
    RuntimeEventPayload, RuntimeEventSink,
};

use crate::RuntimeHostProfileExtension;

pub struct RuntimeHostEventSink<S> {
    backend_runtime: BackendRuntime,
    profile_extension: Option<Weak<dyn RuntimeHostProfileExtension>>,
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
            profile_extension: profile_extension.as_ref().map(Arc::downgrade),
            inner,
        }
    }
}

impl<S> RuntimeHostEventSink<S>
where
    S: RuntimeEventSink,
{
    fn emit_realtime_projection_sync(&self, snapshot: BackendRuntimeSnapshot) {
        let projection = RealtimeProjectionSync { snapshot };
        match serde_json::to_value(&projection) {
            Ok(payload) => {
                self.inner
                    .emit(RealtimeProjectionSync::EVENT_NAME, payload, &projection)
            }
            Err(error) => tracing::warn!(
                error = %error,
                "failed to serialize realtime projection sync"
            ),
        }
    }

    fn emit_backend_runtime_telemetry(&self, telemetry: BackendRuntimeTelemetry) {
        let snapshot = telemetry.snapshot.clone();
        match serde_json::to_value(&telemetry) {
            Ok(payload) => {
                self.emit_realtime_projection_sync(snapshot);
                self.inner
                    .emit(BackendRuntimeTelemetry::EVENT_NAME, payload, &telemetry);
            }
            Err(error) => tracing::warn!(
                error = %error,
                "failed to serialize backend runtime telemetry"
            ),
        }
    }
}

impl<S> RuntimeEventSink for RuntimeHostEventSink<S>
where
    S: RuntimeEventSink,
{
    fn emit(&self, event: &str, payload: serde_json::Value, typed_payload: &dyn Any) {
        if let Some(extension) = self.profile_extension.as_ref().and_then(Weak::upgrade) {
            extension.observe_runtime_event(typed_payload);
        }

        if let Some(telemetry) = typed_payload.downcast_ref::<BackendRuntimeTelemetry>() {
            self.emit_realtime_projection_sync(telemetry.snapshot.clone());
            self.inner.emit(event, payload, typed_payload);
            return;
        }

        let telemetry = self.backend_runtime.observe_runtime_event(typed_payload);
        if event != BackendRuntimeTelemetry::EVENT_NAME {
            self.inner.emit(event, payload, typed_payload);
        }

        if let Some(telemetry) = telemetry {
            self.emit_backend_runtime_telemetry(telemetry);
        } else if event == BackendRuntimeTelemetry::EVENT_NAME {
            tracing::warn!(
                event,
                "unrecognized typed backend runtime telemetry payload"
            );
        }
    }
}

#[cfg(test)]
mod tests;
