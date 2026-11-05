use futures_util::future::BoxFuture;

use std::sync::Arc;
use std::time::Duration;

use vrcx_0_application_core::{
    AuthenticatedMutationContext, RemoteMutationGate, Result, RuntimeAuthScope,
    RuntimeAuthScopeSnapshot,
};
use vrcx_0_contracts::vrchat_api::VrchatResponse;

use super::types::{
    VrchatCurrentUserBadgeInput, VrchatCurrentUserProfileUpdateInput, VrchatCurrentUserTagsInput,
    VrchatCurrentUserUpdateInput,
};
use vrcx_0_contracts::vrchat_requests::{
    CurrentUserProfileUpdateRequest, CurrentUserUpdateRequest,
};

const CURRENT_USER_REMOTE_MUTATION_INTERVAL: Duration = Duration::from_millis(250);

pub type CurrentUserMutationFuture<'a> = BoxFuture<'a, Result<VrchatResponse>>;
pub type CurrentUserQueryInvalidationFuture<'a> = BoxFuture<'a, ()>;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CurrentUserMutationRequest {
    Profile(CurrentUserProfileUpdateRequest),
    User(CurrentUserUpdateRequest),
    Badge {
        badge_id: String,
        hidden: bool,
        showcased: bool,
    },
    AddTags(Vec<String>),
    RemoveTags(Vec<String>),
}

pub trait CurrentUserMutationPort: Send + Sync {
    fn execute<'a>(
        &'a self,
        scope: RuntimeAuthScopeSnapshot,
        request: CurrentUserMutationRequest,
    ) -> CurrentUserMutationFuture<'a>;

    fn invalidate_user_query<'a>(
        &'a self,
        scope: RuntimeAuthScopeSnapshot,
    ) -> CurrentUserQueryInvalidationFuture<'a>;
}

#[derive(Clone)]
pub struct CurrentUserMutationRuntime {
    auth_scope: RuntimeAuthScope,
    remote_mutations: Arc<RemoteMutationGate>,
    port: Arc<dyn CurrentUserMutationPort>,
}

impl CurrentUserMutationRuntime {
    pub fn new(
        auth_scope: RuntimeAuthScope,
        remote_mutations: Arc<RemoteMutationGate>,
        port: Arc<dyn CurrentUserMutationPort>,
    ) -> Self {
        Self {
            auth_scope,
            remote_mutations,
            port,
        }
    }

    pub async fn update_profile(
        &self,
        input: VrchatCurrentUserProfileUpdateInput,
    ) -> Result<VrchatResponse> {
        self.execute(
            "Current-user profile mutation",
            CurrentUserMutationRequest::Profile(input.params),
            true,
        )
        .await
    }

    pub async fn update_user(&self, input: VrchatCurrentUserUpdateInput) -> Result<VrchatResponse> {
        self.execute(
            "Current-user mutation",
            CurrentUserMutationRequest::User(input.params),
            true,
        )
        .await
    }

    pub async fn update_badge(&self, input: VrchatCurrentUserBadgeInput) -> Result<VrchatResponse> {
        self.execute(
            "Current-user badge mutation",
            CurrentUserMutationRequest::Badge {
                badge_id: input.badge_id,
                hidden: input.hidden,
                showcased: input.showcased,
            },
            false,
        )
        .await
    }

    pub async fn add_tags(&self, input: VrchatCurrentUserTagsInput) -> Result<VrchatResponse> {
        self.execute(
            "Current-user tags mutation",
            CurrentUserMutationRequest::AddTags(input.tags),
            true,
        )
        .await
    }

    pub async fn remove_tags(&self, input: VrchatCurrentUserTagsInput) -> Result<VrchatResponse> {
        self.execute(
            "Current-user tags mutation",
            CurrentUserMutationRequest::RemoveTags(input.tags),
            true,
        )
        .await
    }

    async fn execute(
        &self,
        label: &'static str,
        request: CurrentUserMutationRequest,
        invalidate_user_query: bool,
    ) -> Result<VrchatResponse> {
        let mutation = AuthenticatedMutationContext::capture(
            &self.auth_scope,
            self.remote_mutations.as_ref(),
            label,
        )?;
        let scope = mutation.scope().clone();
        let response = mutation
            .run_after_wait(CURRENT_USER_REMOTE_MUTATION_INTERVAL, || {
                self.port.execute(scope.clone(), request)
            })
            .await?;
        if invalidate_user_query && (200..300).contains(&response.status) {
            self.port.invalidate_user_query(scope).await;
        }
        Ok(response)
    }
}
