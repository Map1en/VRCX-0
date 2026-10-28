use serde_json::{Map, Value};
use vrcx_0_core::derived_keys;
use vrcx_0_core::json::JsonExt;
use vrcx_0_core::presence::PresenceView;

use vrcx_0_core::friends::normalize_user_id;

#[derive(Clone, Debug, Default)]
pub(super) struct RealtimeCurrentUserState {
    pub(super) generation: u64,
    pub(super) sequence: u64,
    pub(super) current_user_id: String,
    pub(super) snapshot: RealtimeCurrentUserStateSnapshot,
    pub(super) remote_snapshot: RealtimeCurrentUserStateSnapshot,
    pub(super) pending_offline: Option<PendingCurrentUserOffline>,
    pub(super) remote_game_log_interval: Option<RemoteGameLogInterval>,
    pub(super) presence: Option<PresenceView>,
    pub(super) avatar_wear_checkpoint_ms: i64,
}

#[derive(Clone, Debug)]
pub(super) struct PendingCurrentUserOffline {
    pub(super) deadline_ms: i64,
    pub(super) patch: Map<String, Value>,
}

#[derive(Clone, Debug)]
pub(super) struct RemoteGameLogInterval {
    pub(super) created_at: String,
    pub(super) started_at_ms: i64,
    pub(super) location: String,
}

#[derive(Default)]
pub(super) struct CurrentUserPatchOptions {
    pub(super) reconciles_remote_location: bool,
    pub(super) records_remote_game_log: bool,
    pub(super) records_current_avatar_history: bool,
    pub(super) wake_at_ms: Option<i64>,
}

#[derive(Clone, Debug, Default)]
pub(super) struct RealtimeCurrentUserStateSnapshot {
    pub(super) raw: Map<String, Value>,
    pub(super) user_id: String,
    pub(super) location: String,
    pub(super) traveling_to_location: String,
    pub(super) current_avatar: String,
    pub(super) world_name: String,
    pub(super) previous_avatar_swap_time: i64,
}

impl RealtimeCurrentUserStateSnapshot {
    pub(super) fn from_value(snapshot: serde_json::Value, current_user_id: &str) -> Self {
        Self::from_map(
            snapshot.as_object().cloned().unwrap_or_default(),
            current_user_id,
        )
    }

    pub(super) fn from_map(mut raw: Map<String, Value>, current_user_id: &str) -> Self {
        if !current_user_id.is_empty() {
            raw.insert("id".into(), Value::String(current_user_id.to_string()));
        }
        let mut snapshot = Self {
            raw,
            ..Self::default()
        };
        snapshot.refresh_typed_fields();
        snapshot
    }

    pub(super) fn to_map(&self) -> Map<String, Value> {
        let mut raw = self.raw.clone();
        if !self.user_id.is_empty() {
            raw.insert("id".into(), Value::String(self.user_id.clone()));
        }
        raw
    }

    pub(super) fn set_previous_avatar_swap_time(&mut self, value: Option<i64>) {
        self.previous_avatar_swap_time = value.unwrap_or_default();
        self.raw.insert(
            derived_keys::PREVIOUS_AVATAR_SWAP_TIME.into(),
            value.map(Value::from).unwrap_or(Value::Null),
        );
    }

    fn refresh_typed_fields(&mut self) {
        self.user_id = normalize_user_id(&self.raw.text_field("id"));
        self.location = self.raw.text_field("location");
        self.traveling_to_location = self.raw.text_field("travelingToLocation");
        self.current_avatar = normalize_user_id(&self.raw.text_field("currentAvatar"));
        self.world_name = self.raw.text_field("worldName");
        self.previous_avatar_swap_time = self
            .raw
            .i64_field(derived_keys::PREVIOUS_AVATAR_SWAP_TIME)
            .unwrap_or_default();
    }
}

pub(super) const CURRENT_USER_REFRESH_LOCAL_AUTHORITY_FIELDS: &[&str] = &[
    "friends",
    "onlineFriends",
    "activeFriends",
    "offlineFriends",
    "status",
    "statusDescription",
    "location",
    derived_keys::LOCATION_PROJECTION,
    derived_keys::LOCATION_UPDATED_AT,
    "locationUpdatedAt",
    "worldId",
    "instanceId",
    "travelingToLocation",
    "travelingToWorld",
    "travelingToInstance",
    derived_keys::TRAVELING_TO_LOCATION_PROJECTION,
    derived_keys::TRAVELING_TO_TIME,
    "travelingToTime",
    derived_keys::PREVIOUS_LOCATION,
    derived_keys::PREVIOUS_LOCATION_UPDATED_AT,
];

pub(super) const CURRENT_USER_REMOTE_PRESENCE_FIELDS: &[&str] = &[
    "location",
    derived_keys::LOCATION_PROJECTION,
    derived_keys::LOCATION_UPDATED_AT,
    "locationUpdatedAt",
    "worldId",
    "instanceId",
    "travelingToLocation",
    "travelingToWorld",
    "travelingToInstance",
    derived_keys::TRAVELING_TO_LOCATION_PROJECTION,
    derived_keys::TRAVELING_TO_TIME,
    "worldName",
];
