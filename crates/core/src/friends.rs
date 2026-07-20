use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize, specta::Type)]
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

    pub fn is_placeholder(&self) -> bool {
        self.extra.get("$profileSource").and_then(Value::as_str) == Some("placeholder")
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

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize, specta::Type)]
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

pub const DEFAULT_AVATAR_FILE_ID: &str = "file_0e8c4e32-7444-44ea-ade4-313c010d4bae";

pub fn strip_default_avatar_image(object: &mut Map<String, Value>) {
    let is_default = object
        .get("currentAvatarImageUrl")
        .and_then(Value::as_str)
        .is_some_and(|url| url.contains(DEFAULT_AVATAR_FILE_ID));
    if is_default {
        object.remove("currentAvatarImageUrl");
        object.remove("currentAvatarThumbnailImageUrl");
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

pub fn meaningful_display_name(
    display_name: &str,
    username: &str,
    user_id: &str,
) -> Option<String> {
    let user_id = user_id.trim();
    for candidate in [display_name, username] {
        let candidate = candidate.trim();
        if !candidate.is_empty()
            && candidate != user_id
            && candidate != "Unknown"
            && !candidate.starts_with("usr_")
        {
            return Some(candidate.to_string());
        }
    }
    None
}

pub fn first_non_empty<'a>(values: impl IntoIterator<Item = &'a str>) -> &'a str {
    values
        .into_iter()
        .find(|value| !value.trim().is_empty())
        .unwrap_or("")
        .trim()
}

#[cfg(test)]
mod tests {
    use super::{
        meaningful_display_name, strip_default_avatar_image, FriendRecord, FriendRosterBaseline,
        DEFAULT_AVATAR_FILE_ID,
    };
    use crate::vrchat_endpoints::VRCHAT_API_DEFAULT_ENDPOINT;
    use serde_json::{json, Value};

    #[test]
    fn strips_default_avatar_image_and_thumbnail() {
        let mut object = json!({
            "currentAvatarImageUrl": format!("{VRCHAT_API_DEFAULT_ENDPOINT}/file/{DEFAULT_AVATAR_FILE_ID}/1/file"),
            "currentAvatarThumbnailImageUrl": format!("{VRCHAT_API_DEFAULT_ENDPOINT}/file/{DEFAULT_AVATAR_FILE_ID}/1/256"),
            "displayName": "Friend"
        })
        .as_object()
        .cloned()
        .unwrap();

        strip_default_avatar_image(&mut object);

        assert!(!object.contains_key("currentAvatarImageUrl"));
        assert!(!object.contains_key("currentAvatarThumbnailImageUrl"));
        assert_eq!(
            object.get("displayName"),
            Some(&Value::String("Friend".into()))
        );
    }

    #[test]
    fn keeps_real_avatar_image() {
        let mut object = json!({
            "currentAvatarImageUrl": "https://api.vrchat.cloud/api/1/file/file_real/1/file",
            "currentAvatarThumbnailImageUrl": "https://api.vrchat.cloud/api/1/file/file_real/1/256"
        })
        .as_object()
        .cloned()
        .unwrap();

        strip_default_avatar_image(&mut object);

        assert!(object.contains_key("currentAvatarImageUrl"));
        assert!(object.contains_key("currentAvatarThumbnailImageUrl"));
    }

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

    #[test]
    fn meaningful_display_name_skips_placeholders() {
        assert_eq!(
            meaningful_display_name("Nagisa", "naginagi", "usr_1"),
            Some("Nagisa".to_string())
        );
        assert_eq!(
            meaningful_display_name("  ", "naginagi", "usr_1"),
            Some("naginagi".to_string())
        );
        assert_eq!(meaningful_display_name("Unknown", "", "usr_1"), None);
        assert_eq!(meaningful_display_name("usr_1", "", "usr_1"), None);
        assert_eq!(meaningful_display_name("usr_other", "", "usr_1"), None);
        assert_eq!(meaningful_display_name("", "", "usr_1"), None);
    }
}
