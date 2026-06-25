use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatGroupIdInput {
    #[serde(default)]
    pub(crate) endpoint: String,
    #[serde(default)]
    pub(crate) group_id: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatGroupProfileInput {
    #[serde(default)]
    pub(crate) endpoint: String,
    #[serde(default)]
    pub(crate) group_id: String,
    #[serde(default = "default_true")]
    pub(crate) include_roles: bool,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatGroupUserGroupsInput {
    #[serde(default)]
    pub(crate) endpoint: String,
    #[serde(default)]
    pub(crate) user_id: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatGroupPagedInput {
    #[serde(default)]
    pub(crate) endpoint: String,
    #[serde(default)]
    pub(crate) group_id: String,
    #[serde(default)]
    pub(crate) n: i64,
    #[serde(default)]
    pub(crate) offset: i64,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatGroupMembersInput {
    #[serde(default)]
    pub(crate) endpoint: String,
    #[serde(default)]
    pub(crate) group_id: String,
    #[serde(default)]
    pub(crate) n: i64,
    #[serde(default)]
    pub(crate) offset: i64,
    #[serde(default)]
    pub(crate) sort: String,
    #[serde(default)]
    pub(crate) role_id: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatGroupMembersSearchInput {
    #[serde(default)]
    pub(crate) endpoint: String,
    #[serde(default)]
    pub(crate) group_id: String,
    #[serde(default)]
    pub(crate) n: i64,
    #[serde(default)]
    pub(crate) offset: i64,
    #[serde(default)]
    pub(crate) query: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatGroupGalleryInput {
    #[serde(default)]
    pub(crate) endpoint: String,
    #[serde(default)]
    pub(crate) group_id: String,
    #[serde(default)]
    pub(crate) gallery_id: String,
    #[serde(default)]
    pub(crate) n: i64,
    #[serde(default)]
    pub(crate) offset: i64,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatGroupJoinRequestsInput {
    #[serde(default)]
    pub(crate) endpoint: String,
    #[serde(default)]
    pub(crate) group_id: String,
    #[serde(default)]
    pub(crate) n: i64,
    #[serde(default)]
    pub(crate) offset: i64,
    #[serde(default)]
    pub(crate) blocked: bool,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatGroupLogsInput {
    #[serde(default)]
    pub(crate) endpoint: String,
    #[serde(default)]
    pub(crate) group_id: String,
    #[serde(default)]
    pub(crate) n: i64,
    #[serde(default)]
    pub(crate) offset: i64,
    #[serde(default)]
    pub(crate) event_types: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatGroupPostCreateInput {
    #[serde(default)]
    pub(crate) endpoint: String,
    #[serde(default)]
    pub(crate) group_id: String,
    pub(crate) params: Option<Value>,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatGroupPostEditInput {
    #[serde(default)]
    pub(crate) endpoint: String,
    #[serde(default)]
    pub(crate) group_id: String,
    #[serde(default)]
    pub(crate) post_id: String,
    pub(crate) params: Option<Value>,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatGroupPostDeleteInput {
    #[serde(default)]
    pub(crate) endpoint: String,
    #[serde(default)]
    pub(crate) group_id: String,
    #[serde(default)]
    pub(crate) post_id: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatGroupUserInput {
    #[serde(default)]
    pub(crate) endpoint: String,
    #[serde(default)]
    pub(crate) group_id: String,
    #[serde(default)]
    pub(crate) user_id: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatGroupJoinRequestRespondInput {
    #[serde(default)]
    pub(crate) endpoint: String,
    #[serde(default)]
    pub(crate) group_id: String,
    #[serde(default)]
    pub(crate) user_id: String,
    #[serde(default)]
    pub(crate) action: String,
    #[serde(default)]
    pub(crate) block: bool,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatGroupRepresentationInput {
    #[serde(default)]
    pub(crate) endpoint: String,
    #[serde(default)]
    pub(crate) group_id: String,
    #[serde(default)]
    pub(crate) is_representing: bool,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatGroupMemberPropsInput {
    #[serde(default)]
    pub(crate) endpoint: String,
    #[serde(default)]
    pub(crate) group_id: String,
    #[serde(default)]
    pub(crate) user_id: String,
    pub(crate) params: Option<Value>,
}

fn default_true() -> bool {
    true
}
