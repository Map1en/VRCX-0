use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::feed_live::FeedLiveEntry;
use crate::game_log::{GameLogLocationEntry, GameLogLocationTimeUpdate};
use crate::notifications::AppNotification;

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FriendLogUpsert {
    pub target_user_id: String,
    pub display_name: String,
    pub trust_level: String,
    pub friend_number: i64,
    pub created_at: String,
    #[serde(default)]
    pub force_history: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FriendLogDelete {
    pub target_user_id: String,
    pub created_at: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SelfProfileField {
    Status,
    StatusDescription,
    Bio,
}

impl SelfProfileField {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Status => "status",
            Self::StatusDescription => "statusDescription",
            Self::Bio => "bio",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelfProfileObservation {
    pub observed_at: String,
    pub field: SelfProfileField,
    pub value: String,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RealtimePersistenceBatch {
    #[serde(default)]
    pub friend_log_upserts: Vec<FriendLogUpsert>,
    #[serde(default)]
    pub friend_log_deletes: Vec<FriendLogDelete>,
    #[serde(default)]
    pub feed_entries: Vec<FeedLiveEntry>,
    #[serde(default)]
    pub notification_v1_upserts: Vec<Value>,
    #[serde(default)]
    pub notification_v2_upserts: Vec<Value>,
    #[serde(default)]
    pub notification_v2_updates: Vec<NotificationV2Update>,
    #[serde(default)]
    pub notification_expirations: Vec<NotificationExpiration>,
    #[serde(default)]
    pub notification_seen: Vec<String>,
    #[serde(default)]
    pub app_notification_upserts: Vec<AppNotification>,
    #[serde(default)]
    pub avatar_history_upserts: Vec<AvatarHistoryUpsert>,
    #[serde(default)]
    pub avatar_time_spent_upserts: Vec<AvatarTimeSpentUpsert>,
    #[serde(default)]
    pub game_log_locations: Vec<GameLogLocationEntry>,
    #[serde(default)]
    pub game_log_location_time_updates: Vec<GameLogLocationTimeUpdate>,
    #[serde(default)]
    pub self_profile_observations: Vec<SelfProfileObservation>,
}

impl RealtimePersistenceBatch {
    pub fn is_empty(&self) -> bool {
        self.friend_log_upserts.is_empty()
            && self.friend_log_deletes.is_empty()
            && self.feed_entries.is_empty()
            && self.notification_v1_upserts.is_empty()
            && self.notification_v2_upserts.is_empty()
            && self.notification_v2_updates.is_empty()
            && self.notification_expirations.is_empty()
            && self.notification_seen.is_empty()
            && self.app_notification_upserts.is_empty()
            && self.avatar_history_upserts.is_empty()
            && self.avatar_time_spent_upserts.is_empty()
            && self.game_log_locations.is_empty()
            && self.game_log_location_time_updates.is_empty()
            && self.self_profile_observations.is_empty()
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct RealtimeWriteCounts {
    pub affected_count: u64,
    pub game_log_affected_count: u64,
}

impl RealtimeWriteCounts {
    pub fn add_realtime_rows(&mut self, count: u64) {
        self.affected_count = self.affected_count.saturating_add(count);
    }

    pub fn add_game_log_rows(&mut self, count: u64) {
        self.affected_count = self.affected_count.saturating_add(count);
        self.game_log_affected_count = self.game_log_affected_count.saturating_add(count);
    }
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationExpiration {
    pub id: String,
    pub expired_at: String,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationV2Update {
    pub id: String,
    pub updates: Value,
    #[serde(default)]
    pub received_at: String,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AvatarHistoryUpsert {
    pub avatar_id: String,
    pub created_at: String,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AvatarTimeSpentUpsert {
    pub avatar_id: String,
    pub created_at: String,
    pub time_spent: i64,
    pub started_at_ms: i64,
    pub ended_at_ms: i64,
}
