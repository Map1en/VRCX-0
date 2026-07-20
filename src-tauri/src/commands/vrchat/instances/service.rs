#![allow(non_snake_case)]

use std::sync::Arc;

use tauri::State;
use vrcx_0_application::{
    join_instance_launch, InstanceLaunchApiFuture, InstanceLaunchDeps, InstanceLaunchHttpClient,
    InstanceLaunchInput, InstanceLaunchOutcome, InstanceLaunchPipe,
};
use vrcx_0_application_core::vrchat_api::instances::{
    instance_close_input, instance_create_input, instance_get_input, instance_self_invite_input,
    instance_short_name_get_input,
};
use vrcx_0_application_core::vrchat_api::{execute_api_command, VrchatScope};
use vrcx_0_application_core::{RuntimeDiagnostics, RuntimeSyncEngine, WebClient};
use vrcx_0_core::vrchat_endpoints::VRCHAT_API_DEFAULT_ENDPOINT;
use vrcx_0_host_desktop::host_capabilities::{require_host_capability, HostCapability};
use vrcx_0_persistence::DatabaseService;

use crate::error::AppError;
use crate::state::AppState;
use vrcx_0_application_core::vrchat_api::{VrchatApiRequest, VrchatApiResponse};

use super::types::{
    VrchatInstanceCloseInput, VrchatInstanceCreateInput, VrchatInstanceIdentityInput,
    VrchatInstanceSelfInviteInput, VrchatInstanceShortNameInput,
};

async fn execute_instance_api(
    state: State<'_, AppState>,
    command: &str,
    detail: impl Into<String>,
    input: VrchatApiRequest,
) -> Result<VrchatApiResponse, AppError> {
    super::super::execute::execute_vrchat_api(state, command, detail, input, VrchatScope::Vrchat)
        .await
}

struct TauriInstanceLaunchHttpClient {
    db: Arc<DatabaseService>,
    web: Arc<WebClient>,
    diagnostics: RuntimeDiagnostics,
    sync: RuntimeSyncEngine,
}

impl TauriInstanceLaunchHttpClient {
    async fn execute_join_request(
        &self,
        command: &'static str,
        detail: &'static str,
        request: VrchatApiRequest,
    ) -> vrcx_0_application_core::Result<VrchatApiResponse> {
        execute_api_command(
            &self.web,
            &self.db,
            &self.diagnostics,
            &self.sync,
            (command, detail),
            request,
            VrchatScope::Vrchat,
        )
        .await
    }
}

impl InstanceLaunchHttpClient for TauriInstanceLaunchHttpClient {
    fn instance_short_name<'a>(
        &'a self,
        endpoint: &'a str,
        world_id: &'a str,
        instance_id: &'a str,
    ) -> InstanceLaunchApiFuture<'a> {
        Box::pin(async move {
            let (_, _, request) = instance_short_name_get_input(
                endpoint.to_string(),
                world_id.to_string(),
                instance_id.to_string(),
                String::new(),
            )?;
            self.execute_join_request(
                "app__vrchat_instance_join.short_name",
                "Getting a short name for the instance launch.",
                request,
            )
            .await
        })
    }

    fn self_invite<'a>(
        &'a self,
        endpoint: &'a str,
        world_id: &'a str,
        instance_id: &'a str,
        short_name: &'a str,
    ) -> InstanceLaunchApiFuture<'a> {
        Box::pin(async move {
            let (_, _, request) = instance_self_invite_input(
                endpoint.to_string(),
                world_id.to_string(),
                instance_id.to_string(),
                short_name.to_string(),
            )?;
            self.execute_join_request(
                "app__vrchat_instance_join.self_invite",
                "Sending a self invite for the instance launch.",
                request,
            )
            .await
        })
    }
}

struct TauriInstanceLaunchPipe;

impl InstanceLaunchPipe for TauriInstanceLaunchPipe {
    fn try_open_vrchat_launch_url(
        &self,
        launch_url: &str,
    ) -> vrcx_0_application_core::Result<bool> {
        require_host_capability(HostCapability::VrchatLaunchPipe)
            .map_err(|error| vrcx_0_application_core::Error::Custom(error.to_string()))?;
        Ok(crate::adapters::ipc::vrcipc_send(launch_url))
    }
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_instance_get(
    state: State<'_, AppState>,
    input: VrchatInstanceIdentityInput,
) -> Result<VrchatApiResponse, AppError> {
    let (world_id, instance_id, request) = instance_get_input(
        VRCHAT_API_DEFAULT_ENDPOINT.into(),
        input.world_id,
        input.instance_id,
    )?;
    execute_instance_api(
        state,
        "app__vrchat_instance_get",
        format!("Getting instance {world_id}:{instance_id}."),
        request,
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_instance_short_name_get(
    state: State<'_, AppState>,
    input: VrchatInstanceShortNameInput,
) -> Result<VrchatApiResponse, AppError> {
    let (world_id, instance_id, request) = instance_short_name_get_input(
        VRCHAT_API_DEFAULT_ENDPOINT.into(),
        input.world_id,
        input.instance_id,
        input.short_name,
    )?;
    execute_instance_api(
        state,
        "app__vrchat_instance_short_name_get",
        format!("Getting short name for instance {world_id}:{instance_id}."),
        request,
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_instance_create(
    state: State<'_, AppState>,
    input: VrchatInstanceCreateInput,
) -> Result<VrchatApiResponse, AppError> {
    execute_instance_api(
        state,
        "app__vrchat_instance_create",
        "Creating instance.",
        instance_create_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), input.params),
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_instance_self_invite(
    state: State<'_, AppState>,
    input: VrchatInstanceSelfInviteInput,
) -> Result<VrchatApiResponse, AppError> {
    let (world_id, instance_id, request) = instance_self_invite_input(
        VRCHAT_API_DEFAULT_ENDPOINT.into(),
        input.world_id,
        input.instance_id,
        input.short_name,
    )?;
    execute_instance_api(
        state,
        "app__vrchat_instance_self_invite",
        format!("Sending self invite for {world_id}:{instance_id}."),
        request,
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_instance_join(
    state: State<'_, AppState>,
    input: InstanceLaunchInput,
) -> Result<InstanceLaunchOutcome, AppError> {
    let context = &state.runtime_context;
    let api = TauriInstanceLaunchHttpClient {
        db: Arc::clone(&context.db),
        web: Arc::clone(&context.web),
        diagnostics: context.diagnostics.clone(),
        sync: context.sync.clone(),
    };
    let launch_pipe = TauriInstanceLaunchPipe;
    Ok(join_instance_launch(
        &InstanceLaunchDeps {
            api: &api,
            launch_pipe: &launch_pipe,
        },
        input,
    )
    .await?)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_instance_close(
    state: State<'_, AppState>,
    input: VrchatInstanceCloseInput,
) -> Result<VrchatApiResponse, AppError> {
    let (location, request) = instance_close_input(
        VRCHAT_API_DEFAULT_ENDPOINT.into(),
        input.location,
        input.hard_close,
    )?;
    execute_instance_api(
        state,
        "app__vrchat_instance_close",
        format!("Closing instance {location}."),
        request,
    )
    .await
}
