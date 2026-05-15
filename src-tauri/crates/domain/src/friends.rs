//! Friend roster domain models used by host realtime reducers.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FriendRecord {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub display_name: String,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub state: String,
    #[serde(default)]
    pub state_bucket: String,
    #[serde(default)]
    pub location: String,
    #[serde(default)]
    pub traveling_to_location: String,
    #[serde(default)]
    pub world_id: String,
    #[serde(default)]
    pub platform: String,
    #[serde(default, alias = "last_platform")]
    pub last_platform: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub status_description: String,
    #[serde(default)]
    pub bio: String,
    #[serde(default)]
    pub current_avatar_image_url: String,
    #[serde(default)]
    pub current_avatar_thumbnail_image_url: String,
    #[serde(default)]
    pub current_avatar_author_id: String,
    #[serde(default)]
    pub current_avatar_name: String,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

impl FriendRecord {
    pub fn normalized(mut self, fallback_user_id: &str) -> Option<Self> {
        self.id = normalize_user_id(first_non_empty([self.id.as_str(), fallback_user_id]));
        if self.id.is_empty() {
            return None;
        }

        self.state_bucket = normalize_state_bucket(first_non_empty([
            self.state_bucket.as_str(),
            self.state.as_str(),
        ]))
        .unwrap_or_else(|| "offline".to_string());
        self.state = self.state_bucket.clone();
        Some(self)
    }

    pub fn display_name_or_id(&self) -> String {
        first_non_empty([
            self.display_name.as_str(),
            self.username.as_str(),
            self.id.as_str(),
        ])
        .to_string()
    }
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FriendRosterBaseline {
    pub current_user_id: String,
    pub endpoint: String,
    pub websocket: String,
    #[serde(default)]
    pub friends_by_id: HashMap<String, FriendRecord>,
}

impl FriendRosterBaseline {
    pub fn normalized(mut self) -> Self {
        self.current_user_id = normalize_user_id(&self.current_user_id);
        self.endpoint = self.endpoint.trim().to_string();
        self.websocket = self.websocket.trim().to_string();
        self.friends_by_id = self
            .friends_by_id
            .into_iter()
            .filter_map(|(user_id, record)| {
                let normalized_user_id = normalize_user_id(&user_id);
                record
                    .normalized(&normalized_user_id)
                    .map(|record| (record.id.clone(), record))
            })
            .collect();
        self
    }
}

pub fn normalize_user_id(value: &str) -> String {
    value.trim().to_string()
}

pub fn normalize_state_bucket(value: &str) -> Option<String> {
    match value.trim().to_ascii_lowercase().as_str() {
        "online" => Some("online".to_string()),
        "active" => Some("active".to_string()),
        "offline" => Some("offline".to_string()),
        _ => None,
    }
}

fn first_non_empty<'a>(values: impl IntoIterator<Item = &'a str>) -> &'a str {
    values
        .into_iter()
        .find(|value| !value.trim().is_empty())
        .unwrap_or("")
        .trim()
}

#[cfg(test)]
mod tests {
    use super::{FriendRecord, FriendRosterBaseline};

    #[test]
    fn normalizes_baseline_friend_records() {
        let baseline = FriendRosterBaseline {
            current_user_id: " usr_self ".into(),
            endpoint: " https://api.example.test ".into(),
            websocket: " wss://ws.example.test ".into(),
            friends_by_id: [(
                " usr_friend ".to_string(),
                FriendRecord {
                    display_name: "Friend".into(),
                    state: "online".into(),
                    ..FriendRecord::default()
                },
            )]
            .into_iter()
            .collect(),
        }
        .normalized();

        assert_eq!(baseline.current_user_id, "usr_self");
        assert_eq!(baseline.endpoint, "https://api.example.test");
        assert_eq!(baseline.websocket, "wss://ws.example.test");
        let friend = baseline.friends_by_id.get("usr_friend").unwrap();
        assert_eq!(friend.id, "usr_friend");
        assert_eq!(friend.state_bucket, "online");
        assert_eq!(friend.display_name_or_id(), "Friend");
    }
}
