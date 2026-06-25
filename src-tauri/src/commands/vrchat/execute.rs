#![allow(non_snake_case)]

use tauri::State;
use vrcx_0_application::vrchat_api::{self, VrchatApiRequest, VrchatApiResponse, VrchatScope};

use crate::error::AppError;
use crate::state::AppState;

macro_rules! api_execute_command {
    ($name:ident, $scope:expr) => {
        pub async fn $name(
            state: State<'_, AppState>,
            input: VrchatApiRequest,
        ) -> Result<VrchatApiResponse, AppError> {
            let command = stringify!($name);
            let diagnostics = state.runtime_context.diagnostics.clone();
            let sync = state.runtime_context.sync.clone();
            vrchat_api::execute_api_command(
                state.web.as_ref(),
                state.db.as_ref(),
                &diagnostics,
                &sync,
                command,
                input,
                $scope,
            )
            .await
            .map_err(AppError::from)
        }
    };
}

api_execute_command!(execute_vrchat_auth_api, VrchatScope::Vrchat);
api_execute_command!(execute_vrchat_friend_api, VrchatScope::Vrchat);
api_execute_command!(execute_vrchat_favorite_api, VrchatScope::Vrchat);
api_execute_command!(execute_vrchat_search_api, VrchatScope::Vrchat);
api_execute_command!(execute_vrchat_avatar_api, VrchatScope::Vrchat);
api_execute_command!(execute_vrchat_world_api, VrchatScope::Vrchat);
api_execute_command!(execute_vrchat_instance_api, VrchatScope::Vrchat);
api_execute_command!(execute_vrchat_notification_api, VrchatScope::Vrchat);
api_execute_command!(execute_vrchat_media_api, VrchatScope::VrchatMedia);
api_execute_command!(execute_vrchat_tools_api, VrchatScope::Vrchat);
