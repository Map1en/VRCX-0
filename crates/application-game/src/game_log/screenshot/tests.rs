use vrcx_0_contracts::game_log::{GameLogJoinLeaveEntry, GameLogLocationEntry, GameLogWriteBatch};

use crate::game_log::runtime_state::{PlayerState, RuntimeSnapshot};
use crate::ports::TestGameStateStore;
use crate::GameLogWriter;

use super::*;

fn test_store(_name: &str) -> TestGameStateStore {
    TestGameStateStore::default()
}

const LOCATION: &str = "wrld_live:123";
const LOCATION_AT: &str = "2026-04-30T10:00:00.000Z";
const SHOT_AT: &str = "2026-04-30T10:15:00.000Z";

fn join_leave_entry(
    created_at: &str,
    event_type: &str,
    display_name: &str,
    user_id: &str,
) -> GameLogJoinLeaveEntry {
    GameLogJoinLeaveEntry {
        created_at: created_at.to_string(),
        event_type: event_type.to_string(),
        display_name: display_name.to_string(),
        location: LOCATION.to_string(),
        user_id: user_id.to_string(),
        world_name: "Live World".to_string(),
        time: 0,
    }
}

fn write_visited_location(store: &TestGameStateStore, join_leave: Vec<GameLogJoinLeaveEntry>) {
    let batch = GameLogWriteBatch {
        locations: vec![GameLogLocationEntry {
            created_at: LOCATION_AT.to_string(),
            location: LOCATION.to_string(),
            world_id: "wrld_live".to_string(),
            world_name: "Live World".to_string(),
            time: 0,
            group_name: String::new(),
        }],
        join_leave,
        ..Default::default()
    };
    store.write_game_log(&OwnerId::new(""), &batch).unwrap();
}

fn context_at(store: &TestGameStateStore, created_at: &str) -> Option<ScreenshotContext> {
    let input = ScreenshotInput {
        created_at: created_at.to_string(),
        path: "screenshot.png".to_string(),
        snapshot: RuntimeSnapshot::default(),
    };
    screenshot_context(store, &OwnerId::new(""), &input).unwrap()
}

#[test]
fn snapshot_location_short_circuits_the_database_lookup() {
    let store = test_store("screenshot-snapshot-shortcircuit");
    let input = ScreenshotInput {
        created_at: SHOT_AT.to_string(),
        path: "screenshot.png".to_string(),
        snapshot: RuntimeSnapshot {
            ready: true,
            has_player_events: true,
            location: LOCATION.to_string(),
            world_name: "Live World".to_string(),
            destination: String::new(),
            started_at: String::new(),
            players: vec![PlayerState {
                user_id: "usr_a".to_string(),
                display_name: "Alice".to_string(),
                join_time_ms: None,
            }],
        },
    };

    let context = screenshot_context(&store, &OwnerId::new(""), &input)
        .unwrap()
        .unwrap();
    assert_eq!(context.location, LOCATION);
    assert_eq!(context.world_name, "Live World");
    assert_eq!(context.players.len(), 1);
    assert_eq!(context.players[0].user_id, "usr_a");
}

#[test]
fn no_location_history_returns_none() {
    let store = test_store("screenshot-no-history");

    assert!(context_at(&store, SHOT_AT).is_none());
}

#[test]
fn location_exactly_at_max_age_boundary_is_still_used() {
    let store = test_store("screenshot-boundary-included");
    write_visited_location(&store, vec![]);

    let context = context_at(&store, SHOT_AT).unwrap();

    assert_eq!(context.location, LOCATION);
    assert!(context.players.is_empty());
}

#[test]
fn location_one_ms_past_max_age_boundary_is_rejected() {
    let store = test_store("screenshot-boundary-excluded");
    write_visited_location(&store, vec![]);

    assert!(context_at(&store, "2026-04-30T10:15:00.001Z").is_none());
}

#[test]
fn join_events_dedupe_by_user_id_key() {
    let store = test_store("screenshot-join-dedupe-id");
    write_visited_location(
        &store,
        vec![
            join_leave_entry(
                "2026-04-30T10:01:00.000Z",
                "OnPlayerJoined",
                "Alice",
                "usr_a",
            ),
            join_leave_entry(
                "2026-04-30T10:02:00.000Z",
                "OnPlayerJoined",
                "Alice",
                "usr_a",
            ),
        ],
    );

    let context = context_at(&store, SHOT_AT).unwrap();

    assert_eq!(context.players.len(), 1);
    assert_eq!(context.players[0].user_id, "usr_a");
}

#[test]
fn join_events_dedupe_by_display_name_when_user_id_missing() {
    let store = test_store("screenshot-join-dedupe-name");
    write_visited_location(
        &store,
        vec![
            join_leave_entry("2026-04-30T10:01:00.000Z", "OnPlayerJoined", "NoId", ""),
            join_leave_entry("2026-04-30T10:02:00.000Z", "OnPlayerJoined", "NoId", ""),
        ],
    );

    let context = context_at(&store, SHOT_AT).unwrap();

    assert_eq!(context.players.len(), 1);
    assert_eq!(context.players[0].display_name, "NoId");
}

#[test]
fn distinct_user_ids_with_the_same_display_name_are_not_merged() {
    let store = test_store("screenshot-join-distinct-ids");
    write_visited_location(
        &store,
        vec![
            join_leave_entry(
                "2026-04-30T10:01:00.000Z",
                "OnPlayerJoined",
                "Twin",
                "usr_a",
            ),
            join_leave_entry(
                "2026-04-30T10:02:00.000Z",
                "OnPlayerJoined",
                "Twin",
                "usr_b",
            ),
        ],
    );

    let context = context_at(&store, SHOT_AT).unwrap();

    assert_eq!(context.players.len(), 2);
}

#[test]
fn leave_removes_player_by_user_id_key() {
    let store = test_store("screenshot-leave-by-id");
    write_visited_location(
        &store,
        vec![
            join_leave_entry(
                "2026-04-30T10:01:00.000Z",
                "OnPlayerJoined",
                "Alice",
                "usr_a",
            ),
            join_leave_entry("2026-04-30T10:02:00.000Z", "OnPlayerLeft", "Alice", "usr_a"),
        ],
    );

    let context = context_at(&store, SHOT_AT).unwrap();

    assert!(context.players.is_empty());
}

#[test]
fn leave_removes_anonymous_player_by_display_name_key() {
    let store = test_store("screenshot-leave-by-name");
    write_visited_location(
        &store,
        vec![
            join_leave_entry("2026-04-30T10:01:00.000Z", "OnPlayerJoined", "Bob", ""),
            join_leave_entry("2026-04-30T10:02:00.000Z", "OnPlayerLeft", "Bob", ""),
        ],
    );

    let context = context_at(&store, SHOT_AT).unwrap();

    assert!(context.players.is_empty());
}

#[test]
fn captured_author_does_not_follow_a_later_account_switch() {
    let scope = crate::RuntimeAuthScope::new();
    scope.set_identity("usr_first", "First User", "");
    let author = scope.identity();
    scope.set_identity("usr_second", "Second User", "");

    let metadata = build_metadata(&author, &ScreenshotContext::default(), "wrld_example");

    assert_eq!(metadata["author"]["id"], "usr_first");
    assert_eq!(metadata["author"]["displayName"], "First User");
}
