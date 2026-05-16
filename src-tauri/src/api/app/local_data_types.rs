use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigWriteEntry {
    pub(crate) key: String,
    pub(crate) value: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigReadEntry {
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvatarCacheOutput {
    pub(crate) id: String,
    pub(crate) author_id: String,
    pub(crate) author_name: String,
    #[serde(rename = "created_at")]
    pub(crate) created_at: String,
    pub(crate) description: String,
    pub(crate) image_url: String,
    pub(crate) name: String,
    pub(crate) release_status: String,
    pub(crate) thumbnail_image_url: String,
    #[serde(rename = "updated_at")]
    pub(crate) updated_at: String,
    pub(crate) version: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvatarTimeSpentOutput {
    pub(crate) avatar_id: String,
    pub(crate) time_spent: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvatarTagOutput {
    pub(crate) avatar_id: String,
    pub(crate) tag: String,
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserMemoOutput {
    pub(crate) user_id: String,
    pub(crate) edited_at: String,
    pub(crate) memo: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldMemoOutput {
    pub(crate) world_id: String,
    pub(crate) edited_at: String,
    pub(crate) memo: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvatarMemoOutput {
    pub(crate) avatar_id: String,
    pub(crate) edited_at: String,
    pub(crate) memo: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserNoteOutput {
    pub(crate) user_id: String,
    pub(crate) display_name: String,
    pub(crate) note: String,
    pub(crate) created_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FriendLogCurrentOutput {
    pub(crate) user_id: String,
    pub(crate) display_name: String,
    pub(crate) trust_level: String,
    pub(crate) friend_number: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FriendLogHistoryQueryInput {
    pub(crate) user_id: String,
    #[serde(default)]
    pub(crate) target_user_id: String,
    #[serde(default)]
    pub(crate) types: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FriendLogHistoryOutput {
    pub(crate) row_id: i64,
    pub(crate) created_at: String,
    pub(crate) r#type: String,
    pub(crate) user_id: String,
    pub(crate) display_name: String,
    pub(crate) previous_display_name: String,
    pub(crate) trust_level: String,
    pub(crate) previous_trust_level: String,
    pub(crate) friend_number: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivitySelfSourceSliceInput {
    pub(crate) from_date_iso: String,
    #[serde(default)]
    pub(crate) to_date_iso: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivitySelfSourceAfterInput {
    pub(crate) after_created_at: String,
    #[serde(default)]
    pub(crate) inclusive: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityFriendPresenceSliceInput {
    pub(crate) owner_user_id: String,
    pub(crate) user_id: String,
    pub(crate) from_date_iso: String,
    #[serde(default)]
    pub(crate) to_date_iso: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityFriendPresenceAfterInput {
    pub(crate) owner_user_id: String,
    pub(crate) user_id: String,
    pub(crate) after_created_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivitySourceLocationOutput {
    #[serde(rename = "created_at")]
    pub(crate) created_at: String,
    pub(crate) time: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityPresenceOutput {
    #[serde(rename = "created_at")]
    pub(crate) created_at: String,
    pub(crate) r#type: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivitySyncStateOutput {
    pub(crate) user_id: String,
    pub(crate) updated_at: String,
    pub(crate) is_self: bool,
    pub(crate) source_last_created_at: String,
    pub(crate) pending_session_start_at: Value,
    pub(crate) cached_range_days: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivitySessionOutput {
    pub(crate) start: i64,
    pub(crate) end: i64,
    pub(crate) is_open_tail: bool,
    pub(crate) source_revision: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityBucketCacheQueryInput {
    pub(crate) owner_user_id: String,
    #[serde(default)]
    pub(crate) target_user_id: String,
    pub(crate) range_days: Value,
    pub(crate) view_kind: String,
    #[serde(default)]
    pub(crate) exclude_key: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityBucketCacheOutput {
    pub(crate) owner_user_id: String,
    pub(crate) target_user_id: String,
    pub(crate) range_days: i64,
    pub(crate) view_kind: String,
    pub(crate) exclude_key: String,
    pub(crate) bucket_version: i64,
    pub(crate) built_from_cursor: String,
    pub(crate) raw_buckets: Value,
    pub(crate) normalized_buckets: Value,
    pub(crate) summary: Value,
    pub(crate) built_at: String,
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
pub struct MutualGraphLinkOutput {
    pub(crate) friend_id: String,
    pub(crate) mutual_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MutualGraphMetaOutput {
    pub(crate) friend_id: String,
    pub(crate) last_fetched_at: String,
    pub(crate) opted_out: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MutualGraphSnapshotOutput {
    pub(crate) friend_ids: Vec<String>,
    pub(crate) links: Vec<MutualGraphLinkOutput>,
    pub(crate) meta: Vec<MutualGraphMetaOutput>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserTableContextOutput {
    pub(crate) user_id: String,
    pub(crate) user_prefix: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationRowsQueryInput {
    pub(crate) user_id: String,
    #[serde(default)]
    pub(crate) filters: Vec<String>,
    pub(crate) per_table_limit: i64,
    #[serde(default)]
    pub(crate) include_unseen: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct NotificationV1RowOutput {
    pub(crate) id: String,
    pub(crate) created_at: String,
    pub(crate) r#type: String,
    pub(crate) sender_user_id: String,
    pub(crate) sender_username: String,
    pub(crate) receiver_user_id: String,
    pub(crate) message: String,
    pub(crate) world_id: String,
    pub(crate) world_name: String,
    pub(crate) image_url: String,
    pub(crate) invite_message: String,
    pub(crate) request_message: String,
    pub(crate) response_message: String,
    pub(crate) expired: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct NotificationV2RowOutput {
    pub(crate) id: String,
    pub(crate) created_at: String,
    pub(crate) updated_at: String,
    pub(crate) expires_at: String,
    pub(crate) r#type: String,
    pub(crate) link: String,
    pub(crate) link_text: String,
    pub(crate) message: String,
    pub(crate) title: String,
    pub(crate) image_url: String,
    pub(crate) seen: i64,
    pub(crate) sender_user_id: String,
    pub(crate) sender_username: String,
    pub(crate) data: String,
    pub(crate) responses: String,
    pub(crate) details: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationRowsOutput {
    pub(crate) v1_rows: Vec<NotificationV1RowOutput>,
    pub(crate) v2_rows: Vec<NotificationV2RowOutput>,
    pub(crate) unseen_v2_rows: Vec<NotificationV2RowOutput>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MaintenanceTableSizesOutput {
    pub(crate) gps: i64,
    pub(crate) status: i64,
    pub(crate) bio: i64,
    pub(crate) avatar: i64,
    pub(crate) online_offline: i64,
    pub(crate) friend_log_history: i64,
    pub(crate) notification: i64,
    pub(crate) location: i64,
    pub(crate) join_leave: i64,
    pub(crate) portal_spawn: i64,
    pub(crate) video_play: i64,
    pub(crate) event: i64,
    pub(crate) external: i64,
    pub(crate) resource_load: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrokenGameLogDisplayNameOutput {
    pub(crate) id: Value,
    pub(crate) display_name: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedRowsQueryInput {
    pub(crate) user_id: String,
    pub(crate) mode: String,
    #[serde(default)]
    pub(crate) search: String,
    #[serde(default)]
    pub(crate) filters: Vec<String>,
    #[serde(default)]
    pub(crate) vip_list: Vec<String>,
    pub(crate) max_entries: i64,
    #[serde(default)]
    pub(crate) date_from: String,
    #[serde(default)]
    pub(crate) date_to: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedRowOutput {
    pub(crate) row_id: Value,
    #[serde(rename = "created_at")]
    pub(crate) created_at: Value,
    pub(crate) user_id: Value,
    pub(crate) display_name: Value,
    pub(crate) r#type: Value,
    pub(crate) location: Value,
    pub(crate) world_name: Value,
    pub(crate) previous_location: Value,
    pub(crate) time: Value,
    pub(crate) group_name: Value,
    pub(crate) status: Value,
    pub(crate) status_description: Value,
    pub(crate) previous_status: Value,
    pub(crate) previous_status_description: Value,
    pub(crate) bio: Value,
    pub(crate) previous_bio: Value,
    pub(crate) owner_id: Value,
    pub(crate) avatar_name: Value,
    pub(crate) current_avatar_image_url: Value,
    pub(crate) current_avatar_thumbnail_image_url: Value,
    pub(crate) previous_current_avatar_image_url: Value,
    pub(crate) previous_current_avatar_thumbnail_image_url: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameLogQueryInput {
    pub(crate) kind: String,
    #[serde(default)]
    pub(crate) params: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerLocationOutput {
    pub(crate) created_at: String,
    pub(crate) location: String,
    pub(crate) world_id: String,
    pub(crate) world_name: String,
    pub(crate) time: i64,
    pub(crate) group_name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerJoinLeaveOutput {
    pub(crate) id: i64,
    pub(crate) created_at: String,
    pub(crate) r#type: String,
    pub(crate) display_name: String,
    pub(crate) user_id: String,
    pub(crate) time: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceActivityRowOutput {
    pub(crate) id: i64,
    pub(crate) created_at: String,
    pub(crate) r#type: String,
    pub(crate) display_name: String,
    pub(crate) location: String,
    pub(crate) user_id: String,
    pub(crate) time: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldSummaryOutput {
    pub(crate) id: String,
    pub(crate) author_id: String,
    pub(crate) author_name: String,
    #[serde(rename = "created_at")]
    pub(crate) created_at: String,
    pub(crate) description: String,
    pub(crate) image_url: String,
    pub(crate) name: String,
    pub(crate) release_status: String,
    pub(crate) thumbnail_image_url: String,
    #[serde(rename = "updated_at")]
    pub(crate) updated_at: String,
    pub(crate) version: i64,
}
