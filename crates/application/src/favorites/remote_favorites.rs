use std::sync::Arc;

use vrcx_0_application_core::{
    vrchat_api::{self, VrchatApiRequest, VrchatApiResponse, VrchatScope},
    RuntimeDiagnostics, RuntimeSyncEngine, WebClient,
};
use vrcx_0_application_realtime::RealtimeHostRuntime;
use vrcx_0_persistence::DatabaseService;

use crate::Result;

pub struct FavoriteRemoteMutationDeps<'a> {
    pub db: &'a DatabaseService,
    pub web: &'a WebClient,
    pub diagnostics: &'a RuntimeDiagnostics,
    pub sync: &'a RuntimeSyncEngine,
    pub realtime: &'a Arc<RealtimeHostRuntime>,
}

pub struct FavoriteRemoteAddInput {
    pub endpoint: String,
    pub kind: String,
    pub entity_id: String,
    pub tags: String,
}

pub struct FavoriteRemoteDeleteInput {
    pub endpoint: String,
    pub object_id: String,
}

pub struct FavoriteRemoteGroupSaveInput {
    pub endpoint: String,
    pub owner_id: String,
    pub kind: String,
    pub group: String,
    pub display_name: Option<String>,
    pub visibility: Option<String>,
}

pub struct FavoriteRemoteGroupClearInput {
    pub endpoint: String,
    pub owner_id: String,
    pub kind: String,
    pub group: String,
}

fn should_notify_favorite_change(status: i32) -> bool {
    vrchat_api::classify_api_response(status).class == "ok"
}

async fn execute_remote_favorite_mutation(
    deps: &FavoriteRemoteMutationDeps<'_>,
    command: &str,
    detail: String,
    request: VrchatApiRequest,
    notification_kind: &str,
) -> Result<VrchatApiResponse> {
    let response = vrchat_api::execute_api_command(
        deps.web,
        deps.db,
        deps.diagnostics,
        deps.sync,
        (command, detail),
        request,
        VrchatScope::Vrchat,
    )
    .await?;
    if should_notify_favorite_change(response.status) {
        deps.realtime
            .notify_favorites_changed(notification_kind, false, true);
    }
    Ok(response)
}

pub async fn add_remote_favorite(
    deps: &FavoriteRemoteMutationDeps<'_>,
    input: FavoriteRemoteAddInput,
) -> Result<VrchatApiResponse> {
    let (kind, entity_id, request) = vrchat_api::favorites::favorite_add_input(
        input.endpoint,
        input.kind,
        input.entity_id,
        input.tags,
    )?;
    execute_remote_favorite_mutation(
        deps,
        "favorite.remote.add",
        format!("Adding {kind} favorite {entity_id}."),
        request,
        &kind,
    )
    .await
}

pub async fn delete_remote_favorite(
    deps: &FavoriteRemoteMutationDeps<'_>,
    input: FavoriteRemoteDeleteInput,
) -> Result<VrchatApiResponse> {
    let (object_id, request) =
        vrchat_api::favorites::favorite_delete_input(input.endpoint, input.object_id)?;
    execute_remote_favorite_mutation(
        deps,
        "favorite.remote.delete",
        format!("Deleting favorite for {object_id}."),
        request,
        "unknown",
    )
    .await
}

pub async fn save_remote_favorite_group(
    deps: &FavoriteRemoteMutationDeps<'_>,
    input: FavoriteRemoteGroupSaveInput,
) -> Result<VrchatApiResponse> {
    let kind = input.kind.clone();
    let (group, request) = vrchat_api::favorites::favorite_group_save_input(
        input.endpoint,
        input.owner_id,
        input.kind,
        input.group,
        input.display_name,
        input.visibility,
    )?;
    execute_remote_favorite_mutation(
        deps,
        "favorite.remote.group.save",
        format!("Saving favorite group {group}."),
        request,
        &kind,
    )
    .await
}

pub async fn clear_remote_favorite_group(
    deps: &FavoriteRemoteMutationDeps<'_>,
    input: FavoriteRemoteGroupClearInput,
) -> Result<VrchatApiResponse> {
    let kind = input.kind.clone();
    let (group, request) = vrchat_api::favorites::favorite_group_clear_input(
        input.endpoint,
        input.owner_id,
        input.kind,
        input.group,
    )?;
    execute_remote_favorite_mutation(
        deps,
        "favorite.remote.group.clear",
        format!("Clearing favorite group {group}."),
        request,
        &kind,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::should_notify_favorite_change;
    #[test]
    fn only_successful_http_policies_are_favorite_changes() {
        for (status, expected) in [
            (200, true),
            (204, true),
            (302, false),
            (401, false),
            (429, false),
            (500, false),
        ] {
            assert_eq!(
                should_notify_favorite_change(status),
                expected,
                "status {status}"
            );
        }
    }
}
