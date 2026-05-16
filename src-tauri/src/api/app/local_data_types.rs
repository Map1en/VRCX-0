use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigWriteEntry {
    pub(crate) key: String,
    pub(crate) value: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheEntityInput {
    #[serde(default)]
    pub(crate) id: Value,
    #[serde(default)]
    pub(crate) author_id: Value,
    #[serde(default)]
    pub(crate) author_name: Value,
    #[serde(default)]
    pub(crate) created_at: Value,
    #[serde(default)]
    pub(crate) description: Value,
    #[serde(default)]
    pub(crate) image_url: Value,
    #[serde(default)]
    pub(crate) name: Value,
    #[serde(default)]
    pub(crate) release_status: Value,
    #[serde(default)]
    pub(crate) thumbnail_image_url: Value,
    #[serde(default)]
    pub(crate) updated_at: Value,
    #[serde(default)]
    pub(crate) version: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoSaveResult {
    pub(crate) entity_id: String,
    pub(crate) edited_at: String,
    pub(crate) memo: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AvatarTagInput {
    #[serde(default)]
    pub(crate) tag: String,
    #[serde(default)]
    pub(crate) color: Value,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AvatarTagsPatchInput {
    #[serde(default)]
    pub(crate) previous_entries: Vec<AvatarTagInput>,
    #[serde(default)]
    pub(crate) next_entries: Vec<AvatarTagInput>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FriendLogHistoryEntryInput {
    #[serde(default)]
    pub(crate) row_id: Value,
    #[serde(default)]
    pub(crate) created_at: String,
    #[serde(default)]
    pub(crate) r#type: String,
    #[serde(default)]
    pub(crate) user_id: String,
    #[serde(default)]
    pub(crate) display_name: String,
    #[serde(default)]
    pub(crate) previous_display_name: String,
    #[serde(default)]
    pub(crate) trust_level: String,
    #[serde(default)]
    pub(crate) previous_trust_level: String,
    #[serde(default)]
    pub(crate) friend_number: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FriendLogCurrentEntryInput {
    #[serde(default)]
    pub(crate) user_id: String,
    #[serde(default)]
    pub(crate) display_name: String,
    #[serde(default)]
    pub(crate) trust_level: Option<String>,
    #[serde(default)]
    pub(crate) friend_number: Value,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FriendLogReplaceOptionsInput {
    #[serde(default)]
    pub(crate) history_entries: Vec<FriendLogHistoryEntryInput>,
    #[serde(default)]
    pub(crate) added_history_entries: Vec<FriendLogHistoryEntryInput>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FriendLogDeleteOptionsInput {
    #[serde(default)]
    pub(crate) history_entries: Vec<FriendLogHistoryEntryInput>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FriendLogUpsertOptionsInput {
    #[serde(default)]
    pub(crate) history_entry: Option<FriendLogHistoryEntryInput>,
    #[serde(default)]
    pub(crate) force_history: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FriendLogMutationResult {
    pub(crate) user_id: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub(crate) target_user_id: String,
    pub(crate) count: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) inserted: Option<bool>,
    pub(crate) history_count: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalModerationInput {
    #[serde(default)]
    pub(crate) user_id: String,
    #[serde(default)]
    pub(crate) updated_at: String,
    #[serde(default)]
    pub(crate) display_name: String,
    #[serde(default)]
    pub(crate) block: bool,
    #[serde(default)]
    pub(crate) mute: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteModerationInput {
    #[serde(default)]
    pub(crate) r#type: String,
    #[serde(default)]
    pub(crate) target_user_id: String,
    #[serde(default)]
    pub(crate) target_display_name: String,
    #[serde(default)]
    pub(crate) created: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalModerationOutput {
    pub(crate) user_id: String,
    pub(crate) updated_at: String,
    pub(crate) display_name: String,
    pub(crate) block: bool,
    pub(crate) mute: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivitySyncStateInput {
    #[serde(default)]
    pub(crate) user_id: String,
    #[serde(default)]
    pub(crate) updated_at: String,
    #[serde(default)]
    pub(crate) is_self: bool,
    #[serde(default)]
    pub(crate) source_last_created_at: String,
    #[serde(default)]
    pub(crate) pending_session_start_at: Option<Value>,
    #[serde(default)]
    pub(crate) cached_range_days: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivitySessionInput {
    #[serde(default)]
    pub(crate) start: Value,
    #[serde(default)]
    pub(crate) end: Value,
    #[serde(default)]
    pub(crate) is_open_tail: bool,
    #[serde(default)]
    pub(crate) source_revision: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityBucketCacheInput {
    pub(crate) owner_user_id: String,
    #[serde(default)]
    pub(crate) target_user_id: String,
    pub(crate) range_days: Value,
    pub(crate) view_kind: String,
    #[serde(default)]
    pub(crate) exclude_key: String,
    #[serde(default)]
    pub(crate) bucket_version: Value,
    #[serde(default)]
    pub(crate) built_from_cursor: String,
    #[serde(default)]
    pub(crate) raw_buckets: Value,
    #[serde(default)]
    pub(crate) normalized_buckets: Value,
    #[serde(default)]
    pub(crate) summary: Value,
    #[serde(default)]
    pub(crate) built_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MutualGraphSnapshotEntryInput {
    pub(crate) friend_id: String,
    #[serde(default)]
    pub(crate) mutual_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MutualGraphMetaInput {
    pub(crate) friend_id: String,
    #[serde(default)]
    pub(crate) last_fetched_at: String,
    #[serde(default)]
    pub(crate) opted_out: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserTableContextOutput {
    pub(crate) user_id: String,
    pub(crate) user_prefix: String,
}
