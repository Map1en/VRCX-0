use std::sync::Arc;

use vrcx_0_application::social::{
    CurrentUserMutationFuture, CurrentUserMutationPort, CurrentUserMutationRequest,
    CurrentUserQueryInvalidationFuture,
};
use vrcx_0_application_core::vrchat_api::execute_api_command;
use vrcx_0_application_core::{
    RuntimeAuthScopeSnapshot, RuntimeDiagnostics, RuntimeSyncEngine, WebClient,
};
use vrcx_0_application_realtime::RealtimeHostRuntime;
use vrcx_0_contracts::vrchat_api::VrchatScope;
use vrcx_0_vrchat_protocol::users::{
    current_user_badge_update_input, current_user_tags_add_input, current_user_tags_remove_input,
    current_user_update_input, profile_update_input,
};

pub struct VrchatCurrentUserMutationRemote {
    web: Arc<WebClient>,
    diagnostics: RuntimeDiagnostics,
    sync: RuntimeSyncEngine,
    realtime_runtime: Arc<RealtimeHostRuntime>,
}

impl VrchatCurrentUserMutationRemote {
    pub fn new(
        web: Arc<WebClient>,
        diagnostics: RuntimeDiagnostics,
        sync: RuntimeSyncEngine,
        realtime_runtime: Arc<RealtimeHostRuntime>,
    ) -> Self {
        Self {
            web,
            diagnostics,
            sync,
            realtime_runtime,
        }
    }
}

impl CurrentUserMutationPort for VrchatCurrentUserMutationRemote {
    fn execute<'a>(
        &'a self,
        scope: RuntimeAuthScopeSnapshot,
        request: CurrentUserMutationRequest,
    ) -> CurrentUserMutationFuture<'a> {
        Box::pin(async move {
            let (command, detail, request) = match request {
                CurrentUserMutationRequest::Profile(params) => {
                    let (user_id, request) =
                        profile_update_input(scope.endpoint, scope.current_user_id, params)?;
                    (
                        "app__vrchat_current_user_profile_update",
                        format!("Updating profile for current user {user_id}."),
                        request,
                    )
                }
                CurrentUserMutationRequest::User(params) => {
                    let (user_id, request) =
                        current_user_update_input(scope.endpoint, scope.current_user_id, params)?;
                    (
                        "app__vrchat_current_user_update",
                        format!("Updating current user {user_id}."),
                        request,
                    )
                }
                CurrentUserMutationRequest::Badge {
                    badge_id,
                    hidden,
                    showcased,
                } => {
                    let (user_id, badge_id, request) = current_user_badge_update_input(
                        scope.endpoint,
                        scope.current_user_id,
                        badge_id,
                        hidden,
                        showcased,
                    )?;
                    (
                        "app__vrchat_current_user_badge_update",
                        format!("Updating badge {badge_id} for current user {user_id}."),
                        request,
                    )
                }
                CurrentUserMutationRequest::AddTags(tags) => {
                    let (user_id, request) =
                        current_user_tags_add_input(scope.endpoint, scope.current_user_id, tags)?;
                    (
                        "app__vrchat_current_user_tags_add",
                        format!("Adding tags to current user {user_id}."),
                        request,
                    )
                }
                CurrentUserMutationRequest::RemoveTags(tags) => {
                    let (user_id, request) = current_user_tags_remove_input(
                        scope.endpoint,
                        scope.current_user_id,
                        tags,
                    )?;
                    (
                        "app__vrchat_current_user_tags_remove",
                        format!("Removing tags from current user {user_id}."),
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

    fn invalidate_user_query<'a>(
        &'a self,
        scope: RuntimeAuthScopeSnapshot,
    ) -> CurrentUserQueryInvalidationFuture<'a> {
        Box::pin(async move {
            self.realtime_runtime
                .invalidate_user_query_cache(&scope.endpoint, &scope.current_user_id)
                .await;
        })
    }
}
