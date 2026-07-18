use serde::Serialize;

use vrcx_0_persistence::game_log::get_join_leave_entries_for_location_range;
use vrcx_0_persistence::player_list::{
    player_list_latest_location_get, player_list_location_get, PlayerLocationOutput,
};
use vrcx_0_persistence::DatabaseService;

use super::roster::fold_roster;
use super::runtime_state::{parse_event_time_ms, world_id_from_location};
use crate::Result;

const ROSTER_RANGE_END: &str = "9999-12-31T23:59:59Z";

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PlayerListSnapshotContext {
    pub created_at: String,
    pub location: String,
    pub world_id: String,
    pub world_name: String,
    pub time: i64,
    pub group_name: String,
    pub source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub player_count: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub observed_player_event_count: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub player_facts_known: Option<bool>,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PlayerListSnapshotPlayer {
    pub id: String,
    pub user_id: String,
    pub display_name: String,
    pub joined_at: String,
    pub joined_at_ms: i64,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PlayerListSnapshotOutput {
    pub context: PlayerListSnapshotContext,
    pub players: Vec<PlayerListSnapshotPlayer>,
}

struct RosterRebuild {
    players: Vec<PlayerListSnapshotPlayer>,
    observed_player_event_count: i64,
}

fn parse_date_ms(value: &str) -> i64 {
    parse_event_time_ms(value.trim()).unwrap_or(0)
}

fn is_live_location(location: &str) -> bool {
    let normalized = location.trim();
    !normalized.is_empty()
        && normalized != "offline"
        && normalized != "private"
        && normalized != "traveling"
}

fn context_from_row(row: PlayerLocationOutput, source: &str) -> PlayerListSnapshotContext {
    PlayerListSnapshotContext {
        created_at: row.created_at,
        location: row.location,
        world_id: row.world_id,
        world_name: row.world_name,
        time: row.time,
        group_name: row.group_name,
        source: source.to_string(),
        player_count: None,
        observed_player_event_count: None,
        player_facts_known: None,
    }
}

fn empty_context(location: String, source: &str) -> PlayerListSnapshotContext {
    PlayerListSnapshotContext {
        created_at: String::new(),
        location,
        world_id: String::new(),
        world_name: String::new(),
        time: 0,
        group_name: String::new(),
        source: source.to_string(),
        player_count: None,
        observed_player_event_count: None,
        player_facts_known: None,
    }
}

fn resolve_location_context(
    db: &DatabaseService,
    owner_user_id: &str,
    current_location: &str,
) -> Result<PlayerListSnapshotContext> {
    let normalized = current_location.trim().to_string();

    if is_live_location(&normalized) {
        if let Some(row) = player_list_location_get(db, owner_user_id, normalized.clone())? {
            return Ok(context_from_row(row, "database"));
        }
        let world_id = world_id_from_location(&normalized);
        let world_name = if world_id.is_empty() {
            normalized.clone()
        } else {
            world_id.clone()
        };
        let mut context = empty_context(normalized, "runtime");
        context.world_id = world_id;
        context.world_name = world_name;
        return Ok(context);
    }

    if !normalized.is_empty() {
        return Ok(empty_context(normalized, "runtime"));
    }

    if let Some(row) = player_list_latest_location_get(db, owner_user_id)? {
        return Ok(context_from_row(row, "database"));
    }

    Ok(empty_context(String::new(), "none"))
}

fn rebuild_roster(
    db: &DatabaseService,
    owner_user_id: &str,
    location: &str,
    started_at: &str,
    current_user_id: &str,
) -> Result<RosterRebuild> {
    let started_at = started_at.trim();
    let started_at_ms = parse_date_ms(started_at);
    let range_start = if started_at_ms > 0 { started_at } else { "" };
    let entries = get_join_leave_entries_for_location_range(
        db,
        owner_user_id,
        location.trim(),
        range_start,
        ROSTER_RANGE_END,
    )?;
    let entries = entries
        .into_iter()
        .filter(|entry| {
            if started_at_ms <= 0 {
                return true;
            }
            parse_event_time_ms(&entry.created_at).is_some_and(|event_ms| event_ms >= started_at_ms)
        })
        .collect::<Vec<_>>();
    let observed_player_event_count = entries.len() as i64;

    let mut players = fold_roster(&entries)
        .into_iter()
        .filter(|(_, player)| {
            current_user_id.is_empty() || player.user_id.trim() != current_user_id
        })
        .map(|(key, player)| {
            let display_name = if !player.display_name.is_empty() {
                player.display_name.clone()
            } else if !player.user_id.is_empty() {
                player.user_id.clone()
            } else {
                key.clone()
            };
            PlayerListSnapshotPlayer {
                id: key,
                user_id: player.user_id,
                display_name,
                joined_at: player.joined_at,
                joined_at_ms: player.joined_at_ms.unwrap_or(0),
            }
        })
        .collect::<Vec<_>>();
    players.sort_by(|left, right| {
        left.joined_at_ms
            .cmp(&right.joined_at_ms)
            .then_with(|| left.display_name.cmp(&right.display_name))
    });

    Ok(RosterRebuild {
        players,
        observed_player_event_count,
    })
}

pub fn player_list_current_snapshot(
    db: &DatabaseService,
    owner_user_id: &str,
    current_user_id: &str,
    current_location: &str,
    current_location_started_at: &str,
) -> Result<PlayerListSnapshotOutput> {
    let location_context = resolve_location_context(db, owner_user_id, current_location)?;

    let runtime_started_at = current_location_started_at.trim();
    let mut context = location_context.clone();
    if parse_date_ms(runtime_started_at) > parse_date_ms(&location_context.created_at) {
        context.created_at = runtime_started_at.to_string();
    }

    if !is_live_location(&context.location) {
        return Ok(PlayerListSnapshotOutput {
            context,
            players: Vec::new(),
        });
    }

    let current_user_id = current_user_id.trim();
    let mut roster = rebuild_roster(
        db,
        owner_user_id,
        &context.location,
        &context.created_at,
        current_user_id,
    )?;
    let mut effective_context = context.clone();

    let db_started_at_ms = parse_date_ms(&location_context.created_at);
    if roster.players.is_empty()
        && db_started_at_ms > 0
        && db_started_at_ms < parse_date_ms(&context.created_at)
    {
        let db_roster = rebuild_roster(
            db,
            owner_user_id,
            &location_context.location,
            &location_context.created_at,
            current_user_id,
        )?;
        if !db_roster.players.is_empty() {
            roster = db_roster;
            effective_context = location_context;
        }
    }

    effective_context.player_count = Some(roster.players.len() as i64);
    effective_context.observed_player_event_count = Some(roster.observed_player_event_count);
    effective_context.player_facts_known = Some(roster.observed_player_event_count > 0);

    Ok(PlayerListSnapshotOutput {
        context: effective_context,
        players: roster.players,
    })
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::sync::Arc;

    use vrcx_0_persistence::game_log::{
        write_batch, GameLogJoinLeaveEntry, GameLogLocationEntry, GameLogWriteBatch,
    };

    use super::*;

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn new(name: &str) -> Self {
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path =
                std::env::temp_dir().join(format!("vrcx-0-{name}-{}-{nonce}", std::process::id()));
            std::fs::create_dir_all(&path).unwrap();
            Self { path }
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    fn test_db(name: &str) -> (TestDir, Arc<DatabaseService>) {
        let dir = TestDir::new(name);
        let db = Arc::new(DatabaseService::new(&dir.path.join("VRCX-0.sqlite3")).unwrap());
        (dir, db)
    }

    fn location_entry(created_at: &str, location: &str) -> GameLogLocationEntry {
        GameLogLocationEntry {
            created_at: created_at.to_string(),
            location: location.to_string(),
            world_id: "wrld_live".to_string(),
            world_name: "Live World".to_string(),
            time: 0,
            group_name: String::new(),
        }
    }

    fn join_leave_entry(
        created_at: &str,
        event_type: &str,
        display_name: &str,
        location: &str,
        user_id: &str,
    ) -> GameLogJoinLeaveEntry {
        join_leave_entry_with_time(created_at, event_type, display_name, location, user_id, 0)
    }

    fn join_leave_entry_with_time(
        created_at: &str,
        event_type: &str,
        display_name: &str,
        location: &str,
        user_id: &str,
        time: i64,
    ) -> GameLogJoinLeaveEntry {
        GameLogJoinLeaveEntry {
            created_at: created_at.to_string(),
            event_type: event_type.to_string(),
            display_name: display_name.to_string(),
            location: location.to_string(),
            user_id: user_id.to_string(),
            world_name: "Live World".to_string(),
            time,
        }
    }

    fn write_rows(
        db: &DatabaseService,
        locations: Vec<GameLogLocationEntry>,
        join_leave: Vec<GameLogJoinLeaveEntry>,
    ) {
        let batch = GameLogWriteBatch {
            locations,
            join_leave,
            ..Default::default()
        };
        write_batch(db, "", &batch).unwrap();
    }

    #[test]
    fn excludes_join_rows_from_earlier_visits_to_the_same_instance() {
        let (_dir, db) = test_db("snapshot-earlier-visits");
        write_rows(
            &db,
            vec![location_entry("2026-04-30T10:00:00.000Z", "wrld_live:123")],
            vec![
                join_leave_entry(
                    "2026-01-01T10:00:00.000Z",
                    "OnPlayerJoined",
                    "Old Player",
                    "wrld_live:123",
                    "usr_old",
                ),
                join_leave_entry(
                    "2026-04-30T10:01:00.000Z",
                    "OnPlayerJoined",
                    "Current Player",
                    "wrld_live:123",
                    "usr_current",
                ),
            ],
        );

        let snapshot = player_list_current_snapshot(&db, "", "", "wrld_live:123", "").unwrap();
        assert_eq!(snapshot.players.len(), 1);
        assert_eq!(snapshot.players[0].user_id, "usr_current");
        assert_eq!(snapshot.context.player_count, Some(1));
    }

    #[test]
    fn runtime_start_time_overrides_stale_database_location_rows() {
        let (_dir, db) = test_db("snapshot-runtime-start");
        write_rows(
            &db,
            vec![location_entry("2026-01-01T10:00:00.000Z", "wrld_live:123")],
            vec![
                join_leave_entry(
                    "2026-01-01T10:01:00.000Z",
                    "OnPlayerJoined",
                    "Old Player",
                    "wrld_live:123",
                    "usr_old",
                ),
                join_leave_entry(
                    "2026-04-30T10:01:00.000Z",
                    "OnPlayerJoined",
                    "Current Player",
                    "wrld_live:123",
                    "usr_current",
                ),
            ],
        );

        let snapshot =
            player_list_current_snapshot(&db, "", "", "wrld_live:123", "2026-04-30T10:00:00.000Z")
                .unwrap();
        assert_eq!(snapshot.context.created_at, "2026-04-30T10:00:00.000Z");
        assert_eq!(snapshot.players.len(), 1);
        assert_eq!(snapshot.players[0].user_id, "usr_current");
    }

    #[test]
    fn leave_with_id_removes_unique_anonymous_join_by_display_name() {
        let (_dir, db) = test_db("snapshot-anonymous-leave");
        write_rows(
            &db,
            vec![location_entry("2026-04-30T10:00:00.000Z", "wrld_live:123")],
            vec![
                join_leave_entry(
                    "2026-04-30T10:01:00.000Z",
                    "OnPlayerJoined",
                    "Left Player",
                    "wrld_live:123",
                    "",
                ),
                join_leave_entry(
                    "2026-04-30T10:02:00.000Z",
                    "OnPlayerLeft",
                    "Left Player",
                    "wrld_live:123",
                    "usr_left",
                ),
            ],
        );

        let snapshot = player_list_current_snapshot(&db, "", "", "wrld_live:123", "").unwrap();
        assert!(snapshot.players.is_empty());
    }

    #[test]
    fn anonymous_leave_uses_duration_when_display_name_is_ambiguous() {
        let (_dir, db) = test_db("snapshot-anonymous-duration-leave");
        write_rows(
            &db,
            vec![location_entry("2026-04-30T10:00:00.000Z", "wrld_live:123")],
            vec![
                join_leave_entry(
                    "2026-04-30T10:01:00.000Z",
                    "OnPlayerJoined",
                    "Guest",
                    "wrld_live:123",
                    "",
                ),
                join_leave_entry(
                    "2026-04-30T10:01:30.000Z",
                    "OnPlayerJoined",
                    "Guest",
                    "wrld_live:123",
                    "",
                ),
                join_leave_entry_with_time(
                    "2026-04-30T10:02:00.000Z",
                    "OnPlayerLeft",
                    "Guest",
                    "wrld_live:123",
                    "",
                    60_000,
                ),
            ],
        );

        let snapshot = player_list_current_snapshot(&db, "", "", "wrld_live:123", "").unwrap();
        assert_eq!(snapshot.players.len(), 1);
        assert_eq!(snapshot.players[0].display_name, "Guest");
        assert_eq!(snapshot.players[0].joined_at, "2026-04-30T10:01:30.000Z");
    }

    #[test]
    fn falls_back_to_database_enter_time_when_stale_runtime_start_empties_roster() {
        let (_dir, db) = test_db("snapshot-db-window-fallback");
        write_rows(
            &db,
            vec![location_entry(
                "2026-06-09T12:26:31.000Z",
                "wrld_live:83220",
            )],
            vec![join_leave_entry(
                "2026-06-09T12:26:59.000Z",
                "OnPlayerJoined",
                "CyanChanges",
                "wrld_live:83220",
                "usr_cyan",
            )],
        );

        let snapshot = player_list_current_snapshot(
            &db,
            "",
            "",
            "wrld_live:83220",
            "2026-06-10T19:00:00.000Z",
        )
        .unwrap();
        assert_eq!(snapshot.players.len(), 1);
        assert_eq!(snapshot.players[0].user_id, "usr_cyan");
        assert_eq!(snapshot.context.created_at, "2026-06-09T12:26:31.000Z");
        assert_eq!(snapshot.context.player_facts_known, Some(true));
    }

    #[test]
    fn current_user_filter_can_empty_roster_and_trigger_facts_known() {
        let (_dir, db) = test_db("snapshot-current-user-filter");
        write_rows(
            &db,
            vec![location_entry("2026-04-30T10:00:00.000Z", "wrld_live:123")],
            vec![join_leave_entry(
                "2026-04-30T10:01:00.000Z",
                "OnPlayerJoined",
                "Me",
                "wrld_live:123",
                "usr_me",
            )],
        );

        let snapshot =
            player_list_current_snapshot(&db, "usr_me", "usr_me", "wrld_live:123", "").unwrap();
        assert!(snapshot.players.is_empty());
        assert_eq!(snapshot.context.player_count, Some(0));
        assert_eq!(snapshot.context.player_facts_known, Some(true));
    }

    #[test]
    fn non_live_location_returns_context_without_roster() {
        let (_dir, db) = test_db("snapshot-non-live");
        let snapshot = player_list_current_snapshot(&db, "", "", "private", "").unwrap();
        assert_eq!(snapshot.context.source, "runtime");
        assert_eq!(snapshot.context.location, "private");
        assert!(snapshot.players.is_empty());
        assert_eq!(snapshot.context.player_count, None);
    }
}
