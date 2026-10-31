use serde::{de::Error as _, Deserialize, Deserializer, Serialize};
pub use vrcx_0_contracts::vrchat_requests::{
    GroupGalleryMutation, GroupMemberPatch, GroupMemberSort, GroupMemberVisibility,
    GroupPostMutation, GroupPostVisibility, GroupProfileJoinState, GroupProfileUpdate,
    GroupRoleMutation,
};
use vrcx_0_core::GroupJoinRequestAction;

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VrchatGroupIdInput {
    #[serde(default)]
    pub group_id: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VrchatGroupProfileInput {
    #[serde(default)]
    pub group_id: String,
    #[serde(default = "default_true")]
    pub include_roles: bool,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VrchatGroupUserGroupsInput {
    #[serde(default)]
    pub user_id: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
pub enum GroupMembershipListStatus {
    #[serde(rename = "invited")]
    Invited,
    #[serde(rename = "requested")]
    Requested,
    #[serde(rename = "userblocked")]
    UserBlocked,
}

impl GroupMembershipListStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Invited => "invited",
            Self::Requested => "requested",
            Self::UserBlocked => "userblocked",
        }
    }
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VrchatGroupMembershipListInput {
    #[serde(default)]
    pub user_id: String,
    pub status: GroupMembershipListStatus,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VrchatGroupPagedInput {
    #[serde(default)]
    pub group_id: String,
    #[serde(default, deserialize_with = "deserialize_nonnegative_i32")]
    pub n: i32,
    #[serde(default, deserialize_with = "deserialize_nonnegative_i32")]
    pub offset: i32,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VrchatGroupMembersInput {
    #[serde(default)]
    pub group_id: String,
    #[serde(default, deserialize_with = "deserialize_nonnegative_i32")]
    pub n: i32,
    #[serde(default, deserialize_with = "deserialize_nonnegative_i32")]
    pub offset: i32,
    #[serde(default)]
    pub sort: GroupMemberSort,
    #[serde(default)]
    pub role_id: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VrchatGroupMembersSearchInput {
    #[serde(default)]
    pub group_id: String,
    #[serde(default, deserialize_with = "deserialize_nonnegative_i32")]
    pub n: i32,
    #[serde(default, deserialize_with = "deserialize_nonnegative_i32")]
    pub offset: i32,
    #[serde(default)]
    pub query: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VrchatGroupGalleryInput {
    #[serde(default)]
    pub group_id: String,
    #[serde(default)]
    pub gallery_id: String,
    #[serde(default, deserialize_with = "deserialize_nonnegative_i32")]
    pub n: i32,
    #[serde(default, deserialize_with = "deserialize_nonnegative_i32")]
    pub offset: i32,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VrchatGroupJoinRequestsInput {
    #[serde(default)]
    pub group_id: String,
    #[serde(default, deserialize_with = "deserialize_nonnegative_i32")]
    pub n: i32,
    #[serde(default, deserialize_with = "deserialize_nonnegative_i32")]
    pub offset: i32,
    #[serde(default)]
    pub blocked: bool,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VrchatGroupLogsInput {
    #[serde(default)]
    pub group_id: String,
    #[serde(default, deserialize_with = "deserialize_nonnegative_i32")]
    pub n: i32,
    #[serde(default, deserialize_with = "deserialize_nonnegative_i32")]
    pub offset: i32,
    #[serde(default)]
    pub event_types: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VrchatGroupUpdateInput {
    #[serde(default)]
    pub group_id: String,
    pub params: GroupProfileUpdate,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VrchatGroupGalleryCreateInput {
    #[serde(default)]
    pub group_id: String,
    pub params: GroupGalleryMutation,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VrchatGroupGalleryEditInput {
    #[serde(default)]
    pub group_id: String,
    #[serde(default)]
    pub gallery_id: String,
    pub params: GroupGalleryMutation,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VrchatGroupGalleryDeleteInput {
    #[serde(default)]
    pub group_id: String,
    #[serde(default)]
    pub gallery_id: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VrchatGroupGalleryImageAddInput {
    #[serde(default)]
    pub group_id: String,
    #[serde(default)]
    pub gallery_id: String,
    #[serde(default)]
    pub file_id: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VrchatGroupGalleryImageDeleteInput {
    #[serde(default)]
    pub group_id: String,
    #[serde(default)]
    pub gallery_id: String,
    #[serde(default)]
    pub image_id: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VrchatGroupPostCreateInput {
    #[serde(default)]
    pub group_id: String,
    pub params: GroupPostMutation,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VrchatGroupPostEditInput {
    #[serde(default)]
    pub group_id: String,
    #[serde(default)]
    pub post_id: String,
    pub params: GroupPostMutation,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VrchatGroupPostDeleteInput {
    #[serde(default)]
    pub group_id: String,
    #[serde(default)]
    pub post_id: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VrchatGroupUserInput {
    #[serde(default)]
    pub group_id: String,
    #[serde(default)]
    pub user_id: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VrchatGroupMemberRoleInput {
    #[serde(default)]
    pub group_id: String,
    #[serde(default)]
    pub user_id: String,
    #[serde(default)]
    pub role_id: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VrchatGroupJoinRequestRespondInput {
    #[serde(default)]
    pub group_id: String,
    #[serde(default)]
    pub user_id: String,
    pub action: GroupJoinRequestAction,
    #[serde(default)]
    pub block: bool,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VrchatGroupRoleCreateInput {
    #[serde(default)]
    pub group_id: String,
    pub params: GroupRoleMutation,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VrchatGroupRoleUpdateInput {
    #[serde(default)]
    pub group_id: String,
    #[serde(default)]
    pub role_id: String,
    pub params: GroupRoleMutation,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VrchatGroupRoleInput {
    #[serde(default)]
    pub group_id: String,
    #[serde(default)]
    pub role_id: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VrchatGroupRepresentationInput {
    #[serde(default)]
    pub group_id: String,
    #[serde(default)]
    pub is_representing: bool,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VrchatGroupMemberPropsInput {
    #[serde(default)]
    pub group_id: String,
    #[serde(default)]
    pub user_id: String,
    pub params: GroupMemberPatch,
}

fn default_true() -> bool {
    true
}

fn deserialize_nonnegative_i32<'de, D>(deserializer: D) -> Result<i32, D::Error>
where
    D: Deserializer<'de>,
{
    let value = i32::deserialize(deserializer)?;
    if value >= 0 {
        Ok(value)
    } else {
        Err(D::Error::custom("value must be non-negative"))
    }
}
