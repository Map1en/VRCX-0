use serde::{de::Error as _, Deserialize, Deserializer, Serialize};
use vrcx_0_core::friends::UserStatus;

fn deserialize_optional_nonnegative_i32<'de, D>(
    deserializer: D,
) -> std::result::Result<Option<i32>, D::Error>
where
    D: Deserializer<'de>,
{
    let value = Option::<i32>::deserialize(deserializer)?;
    if value.is_some_and(|value| value < 0) {
        return Err(D::Error::custom("value must be non-negative"));
    }
    Ok(value)
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
pub enum AvatarListSort {
    #[serde(rename = "created")]
    Created,
    #[serde(rename = "updated")]
    Updated,
    #[serde(rename = "order")]
    Order,
    #[serde(rename = "_created_at")]
    CreatedAt,
    #[serde(rename = "_updated_at")]
    UpdatedAt,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum AvatarReleaseStatus {
    Public,
    Private,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AvatarUpdateRequest {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub primary_style: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub secondary_style: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub release_status: Option<AvatarReleaseStatus>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
pub enum UserSearchCustomField {
    #[serde(rename = "bio")]
    Bio,
    #[serde(rename = "displayName")]
    DisplayName,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
pub enum UserSearchSort {
    #[serde(rename = "_created_at")]
    CreatedAt,
    #[serde(rename = "created")]
    Created,
    #[serde(rename = "last_login")]
    LastLogin,
    #[serde(rename = "nuisanceFactor")]
    NuisanceFactor,
    #[serde(rename = "relevance")]
    Relevance,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorldSearchParams {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub featured: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sort: Option<WorldSearchSort>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_id: Option<String>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_nonnegative_i32"
    )]
    pub n: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub order: Option<QueryOrder>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_nonnegative_i32"
    )]
    pub offset: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub search: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tag: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notag: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub release_status: Option<ReleaseStatusFilter>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_unity_version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_unity_version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub platform: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub noplatform: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fuzzy: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub avatar_specific: Option<bool>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UserSearchParams {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub search: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub developer_type: Option<String>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_nonnegative_i32"
    )]
    pub n: Option<i32>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_nonnegative_i32"
    )]
    pub offset: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_internal_variant: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom_fields: Option<UserSearchCustomField>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sort: Option<UserSearchSort>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub order: Option<QueryOrder>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GroupSearchParams {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub query: Option<String>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_nonnegative_i32"
    )]
    pub offset: Option<i32>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_nonnegative_i32"
    )]
    pub n: Option<i32>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
pub enum InstanceCreateType {
    #[serde(rename = "friends")]
    Friends,
    #[serde(rename = "group")]
    Group,
    #[serde(rename = "hidden")]
    Hidden,
    #[serde(rename = "private")]
    Private,
    #[serde(rename = "public")]
    Public,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
pub enum InstanceCreateRegion {
    #[serde(rename = "eu")]
    Eu,
    #[serde(rename = "jp")]
    Jp,
    #[serde(rename = "us")]
    Us,
    #[serde(rename = "use")]
    Use,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
pub enum InstanceCreateGroupAccessType {
    #[serde(rename = "members")]
    Members,
    #[serde(rename = "plus")]
    Plus,
    #[serde(rename = "public")]
    Public,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
pub enum InstanceCreateMinimumAvatarPerformance {
    Poor,
    Medium,
    Good,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InstanceCreateRequest {
    #[serde(rename = "type")]
    pub r#type: InstanceCreateType,
    pub can_request_invite: bool,
    pub world_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub owner_id: Option<String>,
    pub region: InstanceCreateRegion,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group_access_type: Option<InstanceCreateGroupAccessType>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub queue_enabled: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role_ids: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub age_gate: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub minimum_avatar_performance: Option<InstanceCreateMinimumAvatarPerformance>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RequestInviteRequest {
    #[serde(default)]
    pub request_slot: Option<i32>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum MediaFileTag {
    Gallery,
    AvatarGallery,
    Icon,
    Emoji,
    EmojiAnimated,
    Sticker,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MediaFileListParams {
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_nonnegative_i32"
    )]
    pub n: Option<i32>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_nonnegative_i32"
    )]
    pub offset: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tag: Option<MediaFileTag>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum ImageAnimationStyle {
    Aura,
    Bats,
    Bees,
    Bounce,
    Cloud,
    Confetti,
    Crying,
    Dislike,
    Fire,
    Idea,
    Lasers,
    Like,
    Magnet,
    Mistletoe,
    Money,
    Noise,
    Orbit,
    Pizza,
    Rain,
    Rotate,
    Shake,
    Snow,
    Snowball,
    Spin,
    Splash,
    Stop,
    Zzz,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum ImageMaskTag {
    Square,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum EmojiLoopStyle {
    PingPong,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(tag = "tag", rename_all = "lowercase", deny_unknown_fields)]
pub enum EmojiUploadParams {
    #[serde(rename_all = "camelCase")]
    Emoji {
        animation_style: ImageAnimationStyle,
        mask_tag: ImageMaskTag,
    },
    #[serde(rename_all = "camelCase")]
    EmojiAnimated {
        animation_style: ImageAnimationStyle,
        mask_tag: ImageMaskTag,
        #[serde(deserialize_with = "deserialize_emoji_frame_count")]
        frames: i32,
        #[serde(deserialize_with = "deserialize_emoji_frames_per_second")]
        frames_over_time: i32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        loop_style: Option<EmojiLoopStyle>,
    },
}

fn deserialize_bounded_i32<'de, D>(
    deserializer: D,
    minimum: i32,
    maximum: i32,
    field: &str,
) -> std::result::Result<i32, D::Error>
where
    D: Deserializer<'de>,
{
    let value = i32::deserialize(deserializer)?;
    if (minimum..=maximum).contains(&value) {
        return Ok(value);
    }
    Err(D::Error::custom(format!(
        "{field} must be between {minimum} and {maximum}"
    )))
}

fn deserialize_emoji_frame_count<'de, D>(deserializer: D) -> std::result::Result<i32, D::Error>
where
    D: Deserializer<'de>,
{
    deserialize_bounded_i32(deserializer, 2, 64, "frames")
}

fn deserialize_emoji_frames_per_second<'de, D>(
    deserializer: D,
) -> std::result::Result<i32, D::Error>
where
    D: Deserializer<'de>,
{
    deserialize_bounded_i32(deserializer, 1, 64, "framesOverTime")
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PrintUploadParams {
    pub note: String,
    pub timestamp: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum InventoryOrder {
    Newest,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InventoryListParams {
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_nonnegative_i32"
    )]
    pub n: Option<i32>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_nonnegative_i32"
    )]
    pub offset: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub holder_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub equip_slot: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub order: Option<InventoryOrder>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tags: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub types: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub flags: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub not_types: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub not_flags: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub archived: Option<bool>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ProfileDecorationEquipSlot {
    IconFrame,
    ProfileEffect,
    NameplateEffect,
}

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(tag = "assetKind", rename_all = "camelCase", deny_unknown_fields)]
pub enum MediaAssetUploadRequest {
    #[serde(rename_all = "camelCase")]
    Gallery { image_data: String },
    #[serde(rename_all = "camelCase")]
    Icons { image_data: String },
    #[serde(rename_all = "camelCase")]
    Emojis {
        image_data: String,
        params: EmojiUploadParams,
    },
    #[serde(rename_all = "camelCase")]
    Stickers { image_data: String },
    #[serde(rename_all = "camelCase")]
    Prints {
        image_data: String,
        crop_white_border: bool,
        params: PrintUploadParams,
    },
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InventoryItemUpdateRequest {
    pub is_archived: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum GroupCalendarEventAccessType {
    Group,
    Public,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum GroupCalendarRecurrenceFrequency {
    Weekly,
    Monthly,
    Yearly,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum GroupCalendarRecurrenceEnd {
    AfterOccurrences { count: u32 },
    AfterDate { date: String },
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GroupCalendarRecurrence {
    pub frequency: GroupCalendarRecurrenceFrequency,
    pub interval: u32,
    pub timezone: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub days_of_week: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end: Option<GroupCalendarRecurrenceEnd>,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
pub enum GroupMemberSort {
    #[serde(rename = "joinedAt:asc")]
    JoinedAtAsc,
    #[default]
    #[serde(rename = "joinedAt:desc")]
    JoinedAtDesc,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
pub enum GroupPostVisibility {
    #[serde(rename = "group")]
    Group,
    #[serde(rename = "public")]
    Public,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GroupPostMutation {
    pub title: String,
    pub text: String,
    pub send_notification: bool,
    pub visibility: GroupPostVisibility,
    #[serde(default)]
    pub role_ids: Vec<String>,
    pub image_id: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
pub enum GroupProfileJoinState {
    #[serde(rename = "closed")]
    Closed,
    #[serde(rename = "invite")]
    Invite,
    #[serde(rename = "open")]
    Open,
    #[serde(rename = "request")]
    Request,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GroupProfileUpdate {
    pub name: String,
    pub short_code: String,
    pub description: String,
    pub join_state: GroupProfileJoinState,
    pub languages: Vec<String>,
    pub rules: String,
    pub links: Vec<String>,
    pub icon_id: Option<String>,
    pub banner_id: Option<String>,
    pub allow_group_join_prompt: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
pub enum GroupMemberVisibility {
    #[serde(rename = "friends")]
    Friends,
    #[serde(rename = "hidden")]
    Hidden,
    #[serde(rename = "visible")]
    Visible,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GroupMemberPatch {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_subscribed_to_announcements: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_subscribed_to_event_announcements: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub manager_notes: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visibility: Option<GroupMemberVisibility>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GroupGalleryMutation {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub members_only: bool,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GroupRoleMutation {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_self_assignable: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_added_on_join: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub requires_two_factor: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub requires_purchase: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub permissions: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub order: Option<i32>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GroupCalendarEventMutation {
    pub title: String,
    pub description: String,
    pub starts_at: String,
    pub ends_at: String,
    pub category: String,
    pub access_type: GroupCalendarEventAccessType,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub languages: Vec<String>,
    #[serde(default)]
    pub platforms: Vec<String>,
    #[serde(default)]
    pub role_ids: Vec<String>,
    pub image_id: Option<String>,
    #[serde(default)]
    pub send_creation_notification: bool,
    pub host_early_join_minutes: u32,
    pub guest_early_join_minutes: u32,
    pub close_instance_after_end_minutes: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recurrence: Option<GroupCalendarRecurrence>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CalendarListParams {
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_nonnegative_i32"
    )]
    pub n: Option<i32>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_nonnegative_i32"
    )]
    pub offset: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub date: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum InviteMessageType {
    Message,
    Request,
    RequestResponse,
    Response,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ModerationReportType {
    Avatar,
    Group,
    User,
    World,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
pub enum QueryOrder {
    #[serde(rename = "ascending")]
    Ascending,
    #[serde(rename = "descending")]
    Descending,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
pub enum ReleaseStatusFilter {
    #[serde(rename = "all")]
    All,
    #[serde(rename = "hidden")]
    Hidden,
    #[serde(rename = "private")]
    Private,
    #[serde(rename = "public")]
    Public,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
pub enum WorldSearchSort {
    #[serde(rename = "_created_at")]
    CreatedAt,
    #[serde(rename = "_updated_at")]
    UpdatedAt,
    #[serde(rename = "created")]
    Created,
    #[serde(rename = "favorites")]
    Favorites,
    #[serde(rename = "heat")]
    Heat,
    #[serde(rename = "labsPublicationDate")]
    LabsPublicationDate,
    #[serde(rename = "magic")]
    Magic,
    #[serde(rename = "name")]
    Name,
    #[serde(rename = "order")]
    Order,
    #[serde(rename = "popularity")]
    Popularity,
    #[serde(rename = "publicationDate")]
    PublicationDate,
    #[serde(rename = "random")]
    Random,
    #[serde(rename = "relevance")]
    Relevance,
    #[serde(rename = "reportCount")]
    ReportCount,
    #[serde(rename = "reportScore")]
    ReportScore,
    #[serde(rename = "shuffle")]
    Shuffle,
    #[serde(rename = "trust")]
    Trust,
    #[serde(rename = "updated")]
    Updated,
}

impl ProfileDecorationEquipSlot {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::IconFrame => "iconFrame",
            Self::ProfileEffect => "profileEffect",
            Self::NameplateEffect => "nameplateEffect",
        }
    }
}

impl AvatarListSort {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Created => "created",
            Self::Updated => "updated",
            Self::Order => "order",
            Self::CreatedAt => "_created_at",
            Self::UpdatedAt => "_updated_at",
        }
    }
}

impl QueryOrder {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Ascending => "ascending",
            Self::Descending => "descending",
        }
    }
}

impl ReleaseStatusFilter {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::All => "all",
            Self::Hidden => "hidden",
            Self::Private => "private",
            Self::Public => "public",
        }
    }
}

impl WorldSearchSort {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::CreatedAt => "_created_at",
            Self::UpdatedAt => "_updated_at",
            Self::Created => "created",
            Self::Favorites => "favorites",
            Self::Heat => "heat",
            Self::LabsPublicationDate => "labsPublicationDate",
            Self::Magic => "magic",
            Self::Name => "name",
            Self::Order => "order",
            Self::Popularity => "popularity",
            Self::PublicationDate => "publicationDate",
            Self::Random => "random",
            Self::Relevance => "relevance",
            Self::ReportCount => "reportCount",
            Self::ReportScore => "reportScore",
            Self::Shuffle => "shuffle",
            Self::Trust => "trust",
            Self::Updated => "updated",
        }
    }
}

impl InviteMessageType {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Message => "message",
            Self::Request => "request",
            Self::RequestResponse => "requestResponse",
            Self::Response => "response",
        }
    }
}

impl ModerationReportType {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Avatar => "avatar",
            Self::Group => "group",
            Self::User => "user",
            Self::World => "world",
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorldUpdateRequest {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_nonnegative_i32"
    )]
    pub capacity: Option<i32>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_nonnegative_i32"
    )]
    pub recommended_capacity: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preview_youtube_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url_list: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub disabled_prop_abilities: Option<Vec<String>>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
pub enum ContentFilter {
    #[serde(rename = "content_adult")]
    Adult,
    #[serde(rename = "content_gore")]
    Gore,
    #[serde(rename = "content_horror")]
    Horror,
    #[serde(rename = "content_sex")]
    Sex,
    #[serde(rename = "content_violence")]
    Violence,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ProfileBackgroundType {
    Default,
    Gradient,
    Texture,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ProfileBannerType {
    AvatarBanner,
    CustomImage,
    Color,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CurrentUserProfileUpdateRequest {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bio: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bio_links: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_icon: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub banner_type: Option<ProfileBannerType>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub banner_custom_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub banner_color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub background_type: Option<ProfileBackgroundType>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub background_gradient_bottom: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub background_gradient_top: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub background_texture_id: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CurrentUserUpdateRequest {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub home_location: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<UserStatus>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status_description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pronouns: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub allow_avatar_copying: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_booping_enabled: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub has_shared_connections_opt_out: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub has_discord_friends_opt_out: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_filters: Option<Vec<ContentFilter>>,
}

#[cfg(test)]
mod tests;
