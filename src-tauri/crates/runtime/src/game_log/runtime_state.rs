use std::collections::HashMap;

use chrono::DateTime;
use serde::Serialize;

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

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
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
    pub players: Vec<PlayerState>,
}

impl GameLogRuntimeState {
    pub fn snapshot(&self) -> RuntimeSnapshot {
        RuntimeSnapshot {
            location: self.current_location.clone(),
            world_name: self.current_world_name.clone(),
            destination: self.current_destination.clone(),
            players: self.players_by_key.values().cloned().collect(),
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

pub fn world_id_from_location(location: &str) -> String {
    location.split(':').next().unwrap_or_default().to_string()
}
