use serde::{Deserialize, Serialize};
use vrcx_0_core::json::RawJson;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct GameLogLocationEntry {
    pub created_at: String,
    pub location: String,
    pub world_id: String,
    pub world_name: String,
    pub time: i64,
    pub group_name: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct GameLogJoinLeaveEntry {
    pub created_at: String,
    pub event_type: String,
    pub display_name: String,
    pub location: String,
    pub user_id: String,
    pub time: i64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct GameLogPortalSpawnEntry {
    pub created_at: String,
    pub display_name: String,
    pub location: String,
    pub user_id: String,
    pub instance_id: String,
    pub world_name: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct GameLogVideoPlayEntry {
    pub created_at: String,
    pub video_url: String,
    pub video_name: String,
    pub video_id: String,
    pub location: String,
    pub display_name: String,
    pub user_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct GameLogResourceLoadEntry {
    pub created_at: String,
    pub resource_url: String,
    pub resource_type: String,
    pub location: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct GameLogEventEntry {
    pub created_at: String,
    pub data: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct GameLogExternalEntry {
    pub created_at: String,
    pub message: String,
    pub display_name: String,
    pub user_id: String,
    pub location: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub struct GameLogLocationTimeUpdate {
    pub created_at: String,
    pub time: i64,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub struct GameLogWriteBatch {
    pub locations: Vec<GameLogLocationEntry>,
    pub location_time_updates: Vec<GameLogLocationTimeUpdate>,
    pub join_leave: Vec<GameLogJoinLeaveEntry>,
    pub portal_spawns: Vec<GameLogPortalSpawnEntry>,
    pub video_plays: Vec<GameLogVideoPlayEntry>,
    pub resource_loads: Vec<GameLogResourceLoadEntry>,
    pub events: Vec<GameLogEventEntry>,
    pub externals: Vec<GameLogExternalEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameLogQueryInput {
    pub kind: String,
    #[serde(default)]
    pub params: RawJson,
}

impl GameLogWriteBatch {
    pub fn is_empty(&self) -> bool {
        self.locations.is_empty()
            && self.location_time_updates.is_empty()
            && self.join_leave.is_empty()
            && self.portal_spawns.is_empty()
            && self.video_plays.is_empty()
            && self.resource_loads.is_empty()
            && self.events.is_empty()
            && self.externals.is_empty()
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GameLogLocationSnapshot {
    pub created_at: String,
    pub location: String,
    pub world_id: String,
    pub world_name: String,
    pub group_name: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GameLogJoinLeaveSnapshot {
    pub created_at: String,
    pub event_type: String,
    pub display_name: String,
    pub user_id: String,
}
