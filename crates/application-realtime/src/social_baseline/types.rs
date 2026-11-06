use crate::realtime::FriendRosterSnapshot;
use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use vrcx_0_core::json::RawJson;

#[derive(Clone, Debug, Default, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteGroupOutput {
    pub assign: bool,
    pub key: String,
    #[serde(rename = "type")]
    pub type_name: String,
    pub name: String,
    pub display_name: String,
    pub capacity: i64,
    pub count: i64,
    pub visibility: String,
}

#[derive(Clone, Debug, Default, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteBaselineSnapshot {
    pub current_user_id: String,
    pub favorite_limits: RawJson,
    pub favorites_sort_order: Vec<String>,
    pub remote_favorites_by_id: BTreeMap<String, RawJson>,
    pub favorite_friend_ids: Vec<String>,
    pub grouped_favorite_friend_ids_by_group_key: BTreeMap<String, Vec<String>>,
    pub favorite_world_ids: Vec<String>,
    pub grouped_favorite_world_ids_by_group_key: BTreeMap<String, Vec<String>>,
    pub favorite_avatar_ids: Vec<String>,
    pub cached_favorite_groups_by_id: BTreeMap<String, RawJson>,
    pub favorite_friend_groups: Vec<FavoriteGroupOutput>,
    pub favorite_world_groups: Vec<FavoriteGroupOutput>,
    pub favorite_avatar_groups: Vec<FavoriteGroupOutput>,
    #[serde(skip)]
    pub local_world_favorites: BTreeMap<String, Vec<String>>,
    pub local_avatar_favorites: BTreeMap<String, Vec<String>>,
    pub local_friend_favorites: BTreeMap<String, Vec<String>>,
    pub local_avatar_favorite_groups: Vec<String>,
    pub local_friend_favorite_groups: Vec<String>,
    pub local_avatar_favorites_list: Vec<String>,
    pub local_friend_favorites_list: Vec<String>,
    pub detail: String,
}

impl FavoriteBaselineSnapshot {
    pub fn to_value(&self) -> Value {
        serde_json::to_value(self).expect("favorite baseline snapshot must serialize")
    }

    pub fn into_value(self) -> Value {
        serde_json::to_value(self).expect("favorite baseline snapshot must serialize")
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn favorite_baseline_serializes_only_frontend_owned_fields() {
        let snapshot = FavoriteBaselineSnapshot {
            remote_favorites_by_id: BTreeMap::from([(
                "fav_record".into(),
                RawJson::from(json!({
                    "id": "fav_record",
                    "favoriteId": "wrld_target",
                })),
            )]),
            local_world_favorites: BTreeMap::from([("Worlds".into(), vec!["wrld_local".into()])]),
            ..Default::default()
        };

        let serialized = snapshot.to_value();

        assert_eq!(
            serialized["remoteFavoritesById"]["fav_record"]["favoriteId"],
            "wrld_target"
        );
        assert!(serialized.get("localWorldFavorites").is_none());
    }
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SocialFavoritesBaselineInput {
    #[serde(default)]
    pub user_id: String,
    #[serde(default)]
    pub endpoint: String,
    #[serde(default)]
    pub current_user_snapshot: RawJson,
    #[serde(default)]
    pub friend_roster_by_id: RawJson,
}

pub struct SocialFavoritesBaselineRequest {
    pub user_id: String,
    pub endpoint: String,
    pub current_user_snapshot: RawJson,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SocialFavoritesBaselineOutput {
    pub user_id: String,
    pub stale: bool,
    pub count: u32,
    pub snapshot: Option<FavoriteBaselineSnapshot>,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SocialFriendRosterBaselineInput {
    #[serde(default)]
    pub user_id: String,
    #[serde(default)]
    pub endpoint: String,
    #[serde(default)]
    pub websocket: String,
    #[serde(default)]
    pub current_user_snapshot: RawJson,
    #[serde(default)]
    pub is_first_load: bool,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SocialFriendRosterBaselineOutput {
    pub user_id: String,
    pub stale: bool,
    pub count: u32,
    pub detail: String,
    pub snapshot: Option<FriendRosterSnapshot>,
    pub friend_log_changed: bool,
}
