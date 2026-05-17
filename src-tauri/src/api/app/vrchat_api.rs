#![allow(non_snake_case)]

use serde_json::Value;
use tauri::State;
use vrcx_0_vrchat::http_api::{
    self, ApiScope, ExternalApiScope, HttpApiExecuteResponse, HttpApiRequestInput,
};

use crate::error::AppError;
use crate::state::AppState;

async fn execute_http_api(
    state: State<'_, AppState>,
    input: HttpApiRequestInput,
    scope: ApiScope,
) -> Result<HttpApiExecuteResponse, AppError> {
    let save_cookies = http_api::scope_saves_cookies(scope);
    let options = http_api::build_web_execute_options(input, scope)?;
    let (status, data) = state.web.execute(options).await?;
    if save_cookies {
        state.web.save_cookies(&state.db);
    }

    if status == -1 {
        return Err(AppError::Custom(data));
    }

    Ok(http_api::execute_response(status, data, scope))
}

pub(super) async fn execute_external_avatar_search_api(
    state: State<'_, AppState>,
    input: HttpApiRequestInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    execute_http_api(
        state,
        input,
        ApiScope::External(ExternalApiScope::AvatarSearch),
    )
    .await
}

pub(super) async fn execute_external_translation_api(
    state: State<'_, AppState>,
    input: HttpApiRequestInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    execute_http_api(
        state,
        input,
        ApiScope::External(ExternalApiScope::Translation),
    )
    .await
}

pub(super) async fn execute_external_youtube_api(
    state: State<'_, AppState>,
    input: HttpApiRequestInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    execute_http_api(state, input, ApiScope::External(ExternalApiScope::Youtube)).await
}

pub(super) async fn execute_external_vrc_status_api(
    state: State<'_, AppState>,
    input: HttpApiRequestInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    execute_http_api(
        state,
        input,
        ApiScope::External(ExternalApiScope::VrcStatus),
    )
    .await
}

pub(super) async fn execute_external_update_release_api(
    state: State<'_, AppState>,
    input: HttpApiRequestInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    execute_http_api(
        state,
        input,
        ApiScope::External(ExternalApiScope::UpdateRelease),
    )
    .await
}

pub(super) async fn execute_external_image_api(
    state: State<'_, AppState>,
    input: HttpApiRequestInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    execute_http_api(state, input, ApiScope::External(ExternalApiScope::Image)).await
}

macro_rules! api_execute_command {
    ($name:ident, $scope:expr) => {
        pub async fn $name(
            state: State<'_, AppState>,
            input: HttpApiRequestInput,
        ) -> Result<HttpApiExecuteResponse, AppError> {
            let command = stringify!($name);
            let diagnostics = state.backend_context.diagnostics.clone();
            let sync = state.backend_context.sync.clone();
            diagnostics.record_command(command, "running", "HTTP API request dispatched.");
            let result = execute_http_api(state, input, $scope).await;
            match &result {
                Ok(response) => {
                    let policy_class = response
                        .raw
                        .get("policy")
                        .and_then(|policy| policy.get("class"))
                        .and_then(Value::as_str)
                        .unwrap_or("unknown");
                    diagnostics.record_command(
                        command,
                        "ok",
                        format!("status={}, class={policy_class}", response.status),
                    );
                    sync.record(
                        "api",
                        "ready",
                        format!("{command} completed with status {}.", response.status),
                        0,
                    );
                }
                Err(error) => {
                    diagnostics.record_command(command, "error", error.to_string());
                    sync.record_failure("api", error.to_string());
                }
            }
            result
        }
    };
}

api_execute_command!(execute_vrchat_auth_api, ApiScope::Vrchat);
api_execute_command!(execute_vrchat_friend_api, ApiScope::Vrchat);
api_execute_command!(execute_vrchat_favorite_api, ApiScope::Vrchat);
api_execute_command!(execute_vrchat_search_api, ApiScope::Vrchat);
api_execute_command!(execute_vrchat_avatar_api, ApiScope::Vrchat);
api_execute_command!(execute_vrchat_world_api, ApiScope::Vrchat);
api_execute_command!(execute_vrchat_group_api, ApiScope::Vrchat);
api_execute_command!(execute_vrchat_instance_api, ApiScope::Vrchat);
api_execute_command!(execute_vrchat_notification_api, ApiScope::Vrchat);
api_execute_command!(execute_vrchat_media_api, ApiScope::VrchatMedia);
api_execute_command!(execute_vrchat_tools_api, ApiScope::Vrchat);
