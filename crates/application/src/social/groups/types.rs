use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatGroupIdInput {
    #[serde(default)]
    pub(super) endpoint: String,
    #[serde(default)]
    pub(super) group_id: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatGroupProfileInput {
    #[serde(default)]
    pub(super) endpoint: String,
    #[serde(default)]
    pub(super) group_id: String,
    #[serde(default = "default_true")]
    pub(super) include_roles: bool,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatGroupUserGroupsInput {
    #[serde(default)]
    pub(super) endpoint: String,
    #[serde(default)]
    pub(super) user_id: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatGroupPagedInput {
    #[serde(default)]
    pub(super) endpoint: String,
    #[serde(default)]
    pub(super) group_id: String,
    #[serde(default)]
    pub(super) n: i64,
    #[serde(default)]
    pub(super) offset: i64,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatGroupMembersInput {
    #[serde(default)]
    pub(super) endpoint: String,
    #[serde(default)]
    pub(super) group_id: String,
    #[serde(default)]
    pub(super) n: i64,
    #[serde(default)]
    pub(super) offset: i64,
    #[serde(default)]
    pub(super) sort: String,
    #[serde(default)]
    pub(super) role_id: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatGroupMembersSearchInput {
    #[serde(default)]
    pub(super) endpoint: String,
    #[serde(default)]
    pub(super) group_id: String,
    #[serde(default)]
    pub(super) n: i64,
    #[serde(default)]
    pub(super) offset: i64,
    #[serde(default)]
    pub(super) query: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatGroupGalleryInput {
    #[serde(default)]
    pub(super) endpoint: String,
    #[serde(default)]
    pub(super) group_id: String,
    #[serde(default)]
    pub(super) gallery_id: String,
    #[serde(default)]
    pub(super) n: i64,
    #[serde(default)]
    pub(super) offset: i64,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatGroupJoinRequestsInput {
    #[serde(default)]
    pub(super) endpoint: String,
    #[serde(default)]
    pub(super) group_id: String,
    #[serde(default)]
    pub(super) n: i64,
    #[serde(default)]
    pub(super) offset: i64,
    #[serde(default)]
    pub(super) blocked: bool,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatGroupLogsInput {
    #[serde(default)]
    pub(super) endpoint: String,
    #[serde(default)]
    pub(super) group_id: String,
    #[serde(default)]
    pub(super) n: i64,
    #[serde(default)]
    pub(super) offset: i64,
    #[serde(default)]
    pub(super) event_types: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatGroupPostCreateInput {
    #[serde(default)]
    pub(super) endpoint: String,
    #[serde(default)]
    pub(super) group_id: String,
    pub(super) params: Option<Value>,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatGroupPostEditInput {
    #[serde(default)]
    pub(super) endpoint: String,
    #[serde(default)]
    pub(super) group_id: String,
    #[serde(default)]
    pub(super) post_id: String,
    pub(super) params: Option<Value>,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatGroupPostDeleteInput {
    #[serde(default)]
    pub(super) endpoint: String,
    #[serde(default)]
    pub(super) group_id: String,
    #[serde(default)]
    pub(super) post_id: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatGroupUserInput {
    #[serde(default)]
    pub(super) endpoint: String,
    #[serde(default)]
    pub(super) group_id: String,
    #[serde(default)]
    pub(super) user_id: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatGroupJoinRequestRespondInput {
    #[serde(default)]
    pub(super) endpoint: String,
    #[serde(default)]
    pub(super) group_id: String,
    #[serde(default)]
    pub(super) user_id: String,
    #[serde(default)]
    pub(super) action: String,
    #[serde(default)]
    pub(super) block: bool,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatGroupRepresentationInput {
    #[serde(default)]
    pub(super) endpoint: String,
    #[serde(default)]
    pub(super) group_id: String,
    #[serde(default)]
    pub(super) is_representing: bool,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatGroupMemberPropsInput {
    #[serde(default)]
    pub(super) endpoint: String,
    #[serde(default)]
    pub(super) group_id: String,
    #[serde(default)]
    pub(super) user_id: String,
    pub(super) params: Option<Value>,
}

fn default_true() -> bool {
    true
}
