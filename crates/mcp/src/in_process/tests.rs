use std::collections::HashMap;
use std::time::Duration;

use serde_json::{json, Map};
use vrcx_0_application_core::{
    RuntimeTask, RuntimeTaskExecutor, RuntimeTaskHandle, TaskSupervisor,
};
use vrcx_0_core::friends::FriendRecord;
use vrcx_0_persistence::realtime::{
    write_realtime_batch, FriendLogUpsert, RealtimePersistenceBatch,
};

use super::*;
use crate::test_support::test_runtime;
use vrcx_0_application_core::FeedLiveEntry;
use vrcx_0_core::OwnerId;

fn bio_feed_entry(
    created_at: &str,
    user_id: &str,
    display_name: &str,
    bio: &str,
    previous_bio: &str,
) -> FeedLiveEntry {
    FeedLiveEntry::Bio {
        created_at: created_at.into(),
        user_id: user_id.into(),
        display_name: display_name.into(),
        bio: bio.into(),
        previous_bio: previous_bio.into(),
        owner_user_id: String::new(),
    }
}

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

fn friend(id: &str, display_name: &str, state_bucket: &str, location: &str) -> FriendRecord {
    FriendRecord {
        id: id.into(),
        display_name: display_name.into(),
        state: state_bucket.into(),
        location: location.into(),
        status: "active".into(),
        ..FriendRecord::default()
    }
}

fn seed_live_friends(runtime: &mut McpRuntime, friends: HashMap<String, FriendRecord>) {
    runtime.tasks.set_executor(DiscardTaskExecutor);
    runtime
        .realtime_runtime
        .start(
            "usr_owner".into(),
            "https://api.vrchat.cloud/api/1".into(),
            "wss://pipeline.vrchat.cloud".into(),
            1,
            json!({ "id": "usr_owner" }),
            friends,
        )
        .unwrap();
    runtime.tasks = TaskSupervisor::new();
}

#[tokio::test]
async fn in_process_bridge_lists_the_real_server_tools() {
    let (_dir, runtime) = test_runtime("in-process-list", "usr_owner").unwrap();
    let tools = spawn_in_process_tools(runtime).await.unwrap();

    let descriptors = tools.list_tools().await.unwrap();
    let favorites = descriptors
        .iter()
        .find(|tool| tool.name == "get_favorites")
        .expect("get_favorites should cross the in-process bridge");

    assert!(!favorites.description.is_empty());
    assert_eq!(favorites.parameters["type"], "object");
}

#[tokio::test]
async fn in_process_bridge_returns_structured_read_only_results() {
    let (_dir, runtime) = test_runtime("in-process-call", "usr_owner").unwrap();
    let tools = spawn_in_process_tools(runtime).await.unwrap();

    let outcome = tools
        .call_tool("get_favorites", Some(Map::new()))
        .await
        .unwrap();

    assert!(!outcome.is_error);
    let structured = outcome.structured.expect("structured tool result");
    assert_eq!(structured["rows"], json!([]));
    assert!(structured["summary"]
        .as_str()
        .is_some_and(|value| !value.is_empty()));
}

#[tokio::test]
async fn friend_feed_search_resolves_target_pages_results_and_guards_global_history() {
    let (_dir, runtime, db) =
        crate::test_support::test_runtime_with_database("in-process-friend-feed", "usr_owner")
            .unwrap();
    write_realtime_batch(
        db.as_ref(),
        &OwnerId::new("usr_owner"),
        &RealtimePersistenceBatch {
            friend_log_upserts: vec![FriendLogUpsert {
                target_user_id: "usr_alice".into(),
                display_name: "Alice".into(),
                trust_level: "trusted".into(),
                friend_number: 1,
                created_at: "2026-08-01T00:00:00.000Z".into(),
                force_history: false,
            }],
            feed_entries: vec![
                bio_feed_entry(
                    "2026-08-12T10:00:00.000Z",
                    "usr_alice",
                    "Alice",
                    "new needle text",
                    "older text",
                ),
                bio_feed_entry(
                    "2026-08-11T10:00:00.000Z",
                    "usr_alice",
                    "Alice",
                    "older needle text",
                    "oldest text",
                ),
                bio_feed_entry(
                    "2026-08-12T11:00:00.000Z",
                    "usr_bob",
                    "Bob",
                    "other needle text",
                    "",
                ),
            ],
            ..RealtimePersistenceBatch::default()
        },
    )
    .unwrap();
    let tools = spawn_in_process_tools(runtime).await.unwrap();

    let first = tools
        .call_tool(
            "search_friend_feed",
            Some(Map::from_iter([
                ("query".into(), json!("needle")),
                ("target".into(), json!("Alice")),
                ("eventTypes".into(), json!(["bio"])),
                ("limit".into(), json!(1)),
            ])),
        )
        .await
        .unwrap();
    assert!(!first.is_error, "{}", first.text);
    let first = first.structured.expect("structured friend Feed result");
    assert_eq!(first["resolvedUser"]["userId"], "usr_alice");
    assert_eq!(first["rows"].as_array().unwrap().len(), 1);
    assert_eq!(first["rows"][0]["bio"], "new needle text");
    assert_eq!(first["truncated"], true);
    let cursor = first["nextCursor"].as_str().unwrap().to_string();

    let second = tools
        .call_tool(
            "search_friend_feed",
            Some(Map::from_iter([
                ("query".into(), json!("needle")),
                ("target".into(), json!("usr_alice")),
                ("eventTypes".into(), json!(["bio"])),
                ("limit".into(), json!(1)),
                ("cursor".into(), json!(cursor)),
            ])),
        )
        .await
        .unwrap();
    assert!(!second.is_error, "{}", second.text);
    let second = second.structured.expect("structured second page");
    assert_eq!(second["rows"][0]["bio"], "older needle text");
    assert_eq!(second["truncated"], false);

    let target_history = tools
        .call_tool(
            "search_friend_feed",
            Some(Map::from_iter([
                ("target".into(), json!("usr_alice")),
                ("eventTypes".into(), json!(["bio"])),
                (
                    "timeWindow".into(),
                    json!({ "from": "2026-08-12T00:00:00Z" }),
                ),
            ])),
        )
        .await
        .unwrap();
    assert!(!target_history.is_error, "{}", target_history.text);
    let target_history = target_history
        .structured
        .expect("structured target history");
    assert_eq!(target_history["rows"].as_array().unwrap().len(), 1);
    assert_eq!(target_history["rows"][0]["bio"], "new needle text");

    let bounded_global_history = tools
        .call_tool(
            "search_friend_feed",
            Some(Map::from_iter([
                ("allHistory".into(), json!(true)),
                ("eventTypes".into(), json!(["bio"])),
                ("limit".into(), json!(10)),
                ("timeWindow".into(), json!("24h")),
            ])),
        )
        .await
        .unwrap();
    assert!(
        !bounded_global_history.is_error,
        "{}",
        bounded_global_history.text
    );

    let string_window = tools
        .call_tool(
            "search_friend_feed",
            Some(Map::from_iter([
                ("target".into(), json!("usr_alice")),
                ("eventTypes".into(), json!(["bio"])),
                ("timeWindow".into(), json!("all history")),
            ])),
        )
        .await
        .unwrap();
    assert!(!string_window.is_error, "{}", string_window.text);
    assert_eq!(
        string_window.structured.unwrap()["rows"]
            .as_array()
            .unwrap()
            .len(),
        2
    );

    for invalid_time_window in [json!("whenever-ish"), json!({ "from": 7 })] {
        let invalid = tools
            .call_tool(
                "search_friend_feed",
                Some(Map::from_iter([
                    ("target".into(), json!("usr_alice")),
                    ("timeWindow".into(), invalid_time_window),
                ])),
            )
            .await
            .unwrap();
        assert!(invalid.is_error);
        assert!(invalid.text.contains("timeWindow"));
    }

    let unbounded = tools
        .call_tool(
            "search_friend_feed",
            Some(Map::from_iter([("query".into(), json!("needle"))])),
        )
        .await
        .unwrap();
    assert!(unbounded.is_error);
    assert!(unbounded.text.contains("allHistory=true"));
}

#[tokio::test]
async fn in_process_bridge_preserves_tool_errors_and_dispatch_failures() {
    let (_dir, runtime) = test_runtime("in-process-errors", "usr_owner").unwrap();
    let tools = spawn_in_process_tools(runtime).await.unwrap();

    let invalid = tools
        .call_tool(
            "get_favorites",
            Some(Map::from_iter([("kind".into(), json!(42))])),
        )
        .await
        .unwrap();
    assert!(invalid.is_error);
    assert!(!invalid.text.is_empty());

    let unknown = tools.call_tool("missing_tool", Some(Map::new())).await;
    assert!(unknown
        .unwrap_err()
        .to_string()
        .contains("call_tool failed"));
}

#[tokio::test]
async fn in_process_bridge_tolerates_reported_assistant_argument_shapes() {
    let (_dir, runtime) = test_runtime("in-process-assistant-args", "usr_owner").unwrap();
    let tools = spawn_in_process_tools(runtime).await.unwrap();

    let copresence = tools
        .call_tool(
            "get_copresence_summary",
            Some(Map::from_iter([
                ("friendsOnly".into(), json!("true")),
                ("limit".into(), json!(10)),
            ])),
        )
        .await
        .unwrap();
    assert!(!copresence.is_error, "{}", copresence.text);

    let activity = tools
        .call_tool(
            "get_friend_activity_pattern",
            Some(Map::from_iter([
                ("bucket".into(), json!("weekday")),
                ("user".into(), json!("Alice")),
                ("utcOffsetMinutes".into(), json!(540)),
            ])),
        )
        .await
        .unwrap();
    assert!(!activity.is_error, "{}", activity.text);

    let companions = tools
        .call_tool(
            "get_companions_of",
            Some(Map::from_iter([("limit".into(), json!(10))])),
        )
        .await
        .unwrap();
    assert!(!companions.is_error, "{}", companions.text);
    let structured = companions.structured.expect("structured tool result");
    assert_eq!(structured["needsDisambiguation"], true);
    assert_eq!(
        structured["summary"],
        "Which person's regular companions should I analyze?"
    );
}

#[tokio::test]
async fn online_friends_tool_filters_sorts_and_projects_live_presence() {
    let (_dir, mut runtime) = test_runtime("in-process-online-friends", "usr_owner").unwrap();
    let mut friends = HashMap::new();
    let mut alpha = friend(
        "usr_alpha",
        "Alpha",
        "active",
        "wrld_alpha:123~group(grp_alpha)",
    );
    alpha.last_platform = "android".into();
    alpha
        .extra
        .insert("world_name".into(), json!("Alpha World"));
    let mut zulu = friend("usr_zulu", "Zulu", "online", "wrld_zulu:456");
    zulu.platform = "standalonewindows".into();
    zulu.extra.insert("worldName".into(), json!("Zulu World"));
    friends.insert(alpha.id.clone(), alpha);
    friends.insert(zulu.id.clone(), zulu);
    friends.insert(
        "usr_offline".into(),
        friend("usr_offline", "Offline", "offline", "offline"),
    );
    seed_live_friends(&mut runtime, friends);
    let tools = spawn_in_process_tools(runtime).await.unwrap();

    let outcome = tools
        .call_tool("get_online_friends", Some(Map::new()))
        .await
        .unwrap();
    let structured = outcome.structured.expect("structured tool result");

    assert_eq!(structured["summary"], "2 friends online now: Alpha, Zulu.");
    assert_eq!(structured["rows"][0]["userId"], "usr_alpha");
    assert_eq!(structured["rows"][0]["worldId"], "wrld_alpha");
    assert_eq!(structured["rows"][0]["worldName"], "Alpha World");
    assert_eq!(structured["rows"][0]["instanceAccessType"], "group");
    assert_eq!(structured["rows"][0]["platform"], "android");
    assert_eq!(structured["rows"][1]["userId"], "usr_zulu");
    assert_eq!(structured["rows"][1]["platform"], "standalonewindows");
}

#[tokio::test]
async fn online_friends_tool_honors_custom_states_and_location_redaction() {
    let (_dir, mut runtime) = test_runtime("in-process-offline-friends", "usr_owner").unwrap();
    let offline = friend("usr_offline", "Offline", "offline", "offline");
    seed_live_friends(
        &mut runtime,
        [(offline.id.clone(), offline)].into_iter().collect(),
    );
    let tools = spawn_in_process_tools(runtime).await.unwrap();

    let outcome = tools
        .call_tool(
            "get_online_friends",
            Some(Map::from_iter([
                ("states".into(), json!([" OFFLINE ", ""])),
                ("includeLocation".into(), json!(false)),
            ])),
        )
        .await
        .unwrap();
    let structured = outcome.structured.expect("structured tool result");

    assert_eq!(structured["rows"].as_array().unwrap().len(), 1);
    assert_eq!(structured["rows"][0]["userId"], "usr_offline");
    assert!(structured["rows"][0]["location"].is_null());
    assert!(structured["rows"][0]["worldId"].is_null());
    assert!(structured["rows"][0]["worldName"].is_null());
    assert!(structured["rows"][0]["instanceAccessType"].is_null());
}
