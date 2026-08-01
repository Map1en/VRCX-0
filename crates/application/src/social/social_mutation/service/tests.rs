use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use vrcx_0_persistence::friends::{friend_log_history_query, FriendLogHistoryQueryInput};
use vrcx_0_persistence::storage::StorageService;
use vrcx_0_persistence::DatabaseService;

use crate::{RuntimeAuthScope, RuntimeEventBus, UnavailableLocalGameContextSource};
use vrcx_0_application_core::{
    HostSessionRuntime, NoopPrintCleanupInputSink, RuntimeSyncEngine, TaskSupervisor, WebClient,
    WorldCache,
};
use vrcx_0_application_realtime::{RealtimeHostRuntime, RealtimeHostRuntimeDeps};

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

struct TestDir {
    path: PathBuf,
}

impl TestDir {
    fn new(name: &str) -> Self {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "vrcx-0-social-mutation-{name}-{}-{nonce}",
            std::process::id()
        ));
        std::fs::create_dir_all(&path).unwrap();
        Self { path }
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

struct Fixture {
    _dir: TestDir,
    runtime: Arc<RealtimeHostRuntime>,
    db: Arc<DatabaseService>,
    web: Arc<WebClient>,
    auth_scope: RuntimeAuthScope,
    event_bus: RuntimeEventBus,
}

fn fixture(name: &str) -> Fixture {
    let dir = TestDir::new(name);
    let db = Arc::new(DatabaseService::new(&dir.path.join("VRCX-0.sqlite3")).unwrap());
    let storage = StorageService::new(&dir.path.join("storage.json")).unwrap();
    let web = Arc::new(
        WebClient::new(
            &storage,
            db.as_ref(),
            "wss://pipeline.vrchat.cloud".to_string(),
            env!("CARGO_PKG_VERSION"),
        )
        .unwrap(),
    );
    let auth_scope = RuntimeAuthScope::new();
    let event_bus = RuntimeEventBus::new();
    let world_cache = Arc::new(WorldCache::new(
        Arc::clone(&db),
        512,
        Duration::from_secs(30 * 60),
    ));
    let runtime = Arc::new(RealtimeHostRuntime::new(RealtimeHostRuntimeDeps {
        db: Arc::clone(&db),
        web: Arc::clone(&web),
        event_bus: event_bus.clone(),
        sync: RuntimeSyncEngine::new(),
        tasks: TaskSupervisor::new(),
        session: HostSessionRuntime::new(),
        auth_scope: auth_scope.clone(),
        local_game_context: Arc::new(UnavailableLocalGameContextSource),
        activity_sink: None,
        world_cache,
        print_cleanup: Arc::new(NoopPrintCleanupInputSink),
        friend_note_change_sink: None,
    }));
    Fixture {
        _dir: dir,
        runtime,
        db,
        web,
        auth_scope,
        event_bus,
    }
}

impl Fixture {
    fn deps(&self) -> SocialMutationDeps<'_> {
        SocialMutationDeps {
            db: self.db.as_ref(),
            web: self.web.as_ref(),
            auth_scope: &self.auth_scope,
            realtime: &self.runtime,
        }
    }
}

fn history_rows(db: &DatabaseService, owner: &str, target: &str, r#type: &str) -> usize {
    friend_log_history_query(
        db,
        FriendLogHistoryQueryInput {
            user_id: owner.to_string(),
            target_user_id: target.to_string(),
            types: vec![r#type.to_string()],
        },
    )
    .expect("history query")
    .len()
}

#[tokio::test]
async fn unfriend_rejects_stale_auth_scope_with_zero_side_effects() {
    let fixture = fixture("unfriend-auth-scope-mismatch");
    let input = SocialFriendMutationInput {
        owner_user_id: "usr_self".into(),
        endpoint: String::new(),
        target_user_id: "usr_target".into(),
        target_display_name: "Target".into(),
    };

    let result = unfriend(fixture.deps(), input).await;

    assert!(result.is_err());
    assert_eq!(
        history_rows(fixture.db.as_ref(), "usr_self", "usr_target", "Unfriend"),
        0
    );
}

#[tokio::test]
async fn accept_friend_request_rejects_stale_auth_scope_with_zero_side_effects() {
    let fixture = fixture("accept-auth-scope-mismatch");
    let input = SocialFriendRequestAcceptInput {
        owner_user_id: "usr_self".into(),
        endpoint: String::new(),
        notification_id: "not_1".into(),
        target_user_id: "usr_target".into(),
        target_display_name: "Target".into(),
    };

    let result = accept_friend_request(fixture.deps(), input).await;

    assert!(result.is_err());
    assert_eq!(
        history_rows(fixture.db.as_ref(), "usr_self", "usr_target", "Friend"),
        0
    );
}

#[test]
fn apply_unfriend_locally_without_baseline_falls_back_to_direct_persistence_write() {
    let fixture = fixture("unfriend-missing-baseline-fallback");
    friend_log_upsert_current(
        fixture.db.as_ref(),
        "usr_self".into(),
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
    let watermark_before = fixture.runtime.capture_friend_baseline_watermark().unwrap();

    let outcome = apply_unfriend_locally(
        &fixture.deps(),
        "usr_self",
        "https://api.vrchat.cloud/api/1",
        "usr_target",
        "Target",
    );

    assert_eq!(outcome.status, SocialFriendMutationStatus::Applied);
    assert!(vrcx_0_persistence::friends::friend_log_current_list(
        fixture.db.as_ref(),
        "usr_self".into()
    )
    .unwrap()
    .is_empty());
    assert_eq!(
        history_rows(fixture.db.as_ref(), "usr_self", "usr_target", "Unfriend"),
        1
    );
    let watermark_after = fixture.runtime.capture_friend_baseline_watermark().unwrap();
    assert!(watermark_after.friend_log_sequence > watermark_before.friend_log_sequence);
}

#[test]
fn apply_friend_request_accept_locally_without_baseline_falls_back_and_creates_friend_row() {
    let fixture = fixture("accept-missing-baseline-fallback");
    let watermark_before = fixture.runtime.capture_friend_baseline_watermark().unwrap();

    let outcome = apply_friend_request_accept_locally(
        &fixture.deps(),
        "usr_self",
        "https://api.vrchat.cloud/api/1",
        "usr_target",
        "Target",
        json!({ "id": "usr_target", "displayName": "Target" }),
    );

    assert_eq!(outcome.status, SocialFriendMutationStatus::Applied);
    let current = vrcx_0_persistence::friends::friend_log_current_list(
        fixture.db.as_ref(),
        "usr_self".into(),
    )
    .unwrap();
    assert!(current.iter().any(|row| row.user_id == "usr_target"));
    assert_eq!(
        history_rows(fixture.db.as_ref(), "usr_self", "usr_target", "Friend"),
        1
    );
    let watermark_after = fixture.runtime.capture_friend_baseline_watermark().unwrap();
    assert!(watermark_after.friend_log_sequence > watermark_before.friend_log_sequence);
}

#[test]
fn apply_unfriend_locally_reports_remote_ok_local_failed_when_persistence_write_fails() {
    let fixture = fixture("unfriend-local-write-fails");

    let outcome = apply_unfriend_locally(
        &fixture.deps(),
        "usr_self;DROP TABLE",
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
        "usr_self;DROP TABLE",
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
fn write_friend_request_history_records_friend_request_type() {
    let fixture = fixture("send-request-history-only");

    let outcome = write_friend_request_history(
        &fixture.deps(),
        "usr_self",
        "usr_target",
        "Target",
        "FriendRequest",
    );

    assert_eq!(outcome.status, SocialFriendMutationStatus::Applied);
    assert_eq!(
        history_rows(
            fixture.db.as_ref(),
            "usr_self",
            "usr_target",
            "FriendRequest"
        ),
        1
    );
}

#[test]
fn error_message_with_status_suffix_appends_status_for_error_message_payload() {
    let message = ApiJsonResponse::parse(
        404,
        r#"{"error":{"message":"The specified friend request was not found."}}"#,
    )
    .error_message_or("VRChat social mutation request failed");

    let message = error_message_with_status_suffix(message, 404);

    assert!(message.ends_with("(404)"));
}

#[test]
fn error_message_with_status_suffix_does_not_double_append_fallback_message() {
    let message =
        ApiJsonResponse::parse(404, "{}").error_message_or("VRChat social mutation request failed");

    let message = error_message_with_status_suffix(message, 404);

    assert_eq!(message.matches("(404)").count(), 1);
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

    let events = fixture.event_bus.take_events_for_test();
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
        .event_bus
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
        .event_bus
        .take_events_for_test()
        .iter()
        .all(|event| event.name != "runtimeVrchatAuthFailure"));
}

#[test]
fn write_friend_request_history_records_cancel_friend_request_type() {
    let fixture = fixture("cancel-request-history-only");

    let outcome = write_friend_request_history(
        &fixture.deps(),
        "usr_self",
        "usr_target",
        "Target",
        "CancelFriendRequest",
    );

    assert_eq!(outcome.status, SocialFriendMutationStatus::Applied);
    assert_eq!(
        history_rows(
            fixture.db.as_ref(),
            "usr_self",
            "usr_target",
            "CancelFriendRequest"
        ),
        1
    );
}
