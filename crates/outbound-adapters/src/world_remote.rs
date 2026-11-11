use std::sync::Arc;

use vrcx_0_application::remote::{
    WorldRemoteFuture, WorldRemoteOperation, WorldRemotePort, WorldRemoteScope,
    WorldResponseProjectionPort,
};
use vrcx_0_application_core::vrchat_api::execute_api_command;
use vrcx_0_application_core::{RuntimeDiagnostics, RuntimeSyncEngine, WebClient, WorldCache};
use vrcx_0_contracts::vrchat_api::{VrchatResponse, VrchatScope};
use vrcx_0_vrchat_protocol::worlds::{
    world_delete_input, world_list_by_user_get_input, world_persistent_data_delete_input,
    world_persistent_data_exists_input, world_publish_input, world_rating_get_input,
    world_rating_set_input, world_save_input, world_unpublish_input,
};

pub struct VrchatWorldRemote {
    web: Arc<WebClient>,
    diagnostics: RuntimeDiagnostics,
    sync: RuntimeSyncEngine,
}

impl VrchatWorldRemote {
    pub fn new(
        web: Arc<WebClient>,
        diagnostics: RuntimeDiagnostics,
        sync: RuntimeSyncEngine,
    ) -> Self {
        Self {
            web,
            diagnostics,
            sync,
        }
    }
}

impl WorldRemotePort for VrchatWorldRemote {
    fn execute(
        &self,
        scope: WorldRemoteScope,
        operation: WorldRemoteOperation,
    ) -> WorldRemoteFuture<'_> {
        Box::pin(async move {
            let endpoint = match scope {
                WorldRemoteScope::Public => {
                    vrcx_0_core::vrchat_endpoints::VRCHAT_API_DEFAULT_ENDPOINT.into()
                }
                WorldRemoteScope::Authenticated { endpoint, .. } => endpoint,
            };
            let (command, detail, request) = match operation {
                WorldRemoteOperation::ListByUser {
                    user_id,
                    n,
                    offset,
                    sort,
                    order,
                    release_status,
                } => {
                    let (user_id, request) = world_list_by_user_get_input(
                        endpoint,
                        user_id,
                        n,
                        offset,
                        sort,
                        order,
                        release_status,
                    )?;
                    (
                        "app__vrchat_world_list_by_user_get",
                        format!("Getting worlds for {user_id}."),
                        request,
                    )
                }
                WorldRemoteOperation::PersistentDataExists { user_id, world_id } => {
                    let (user_id, world_id, request) =
                        world_persistent_data_exists_input(endpoint, user_id, world_id)?;
                    (
                        "app__vrchat_world_persistent_data_exists",
                        format!("Checking persistent data for user {user_id} in world {world_id}."),
                        request,
                    )
                }
                WorldRemoteOperation::Save { world_id, params } => {
                    let (world_id, request) = world_save_input(endpoint, world_id, params)?;
                    (
                        "app__vrchat_world_save",
                        format!("Saving world {world_id}."),
                        request,
                    )
                }
                WorldRemoteOperation::Delete { world_id } => {
                    let (world_id, request) = world_delete_input(endpoint, world_id)?;
                    (
                        "app__vrchat_world_delete",
                        format!("Deleting world {world_id}."),
                        request,
                    )
                }
                WorldRemoteOperation::Publish { world_id } => {
                    let (world_id, request) = world_publish_input(endpoint, world_id)?;
                    (
                        "app__vrchat_world_publish",
                        format!("Publishing world {world_id}."),
                        request,
                    )
                }
                WorldRemoteOperation::Unpublish { world_id } => {
                    let (world_id, request) = world_unpublish_input(endpoint, world_id)?;
                    (
                        "app__vrchat_world_unpublish",
                        format!("Unpublishing world {world_id}."),
                        request,
                    )
                }
                WorldRemoteOperation::PersistentDataDelete { user_id, world_id } => {
                    let (user_id, world_id, request) =
                        world_persistent_data_delete_input(endpoint, user_id, world_id)?;
                    (
                        "app__vrchat_world_persistent_data_delete",
                        format!("Deleting persistent data for user {user_id} in world {world_id}."),
                        request,
                    )
                }
                WorldRemoteOperation::RatingGet { world_id } => {
                    let (world_id, request) = world_rating_get_input(endpoint, world_id)?;
                    (
                        "app__vrchat_world_rating_get",
                        format!("Getting rating for world {world_id}."),
                        request,
                    )
                }
                WorldRemoteOperation::RatingSet { world_id, value } => {
                    let (world_id, request) = world_rating_set_input(endpoint, world_id, value)?;
                    (
                        "app__vrchat_world_rating_set",
                        format!("Setting rating for world {world_id}."),
                        request,
                    )
                }
            };
            execute_api_command(
                &self.web,
                &self.diagnostics,
                &self.sync,
                (command, detail),
                request,
                VrchatScope::Vrchat,
            )
            .await
        })
    }
}

pub struct CachedWorldResponseProjection {
    world_cache: Arc<WorldCache>,
}

impl CachedWorldResponseProjection {
    pub fn new(world_cache: Arc<WorldCache>) -> Self {
        Self { world_cache }
    }
}

impl WorldResponseProjectionPort for CachedWorldResponseProjection {
    fn hydrate(&self, response: &VrchatResponse) {
        self.world_cache.hydrate_response(response);
    }
}
