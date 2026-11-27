use vrcx_0_composition::Result;

use super::DesktopRuntimeHostState;

impl DesktopRuntimeHostState {
    pub fn record_telemetry_events(
        &self,
        events: Vec<vrcx_0_application::telemetry::TelemetryClientEvent>,
    ) {
        self.desktop.telemetry.record_events(events);
    }

    pub async fn submit_telemetry_feedback(&self, content: &str) -> Result<()> {
        self.desktop
            .telemetry
            .submit_feedback(content)
            .await
            .map_err(|error| vrcx_0_application_core::Error::Custom(error.to_string()).into())
    }

    pub async fn shutdown_telemetry_flush(&self) {
        self.desktop.telemetry.shutdown_flush().await;
    }
}
