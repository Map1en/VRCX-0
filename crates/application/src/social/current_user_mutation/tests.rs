use std::sync::Arc;

use vrcx_0_application_core::{
    CallRecorder, RemoteMutationGate, RuntimeAuthScope, RuntimeAuthScopeSnapshot,
};
use vrcx_0_contracts::vrchat_api::VrchatResponse;

use super::{
    CurrentUserMutationFuture, CurrentUserMutationPort, CurrentUserMutationRequest,
    CurrentUserMutationRuntime, CurrentUserProfileUpdateRequest,
    CurrentUserQueryInvalidationFuture, CurrentUserUpdateRequest, ProfileBackgroundType,
    VrchatCurrentUserBadgeInput, VrchatCurrentUserProfileUpdateInput, VrchatCurrentUserTagsInput,
    VrchatCurrentUserUpdateInput,
};

struct FakePort {
    response_status: i32,
    calls: CallRecorder<(RuntimeAuthScopeSnapshot, CurrentUserMutationRequest)>,
    invalidations: CallRecorder<RuntimeAuthScopeSnapshot>,
    switch_scope_during_execute: Option<RuntimeAuthScope>,
}

impl FakePort {
    fn new(response_status: i32) -> Self {
        Self {
            response_status,
            calls: CallRecorder::default(),
            invalidations: CallRecorder::default(),
            switch_scope_during_execute: None,
        }
    }
}

impl CurrentUserMutationPort for FakePort {
    fn execute<'a>(
        &'a self,
        scope: RuntimeAuthScopeSnapshot,
        request: CurrentUserMutationRequest,
    ) -> CurrentUserMutationFuture<'a> {
        Box::pin(async move {
            self.calls.record((scope, request));
            if let Some(auth_scope) = self.switch_scope_during_execute.as_ref() {
                auth_scope.set("usr_switched", "https://api.example.test/api/1");
            }
            Ok(VrchatResponse {
                status: self.response_status,
                data: "{}".to_string(),
            })
        })
    }

    fn invalidate_user_query<'a>(
        &'a self,
        scope: RuntimeAuthScopeSnapshot,
    ) -> CurrentUserQueryInvalidationFuture<'a> {
        Box::pin(async move {
            self.invalidations.record(scope);
        })
    }
}

fn runtime(port: Arc<FakePort>) -> (CurrentUserMutationRuntime, RuntimeAuthScope) {
    let auth_scope = RuntimeAuthScope::new();
    auth_scope.set("usr_current", "https://api.example.test/api/1");
    (
        CurrentUserMutationRuntime::new(
            auth_scope.clone(),
            Arc::new(RemoteMutationGate::default()),
            port,
        ),
        auth_scope,
    )
}

fn gradient_request() -> CurrentUserProfileUpdateRequest {
    CurrentUserProfileUpdateRequest {
        background_type: Some(ProfileBackgroundType::Gradient),
        background_gradient_bottom: Some("21385B".into()),
        background_gradient_top: Some("5d3f86".into()),
        ..Default::default()
    }
}

#[tokio::test]
async fn successful_profile_update_uses_captured_scope_and_invalidates_the_user_query() {
    let port = Arc::new(FakePort::new(200));
    let (runtime, _) = runtime(Arc::clone(&port));

    let response = runtime
        .update_profile(VrchatCurrentUserProfileUpdateInput {
            params: gradient_request(),
        })
        .await
        .unwrap();

    assert_eq!(response.status, 200);
    let calls = port.calls.snapshot();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].0.current_user_id, "usr_current");
    assert_eq!(
        calls[0].1,
        CurrentUserMutationRequest::Profile(gradient_request())
    );
    assert_eq!(port.invalidations.len(), 1);
}

#[tokio::test]
async fn non_success_response_does_not_invalidate_the_user_query() {
    let port = Arc::new(FakePort::new(400));
    let (runtime, _) = runtime(Arc::clone(&port));

    runtime
        .update_user(VrchatCurrentUserUpdateInput {
            params: CurrentUserUpdateRequest::default(),
        })
        .await
        .unwrap();

    assert!(port.invalidations.is_empty());
}

#[tokio::test]
async fn badge_update_preserves_the_existing_no_invalidation_policy() {
    let port = Arc::new(FakePort::new(200));
    let (runtime, _) = runtime(Arc::clone(&port));

    runtime
        .update_badge(VrchatCurrentUserBadgeInput {
            badge_id: "bdg_test".into(),
            hidden: true,
            showcased: false,
        })
        .await
        .unwrap();

    assert_eq!(
        port.calls.snapshot()[0].1,
        CurrentUserMutationRequest::Badge {
            badge_id: "bdg_test".into(),
            hidden: true,
            showcased: false,
        }
    );
    assert!(port.invalidations.is_empty());
}

#[tokio::test]
async fn inactive_scope_rejects_mutation_before_calling_the_port() {
    let port = Arc::new(FakePort::new(200));
    let runtime = CurrentUserMutationRuntime::new(
        RuntimeAuthScope::new(),
        Arc::new(RemoteMutationGate::default()),
        Arc::clone(&port) as Arc<dyn CurrentUserMutationPort>,
    );

    let error = runtime
        .add_tags(VrchatCurrentUserTagsInput {
            tags: vec!["system_test".into()],
        })
        .await
        .unwrap_err();

    assert_eq!(
        error.to_string(),
        "Current-user tags mutation requires an authenticated session."
    );
    assert!(port.calls.is_empty());
}

#[tokio::test]
async fn scope_change_during_remote_call_rejects_result_and_skips_invalidation() {
    let auth_scope = RuntimeAuthScope::new();
    auth_scope.set("usr_current", "https://api.example.test/api/1");
    let port = Arc::new(FakePort {
        response_status: 200,
        calls: CallRecorder::default(),
        invalidations: CallRecorder::default(),
        switch_scope_during_execute: Some(auth_scope.clone()),
    });
    let runtime = CurrentUserMutationRuntime::new(
        auth_scope,
        Arc::new(RemoteMutationGate::default()),
        Arc::clone(&port) as Arc<dyn CurrentUserMutationPort>,
    );

    let error = runtime
        .remove_tags(VrchatCurrentUserTagsInput {
            tags: vec!["system_test".into()],
        })
        .await
        .unwrap_err();

    assert_eq!(
        error.to_string(),
        "Current-user tags mutation authentication scope changed."
    );
    assert!(port.invalidations.is_empty());
}
