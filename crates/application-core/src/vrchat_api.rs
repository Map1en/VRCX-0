use crate::diagnostics::RuntimeDiagnostics;
use crate::sync::RuntimeSyncEngine;
use crate::web_client::WebClient;
use crate::{Result, RuntimeOperationStatus};

use vrcx_0_contracts::vrchat_api::{VrchatRequest, VrchatResponse, VrchatScope};

pub fn normalize_text(value: impl AsRef<str>) -> String {
    value.as_ref().trim().to_string()
}

pub fn require_text(value: impl AsRef<str>, message: &str) -> crate::Result<String> {
    let value = normalize_text(value);
    if value.is_empty() {
        return Err(crate::Error::Custom(message.to_string()));
    }
    Ok(value)
}

pub async fn execute_api_command(
    web: &WebClient,
    diagnostics: &RuntimeDiagnostics,
    sync: &RuntimeSyncEngine,
    command: (&str, impl Into<String>),
    input: VrchatRequest,
    scope: VrchatScope,
) -> Result<VrchatResponse> {
    let (command, detail) = command;
    diagnostics.record_command(command, RuntimeOperationStatus::Running, detail);
    let result = web.execute_api(input, scope).await;
    match &result {
        Ok(response) => {
            let policy_class =
                vrcx_0_contracts::vrchat_api::classify_vrchat_response(response.status).class;
            diagnostics.record_command(
                command,
                RuntimeOperationStatus::Ok,
                format!("status={}, class={policy_class}", response.status),
            );
            sync.record(
                "api",
                RuntimeOperationStatus::Ready,
                format!("{command} completed with status {}.", response.status),
                0,
            );
        }
        Err(error) => {
            diagnostics.record_command(command, RuntimeOperationStatus::Error, error.to_string());
            sync.record_failure("api", error.to_string());
        }
    }
    result
}
