use std::time::Duration;

use futures_util::future::BoxFuture;
use vrcx_0_application_core::{
    vrchat_api::{self, VrchatApiResponse},
    FavoriteChange, FavoriteChangeScope, FavoriteGroupVisibility, FavoritesChangedPayload,
    RuntimeEventBus, VrchatFavoriteType,
};
use vrcx_0_contracts::vrchat_api::parse_vrchat_json;
use vrcx_0_core::json::RawJson;

use vrcx_0_application_core::{AuthenticatedMutationContext, Result};

const FAVORITE_REMOTE_MUTATION_INTERVAL: Duration = Duration::from_millis(250);

pub(super) struct FavoriteRemoteMutationDeps<'a> {
    pub remote: &'a dyn FavoriteRemote,
    pub event_bus: &'a RuntimeEventBus,
    pub mutation: AuthenticatedMutationContext<'a>,
}

pub struct FavoriteRemoteCommand {
    pub name: &'static str,
    pub detail: String,
}

pub type FavoriteRemoteFuture<'a, T> = BoxFuture<'a, Result<T>>;

pub trait FavoriteRemote: Send + Sync {
    fn list<'a>(
        &'a self,
        endpoint: String,
        n: i32,
        offset: i32,
        command: Option<FavoriteRemoteCommand>,
    ) -> FavoriteRemoteFuture<'a, VrchatApiResponse>;
    fn limits<'a>(
        &'a self,
        endpoint: String,
        command: Option<FavoriteRemoteCommand>,
    ) -> FavoriteRemoteFuture<'a, VrchatApiResponse>;
    fn favorite_worlds<'a>(
        &'a self,
        endpoint: String,
        n: i32,
        offset: i32,
        owner_id: String,
        user_id: String,
        tag: String,
    ) -> FavoriteRemoteFuture<'a, VrchatApiResponse>;
    fn favorite_avatars<'a>(
        &'a self,
        endpoint: String,
        n: i32,
        offset: i32,
        tag: String,
    ) -> FavoriteRemoteFuture<'a, VrchatApiResponse>;
    fn world<'a>(
        &'a self,
        endpoint: String,
        world_id: String,
    ) -> FavoriteRemoteFuture<'a, VrchatApiResponse>;
    fn avatar<'a>(
        &'a self,
        endpoint: String,
        avatar_id: String,
    ) -> FavoriteRemoteFuture<'a, VrchatApiResponse>;
    fn user<'a>(
        &'a self,
        endpoint: String,
        user_id: String,
    ) -> FavoriteRemoteFuture<'a, VrchatApiResponse>;
    fn add<'a>(
        &'a self,
        endpoint: String,
        input: FavoriteRemoteAddInput,
        command: Option<FavoriteRemoteCommand>,
    ) -> FavoriteRemoteFuture<'a, (String, String, VrchatApiResponse)>;
    fn delete<'a>(
        &'a self,
        endpoint: String,
        object_id: String,
        command: Option<FavoriteRemoteCommand>,
    ) -> FavoriteRemoteFuture<'a, (String, VrchatApiResponse)>;
    fn save_group<'a>(
        &'a self,
        endpoint: String,
        current_user_id: String,
        input: FavoriteRemoteGroupSaveInput,
        command: Option<FavoriteRemoteCommand>,
    ) -> FavoriteRemoteFuture<'a, (String, VrchatApiResponse)>;
    fn clear_group<'a>(
        &'a self,
        endpoint: String,
        current_user_id: String,
        input: FavoriteRemoteGroupClearInput,
        command: Option<FavoriteRemoteCommand>,
    ) -> FavoriteRemoteFuture<'a, (String, VrchatApiResponse)>;
}

pub struct FavoriteRemoteAddInput {
    pub kind: VrchatFavoriteType,
    pub entity_id: String,
    pub tags: String,
}

pub struct FavoriteRemoteDeleteInput {
    pub object_id: String,
}

pub struct FavoriteRemoteGroupSaveInput {
    pub kind: VrchatFavoriteType,
    pub group: String,
    pub display_name: Option<String>,
    pub visibility: Option<FavoriteGroupVisibility>,
}

pub struct FavoriteRemoteGroupClearInput {
    pub kind: VrchatFavoriteType,
    pub group: String,
}

fn should_notify_favorite_change(status: i32) -> bool {
    vrchat_api::classify_api_response(status).class == vrchat_api::ApiResponseClass::Ok
}

fn has_exact_remote_favorite_identity(favorite: &serde_json::Value) -> bool {
    ["id", "favoriteId"].iter().all(|field| {
        favorite
            .get(field)
            .and_then(serde_json::Value::as_str)
            .is_some_and(|value| !value.trim().is_empty())
    })
}

fn notify_favorite_change(
    deps: &FavoriteRemoteMutationDeps<'_>,
    kind: FavoriteChangeScope,
    changes: Vec<FavoriteChange>,
) {
    deps.event_bus.emit(FavoritesChangedPayload::from_changes(
        deps.mutation.scope(),
        kind,
        false,
        true,
        changes,
    ));
}

pub(super) async fn add_remote_favorite(
    deps: &FavoriteRemoteMutationDeps<'_>,
    input: FavoriteRemoteAddInput,
) -> Result<VrchatApiResponse> {
    let notification_scope = input.kind.into();
    let kind = input.kind.as_str().to_string();
    let entity_id = input.entity_id.trim().to_string();
    let endpoint = deps.mutation.scope().endpoint.clone();
    deps.mutation
        .wait_for_remote(FAVORITE_REMOTE_MUTATION_INTERVAL)
        .await?;
    let (_, _, response) = deps
        .remote
        .add(
            endpoint,
            input,
            Some(FavoriteRemoteCommand {
                name: "favorite.remote.add",
                detail: format!("Adding {kind} favorite {entity_id}."),
            }),
        )
        .await?;
    deps.mutation.ensure_current()?;
    if should_notify_favorite_change(response.status) {
        let favorite = parse_vrchat_json(&response.data);
        let changes = if has_exact_remote_favorite_identity(&favorite) {
            vec![FavoriteChange::RemoteAdded {
                favorite: RawJson::from(favorite),
            }]
        } else {
            Vec::new()
        };
        notify_favorite_change(deps, notification_scope, changes);
    }
    Ok(response)
}

pub(super) async fn delete_remote_favorite(
    deps: &FavoriteRemoteMutationDeps<'_>,
    input: FavoriteRemoteDeleteInput,
) -> Result<VrchatApiResponse> {
    let endpoint = deps.mutation.scope().endpoint.clone();
    let object_id = input.object_id.trim().to_string();
    deps.mutation
        .wait_for_remote(FAVORITE_REMOTE_MUTATION_INTERVAL)
        .await?;
    let (object_id, response) = deps
        .remote
        .delete(
            endpoint,
            input.object_id,
            Some(FavoriteRemoteCommand {
                name: "favorite.remote.delete",
                detail: format!("Deleting favorite for {object_id}."),
            }),
        )
        .await?;
    deps.mutation.ensure_current()?;
    if should_notify_favorite_change(response.status) {
        notify_favorite_change(
            deps,
            FavoriteChangeScope::All,
            vec![FavoriteChange::RemoteRemoved { object_id }],
        );
    }
    Ok(response)
}

pub(super) async fn save_remote_favorite_group(
    deps: &FavoriteRemoteMutationDeps<'_>,
    input: FavoriteRemoteGroupSaveInput,
) -> Result<VrchatApiResponse> {
    let notification_scope = input.kind.into();
    let group = input.group.trim().to_string();
    let endpoint = deps.mutation.scope().endpoint.clone();
    let current_user_id = deps.mutation.scope().current_user_id.clone();
    deps.mutation
        .wait_for_remote(FAVORITE_REMOTE_MUTATION_INTERVAL)
        .await?;
    let (_, response) = deps
        .remote
        .save_group(
            endpoint,
            current_user_id,
            input,
            Some(FavoriteRemoteCommand {
                name: "favorite.remote.group.save",
                detail: format!("Saving favorite group {group}."),
            }),
        )
        .await?;
    deps.mutation.ensure_current()?;
    if should_notify_favorite_change(response.status) {
        notify_favorite_change(deps, notification_scope, Vec::new());
    }
    Ok(response)
}

pub(super) async fn clear_remote_favorite_group(
    deps: &FavoriteRemoteMutationDeps<'_>,
    input: FavoriteRemoteGroupClearInput,
) -> Result<VrchatApiResponse> {
    let notification_scope = input.kind.into();
    let group = input.group.trim().to_string();
    let endpoint = deps.mutation.scope().endpoint.clone();
    let current_user_id = deps.mutation.scope().current_user_id.clone();
    deps.mutation
        .wait_for_remote(FAVORITE_REMOTE_MUTATION_INTERVAL)
        .await?;
    let (_, response) = deps
        .remote
        .clear_group(
            endpoint,
            current_user_id,
            input,
            Some(FavoriteRemoteCommand {
                name: "favorite.remote.group.clear",
                detail: format!("Clearing favorite group {group}."),
            }),
        )
        .await?;
    deps.mutation.ensure_current()?;
    if should_notify_favorite_change(response.status) {
        notify_favorite_change(deps, notification_scope, Vec::new());
    }
    Ok(response)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{has_exact_remote_favorite_identity, should_notify_favorite_change};

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

    #[test]
    fn exact_remote_add_requires_both_favorite_identifiers() {
        assert!(has_exact_remote_favorite_identity(&json!({
            "id": "fvrt_1",
            "favoriteId": "wrld_1"
        })));
        for payload in [
            json!({}),
            json!({"id": "fvrt_1"}),
            json!({"favoriteId": "wrld_1"}),
            json!({"id": "", "favoriteId": "wrld_1"}),
            json!({"id": "fvrt_1", "favoriteId": null}),
        ] {
            assert!(!has_exact_remote_favorite_identity(&payload));
        }
    }
}
