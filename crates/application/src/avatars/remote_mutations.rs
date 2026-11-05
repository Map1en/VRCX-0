use std::{sync::Arc, time::Duration};

use serde::Serialize;
use vrcx_0_application_core::AvatarCache;
use vrcx_0_application_realtime::RealtimeHostRuntime;
use vrcx_0_contracts::vrchat_api::VrchatResponse;

use vrcx_0_application_core::{AuthenticatedMutationContext, Result};

const AVATAR_REMOTE_MUTATION_INTERVAL: Duration = Duration::from_millis(250);

pub struct AvatarRemoteMutationDeps<'a> {
    pub(crate) store: &'a dyn super::AvatarCacheStore,
    pub(crate) remote: &'a dyn super::AvatarRemote,
    pub realtime: &'a Arc<RealtimeHostRuntime>,
    pub avatar_cache: &'a Arc<AvatarCache>,
    pub avatar_moderation: &'a super::AvatarModerationRuntime,
    pub mutation: AuthenticatedMutationContext<'a>,
}

impl<'a> AvatarRemoteMutationDeps<'a> {
    pub fn new(
        store: &'a dyn super::AvatarCacheStore,
        remote: &'a dyn super::AvatarRemote,
        realtime: &'a Arc<RealtimeHostRuntime>,
        avatar_cache: &'a Arc<AvatarCache>,
        avatar_moderation: &'a super::AvatarModerationRuntime,
        mutation: AuthenticatedMutationContext<'a>,
    ) -> Self {
        Self {
            store,
            remote,
            realtime,
            avatar_cache,
            avatar_moderation,
            mutation,
        }
    }
}

#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AvatarSelectionMutationOutcome {
    pub applied: bool,
    pub response: VrchatResponse,
}

pub async fn execute_avatar_remote_mutation(
    deps: &AvatarRemoteMutationDeps<'_>,
    command: &str,
    detail: String,
    mutation: super::AvatarRemoteMutation,
) -> Result<VrchatResponse> {
    let endpoint = deps.mutation.scope().endpoint.clone();
    deps.mutation
        .run_after_wait(AVATAR_REMOTE_MUTATION_INTERVAL, || async move {
            deps.remote
                .mutate(&endpoint, command, &detail, mutation)
                .await
        })
        .await
}

pub async fn select_avatar(
    deps: &AvatarRemoteMutationDeps<'_>,
    command: &str,
    detail: String,
    mutation: super::AvatarRemoteMutation,
) -> Result<AvatarSelectionMutationOutcome> {
    let endpoint = deps.mutation.scope().endpoint.clone();
    let (expectation, response) = deps
        .mutation
        .run_after_wait(AVATAR_REMOTE_MUTATION_INTERVAL, || async move {
            let expectation = deps.realtime.capture_current_user_refresh_expectation();
            let response = deps
                .remote
                .mutate(&endpoint, command, &detail, mutation)
                .await?;
            Ok((expectation, response))
        })
        .await?;
    let mut applied = false;
    if let Some(expectation) = expectation {
        if (200..300).contains(&response.status) {
            if let Ok(snapshot) = serde_json::from_str::<serde_json::Value>(&response.data) {
                applied = deps
                    .realtime
                    .apply_current_user_refreshed_snapshot_if_sequence(
                        expectation,
                        snapshot,
                        serde_json::Value::Null,
                    );
            }
        }
    }
    Ok(AvatarSelectionMutationOutcome { applied, response })
}

pub async fn save_avatar(
    deps: &AvatarRemoteMutationDeps<'_>,
    command: &str,
    detail: String,
    mutation: super::AvatarRemoteMutation,
) -> Result<VrchatResponse> {
    let response = execute_avatar_remote_mutation(deps, command, detail, mutation).await?;
    if (200..300).contains(&response.status) {
        if let Ok(avatar) = serde_json::from_str::<serde_json::Value>(&response.data) {
            let scope = deps.mutation.scope();
            deps.avatar_cache
                .hydrate_from_payload(&scope.current_user_id, &scope.endpoint, avatar);
        }
    }
    Ok(response)
}

pub async fn delete_avatar(
    deps: &AvatarRemoteMutationDeps<'_>,
    avatar_id: String,
    command: &str,
    detail: String,
    mutation: super::AvatarRemoteMutation,
) -> Result<VrchatResponse> {
    let response = execute_avatar_remote_mutation(deps, command, detail, mutation).await?;
    if (200..300).contains(&response.status) {
        let scope = deps.mutation.scope();
        deps.avatar_cache
            .invalidate(&scope.current_user_id, &scope.endpoint, &avatar_id);
        if let Err(error) = deps.store.remove_cached_avatar(avatar_id.clone()) {
            tracing::warn!(avatar_id = %avatar_id, "Avatar cache cleanup failed: {error}");
        }
    }
    Ok(response)
}
