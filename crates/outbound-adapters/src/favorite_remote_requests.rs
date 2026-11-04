use std::sync::Arc;

use vrcx_0_application::favorites::{
    FavoriteRemote, FavoriteRemoteAddInput, FavoriteRemoteCommand, FavoriteRemoteFuture,
    FavoriteRemoteGroupClearInput, FavoriteRemoteGroupSaveInput,
};
use vrcx_0_application_core::vrchat_api::execute_api_command;
use vrcx_0_application_core::{RuntimeDiagnostics, RuntimeSyncEngine, WebClient, WorldCache};
use vrcx_0_contracts::vrchat_api::{VrchatRequest, VrchatResponse, VrchatScope};
use vrcx_0_vrchat_protocol::avatars::avatar_get_input;
use vrcx_0_vrchat_protocol::favorites::{
    favorite_add_input, favorite_avatars_get_input, favorite_delete_input,
    favorite_group_clear_input, favorite_group_save_input, favorite_limits_get_input,
    favorite_worlds_get_input, favorites_get_input,
};
use vrcx_0_vrchat_protocol::users::user_get_input;

pub struct VrchatFavoriteRemote {
    web: Arc<WebClient>,
    diagnostics: RuntimeDiagnostics,
    sync: RuntimeSyncEngine,
    world_cache: Arc<WorldCache>,
}

impl VrchatFavoriteRemote {
    pub fn new(
        web: Arc<WebClient>,
        diagnostics: RuntimeDiagnostics,
        sync: RuntimeSyncEngine,
        world_cache: Arc<WorldCache>,
    ) -> Self {
        Self {
            web,
            diagnostics,
            sync,
            world_cache,
        }
    }

    async fn execute(
        &self,
        request: VrchatRequest,
        command: Option<FavoriteRemoteCommand>,
    ) -> crate::Result<VrchatResponse> {
        match command {
            Some(command) => {
                execute_api_command(
                    &self.web,
                    &self.diagnostics,
                    &self.sync,
                    (command.name, command.detail),
                    request,
                    VrchatScope::Vrchat,
                )
                .await
            }
            None => self.web.execute_api(request, VrchatScope::Vrchat).await,
        }
    }
}

impl FavoriteRemote for VrchatFavoriteRemote {
    fn list<'a>(
        &'a self,
        endpoint: String,
        n: i32,
        offset: i32,
        command: Option<FavoriteRemoteCommand>,
    ) -> FavoriteRemoteFuture<'a, VrchatResponse> {
        Box::pin(async move {
            self.execute(favorites_get_input(endpoint, n, offset), command)
                .await
        })
    }

    fn limits<'a>(
        &'a self,
        endpoint: String,
        command: Option<FavoriteRemoteCommand>,
    ) -> FavoriteRemoteFuture<'a, VrchatResponse> {
        Box::pin(async move {
            self.execute(favorite_limits_get_input(endpoint), command)
                .await
        })
    }

    fn favorite_worlds<'a>(
        &'a self,
        endpoint: String,
        n: i32,
        offset: i32,
        owner_id: String,
        user_id: String,
        tag: String,
    ) -> FavoriteRemoteFuture<'a, VrchatResponse> {
        Box::pin(async move {
            self.execute(
                favorite_worlds_get_input(endpoint, n, offset, owner_id, user_id, tag),
                None,
            )
            .await
        })
    }

    fn favorite_avatars<'a>(
        &'a self,
        endpoint: String,
        n: i32,
        offset: i32,
        tag: String,
    ) -> FavoriteRemoteFuture<'a, VrchatResponse> {
        Box::pin(async move {
            self.execute(favorite_avatars_get_input(endpoint, n, offset, tag), None)
                .await
        })
    }

    fn world<'a>(
        &'a self,
        endpoint: String,
        world_id: String,
    ) -> FavoriteRemoteFuture<'a, VrchatResponse> {
        Box::pin(async move {
            self.world_cache
                .get(&endpoint, &world_id, true, false)
                .await
        })
    }

    fn avatar<'a>(
        &'a self,
        endpoint: String,
        avatar_id: String,
    ) -> FavoriteRemoteFuture<'a, VrchatResponse> {
        Box::pin(async move {
            let (_, request) = avatar_get_input(endpoint, avatar_id)?;
            self.execute(request, None).await
        })
    }

    fn user<'a>(
        &'a self,
        endpoint: String,
        user_id: String,
    ) -> FavoriteRemoteFuture<'a, VrchatResponse> {
        Box::pin(async move {
            let (_, request) = user_get_input(endpoint, user_id)?;
            self.execute(request, None).await
        })
    }

    fn add<'a>(
        &'a self,
        endpoint: String,
        input: FavoriteRemoteAddInput,
        command: Option<FavoriteRemoteCommand>,
    ) -> FavoriteRemoteFuture<'a, (String, String, VrchatResponse)> {
        Box::pin(async move {
            let (kind, entity_id, request) =
                favorite_add_input(endpoint, input.kind, input.entity_id, input.tags)?;
            let response = self.execute(request, command).await?;
            Ok((kind, entity_id, response))
        })
    }

    fn delete<'a>(
        &'a self,
        endpoint: String,
        object_id: String,
        command: Option<FavoriteRemoteCommand>,
    ) -> FavoriteRemoteFuture<'a, (String, VrchatResponse)> {
        Box::pin(async move {
            let (object_id, request) = favorite_delete_input(endpoint, object_id)?;
            let response = self.execute(request, command).await?;
            Ok((object_id, response))
        })
    }

    fn save_group<'a>(
        &'a self,
        endpoint: String,
        current_user_id: String,
        input: FavoriteRemoteGroupSaveInput,
        command: Option<FavoriteRemoteCommand>,
    ) -> FavoriteRemoteFuture<'a, (String, VrchatResponse)> {
        Box::pin(async move {
            let (group, request) = favorite_group_save_input(
                endpoint,
                current_user_id,
                input.kind,
                input.group,
                input.display_name,
                input.visibility,
            )?;
            let response = self.execute(request, command).await?;
            Ok((group, response))
        })
    }

    fn clear_group<'a>(
        &'a self,
        endpoint: String,
        current_user_id: String,
        input: FavoriteRemoteGroupClearInput,
        command: Option<FavoriteRemoteCommand>,
    ) -> FavoriteRemoteFuture<'a, (String, VrchatResponse)> {
        Box::pin(async move {
            let (group, request) =
                favorite_group_clear_input(endpoint, current_user_id, input.kind, input.group)?;
            let response = self.execute(request, command).await?;
            Ok((group, response))
        })
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use vrcx_0_contracts::VrchatFavoriteType;
    use vrcx_0_vrchat_protocol::favorites::favorite_add_input;

    #[test]
    fn vrc_plus_world_add_preserves_request_shape() {
        let (kind, entity_id, request) = favorite_add_input(
            "endpoint".into(),
            VrchatFavoriteType::VrcPlusWorld,
            "wrld_1".into(),
            "worlds4".into(),
        )
        .unwrap();

        assert_eq!(kind, "vrcPlusWorld");
        assert_eq!(entity_id, "wrld_1");
        assert_eq!(request.path.as_deref(), Some("favorites"));
        assert_eq!(
            request.body.as_json(),
            Some(&json!({
                "type": "vrcPlusWorld",
                "favoriteId": "wrld_1",
                "tags": "worlds4",
            }))
        );
    }
}
