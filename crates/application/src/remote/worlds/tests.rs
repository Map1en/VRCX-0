use std::sync::{Arc, Mutex};

use vrcx_0_application_core::{RemoteMutationGate, RuntimeAuthScope};
use vrcx_0_contracts::vrchat_api::VrchatResponse;

use super::{
    WorldRemoteFuture, WorldRemoteOperation, WorldRemotePort, WorldRemoteRuntime, WorldRemoteScope,
    WorldResponseProjectionPort,
};

#[derive(Default)]
struct RecordingPort {
    calls: Mutex<Vec<(WorldRemoteScope, WorldRemoteOperation)>>,
}

#[derive(Default)]
struct RecordingProjection {
    responses: Mutex<Vec<VrchatResponse>>,
}

impl WorldResponseProjectionPort for RecordingProjection {
    fn hydrate(&self, response: &VrchatResponse) {
        self.responses.lock().unwrap().push(response.clone());
    }
}

impl WorldRemotePort for RecordingPort {
    fn execute(
        &self,
        scope: WorldRemoteScope,
        operation: WorldRemoteOperation,
    ) -> WorldRemoteFuture<'_> {
        self.calls.lock().unwrap().push((scope, operation));
        Box::pin(async {
            Ok(VrchatResponse {
                status: 200,
                data: r#"{"id":"wrld_test"}"#.into(),
            })
        })
    }
}

#[tokio::test]
async fn read_delegates_semantic_input_without_authenticated_scope() {
    let port = Arc::new(RecordingPort::default());
    let projection = Arc::new(RecordingProjection::default());
    let runtime = WorldRemoteRuntime::new(
        RuntimeAuthScope::new(),
        Arc::new(RemoteMutationGate::default()),
        port.clone(),
        projection.clone(),
    );

    runtime
        .list_by_user(
            " usr_test ".into(),
            50,
            100,
            super::WorldSearchSort::Updated,
            super::QueryOrder::Descending,
            super::ReleaseStatusFilter::All,
        )
        .await
        .unwrap();

    let calls = port.calls.lock().unwrap();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].0, WorldRemoteScope::Public);
    assert_eq!(
        calls[0].1,
        WorldRemoteOperation::ListByUser {
            user_id: "usr_test".into(),
            n: 50,
            offset: 100,
            sort: super::WorldSearchSort::Updated,
            order: super::QueryOrder::Descending,
            release_status: super::ReleaseStatusFilter::All,
        }
    );
    assert!(projection.responses.lock().unwrap().is_empty());
}

#[tokio::test]
async fn mutation_requires_authentication_before_calling_the_port() {
    let port = Arc::new(RecordingPort::default());
    let projection = Arc::new(RecordingProjection::default());
    let runtime = WorldRemoteRuntime::new(
        RuntimeAuthScope::new(),
        Arc::new(RemoteMutationGate::default()),
        port.clone(),
        projection.clone(),
    );

    let error = runtime.delete("wrld_test".into()).await.unwrap_err();

    assert_eq!(
        error.to_string(),
        "VRChat mutation requires an authenticated session."
    );
    assert!(port.calls.lock().unwrap().is_empty());
    assert!(projection.responses.lock().unwrap().is_empty());
}

#[tokio::test]
async fn mutation_passes_captured_identity_to_the_port() {
    let auth_scope = RuntimeAuthScope::new();
    auth_scope.set("usr_current", "https://api.example.test/api/1");
    let port = Arc::new(RecordingPort::default());
    let projection = Arc::new(RecordingProjection::default());
    let runtime = WorldRemoteRuntime::new(
        auth_scope,
        Arc::new(RemoteMutationGate::default()),
        port.clone(),
        projection.clone(),
    );

    runtime.publish(" wrld_test ".into()).await.unwrap();

    let calls = port.calls.lock().unwrap();
    assert_eq!(calls.len(), 1);
    assert_eq!(
        calls[0].0,
        WorldRemoteScope::Authenticated {
            current_user_id: "usr_current".into(),
            endpoint: "https://api.example.test/api/1".into(),
        }
    );
    assert_eq!(
        calls[0].1,
        WorldRemoteOperation::Publish {
            world_id: "wrld_test".into(),
        }
    );
    assert_eq!(projection.responses.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn rating_set_is_an_authenticated_mutation_that_does_not_hydrate_the_world() {
    let auth_scope = RuntimeAuthScope::new();
    auth_scope.set("usr_current", "https://api.example.test/api/1");
    let port = Arc::new(RecordingPort::default());
    let projection = Arc::new(RecordingProjection::default());
    let runtime = WorldRemoteRuntime::new(
        auth_scope,
        Arc::new(RemoteMutationGate::default()),
        port.clone(),
        projection.clone(),
    );

    runtime
        .rating_set(" wrld_test ".into(), Some(super::WorldRatingValue::Like))
        .await
        .unwrap();

    let calls = port.calls.lock().unwrap();
    assert_eq!(calls.len(), 1);
    assert!(matches!(calls[0].0, WorldRemoteScope::Authenticated { .. }));
    assert_eq!(
        calls[0].1,
        WorldRemoteOperation::RatingSet {
            world_id: "wrld_test".into(),
            value: Some(super::WorldRatingValue::Like),
        }
    );
    assert!(projection.responses.lock().unwrap().is_empty());
}
