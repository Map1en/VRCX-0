use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendGroupIdInput {
    #[serde(default)]
    pub(crate) endpoint: String,
    #[serde(default)]
    pub(crate) group_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendGroupProfileInput {
    #[serde(default)]
    pub(crate) endpoint: String,
    #[serde(default)]
    pub(crate) group_id: String,
    #[serde(default = "default_true")]
    pub(crate) include_roles: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendGroupUserGroupsInput {
    #[serde(default)]
    pub(crate) endpoint: String,
    #[serde(default)]
    pub(crate) user_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendGroupPagedInput {
    #[serde(default)]
    pub(crate) endpoint: String,
    #[serde(default)]
    pub(crate) group_id: String,
    #[serde(default)]
    pub(crate) n: i64,
    #[serde(default)]
    pub(crate) offset: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendGroupMembersInput {
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendGroupMembersSearchInput {
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendGroupGalleryInput {
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendGroupJoinRequestsInput {
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendGroupLogsInput {
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendGroupPostCreateInput {
    #[serde(default)]
    pub(crate) endpoint: String,
    #[serde(default)]
    pub(crate) group_id: String,
    pub(crate) params: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendGroupPostEditInput {
    #[serde(default)]
    pub(crate) endpoint: String,
    #[serde(default)]
    pub(crate) group_id: String,
    #[serde(default)]
    pub(crate) post_id: String,
    pub(crate) params: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendGroupPostDeleteInput {
    #[serde(default)]
    pub(crate) endpoint: String,
    #[serde(default)]
    pub(crate) group_id: String,
    #[serde(default)]
    pub(crate) post_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendGroupUserInput {
    #[serde(default)]
    pub(crate) endpoint: String,
    #[serde(default)]
    pub(crate) group_id: String,
    #[serde(default)]
    pub(crate) user_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendGroupJoinRequestRespondInput {
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendGroupRepresentationInput {
    #[serde(default)]
    pub(crate) endpoint: String,
    #[serde(default)]
    pub(crate) group_id: String,
    #[serde(default)]
    pub(crate) is_representing: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendGroupMemberPropsInput {
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
