use std::collections::HashMap;

use chrono::DateTime;
use serde::Serialize;

pub use vrcx_0_core::location::world_id_from_location;

#[derive(Clone, Debug, Default)]
pub struct GameLogRuntimeState {
    pub current_location: String,
    pub current_world_name: String,
    pub current_destination: String,
    pub current_location_started_at: String,
    pub current_location_started_at_ms: Option<i64>,
    pub players_by_key: HashMap<String, PlayerState>,
    pub last_resource_url: String,
    pub last_video_url: String,
    pub now_playing_url: String,
    pub is_game_running: bool,
    pub is_steamvr_running: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PlayerState {
    pub user_id: String,
    pub display_name: String,
    pub join_time_ms: Option<i64>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct RuntimeSnapshot {
    pub location: String,
    pub world_name: String,
    pub destination: String,
    pub started_at: String,
    pub players: Vec<PlayerState>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GameLogProjection {
    pub current_location: String,
    pub current_world_id: String,
    pub current_world_name: String,
    pub current_destination: String,
    pub current_location_started_at: Option<String>,
    pub current_location_player_ids: Vec<String>,
    pub current_location_players: Vec<PlayerState>,
    pub last_game_log_at: String,
    pub last_game_log_type: String,
}

impl GameLogRuntimeState {
    pub fn snapshot(&self) -> RuntimeSnapshot {
        let mut players: Vec<PlayerState> = self.players_by_key.values().cloned().collect();
        players.sort_by(|left, right| {
            left.display_name
                .cmp(&right.display_name)
                .then_with(|| left.user_id.cmp(&right.user_id))
        });
        RuntimeSnapshot {
            location: self.current_location.clone(),
            world_name: self.current_world_name.clone(),
            destination: self.current_destination.clone(),
            started_at: self.current_location_started_at.clone(),
            players,
        }
    }

    pub fn projection(
        &self,
        last_game_log_at: &str,
        last_game_log_type: &str,
    ) -> GameLogProjection {
        let snapshot = self.snapshot();
        GameLogProjection {
            current_world_id: world_id_from_location(&snapshot.location),
            current_location: snapshot.location,
            current_world_name: snapshot.world_name,
            current_destination: snapshot.destination,
            current_location_started_at: if snapshot.started_at.is_empty() {
                None
            } else {
                Some(snapshot.started_at)
            },
            current_location_player_ids: snapshot
                .players
                .iter()
                .filter_map(|player| {
                    if player.user_id.is_empty() {
                        None
                    } else {
                        Some(player.user_id.clone())
                    }
                })
                .collect(),
            current_location_players: snapshot.players,
            last_game_log_at: last_game_log_at.to_string(),
            last_game_log_type: last_game_log_type.to_string(),
        }
    }
}

pub fn parse_event_time_ms(value: &str) -> Option<i64> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|dt| dt.timestamp_millis())
}

pub fn duration_ms(started_at: Option<i64>, stopped_at: Option<i64>) -> i64 {
    match (started_at, stopped_at) {
        (Some(started_at), Some(stopped_at)) if stopped_at >= started_at => stopped_at - started_at,
        _ => 0,
    }
}

pub fn player_key(user_id: &str, display_name: &str) -> String {
    if user_id.is_empty() {
        format!("display:{display_name}")
    } else {
        format!("id:{user_id}")
    }
}
