use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendFavoritesBaselineInput {
    #[serde(default)]
    pub(crate) user_id: String,
    #[serde(default)]
    pub(crate) endpoint: String,
    #[serde(default)]
    pub(crate) current_user_snapshot: Value,
    #[serde(default)]
    pub(crate) friend_roster_by_id: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendFavoritesBaselineOutput {
    pub(crate) user_id: String,
    pub(crate) stale: bool,
    pub(crate) count: usize,
    pub(crate) snapshot: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendFriendRosterBaselineInput {
    #[serde(default)]
    pub(crate) user_id: String,
    #[serde(default)]
    pub(crate) endpoint: String,
    #[serde(default)]
    pub(crate) current_user_snapshot: Value,
    #[serde(default)]
    pub(crate) explicit_add_intent_user_ids: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendFriendRosterBaselineOutput {
    pub(crate) user_id: String,
    pub(crate) stale: bool,
    pub(crate) count: usize,
    pub(crate) detail: String,
    pub(crate) snapshot: Option<Value>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FavoriteGroupOutput {
    pub(crate) assign: bool,
    pub(crate) key: String,
    #[serde(rename = "type")]
    pub(crate) type_name: String,
    pub(crate) name: String,
    pub(crate) display_name: String,
    pub(crate) capacity: i64,
    pub(crate) count: i64,
    pub(crate) visibility: String,
}

#[derive(Clone, Debug)]
pub(crate) struct TrustLevelInfo {
    pub(crate) trust_level: String,
    pub(crate) trust_class: String,
    pub(crate) trust_sort_num: f64,
    pub(crate) is_moderator: bool,
    pub(crate) is_troll: bool,
    pub(crate) is_probable_troll: bool,
}

#[derive(Clone, Debug, Default)]
pub(crate) struct RemoteFavoriteSnapshot {
    pub(crate) remote_favorites_by_id: Map<String, Value>,
    pub(crate) remote_favorites_by_object_id: Map<String, Value>,
    pub(crate) favorites_sort_order: Vec<String>,
    pub(crate) favorite_friend_ids: Vec<String>,
    pub(crate) favorite_world_ids: Vec<String>,
    pub(crate) favorite_avatar_ids: Vec<String>,
    pub(crate) grouped_favorite_friend_ids_by_group_key: Map<String, Value>,
}
