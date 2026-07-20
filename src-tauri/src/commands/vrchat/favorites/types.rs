use serde::Deserialize;

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatFavoritePagedInput {
    #[serde(default)]
    pub(crate) n: i64,
    #[serde(default)]
    pub(crate) offset: i64,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatFavoriteWorldsInput {
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

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatFavoriteAvatarsInput {
    #[serde(default)]
    pub(crate) n: i64,
    #[serde(default)]
    pub(crate) offset: i64,
    #[serde(default)]
    pub(crate) tag: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatFavoriteGroupsInput {
    #[serde(default)]
    pub(crate) n: i64,
    #[serde(default)]
    pub(crate) offset: i64,
    #[serde(default)]
    pub(crate) owner_id: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatFavoriteAddInput {
    #[serde(default, rename = "type")]
    pub(crate) type_name: String,
    #[serde(default)]
    pub(crate) favorite_id: String,
    #[serde(default)]
    pub(crate) tags: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatFavoriteDeleteInput {
    #[serde(default)]
    pub(crate) object_id: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatFavoriteGroupSaveInput {
    #[serde(default)]
    pub(crate) owner_id: String,
    #[serde(default, rename = "type")]
    pub(crate) type_name: String,
    #[serde(default)]
    pub(crate) group: String,
    pub(crate) display_name: Option<String>,
    pub(crate) visibility: Option<String>,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatFavoriteGroupClearInput {
    #[serde(default)]
    pub(crate) owner_id: String,
    #[serde(default, rename = "type")]
    pub(crate) type_name: String,
    #[serde(default)]
    pub(crate) group: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct LocalFavoriteInput {
    #[serde(default)]
    pub(crate) kind: String,
    #[serde(default)]
    pub(crate) entity_id: String,
    #[serde(default)]
    pub(crate) group_name: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct LocalFavoriteGroupInput {
    #[serde(default)]
    pub(crate) kind: String,
    #[serde(default)]
    pub(crate) group_name: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct LocalFavoriteGroupRenameInput {
    #[serde(default)]
    pub(crate) kind: String,
    #[serde(default)]
    pub(crate) group_name: String,
    #[serde(default)]
    pub(crate) new_group_name: String,
}
