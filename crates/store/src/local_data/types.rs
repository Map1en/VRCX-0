use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigWriteEntry {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigReadEntry {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheEntityInput {
    #[serde(default)]
    pub id: Value,
    #[serde(default)]
    pub author_id: Value,
    #[serde(default)]
    pub author_name: Value,
    #[serde(default)]
    pub created_at: Value,
    #[serde(default)]
    pub description: Value,
    #[serde(default)]
    pub image_url: Value,
    #[serde(default)]
    pub name: Value,
    #[serde(default)]
    pub release_status: Value,
    #[serde(default)]
    pub thumbnail_image_url: Value,
    #[serde(default)]
    pub updated_at: Value,
    #[serde(default)]
    pub version: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoSaveResult {
    pub entity_id: String,
    pub edited_at: String,
    pub memo: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AvatarTagInput {
    #[serde(default)]
    pub tag: String,
    #[serde(default)]
    pub color: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvatarCacheOutput {
    pub id: String,
    pub author_id: String,
    pub author_name: String,
    #[serde(rename = "created_at")]
    pub created_at: String,
    pub description: String,
    pub image_url: String,
    pub name: String,
    pub release_status: String,
    pub thumbnail_image_url: String,
    #[serde(rename = "updated_at")]
    pub updated_at: String,
    pub version: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvatarTimeSpentOutput {
    pub avatar_id: String,
    pub time_spent: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvatarTagOutput {
    pub avatar_id: String,
    pub tag: String,
    pub color: Value,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AvatarTagsPatchInput {
    #[serde(default)]
    pub previous_entries: Vec<AvatarTagInput>,
    #[serde(default)]
    pub next_entries: Vec<AvatarTagInput>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FriendLogHistoryEntryInput {
    #[serde(default)]
    pub row_id: Value,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub r#type: String,
    #[serde(default)]
    pub user_id: String,
    #[serde(default)]
    pub display_name: String,
    #[serde(default)]
    pub previous_display_name: String,
    #[serde(default)]
    pub trust_level: String,
    #[serde(default)]
    pub previous_trust_level: String,
    #[serde(default)]
    pub friend_number: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FriendLogCurrentEntryInput {
    #[serde(default)]
    pub user_id: String,
    #[serde(default)]
    pub display_name: String,
    #[serde(default)]
    pub trust_level: Option<String>,
    #[serde(default)]
    pub friend_number: Value,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FriendLogReplaceOptionsInput {
    #[serde(default)]
    pub history_entries: Vec<FriendLogHistoryEntryInput>,
    #[serde(default)]
    pub added_history_entries: Vec<FriendLogHistoryEntryInput>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FriendLogDeleteOptionsInput {
    #[serde(default)]
    pub history_entries: Vec<FriendLogHistoryEntryInput>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FriendLogUpsertOptionsInput {
    #[serde(default)]
    pub history_entry: Option<FriendLogHistoryEntryInput>,
    #[serde(default)]
    pub force_history: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FriendLogMutationResult {
    pub user_id: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub target_user_id: String,
    pub count: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inserted: Option<bool>,
    pub history_count: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalModerationInput {
    #[serde(default)]
    pub user_id: String,
    #[serde(default)]
    pub updated_at: String,
    #[serde(default)]
    pub display_name: String,
    #[serde(default)]
    pub block: bool,
    #[serde(default)]
    pub mute: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteModerationInput {
    #[serde(default)]
    pub r#type: String,
    #[serde(default)]
    pub target_user_id: String,
    #[serde(default)]
    pub target_display_name: String,
    #[serde(default)]
    pub created: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalModerationOutput {
    pub user_id: String,
    pub updated_at: String,
    pub display_name: String,
    pub block: bool,
    pub mute: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserMemoOutput {
    pub user_id: String,
    pub edited_at: String,
    pub memo: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldMemoOutput {
    pub world_id: String,
    pub edited_at: String,
    pub memo: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvatarMemoOutput {
    pub avatar_id: String,
    pub edited_at: String,
    pub memo: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserNoteOutput {
    pub user_id: String,
    pub display_name: String,
    pub note: String,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FriendLogCurrentOutput {
    pub user_id: String,
    pub display_name: String,
    pub trust_level: String,
    pub friend_number: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FriendLogHistoryQueryInput {
    pub user_id: String,
    #[serde(default)]
    pub target_user_id: String,
    #[serde(default)]
    pub types: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FriendLogHistoryOutput {
    pub row_id: i64,
    pub created_at: String,
    pub r#type: String,
    pub user_id: String,
    pub display_name: String,
    pub previous_display_name: String,
    pub trust_level: String,
    pub previous_trust_level: String,
    pub friend_number: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivitySelfSourceSliceInput {
    pub from_date_iso: String,
    #[serde(default)]
    pub to_date_iso: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivitySelfSourceAfterInput {
    pub after_created_at: String,
    #[serde(default)]
    pub inclusive: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityFriendPresenceSliceInput {
    pub owner_user_id: String,
    pub user_id: String,
    pub from_date_iso: String,
    #[serde(default)]
    pub to_date_iso: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityFriendPresenceAfterInput {
    pub owner_user_id: String,
    pub user_id: String,
    pub after_created_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivitySourceLocationOutput {
    #[serde(rename = "created_at")]
    pub created_at: String,
    pub time: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityPresenceOutput {
    #[serde(rename = "created_at")]
    pub created_at: String,
    pub r#type: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivitySyncStateOutput {
    pub user_id: String,
    pub updated_at: String,
    pub is_self: bool,
    pub source_last_created_at: String,
    pub pending_session_start_at: Value,
    pub cached_range_days: i64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivitySessionOutput {
    pub start: i64,
    pub end: i64,
    pub is_open_tail: bool,
    pub source_revision: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivitySelfSessionsRefreshInput {
    pub user_id: String,
    pub mode: String,
    #[serde(default)]
    pub range_days: Value,
    #[serde(default)]
    pub now_ms: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivitySelfSessionsRefreshOutput {
    pub sync: ActivitySyncStateOutput,
    pub sessions: Vec<ActivitySessionOutput>,
    pub source_count: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityBucketCacheQueryInput {
    pub owner_user_id: String,
    #[serde(default)]
    pub target_user_id: String,
    pub range_days: Value,
    pub view_kind: String,
    #[serde(default)]
    pub exclude_key: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityBucketCacheOutput {
    pub owner_user_id: String,
    pub target_user_id: String,
    pub range_days: i64,
    pub view_kind: String,
    pub exclude_key: String,
    pub bucket_version: i64,
    pub built_from_cursor: String,
    pub raw_buckets: Value,
    pub normalized_buckets: Value,
    pub summary: Value,
    pub built_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivitySyncStateInput {
    #[serde(default)]
    pub user_id: String,
    #[serde(default)]
    pub updated_at: String,
    #[serde(default)]
    pub is_self: bool,
    #[serde(default)]
    pub source_last_created_at: String,
    #[serde(default)]
    pub pending_session_start_at: Option<Value>,
    #[serde(default)]
    pub cached_range_days: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivitySessionInput {
    #[serde(default)]
    pub start: Value,
    #[serde(default)]
    pub end: Value,
    #[serde(default)]
    pub is_open_tail: bool,
    #[serde(default)]
    pub source_revision: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityBucketCacheInput {
    pub owner_user_id: String,
    #[serde(default)]
    pub target_user_id: String,
    pub range_days: Value,
    pub view_kind: String,
    #[serde(default)]
    pub exclude_key: String,
    #[serde(default)]
    pub bucket_version: Value,
    #[serde(default)]
    pub built_from_cursor: String,
    #[serde(default)]
    pub raw_buckets: Value,
    #[serde(default)]
    pub normalized_buckets: Value,
    #[serde(default)]
    pub summary: Value,
    #[serde(default)]
    pub built_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MutualGraphSnapshotEntryInput {
    pub friend_id: String,
    #[serde(default)]
    pub mutual_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MutualGraphMetaInput {
    pub friend_id: String,
    #[serde(default)]
    pub last_fetched_at: String,
    #[serde(default)]
    pub opted_out: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MutualGraphLinkOutput {
    pub friend_id: String,
    pub mutual_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MutualGraphMetaOutput {
    pub friend_id: String,
    pub last_fetched_at: String,
    pub opted_out: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MutualGraphSnapshotOutput {
    pub friend_ids: Vec<String>,
    pub links: Vec<MutualGraphLinkOutput>,
    pub meta: Vec<MutualGraphMetaOutput>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserTableContextOutput {
    pub user_id: String,
    pub user_prefix: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationRowsQueryInput {
    pub user_id: String,
    #[serde(default)]
    pub filters: Vec<String>,
    pub per_table_limit: i64,
    #[serde(default)]
    pub include_unseen: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct NotificationV1RowOutput {
    pub id: String,
    pub created_at: String,
    pub r#type: String,
    pub sender_user_id: String,
    pub sender_username: String,
    pub receiver_user_id: String,
    pub message: String,
    pub world_id: String,
    pub world_name: String,
    pub image_url: String,
    pub invite_message: String,
    pub request_message: String,
    pub response_message: String,
    pub expired: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct NotificationV2RowOutput {
    pub id: String,
    pub created_at: String,
    pub updated_at: String,
    pub expires_at: String,
    pub r#type: String,
    pub link: String,
    pub link_text: String,
    pub message: String,
    pub title: String,
    pub image_url: String,
    pub seen: i64,
    pub sender_user_id: String,
    pub sender_username: String,
    pub data: String,
    pub responses: String,
    pub details: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationRowsOutput {
    pub v1_rows: Vec<NotificationV1RowOutput>,
    pub v2_rows: Vec<NotificationV2RowOutput>,
    pub unseen_v2_rows: Vec<NotificationV2RowOutput>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationListQueryInput {
    pub user_id: String,
    #[serde(default)]
    pub search: String,
    #[serde(default)]
    pub filters: Vec<String>,
    #[serde(default)]
    pub per_table_limit: i64,
    #[serde(default)]
    pub limit: i64,
    #[serde(default)]
    pub include_unseen: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationListItemOutput {
    pub id: String,
    pub version: i64,
    pub created_at: String,
    #[serde(rename = "created_at")]
    pub created_at_legacy: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub updated_at: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub expires_at: String,
    pub r#type: String,
    pub link: String,
    pub link_text: String,
    pub message: String,
    pub title: String,
    pub image_url: String,
    pub seen: bool,
    pub sender_user_id: String,
    pub sender_username: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub receiver_user_id: String,
    pub data: Value,
    pub responses: Value,
    pub details: Value,
    pub expired: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MaintenanceTableSizesOutput {
    pub gps: i64,
    pub status: i64,
    pub bio: i64,
    pub avatar: i64,
    pub online_offline: i64,
    pub friend_log_history: i64,
    pub notification: i64,
    pub location: i64,
    pub join_leave: i64,
    pub portal_spawn: i64,
    pub video_play: i64,
    pub event: i64,
    pub external: i64,
    pub resource_load: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrokenGameLogDisplayNameOutput {
    pub id: Value,
    pub display_name: Value,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedRowsQueryInput {
    pub user_id: String,
    pub mode: String,
    #[serde(default)]
    pub search: String,
    #[serde(default)]
    pub filters: Vec<String>,
    #[serde(default)]
    pub vip_list: Vec<String>,
    pub max_entries: i64,
    #[serde(default)]
    pub date_from: String,
    #[serde(default)]
    pub date_to: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedLiveEntryInput {
    pub sequence: i64,
    #[serde(default)]
    pub entry: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedReadModelQueryInput {
    pub user_id: String,
    pub mode: String,
    #[serde(default)]
    pub search: String,
    #[serde(default)]
    pub filters: Vec<String>,
    #[serde(default)]
    pub vip_list: Vec<String>,
    #[serde(default)]
    pub max_entries: i64,
    #[serde(default)]
    pub date_from: String,
    #[serde(default)]
    pub date_to: String,
    #[serde(default)]
    pub live_entries: Vec<FeedLiveEntryInput>,
    #[serde(default)]
    pub min_live_sequence: i64,
    #[serde(default)]
    pub favorites_only: bool,
    #[serde(default)]
    pub favorite_user_ids: Vec<String>,
    #[serde(default)]
    pub max_rows: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedLiveRowsMergeInput {
    #[serde(default)]
    pub rows: Vec<Value>,
    #[serde(default)]
    pub current_user_id: String,
    #[serde(default)]
    pub filters: Vec<String>,
    #[serde(default)]
    pub search: String,
    #[serde(default)]
    pub date_from: String,
    #[serde(default)]
    pub date_to: String,
    #[serde(default)]
    pub favorites_only: bool,
    #[serde(default)]
    pub favorite_user_ids: Vec<String>,
    #[serde(default)]
    pub live_entries: Vec<FeedLiveEntryInput>,
    #[serde(default)]
    pub min_live_sequence: i64,
    #[serde(default)]
    pub max_rows: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedReadModelOutput {
    pub rows: Vec<Value>,
    pub max_sequence: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedRowOutput {
    pub row_id: Value,
    #[serde(rename = "created_at")]
    pub created_at: Value,
    pub user_id: Value,
    pub display_name: Value,
    pub r#type: Value,
    pub location: Value,
    pub world_name: Value,
    pub previous_location: Value,
    pub time: Value,
    pub group_name: Value,
    pub status: Value,
    pub status_description: Value,
    pub previous_status: Value,
    pub previous_status_description: Value,
    pub bio: Value,
    pub previous_bio: Value,
    pub owner_id: Value,
    pub avatar_name: Value,
    pub current_avatar_image_url: Value,
    pub current_avatar_thumbnail_image_url: Value,
    pub previous_current_avatar_image_url: Value,
    pub previous_current_avatar_thumbnail_image_url: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameLogQueryInput {
    pub kind: String,
    #[serde(default)]
    pub params: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerLocationOutput {
    pub created_at: String,
    pub location: String,
    pub world_id: String,
    pub world_name: String,
    pub time: i64,
    pub group_name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerJoinLeaveOutput {
    pub id: i64,
    pub created_at: String,
    pub r#type: String,
    pub display_name: String,
    pub user_id: String,
    pub time: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceActivityRowOutput {
    pub id: i64,
    pub created_at: String,
    pub r#type: String,
    pub display_name: String,
    pub location: String,
    pub user_id: String,
    pub time: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldSummaryOutput {
    pub id: String,
    pub author_id: String,
    pub author_name: String,
    #[serde(rename = "created_at")]
    pub created_at: String,
    pub description: String,
    pub image_url: String,
    pub name: String,
    pub release_status: String,
    pub thumbnail_image_url: String,
    #[serde(rename = "updated_at")]
    pub updated_at: String,
    pub version: i64,
}
