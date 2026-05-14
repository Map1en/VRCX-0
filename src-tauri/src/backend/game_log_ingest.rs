use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use chrono::DateTime;

use crate::backend::db::config as backend_config;
use crate::backend::db::game_log::{
    write_batch, GameLogEventEntry, GameLogExternalEntry, GameLogJoinLeaveEntry,
    GameLogLocationEntry, GameLogLocationTimeUpdate, GameLogPortalSpawnEntry,
    GameLogResourceLoadEntry, GameLogWriteBatch,
};
use crate::domain::database::DatabaseService;
use crate::domain::log_watcher::{GameLogEvent, GameLogEventKind, GameLogEventSink};
use crate::error::AppError;

pub struct GameLogIngest {
    db: Arc<DatabaseService>,
    state: Mutex<GameLogIngestState>,
}

#[derive(Default)]
struct GameLogIngestState {
    current_location: String,
    current_world_name: String,
    current_location_started_at: String,
    current_location_started_at_ms: Option<i64>,
    players_by_key: HashMap<String, PlayerState>,
    last_resource_url: String,
}

struct PlayerState {
    user_id: String,
    display_name: String,
    join_time_ms: Option<i64>,
}

impl GameLogIngest {
    pub fn new(db: Arc<DatabaseService>) -> Self {
        Self {
            db,
            state: Mutex::new(GameLogIngestState::default()),
        }
    }

    pub fn ingest_event(&self, event: &GameLogEvent) -> Result<(), AppError> {
        self.ingest_events(std::slice::from_ref(event))
    }

    pub fn ingest_events(&self, events: &[GameLogEvent]) -> Result<(), AppError> {
        if events.is_empty() {
            return Ok(());
        }

        let mut state = self
            .state
            .lock()
            .map_err(|error| AppError::Custom(format!("GameLog ingest state lock: {error}")))?;
        if backend_config::get_bool(&self.db, "gameLogDisabled", false)? {
            return Ok(());
        }

        let log_resource_load = backend_config::get_bool(&self.db, "logResourceLoad", false)?;
        let mut batch = GameLogWriteBatch::default();
        for event in events {
            match &event.kind {
                GameLogEventKind::Location {
                    location,
                    world_name,
                } => self.ingest_location(&mut state, &mut batch, event, location, world_name),
                GameLogEventKind::LocationDestination { .. } => {
                    self.finalize_location_session(&mut state, &mut batch, &event.created_at);
                    state.current_location = "traveling".into();
                    state.current_world_name.clear();
                    state.current_location_started_at = event.created_at.clone();
                    state.current_location_started_at_ms = parse_event_time_ms(&event.created_at);
                }
                GameLogEventKind::PlayerJoined {
                    display_name,
                    user_id,
                } => {
                    self.ingest_player_joined(&mut state, &mut batch, event, display_name, user_id)
                }
                GameLogEventKind::PlayerLeft {
                    display_name,
                    user_id,
                } => self.ingest_player_left(&mut state, &mut batch, event, display_name, user_id),
                GameLogEventKind::PortalSpawn => {
                    self.ingest_portal_spawn(&state, &mut batch, event)
                }
                GameLogEventKind::ResourceLoad {
                    resource_type,
                    resource_url,
                } => self.ingest_resource_load(
                    &mut state,
                    &mut batch,
                    event,
                    resource_type,
                    resource_url,
                    log_resource_load,
                ),
                GameLogEventKind::Event { data } => batch.events.push(GameLogEventEntry {
                    created_at: event.created_at.clone(),
                    data: data.clone(),
                }),
                GameLogEventKind::External { data } => batch.externals.push(GameLogExternalEntry {
                    created_at: event.created_at.clone(),
                    message: data.clone(),
                    display_name: String::new(),
                    user_id: String::new(),
                    location: state.current_location.clone(),
                }),
            }
        }

        write_batch(&self.db, &batch)
    }

    fn ingest_location(
        &self,
        state: &mut GameLogIngestState,
        batch: &mut GameLogWriteBatch,
        event: &GameLogEvent,
        location: &str,
        world_name: &str,
    ) {
        if location.is_empty() {
            return;
        }

        let world_id = location.split(':').next().unwrap_or_default().to_string();
        batch.locations.push(GameLogLocationEntry {
            created_at: event.created_at.clone(),
            location: location.to_string(),
            world_id,
            world_name: world_name.to_string(),
            time: 0,
            group_name: String::new(),
        });

        state.current_location = location.to_string();
        state.current_world_name = world_name.to_string();
        state.current_location_started_at = event.created_at.clone();
        state.current_location_started_at_ms = parse_event_time_ms(&event.created_at);
        state.players_by_key.clear();
        state.last_resource_url.clear();
    }

    fn ingest_player_joined(
        &self,
        state: &mut GameLogIngestState,
        batch: &mut GameLogWriteBatch,
        event: &GameLogEvent,
        display_name: &str,
        user_id: &str,
    ) {
        let player_key = player_key(user_id, display_name);
        let join_time_ms = parse_event_time_ms(&event.created_at);
        state.players_by_key.insert(
            player_key,
            PlayerState {
                user_id: user_id.to_string(),
                display_name: display_name.to_string(),
                join_time_ms,
            },
        );

        batch.join_leave.push(GameLogJoinLeaveEntry {
            created_at: event.created_at.clone(),
            event_type: "OnPlayerJoined".into(),
            display_name: display_name.to_string(),
            location: state.current_location.clone(),
            user_id: user_id.to_string(),
            time: 0,
        });
    }

    fn ingest_player_left(
        &self,
        state: &mut GameLogIngestState,
        batch: &mut GameLogWriteBatch,
        event: &GameLogEvent,
        display_name: &str,
        user_id: &str,
    ) {
        let left_time_ms = parse_event_time_ms(&event.created_at);
        let player = state
            .players_by_key
            .remove(&player_key(user_id, display_name));
        let duration = duration_ms(player.as_ref().and_then(|p| p.join_time_ms), left_time_ms);

        batch.join_leave.push(GameLogJoinLeaveEntry {
            created_at: event.created_at.clone(),
            event_type: "OnPlayerLeft".into(),
            display_name: display_name.to_string(),
            location: state.current_location.clone(),
            user_id: user_id.to_string(),
            time: duration,
        });
    }

    fn ingest_portal_spawn(
        &self,
        state: &GameLogIngestState,
        batch: &mut GameLogWriteBatch,
        event: &GameLogEvent,
    ) {
        batch.portal_spawns.push(GameLogPortalSpawnEntry {
            created_at: event.created_at.clone(),
            display_name: String::new(),
            location: state.current_location.clone(),
            user_id: String::new(),
            instance_id: String::new(),
            world_name: String::new(),
        });
    }

    fn ingest_resource_load(
        &self,
        state: &mut GameLogIngestState,
        batch: &mut GameLogWriteBatch,
        event: &GameLogEvent,
        resource_type: &str,
        resource_url: &str,
        log_resource_load: bool,
    ) {
        if resource_url.is_empty() || state.last_resource_url == resource_url || !log_resource_load
        {
            return;
        }

        state.last_resource_url = resource_url.to_string();
        batch.resource_loads.push(GameLogResourceLoadEntry {
            created_at: event.created_at.clone(),
            resource_url: resource_url.to_string(),
            resource_type: resource_type.to_string(),
            location: state.current_location.clone(),
        });
    }

    fn finalize_location_session(
        &self,
        state: &mut GameLogIngestState,
        batch: &mut GameLogWriteBatch,
        stopped_at: &str,
    ) {
        let stopped_at_ms = parse_event_time_ms(stopped_at);
        if state.current_location.is_empty() || stopped_at_ms.is_none() {
            state.players_by_key.clear();
            return;
        }

        for player in state.players_by_key.values() {
            batch.join_leave.push(GameLogJoinLeaveEntry {
                created_at: stopped_at.to_string(),
                event_type: "OnPlayerLeft".into(),
                display_name: player.display_name.clone(),
                location: state.current_location.clone(),
                user_id: player.user_id.clone(),
                time: duration_ms(player.join_time_ms, stopped_at_ms),
            });
        }
        state.players_by_key.clear();

        let location_duration = duration_ms(state.current_location_started_at_ms, stopped_at_ms);
        if !state.current_location_started_at.is_empty() {
            batch.location_time_updates.push(GameLogLocationTimeUpdate {
                created_at: state.current_location_started_at.clone(),
                time: location_duration,
            });
        }
    }
}

impl GameLogEventSink for GameLogIngest {
    fn ingest_game_log_event(&self, event: &GameLogEvent) -> Result<(), AppError> {
        self.ingest_event(event)
    }

    fn ingest_game_log_events(&self, events: &[GameLogEvent]) -> Result<(), AppError> {
        self.ingest_events(events)
    }
}

fn parse_event_time_ms(value: &str) -> Option<i64> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|dt| dt.timestamp_millis())
}

fn duration_ms(started_at: Option<i64>, stopped_at: Option<i64>) -> i64 {
    match (started_at, stopped_at) {
        (Some(started_at), Some(stopped_at)) if stopped_at >= started_at => stopped_at - started_at,
        _ => 0,
    }
}

fn player_key(user_id: &str, display_name: &str) -> String {
    if user_id.is_empty() {
        format!("display:{display_name}")
    } else {
        format!("id:{user_id}")
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::sync::Arc;

    use crate::domain::database::DatabaseService;
    use crate::domain::log_watcher::{GameLogEvent, GameLogEventKind};
    use crate::error::AppError;

    use crate::backend::db::config as backend_config;

    use super::GameLogIngest;

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

    fn test_ingest(name: &str) -> Result<(TestDir, Arc<DatabaseService>, GameLogIngest), AppError> {
        let dir = TestDir::new(name);
        let db = Arc::new(DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?);
        let ingest = GameLogIngest::new(Arc::clone(&db));
        Ok((dir, db, ingest))
    }

    fn event(created_at: &str, kind: GameLogEventKind) -> GameLogEvent {
        GameLogEvent {
            file_name: "output_log_2026-05-14_00-00-00.txt".into(),
            created_at: created_at.into(),
            kind,
        }
    }

    #[test]
    fn tracks_location_players_and_session_duration() -> Result<(), AppError> {
        let (_dir, db, ingest) = test_ingest("backend-gamelog-ingest")?;

        ingest.ingest_event(&event(
            "2026-05-14T04:00:00.000Z",
            GameLogEventKind::Location {
                location: "wrld_ingest:1".into(),
                world_name: "Ingest World".into(),
            },
        ))?;
        ingest.ingest_event(&event(
            "2026-05-14T04:00:10.000Z",
            GameLogEventKind::PlayerJoined {
                display_name: "Alpha".into(),
                user_id: "usr_alpha".into(),
            },
        ))?;
        ingest.ingest_event(&event(
            "2026-05-14T04:00:40.000Z",
            GameLogEventKind::LocationDestination {
                location: "wrld_next:1".into(),
            },
        ))?;

        let rows = db.execute("SELECT time FROM gamelog_location", &Default::default())?;
        assert_eq!(rows[0][0], serde_json::json!(40000));
        let rows = db.execute(
            "SELECT type, display_name, time FROM gamelog_join_leave ORDER BY created_at",
            &Default::default(),
        )?;
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0][0], serde_json::json!("OnPlayerJoined"));
        assert_eq!(rows[1][0], serde_json::json!("OnPlayerLeft"));
        assert_eq!(rows[1][1], serde_json::json!("Alpha"));
        assert_eq!(rows[1][2], serde_json::json!(30000));
        Ok(())
    }

    #[test]
    fn respects_game_log_disabled_config_before_writing_tables() -> Result<(), AppError> {
        let (_dir, db, ingest) = test_ingest("backend-gamelog-disabled")?;
        db.execute_non_query(
            "CREATE TABLE configs (`key` TEXT PRIMARY KEY, `value` TEXT)",
            &Default::default(),
        )?;
        let mut args = std::collections::HashMap::new();
        args.insert(
            "@key".to_string(),
            serde_json::json!("config:vrcx_gamelogdisabled"),
        );
        args.insert("@value".to_string(), serde_json::json!("true"));
        db.execute_non_query(
            "INSERT INTO configs (key, value) VALUES (@key, @value)",
            &args,
        )?;

        ingest.ingest_event(&event(
            "2026-05-14T05:00:00.000Z",
            GameLogEventKind::Location {
                location: "wrld_disabled:1".into(),
                world_name: "Disabled".into(),
            },
        ))?;

        let rows = db.execute(
            "SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'gamelog_location'",
            &Default::default(),
        )?;
        assert!(rows.is_empty());
        Ok(())
    }

    #[test]
    fn ingests_fixture_batch_with_resource_config_and_empty_user_id() -> Result<(), AppError> {
        let (_dir, db, ingest) = test_ingest("backend-gamelog-ingest-batch")?;
        backend_config::set_bool(&db, "logResourceLoad", true)?;

        ingest.ingest_events(&[
            event(
                "2026-05-14T08:00:00.000Z",
                GameLogEventKind::Location {
                    location: "wrld_fixture:1".into(),
                    world_name: "多字节 World".into(),
                },
            ),
            event(
                "2026-05-14T08:00:05.000Z",
                GameLogEventKind::PlayerJoined {
                    display_name: "做鳄梦small-fry".into(),
                    user_id: "".into(),
                },
            ),
            event(
                "2026-05-14T08:00:15.000Z",
                GameLogEventKind::PlayerLeft {
                    display_name: "做鳄梦small-fry".into(),
                    user_id: "".into(),
                },
            ),
            event(
                "2026-05-14T08:00:20.000Z",
                GameLogEventKind::ResourceLoad {
                    resource_type: "ImageLoad".into(),
                    resource_url: "https://example.test/fixture.png".into(),
                },
            ),
            event(
                "2026-05-14T08:00:30.000Z",
                GameLogEventKind::LocationDestination {
                    location: "wrld_next:1".into(),
                },
            ),
        ])?;

        let rows = db.execute(
            "SELECT world_name, time FROM gamelog_location",
            &Default::default(),
        )?;
        assert_eq!(rows[0][0], serde_json::json!("多字节 World"));
        assert_eq!(rows[0][1], serde_json::json!(30000));
        let rows = db.execute(
            "SELECT type, display_name, user_id, time FROM gamelog_join_leave ORDER BY created_at",
            &Default::default(),
        )?;
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[1][0], serde_json::json!("OnPlayerLeft"));
        assert_eq!(rows[1][1], serde_json::json!("做鳄梦small-fry"));
        assert_eq!(rows[1][2], serde_json::json!(""));
        assert_eq!(rows[1][3], serde_json::json!(10000));
        let rows = db.execute(
            "SELECT resource_url FROM gamelog_resource_load",
            &Default::default(),
        )?;
        assert_eq!(
            rows[0][0],
            serde_json::json!("https://example.test/fixture.png")
        );
        Ok(())
    }
}
