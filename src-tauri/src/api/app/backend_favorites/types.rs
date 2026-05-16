use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendFavoriteEndpointInput {
    #[serde(default)]
    pub(crate) endpoint: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendFavoritePagedInput {
    #[serde(default)]
    pub(crate) endpoint: String,
    #[serde(default)]
    pub(crate) n: i64,
    #[serde(default)]
    pub(crate) offset: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendFavoriteWorldsInput {
    #[serde(default)]
    pub(crate) endpoint: String,
    #[serde(default)]
    pub(crate) n: i64,
    #[serde(default)]
    pub(crate) offset: i64,
    #[serde(default)]
    pub(crate) owner_id: String,
    #[serde(default)]
    pub(crate) user_id: String,
    #[serde(default)]
    pub(crate) tag: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendFavoriteAvatarsInput {
    #[serde(default)]
    pub(crate) endpoint: String,
    #[serde(default)]
    pub(crate) n: i64,
    #[serde(default)]
    pub(crate) offset: i64,
    #[serde(default)]
    pub(crate) tag: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendFavoriteGroupsInput {
    #[serde(default)]
    pub(crate) endpoint: String,
    #[serde(default)]
    pub(crate) n: i64,
    #[serde(default)]
    pub(crate) offset: i64,
    #[serde(default)]
    pub(crate) owner_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendFavoriteAddInput {
    #[serde(default)]
    pub(crate) endpoint: String,
    #[serde(default, rename = "type")]
    pub(crate) type_name: String,
    #[serde(default)]
    pub(crate) favorite_id: String,
    #[serde(default)]
    pub(crate) tags: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendFavoriteDeleteInput {
    #[serde(default)]
    pub(crate) endpoint: String,
    #[serde(default)]
    pub(crate) object_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendFavoriteGroupSaveInput {
    #[serde(default)]
    pub(crate) endpoint: String,
    #[serde(default)]
    pub(crate) owner_id: String,
    #[serde(default, rename = "type")]
    pub(crate) type_name: String,
    #[serde(default)]
    pub(crate) group: String,
    pub(crate) display_name: Option<String>,
    pub(crate) visibility: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendFavoriteGroupClearInput {
    #[serde(default)]
    pub(crate) endpoint: String,
    #[serde(default)]
    pub(crate) owner_id: String,
    #[serde(default, rename = "type")]
    pub(crate) type_name: String,
    #[serde(default)]
    pub(crate) group: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendLocalFavoriteInput {
    #[serde(default)]
    pub(crate) kind: String,
    #[serde(default)]
    pub(crate) entity_id: String,
    #[serde(default)]
    pub(crate) group_name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendLocalFavoriteGroupInput {
    #[serde(default)]
    pub(crate) kind: String,
    #[serde(default)]
    pub(crate) group_name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendLocalFavoriteGroupRenameInput {
    #[serde(default)]
    pub(crate) kind: String,
    #[serde(default)]
    pub(crate) group_name: String,
    #[serde(default)]
    pub(crate) new_group_name: String,
}
