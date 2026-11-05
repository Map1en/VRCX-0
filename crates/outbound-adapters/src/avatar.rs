use std::sync::Arc;

use vrcx_0_application::avatars::{
    AvatarCacheStore, AvatarFeedCleanupStore, AvatarRemote, AvatarRemoteFuture,
    AvatarRemoteMutation, MyAvatarsStore,
};
use vrcx_0_application_core::vrchat_api::execute_api_command;
use vrcx_0_application_core::{Error, RuntimeDiagnostics, RuntimeSyncEngine, WebClient};
use vrcx_0_contracts::vrchat_api::{VrchatResponse, VrchatScope};
use vrcx_0_contracts::{AvatarTagOutput, AvatarTimeSpentOutput};
use vrcx_0_persistence::DatabaseService;
use vrcx_0_vrchat_protocol::avatars::{
    avatar_delete_input, avatar_impostor_create_input, avatar_impostor_delete_input,
    avatar_list_by_user_get_input, avatar_moderation_delete_input, avatar_moderation_send_input,
    avatar_moderations_get_input, avatar_save_input, avatar_select_fallback_input,
    avatar_select_input, AvatarListByUserGetInput,
};
use vrcx_0_vrchat_protocol::query::{AvatarListSort, QueryOrder, ReleaseStatusFilter};

#[derive(Clone)]
pub struct LocalAvatarApplicationAdapter {
    db: Arc<DatabaseService>,
}

impl LocalAvatarApplicationAdapter {
    pub fn new(db: Arc<DatabaseService>) -> Self {
        Self { db }
    }
}

impl AvatarFeedCleanupStore for LocalAvatarApplicationAdapter {
    fn purge_avatar_feed(
        &self,
        user_id: String,
        cutoff_date: Option<String>,
    ) -> crate::Result<i64> {
        Ok(vrcx_0_persistence::feed::feed_avatar_purge(
            &self.db,
            user_id,
            cutoff_date,
        )?)
    }

    fn vacuum_if_fragmented(&self) -> crate::Result<bool> {
        Ok(vrcx_0_persistence::maintenance::database_vacuum_if_fragmented(&self.db)?)
    }
}

impl MyAvatarsStore for LocalAvatarApplicationAdapter {
    fn avatar_tags(&self) -> crate::Result<Vec<AvatarTagOutput>> {
        Ok(vrcx_0_persistence::avatars::avatar_tags_list(&self.db)?)
    }

    fn avatar_time_spent(
        &self,
        owner_user_id: String,
    ) -> crate::Result<Vec<AvatarTimeSpentOutput>> {
        Ok(vrcx_0_persistence::avatars::avatar_time_spent_list(
            &self.db,
            owner_user_id,
        )?)
    }
}

impl AvatarCacheStore for LocalAvatarApplicationAdapter {
    fn remove_cached_avatar(&self, avatar_id: String) -> crate::Result<()> {
        Ok(vrcx_0_persistence::avatars::avatar_cache_remove(
            &self.db, avatar_id,
        )?)
    }
}

pub struct VrchatAvatarRemote {
    web: Arc<WebClient>,
    diagnostics: RuntimeDiagnostics,
    sync: RuntimeSyncEngine,
}

impl VrchatAvatarRemote {
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

impl AvatarRemote for VrchatAvatarRemote {
    fn moderations<'a>(
        &'a self,
        endpoint: &'a str,
        command: &'a str,
        detail: &'a str,
    ) -> AvatarRemoteFuture<'a, VrchatResponse> {
        Box::pin(async move {
            execute_api_command(
                &self.web,
                &self.diagnostics,
                &self.sync,
                (command, detail),
                avatar_moderations_get_input(endpoint.to_string()),
                VrchatScope::Vrchat,
            )
            .await
        })
    }

    fn my_avatar_page<'a>(
        &'a self,
        endpoint: &'a str,
        page_size: i32,
        offset: i32,
    ) -> AvatarRemoteFuture<'a, Vec<serde_json::Value>> {
        Box::pin(async move {
            let request = avatar_list_by_user_get_input(AvatarListByUserGetInput {
                endpoint: endpoint.to_string(),
                user_id: String::new(),
                user: "me".into(),
                n: page_size,
                offset,
                sort: AvatarListSort::Updated,
                order: QueryOrder::Descending,
                release_status: ReleaseStatusFilter::All,
            })?
            .1;
            let response = self.web.execute_api(request, VrchatScope::Vrchat).await?;
            parse_my_avatar_page(response.status, &response.data)
        })
    }

    fn mutate<'a>(
        &'a self,
        endpoint: &'a str,
        command: &'a str,
        detail: &'a str,
        mutation: AvatarRemoteMutation,
    ) -> AvatarRemoteFuture<'a, VrchatResponse> {
        Box::pin(async move {
            let request = match mutation {
                AvatarRemoteMutation::Select {
                    avatar_id,
                    fallback: false,
                } => avatar_select_input(endpoint.to_string(), avatar_id)?.1,
                AvatarRemoteMutation::Select {
                    avatar_id,
                    fallback: true,
                } => avatar_select_fallback_input(endpoint.to_string(), avatar_id)?.1,
                AvatarRemoteMutation::Save { avatar_id, params } => {
                    avatar_save_input(endpoint.to_string(), avatar_id, params)?.1
                }
                AvatarRemoteMutation::Delete { avatar_id } => {
                    avatar_delete_input(endpoint.to_string(), avatar_id)?.1
                }
                AvatarRemoteMutation::CreateImpostor { avatar_id } => {
                    avatar_impostor_create_input(endpoint.to_string(), avatar_id)?.1
                }
                AvatarRemoteMutation::DeleteImpostor { avatar_id } => {
                    avatar_impostor_delete_input(endpoint.to_string(), avatar_id)?.1
                }
                AvatarRemoteMutation::SendModeration { avatar_id } => {
                    avatar_moderation_send_input(endpoint.to_string(), avatar_id)?.1
                }
                AvatarRemoteMutation::DeleteModeration { avatar_id } => {
                    avatar_moderation_delete_input(endpoint.to_string(), avatar_id)?.1
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

fn parse_my_avatar_page(status: i32, data: &str) -> crate::Result<Vec<serde_json::Value>> {
    let payload = serde_json::from_str::<serde_json::Value>(data)
        .unwrap_or_else(|_| serde_json::Value::String(data.to_string()));
    if status >= 400 || payload.get("error").is_some() {
        let detail = payload
            .get("error")
            .and_then(|error| error.get("message"))
            .and_then(serde_json::Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| format!("status {status}"));
        return Err(Error::Custom(format!(
            "My avatars request failed: {detail}"
        )));
    }
    match payload {
        serde_json::Value::Array(rows) => Ok(rows),
        _ => Ok(Vec::new()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn my_avatar_page_parser_preserves_array_and_error_contracts() {
        assert_eq!(
            parse_my_avatar_page(200, r#"[{"id":"avtr_1"}]"#)
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            parse_my_avatar_page(403, r#"{"error":{"message":"denied"}}"#)
                .unwrap_err()
                .to_string(),
            "My avatars request failed: denied"
        );
        assert!(parse_my_avatar_page(200, "not-json").unwrap().is_empty());
    }
}
