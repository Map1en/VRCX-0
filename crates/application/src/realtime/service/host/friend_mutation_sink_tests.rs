use std::time::Duration;

use vrcx_0_persistence::friends::{
    friend_log_current_list, friend_log_history_query, FriendLogHistoryQueryInput,
};
use vrcx_0_persistence::realtime::{FriendLogUpsert, RealtimePersistenceBatch};

use crate::social_mutation::types::SocialFriendMutationStatus;
use crate::social_mutation::{apply_friend_request_accept_locally, apply_unfriend_locally};
use crate::{RuntimeTask, RuntimeTaskExecutor, RuntimeTaskHandle, SocialMutationDeps};

use super::test_support::*;
use super::*;

#[derive(Clone, Copy)]
struct DiscardTaskExecutor;

struct FinishedTaskHandle;

impl RuntimeTaskExecutor for DiscardTaskExecutor {
    fn spawn(&self, _task: RuntimeTask) -> Box<dyn RuntimeTaskHandle> {
        Box::new(FinishedTaskHandle)
    }
}

impl RuntimeTaskHandle for FinishedTaskHandle {
    fn abort(&self) {}

    fn is_finished(&self) -> bool {
        true
    }

    fn join_or_abort(&mut self, _timeout: Duration) {}
}

fn deps(runtime: &Arc<RealtimeHostRuntime>) -> SocialMutationDeps<'_> {
    SocialMutationDeps {
        db: runtime.deps.db.as_ref(),
        web: runtime.deps.web.as_ref(),
        auth_scope: &runtime.deps.auth_scope,
        realtime: runtime,
    }
}

fn seed_friend_log_current(runtime: &Arc<RealtimeHostRuntime>, owner: &str, target: &str) {
    write_realtime_batch(
        runtime.deps.db.as_ref(),
        owner,
        &RealtimePersistenceBatch {
            friend_log_upserts: vec![FriendLogUpsert {
                target_user_id: target.into(),
                display_name: "Friend".into(),
                trust_level: "Visitor".into(),
                friend_number: 1,
                created_at: "2026-05-15T00:00:00Z".into(),
                force_history: false,
            }],
            ..RealtimePersistenceBatch::default()
        },
    )
    .expect("seed friend_log_current");
}

fn history_rows(
    runtime: &Arc<RealtimeHostRuntime>,
    owner: &str,
    target: &str,
    r#type: &str,
) -> usize {
    friend_log_history_query(
        runtime.deps.db.as_ref(),
        FriendLogHistoryQueryInput {
            user_id: owner.to_string(),
            target_user_id: target.to_string(),
            types: vec![r#type.to_string()],
        },
    )
    .expect("history query")
    .len()
}

fn friend_delete_payload(user_id: &str) -> RealtimeWsMessagePayload {
    RealtimeWsMessagePayload {
        json: json!({
            "type": "friend-delete",
            "content": { "userId": user_id }
        }),
        raw: "{}".into(),
        received_at: "2026-05-15T00:00:01Z".into(),
    }
}

fn friend_add_payload(user_id: &str, display_name: &str) -> RealtimeWsMessagePayload {
    RealtimeWsMessagePayload {
        json: json!({
            "type": "friend-add",
            "content": {
                "userId": user_id,
                "user": { "id": user_id, "displayName": display_name }
            }
        }),
        raw: "{}".into(),
        received_at: "2026-05-15T00:00:01Z".into(),
    }
}

fn prepare_pending_baseline(
    runtime: &Arc<RealtimeHostRuntime>,
    session: &RealtimeSessionContext,
    friends_by_id: HashMap<String, FriendRecord>,
) -> Result<()> {
    {
        let mut state = runtime.state.lock().unwrap();
        state.active_context = None;
    }
    runtime.friends.clear();
    runtime.sync_friend_snapshot(
        session.user_id.clone(),
        session.endpoint.clone(),
        session.websocket.clone(),
        None,
        friends_by_id,
    )?;
    Ok(())
}

#[test]
fn pending_unfriend_updates_start_baseline_and_emits_projection() -> Result<()> {
    let (_dir, runtime, session) = runtime_with_active_session("mutation-sink-pending-unfriend")?;
    let friend = FriendRecord {
        id: "usr_friend".to_string(),
        display_name: "Friend".to_string(),
        state: "online".to_string(),
        state_bucket: "online".to_string(),
        ..FriendRecord::default()
    };
    let stale_friends: HashMap<String, FriendRecord> =
        [("usr_friend".to_string(), friend)].into_iter().collect();
    prepare_pending_baseline(&runtime, &session, stale_friends.clone())?;
    seed_friend_log_current(&runtime, &session.user_id, "usr_friend");

    let outcome = apply_unfriend_locally(
        &deps(&runtime),
        &session.user_id,
        &session.endpoint,
        "usr_friend",
        "Friend",
    );
    assert_eq!(outcome.status, SocialFriendMutationStatus::Applied);

    runtime.deps.event_bus.take_events_for_test();
    runtime.deps.tasks.set_executor(DiscardTaskExecutor);
    let started = runtime.start(
        session.user_id.clone(),
        session.endpoint.clone(),
        session.websocket.clone(),
        41,
        json!({ "id": session.user_id }),
        stale_friends,
    )?;

    assert!(!runtime
        .friend_snapshot()
        .expect("started friend snapshot")
        .friends_by_id
        .contains_key("usr_friend"));
    let events = runtime.deps.event_bus.take_events_for_test();
    let projection = events
        .iter()
        .find(|event| {
            event.name == "realtimeFriendProjection"
                && event.payload["removals"] == json!(["usr_friend"])
        })
        .expect("pending unfriend projection");
    assert_eq!(projection.payload["generation"], started.generation);
    assert_eq!(projection.payload["friendLogChanged"], true);
    Ok(())
}

#[test]
fn pending_accept_preserves_trusted_profile_state_on_start() -> Result<()> {
    let (_dir, runtime, session) = runtime_with_active_session("mutation-sink-pending-accept")?;
    prepare_pending_baseline(&runtime, &session, HashMap::new())?;

    let outcome = apply_friend_request_accept_locally(
        &deps(&runtime),
        &session.user_id,
        &session.endpoint,
        "usr_target",
        "Target",
        json!({
            "id": "usr_target",
            "displayName": "Target",
            "state": "online",
            "location": "private"
        }),
    );
    assert_eq!(outcome.status, SocialFriendMutationStatus::Applied);

    runtime.deps.event_bus.take_events_for_test();
    runtime.deps.tasks.set_executor(DiscardTaskExecutor);
    let started = runtime.start(
        session.user_id.clone(),
        session.endpoint.clone(),
        session.websocket.clone(),
        42,
        json!({ "id": session.user_id }),
        HashMap::new(),
    )?;

    let snapshot = runtime.friend_snapshot().expect("started friend snapshot");
    let friend = snapshot
        .friends_by_id
        .get("usr_target")
        .expect("accepted pending friend");
    assert_eq!(friend.state_bucket, "online");
    let events = runtime.deps.event_bus.take_events_for_test();
    let projection = events
        .iter()
        .find(|event| {
            event.name == "realtimeFriendProjection"
                && event.payload["patches"][0]["userId"] == "usr_target"
        })
        .expect("pending accept projection");
    assert_eq!(projection.payload["generation"], started.generation);
    assert_eq!(projection.payload["patches"][0]["stateBucket"], "online");
    assert_eq!(projection.payload["friendLogChanged"], true);
    Ok(())
}

#[test]
fn unfriend_locally_applies_via_synthetic_event_when_baseline_present() -> Result<()> {
    let (_dir, runtime, active_session) =
        runtime_with_active_session("mutation-sink-unfriend-baseline")?;
    let friend = FriendRecord {
        id: "usr_friend".to_string(),
        display_name: "Friend".to_string(),
        state: "online".to_string(),
        state_bucket: "online".to_string(),
        ..FriendRecord::default()
    };
    runtime.sync_friend_snapshot(
        active_session.user_id.clone(),
        active_session.endpoint.clone(),
        active_session.websocket.clone(),
        Some(7),
        [("usr_friend".to_string(), friend)].into_iter().collect(),
    )?;
    seed_friend_log_current(&runtime, &active_session.user_id, "usr_friend");

    let outcome = apply_unfriend_locally(
        &deps(&runtime),
        &active_session.user_id,
        &active_session.endpoint,
        "usr_friend",
        "Friend",
    );

    assert_eq!(outcome.status, SocialFriendMutationStatus::Applied);
    assert!(
        friend_log_current_list(runtime.deps.db.as_ref(), active_session.user_id.clone())?
            .is_empty()
    );
    assert_eq!(
        history_rows(&runtime, &active_session.user_id, "usr_friend", "Unfriend"),
        1
    );
    assert!(!runtime
        .friends
        .snapshot()
        .expect("baseline snapshot")
        .friends_by_id
        .contains_key("usr_friend"));
    Ok(())
}

#[test]
fn unfriend_locally_with_stale_owner_falls_back_without_touching_active_roster() -> Result<()> {
    let (_dir, runtime, active_session) =
        runtime_with_active_session("mutation-sink-unfriend-stale-owner")?;
    let friend = FriendRecord {
        id: "usr_friend".to_string(),
        display_name: "Friend".to_string(),
        state: "online".to_string(),
        state_bucket: "online".to_string(),
        ..FriendRecord::default()
    };
    runtime.sync_friend_snapshot(
        active_session.user_id.clone(),
        active_session.endpoint.clone(),
        active_session.websocket.clone(),
        Some(7),
        [("usr_friend".to_string(), friend)].into_iter().collect(),
    )?;
    seed_friend_log_current(&runtime, &active_session.user_id, "usr_friend");
    seed_friend_log_current(&runtime, "usr_previous", "usr_friend");

    let outcome = apply_unfriend_locally(
        &deps(&runtime),
        "usr_previous",
        &active_session.endpoint,
        "usr_friend",
        "Friend",
    );

    assert_eq!(outcome.status, SocialFriendMutationStatus::Applied);
    assert!(runtime
        .friends
        .snapshot()
        .expect("active baseline")
        .friends_by_id
        .contains_key("usr_friend"));
    assert!(
        friend_log_current_list(runtime.deps.db.as_ref(), active_session.user_id.clone())?
            .iter()
            .any(|row| row.user_id == "usr_friend")
    );
    assert!(friend_log_current_list(runtime.deps.db.as_ref(), "usr_previous".into())?.is_empty());
    assert_eq!(
        history_rows(&runtime, "usr_previous", "usr_friend", "Unfriend"),
        1
    );
    assert_eq!(
        history_rows(&runtime, &active_session.user_id, "usr_friend", "Unfriend"),
        0
    );
    Ok(())
}

#[test]
fn synthetic_event_with_stale_endpoint_reports_missing_baseline() -> Result<()> {
    let (_dir, runtime, active_session) =
        runtime_with_active_session("mutation-sink-unfriend-stale-endpoint")?;
    let friend = FriendRecord {
        id: "usr_friend".to_string(),
        display_name: "Friend".to_string(),
        state: "online".to_string(),
        state_bucket: "online".to_string(),
        ..FriendRecord::default()
    };
    runtime.sync_friend_snapshot(
        active_session.user_id.clone(),
        active_session.endpoint.clone(),
        active_session.websocket.clone(),
        Some(7),
        [("usr_friend".to_string(), friend)].into_iter().collect(),
    )?;

    let outcome = runtime.apply_synthetic_friend_event(
        &active_session.user_id,
        "https://api.example.test/api/1",
        "friend-delete",
        json!({ "userId": "usr_friend" }),
        "2026-05-15T00:00:01Z".into(),
    );

    assert_eq!(outcome, SyntheticFriendEventOutcome::MissingBaseline);
    assert!(runtime
        .friends
        .snapshot()
        .expect("active baseline")
        .friends_by_id
        .contains_key("usr_friend"));
    Ok(())
}

#[test]
fn accept_locally_applies_via_synthetic_event_when_baseline_present() -> Result<()> {
    let (_dir, runtime, active_session) =
        runtime_with_active_session("mutation-sink-accept-baseline")?;
    runtime.sync_friend_snapshot(
        active_session.user_id.clone(),
        active_session.endpoint.clone(),
        active_session.websocket.clone(),
        Some(7),
        HashMap::new(),
    )?;

    let outcome = apply_friend_request_accept_locally(
        &deps(&runtime),
        &active_session.user_id,
        &active_session.endpoint,
        "usr_target",
        "Target",
        json!({
            "id": "usr_target",
            "displayName": "Target",
            "state": "online",
            "location": "private"
        }),
    );

    assert_eq!(outcome.status, SocialFriendMutationStatus::Applied);
    let current =
        friend_log_current_list(runtime.deps.db.as_ref(), active_session.user_id.clone())?;
    assert!(current.iter().any(|row| row.user_id == "usr_target"));
    assert_eq!(
        history_rows(&runtime, &active_session.user_id, "usr_target", "Friend"),
        1
    );
    let snapshot = runtime.friends.snapshot().expect("baseline snapshot");
    let friend = snapshot
        .friends_by_id
        .get("usr_target")
        .expect("accepted friend");
    assert_eq!(friend.state, "online");
    assert_eq!(friend.state_bucket, "online");
    Ok(())
}

#[test]
fn unfriend_then_later_ws_friend_delete_records_exactly_one_unfriend_history() -> Result<()> {
    let (_dir, runtime, active_session) =
        runtime_with_active_session("mutation-sink-unfriend-race-local-first")?;
    let friend = FriendRecord {
        id: "usr_friend".to_string(),
        display_name: "Friend".to_string(),
        state: "online".to_string(),
        state_bucket: "online".to_string(),
        ..FriendRecord::default()
    };
    runtime.sync_friend_snapshot(
        active_session.user_id.clone(),
        active_session.endpoint.clone(),
        active_session.websocket.clone(),
        Some(7),
        [("usr_friend".to_string(), friend)].into_iter().collect(),
    )?;
    seed_friend_log_current(&runtime, &active_session.user_id, "usr_friend");

    let outcome = apply_unfriend_locally(
        &deps(&runtime),
        &active_session.user_id,
        &active_session.endpoint,
        "usr_friend",
        "Friend",
    );
    assert_eq!(outcome.status, SocialFriendMutationStatus::Applied);

    let active = runtime
        .state
        .lock()
        .unwrap()
        .active_context
        .clone()
        .unwrap();
    runtime.handle_friend_ws_message(
        active.generation,
        active.session_generation,
        &active.session,
        &friend_delete_payload("usr_friend"),
    );

    assert_eq!(
        history_rows(&runtime, &active_session.user_id, "usr_friend", "Unfriend"),
        1
    );
    Ok(())
}

#[test]
fn ws_friend_delete_then_later_unfriend_records_exactly_one_unfriend_history() -> Result<()> {
    let (_dir, runtime, active_session) =
        runtime_with_active_session("mutation-sink-unfriend-race-ws-first")?;
    let friend = FriendRecord {
        id: "usr_friend".to_string(),
        display_name: "Friend".to_string(),
        state: "online".to_string(),
        state_bucket: "online".to_string(),
        ..FriendRecord::default()
    };
    runtime.sync_friend_snapshot(
        active_session.user_id.clone(),
        active_session.endpoint.clone(),
        active_session.websocket.clone(),
        Some(7),
        [("usr_friend".to_string(), friend)].into_iter().collect(),
    )?;
    seed_friend_log_current(&runtime, &active_session.user_id, "usr_friend");

    let active = runtime
        .state
        .lock()
        .unwrap()
        .active_context
        .clone()
        .unwrap();
    runtime.handle_friend_ws_message(
        active.generation,
        active.session_generation,
        &active.session,
        &friend_delete_payload("usr_friend"),
    );

    let outcome = apply_unfriend_locally(
        &deps(&runtime),
        &active_session.user_id,
        &active_session.endpoint,
        "usr_friend",
        "Friend",
    );
    assert_eq!(outcome.status, SocialFriendMutationStatus::Applied);

    assert_eq!(
        history_rows(&runtime, &active_session.user_id, "usr_friend", "Unfriend"),
        1
    );
    Ok(())
}

#[test]
fn accept_then_later_ws_friend_add_records_exactly_one_friend_history() -> Result<()> {
    let (_dir, runtime, active_session) =
        runtime_with_active_session("mutation-sink-accept-race-local-first")?;
    runtime.sync_friend_snapshot(
        active_session.user_id.clone(),
        active_session.endpoint.clone(),
        active_session.websocket.clone(),
        Some(7),
        HashMap::new(),
    )?;

    let outcome = apply_friend_request_accept_locally(
        &deps(&runtime),
        &active_session.user_id,
        &active_session.endpoint,
        "usr_target",
        "Target",
        json!({ "id": "usr_target", "displayName": "Target" }),
    );
    assert_eq!(outcome.status, SocialFriendMutationStatus::Applied);

    let active = runtime
        .state
        .lock()
        .unwrap()
        .active_context
        .clone()
        .unwrap();
    runtime.handle_friend_ws_message(
        active.generation,
        active.session_generation,
        &active.session,
        &friend_add_payload("usr_target", "Target"),
    );

    assert_eq!(
        history_rows(&runtime, &active_session.user_id, "usr_target", "Friend"),
        1
    );
    Ok(())
}

#[test]
fn ws_friend_add_then_later_accept_records_exactly_one_friend_history() -> Result<()> {
    let (_dir, runtime, active_session) =
        runtime_with_active_session("mutation-sink-accept-race-ws-first")?;
    runtime.sync_friend_snapshot(
        active_session.user_id.clone(),
        active_session.endpoint.clone(),
        active_session.websocket.clone(),
        Some(7),
        HashMap::new(),
    )?;

    let active = runtime
        .state
        .lock()
        .unwrap()
        .active_context
        .clone()
        .unwrap();
    runtime.handle_friend_ws_message(
        active.generation,
        active.session_generation,
        &active.session,
        &friend_add_payload("usr_target", "Target"),
    );

    let outcome = apply_friend_request_accept_locally(
        &deps(&runtime),
        &active_session.user_id,
        &active_session.endpoint,
        "usr_target",
        "Target",
        json!({ "id": "usr_target", "displayName": "Target" }),
    );
    assert_eq!(outcome.status, SocialFriendMutationStatus::Applied);

    assert_eq!(
        history_rows(&runtime, &active_session.user_id, "usr_target", "Friend"),
        1
    );
    Ok(())
}
