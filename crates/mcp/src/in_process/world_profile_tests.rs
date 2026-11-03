use std::sync::Arc;

use serde_json::{json, Map};
use vrcx_0_core::OwnerId;
use vrcx_0_persistence::game_log::{
    write_batch, GameLogJoinLeaveEntry, GameLogLocationEntry, GameLogWriteBatch,
};

use super::*;
use crate::test_support::{test_runtime_with_database, TestMcpWorldLookup};

fn visit(created_at: &str, location: &str, world_name: &str, minutes: i64) -> GameLogLocationEntry {
    GameLogLocationEntry {
        created_at: created_at.into(),
        location: location.into(),
        world_id: location.split(':').next().unwrap_or_default().into(),
        world_name: world_name.into(),
        time: minutes * 60_000,
        group_name: String::new(),
    }
}

fn left(
    created_at: &str,
    name: &str,
    user_id: &str,
    location: &str,
    minutes: i64,
) -> GameLogJoinLeaveEntry {
    GameLogJoinLeaveEntry {
        created_at: created_at.into(),
        event_type: "OnPlayerLeft".into(),
        display_name: name.into(),
        location: location.into(),
        user_id: user_id.into(),
        world_name: String::new(),
        time: minutes * 60_000,
    }
}

fn seed(db: &vrcx_0_persistence::DatabaseService) {
    write_batch(
        db,
        &OwnerId::new("usr_owner"),
        &GameLogWriteBatch {
            locations: vec![
                visit("2026-05-01T20:00:00.000Z", "wrld_pier:1", "Night Pier", 60),
                visit("2026-06-01T20:00:00.000Z", "wrld_pier:2", "Night Pier", 30),
                visit("2026-06-02T20:00:00.000Z", "wrld_loft:1", "Cozy Loft", 45),
            ],
            join_leave: vec![
                left(
                    "2026-05-01T20:40:00.000Z",
                    "Alice",
                    "usr_alice",
                    "wrld_pier:1",
                    40,
                ),
                left(
                    "2026-06-01T20:20:00.000Z",
                    "Bob",
                    "usr_bob",
                    "wrld_pier:2",
                    20,
                ),
                left(
                    "2026-06-02T20:30:00.000Z",
                    "Carol",
                    "usr_carol",
                    "wrld_loft:1",
                    30,
                ),
            ],
            ..GameLogWriteBatch::default()
        },
    )
    .unwrap();
}

#[tokio::test]
async fn world_profile_joins_my_visits_people_and_live_stats() {
    let (_dir, mut runtime, db) =
        test_runtime_with_database("in-process-world-profile", "usr_owner").unwrap();
    seed(db.as_ref());
    runtime.world_lookup = Arc::new(TestMcpWorldLookup(Some(json!({
        "id": "wrld_pier",
        "name": "Night Pier",
        "authorName": "Builder",
        "favorites": 250,
        "visits": 10000,
        "popularity": 7,
        "heat": 4,
        "occupants": 12,
        "tags": ["author_tag_chill", "system_approved"]
    }))));
    let tools = spawn_in_process_tools(runtime).await.unwrap();

    let mut arguments = Map::new();
    arguments.insert("world".into(), json!("night pier"));
    let outcome = tools
        .call_tool("get_world_profile", Some(arguments))
        .await
        .unwrap();

    assert!(!outcome.is_error, "{}", outcome.text);
    let structured = outcome.structured.expect("structured tool result");
    assert_eq!(structured["worldId"], "wrld_pier");
    assert_eq!(structured["myVisits"]["visits"], 2);
    assert_eq!(structured["myVisits"]["totalMinutes"], 90);
    assert_eq!(
        structured["myVisits"]["firstVisitedAt"],
        "2026-05-01T20:00:00.000Z"
    );
    let people: Vec<_> = structured["peopleMetHere"]
        .as_array()
        .expect("people met here")
        .iter()
        .map(|row| row["displayName"].as_str().unwrap_or_default())
        .collect();
    assert_eq!(people, ["Alice", "Bob"]);
    assert_eq!(
        structured["myVisits"]["recentVisits"][0]["people"],
        json!(["Bob"])
    );
    assert_eq!(structured["world"]["favoriteRatePercent"], 2.5);
    assert_eq!(structured["world"]["playersNow"], 12);
    assert_eq!(structured["world"]["tags"], json!(["chill"]));
}

#[tokio::test]
async fn world_profile_still_answers_from_local_history_without_live_stats() {
    let (_dir, runtime, db) =
        test_runtime_with_database("in-process-world-profile-offline", "usr_owner").unwrap();
    seed(db.as_ref());
    let tools = spawn_in_process_tools(runtime).await.unwrap();

    let mut arguments = Map::new();
    arguments.insert("world".into(), json!("wrld_loft"));
    let outcome = tools
        .call_tool("get_world_profile", Some(arguments))
        .await
        .unwrap();

    assert!(!outcome.is_error, "{}", outcome.text);
    let structured = outcome.structured.expect("structured tool result");
    assert_eq!(structured["worldName"], "Cozy Loft");
    assert!(structured.get("world").is_none());
    assert_eq!(structured["myVisits"]["visits"], 1);
}
