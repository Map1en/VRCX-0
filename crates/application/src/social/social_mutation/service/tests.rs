use std::sync::Arc;

use vrcx_0_application_core::{RemoteMutationGate, RuntimeAuthScope};
use vrcx_0_application_realtime::test_support::{
    runtime_with_active_session, TestDir, TestRealtimeHostRuntime,
};
use vrcx_0_application_realtime::SocialMutationStore;
use vrcx_0_contracts::friend_log::{
    FriendLogCurrentEntryInput, FriendLogHistoryQueryInput, FriendLogUpsertOptionsInput,
};

use super::super::types::SocialFriendMutationStatus;
use super::*;

#[test]
fn mutation_response_requires_2xx_and_strict_non_empty_json() {
    assert!(validate_vrchat_mutation_response(302, "{}").is_err());
    assert!(validate_vrchat_mutation_response(200, "not-json").is_err());
    assert_eq!(
        validate_vrchat_mutation_response(204, "").unwrap(),
        serde_json::Value::Null
    );
    assert!(validate_vrchat_mutation_response(200, r#"{"error":{"message":"denied"}}"#).is_err());
}

struct Fixture {
    _dir: TestDir,
    runtime: TestRealtimeHostRuntime,
    auth_scope: RuntimeAuthScope,
    remote_mutations: Arc<RemoteMutationGate>,
    remote: crate::remote::TestVrchatRequestPort,
}

fn fixture(name: &str) -> Fixture {
    let (dir, runtime, _) = runtime_with_active_session(name).unwrap();
    let auth_scope = runtime.auth_scope().clone();
    auth_scope.set("", "");
    let remote_mutations = Arc::new(RemoteMutationGate::default());
    Fixture {
        _dir: dir,
        runtime,
        auth_scope,
        remote_mutations,
        remote: crate::remote::TestVrchatRequestPort,
    }
}

impl Fixture {
    fn deps(&self) -> SocialMutationDeps<'_> {
        SocialMutationDeps {
            store: self.runtime.store(),
            remote: &self.remote,
            auth_scope: &self.auth_scope,
            remote_mutations: self.remote_mutations.as_ref(),
            realtime: self.runtime.runtime(),
        }
    }
}

fn history_rows(
    runtime: &TestRealtimeHostRuntime,
    owner: &str,
    target: &str,
    r#type: &str,
) -> usize {
    runtime
        .store()
        .friend_log_history(FriendLogHistoryQueryInput {
            user_id: owner.to_string(),
            target_user_id: target.to_string(),
            types: vec![r#type.to_string()],
            ..Default::default()
        })
        .expect("history query")
        .len()
}

#[tokio::test]
async fn unfriend_rejects_stale_auth_scope_with_zero_side_effects() {
    let fixture = fixture("unfriend-auth-scope-mismatch");
    let input = SocialFriendMutationInput {
        target_user_id: "usr_target".into(),
        target_display_name: "Target".into(),
    };

    let result = unfriend(fixture.deps(), input).await;

    assert!(result.is_err());
    assert_eq!(
        history_rows(&fixture.runtime, "usr_self", "usr_target", "Unfriend"),
        0
    );
}

#[tokio::test]
async fn accept_friend_request_rejects_stale_auth_scope_with_zero_side_effects() {
    let fixture = fixture("accept-auth-scope-mismatch");
    let input = SocialFriendRequestAcceptInput {
        notification_id: "not_1".into(),
        target_user_id: "usr_target".into(),
        target_display_name: "Target".into(),
    };

    let result = accept_friend_request(fixture.deps(), input).await;

    assert!(result.is_err());
    assert_eq!(
        history_rows(&fixture.runtime, "usr_self", "usr_target", "Friend"),
        0
    );
}

#[test]
fn apply_unfriend_locally_without_baseline_falls_back_to_direct_persistence_write() {
    let fixture = fixture("unfriend-missing-baseline-fallback");
    fixture
        .runtime
        .store()
        .upsert_current_friend(
            "usr_self",
            FriendLogCurrentEntryInput {
                user_id: "usr_target".into(),
                display_name: "Target".into(),
                trust_level: Some("Visitor".into()),
                friend_number: Value::from(1),
            },
            FriendLogUpsertOptionsInput {
                history_entry: None,
                force_history: false,
            },
        )
        .expect("seed friend_log_current");
    let watermark_before = fixture
        .runtime
        .runtime()
        .capture_friend_baseline_watermark()
        .unwrap();

    let outcome = apply_unfriend_locally(
        &fixture.deps(),
        &OwnerId::new("usr_self"),
        "https://api.vrchat.cloud/api/1",
        "usr_target",
        "Target",
    );

    assert_eq!(outcome.status, SocialFriendMutationStatus::Applied);
    assert!(fixture
        .runtime
        .store()
        .friend_log_current_list("usr_self")
        .unwrap()
        .is_empty());
    assert_eq!(
        history_rows(&fixture.runtime, "usr_self", "usr_target", "Unfriend"),
        1
    );
    let watermark_after = fixture
        .runtime
        .runtime()
        .capture_friend_baseline_watermark()
        .unwrap();
    assert!(watermark_after.friend_log_sequence > watermark_before.friend_log_sequence);
}

#[test]
fn apply_friend_request_accept_locally_without_baseline_falls_back_and_creates_friend_row() {
    let fixture = fixture("accept-missing-baseline-fallback");
    let watermark_before = fixture
        .runtime
        .runtime()
        .capture_friend_baseline_watermark()
        .unwrap();

    let outcome = apply_friend_request_accept_locally(
        &fixture.deps(),
        &OwnerId::new("usr_self"),
        "https://api.vrchat.cloud/api/1",
        "usr_target",
        "Target",
        json!({ "id": "usr_target", "displayName": "Target" }),
    );

    assert_eq!(outcome.status, SocialFriendMutationStatus::Applied);
    let current = fixture
        .runtime
        .store()
        .friend_log_current_list("usr_self")
        .unwrap();
    assert!(current.iter().any(|row| row.user_id == "usr_target"));
    assert_eq!(
        history_rows(&fixture.runtime, "usr_self", "usr_target", "Friend"),
        1
    );
    let watermark_after = fixture
        .runtime
        .runtime()
        .capture_friend_baseline_watermark()
        .unwrap();
    assert!(watermark_after.friend_log_sequence > watermark_before.friend_log_sequence);
}

#[test]
fn apply_unfriend_locally_reports_remote_ok_local_failed_when_persistence_write_fails() {
    let fixture = fixture("unfriend-local-write-fails");

    let outcome = apply_unfriend_locally(
        &fixture.deps(),
        &OwnerId::new("usr_self;DROP TABLE"),
        "https://api.vrchat.cloud/api/1",
        "usr_target",
        "Target",
    );

    assert_eq!(
        outcome.status,
        SocialFriendMutationStatus::RemoteOkLocalFailed
    );
    assert!(outcome.local_error.is_some());
}

#[test]
fn apply_friend_request_accept_locally_reports_remote_ok_local_failed_when_persistence_write_fails()
{
    let fixture = fixture("accept-local-write-fails");

    let outcome = apply_friend_request_accept_locally(
        &fixture.deps(),
        &OwnerId::new("usr_self;DROP TABLE"),
        "https://api.vrchat.cloud/api/1",
        "usr_target",
        "Target",
        json!({ "id": "usr_target", "displayName": "Target" }),
    );

    assert_eq!(
        outcome.status,
        SocialFriendMutationStatus::RemoteOkLocalFailed
    );
    assert!(outcome.local_error.is_some());
}

#[test]
fn write_friend_request_history_records_the_given_request_type() {
    let fixture = fixture("friend-request-history-only");

    for history_type in ["FriendRequest", "CancelFriendRequest"] {
        let outcome = write_friend_request_history(
            &fixture.deps(),
            &OwnerId::new("usr_self"),
            "usr_target",
            "Target",
            history_type,
        );

        assert_eq!(outcome.status, SocialFriendMutationStatus::Applied);
        assert_eq!(
            history_rows(&fixture.runtime, "usr_self", "usr_target", history_type),
            1
        );
    }
}

#[test]
fn mutation_response_returns_typed_not_found_failure() {
    let error = validate_vrchat_mutation_response(
        404,
        r#"{"error":{"message":"The specified friend request was not found."}}"#,
    )
    .unwrap_err();

    assert!(matches!(
        error,
        Error::VrchatApi {
            status_code: 404,
            message
        } if message == "The specified friend request was not found."
    ));
}

#[test]
fn friend_request_accept_only_treats_status_404_as_not_found() {
    assert!(is_not_found_error(&Error::VrchatApi {
        status_code: 404,
        message: "opaque not found response".into(),
    }));
    assert!(!is_not_found_error(&Error::VrchatApi {
        status_code: 500,
        message: "The specified friend request was not found. (404)".into(),
    }));
    assert!(!is_not_found_error(&Error::Custom(
        "The specified friend request was not found. (404)".into(),
    )));
}

#[test]
fn current_scope_401_emits_structured_auth_failure() {
    let fixture = fixture("current-scope-401");
    let scope = fixture
        .auth_scope
        .set("usr_self", "https://api.vrchat.cloud/api/1");

    emit_current_scope_auth_failure(
        &fixture.deps(),
        &scope,
        "user/usr_target/friendRequest",
        "Missing Credentials (401)",
        401,
    );

    let events = fixture.runtime.take_events_for_test();
    let event = events
        .iter()
        .find(|event| event.name == "runtimeVrchatAuthFailure")
        .expect("structured auth failure event");
    assert_eq!(event.payload["ownerUserId"], "usr_self");
    assert_eq!(event.payload["statusCode"], 401);
    assert_eq!(event.payload["authScopeGeneration"], scope.generation);
    assert_eq!(event.payload["path"], "user/usr_target/friendRequest");
}

#[test]
fn stale_scope_401_does_not_emit_auth_failure() {
    let fixture = fixture("stale-scope-401");
    let previous = fixture
        .auth_scope
        .set("usr_previous", "https://api.vrchat.cloud/api/1");
    fixture
        .auth_scope
        .set("usr_current", "https://api.vrchat.cloud/api/1");

    emit_current_scope_auth_failure(
        &fixture.deps(),
        &previous,
        "user/usr_target/friendRequest",
        "Missing Credentials (401)",
        401,
    );

    assert!(fixture
        .runtime
        .take_events_for_test()
        .iter()
        .all(|event| event.name != "runtimeVrchatAuthFailure"));
}

#[test]
fn previous_generation_401_does_not_invalidate_reauthenticated_same_scope() {
    let fixture = fixture("previous-generation-401");
    let previous = fixture
        .auth_scope
        .set("usr_self", "https://api.vrchat.cloud/api/1");
    fixture.auth_scope.set("", "");
    let current = fixture
        .auth_scope
        .set("usr_self", "https://api.vrchat.cloud/api/1");
    assert!(current.generation > previous.generation);

    emit_current_scope_auth_failure(
        &fixture.deps(),
        &previous,
        "user/usr_target/friendRequest",
        "Missing Credentials (401)",
        401,
    );

    assert!(fixture
        .runtime
        .take_events_for_test()
        .iter()
        .all(|event| event.name != "runtimeVrchatAuthFailure"));
}
