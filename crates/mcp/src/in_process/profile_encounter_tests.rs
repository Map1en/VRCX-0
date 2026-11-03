use serde_json::{json, Map};
use vrcx_0_core::OwnerId;
use vrcx_0_persistence::game_log::{
    write_batch, GameLogJoinLeaveEntry, GameLogLocationEntry, GameLogWriteBatch,
};

use super::*;
use crate::test_support::test_runtime_with_database;

fn visit(created_at: &str, location: &str, world_name: &str) -> GameLogLocationEntry {
    GameLogLocationEntry {
        created_at: created_at.into(),
        location: location.into(),
        world_id: location.split(':').next().unwrap_or_default().into(),
        world_name: world_name.into(),
        time: 3_600_000,
        group_name: String::new(),
    }
}

fn joined(created_at: &str, name: &str, user_id: &str, location: &str) -> GameLogJoinLeaveEntry {
    event(created_at, "OnPlayerJoined", name, user_id, location, 0)
}

fn left(
    created_at: &str,
    name: &str,
    user_id: &str,
    location: &str,
    minutes: i64,
) -> GameLogJoinLeaveEntry {
    event(
        created_at,
        "OnPlayerLeft",
        name,
        user_id,
        location,
        minutes * 60_000,
    )
}

fn event(
    created_at: &str,
    event_type: &str,
    name: &str,
    user_id: &str,
    location: &str,
    time: i64,
) -> GameLogJoinLeaveEntry {
    GameLogJoinLeaveEntry {
        created_at: created_at.into(),
        event_type: event_type.into(),
        display_name: name.into(),
        location: location.into(),
        user_id: user_id.into(),
        world_name: String::new(),
        time,
    }
}

#[tokio::test]
async fn friend_profile_tells_when_you_met_a_non_friend_and_where() {
    let (_dir, runtime, db) =
        test_runtime_with_database("in-process-profile-encounter", "usr_owner").unwrap();
    write_batch(
        db.as_ref(),
        &OwnerId::new("usr_owner"),
        &GameLogWriteBatch {
            locations: vec![
                visit("2026-05-01T20:00:00.000Z", "wrld_pier:1", "Night Pier"),
                visit("2026-06-01T20:00:00.000Z", "wrld_loft:1", "Cozy Loft"),
            ],
            join_leave: vec![
                joined(
                    "2026-05-01T20:00:00.000Z",
                    "Owner",
                    "usr_owner",
                    "wrld_pier:1",
                ),
                joined(
                    "2026-05-01T20:10:00.000Z",
                    "Stranger",
                    "usr_stranger",
                    "wrld_pier:1",
                ),
                joined(
                    "2026-06-01T20:00:00.000Z",
                    "Owner",
                    "usr_owner",
                    "wrld_loft:1",
                ),
                joined(
                    "2026-06-01T20:05:00.000Z",
                    "Stranger",
                    "usr_stranger",
                    "wrld_loft:1",
                ),
                joined(
                    "2026-06-01T20:06:00.000Z",
                    "Other",
                    "usr_other",
                    "wrld_loft:1",
                ),
                left(
                    "2026-05-01T20:40:00.000Z",
                    "Stranger",
                    "usr_stranger",
                    "wrld_pier:1",
                    30,
                ),
                left(
                    "2026-06-01T21:05:00.000Z",
                    "Stranger",
                    "usr_stranger",
                    "wrld_loft:1",
                    60,
                ),
            ],
            ..GameLogWriteBatch::default()
        },
    )
    .unwrap();
    let tools = spawn_in_process_tools(runtime).await.unwrap();

    let mut arguments = Map::new();
    arguments.insert("user".into(), json!("usr_stranger"));
    let outcome = tools
        .call_tool("get_friend_profile", Some(arguments))
        .await
        .unwrap();

    assert!(!outcome.is_error, "{}", outcome.text);
    let structured = outcome.structured.expect("structured tool result");
    let encounter = &structured["encounter"];
    assert_eq!(encounter["userId"], "usr_stranger");
    assert_eq!(encounter["isFriend"], false);
    assert_eq!(encounter["encounterCount"], 2);
    assert_eq!(encounter["firstSeen"], "2026-05-01T20:10:00.000Z");
    assert_eq!(encounter["lastSeen"], "2026-06-01T20:05:00.000Z");
    let worlds: Vec<_> = structured["sharedWorlds"]
        .as_array()
        .expect("shared worlds")
        .iter()
        .map(|row| row["worldName"].as_str().unwrap_or_default())
        .collect();
    assert_eq!(worlds, ["Cozy Loft", "Night Pier"]);
}
