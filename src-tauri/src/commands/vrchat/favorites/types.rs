use serde::Deserialize;
use vrcx_0_application::remote::deserialize_nonnegative_i32;
use vrcx_0_application_core::{FavoriteEntityKind, FavoriteGroupVisibility};
use vrcx_0_contracts::VrchatFavoriteType;

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VrchatFavoriteWorldsInput {
    #[specta(type = i32)]
    #[serde(default, deserialize_with = "deserialize_nonnegative_i32")]
    pub(crate) n: i32,
    #[specta(type = i32)]
    #[serde(default, deserialize_with = "deserialize_nonnegative_i32")]
    pub(crate) offset: i32,
    #[serde(default)]
    pub(crate) owner_id: String,
    #[serde(default)]
    pub(crate) user_id: String,
    #[serde(default)]
    pub(crate) tag: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VrchatFavoriteGroupsInput {
    #[specta(type = i32)]
    #[serde(default, deserialize_with = "deserialize_nonnegative_i32")]
    pub(crate) n: i32,
    #[specta(type = i32)]
    #[serde(default, deserialize_with = "deserialize_nonnegative_i32")]
    pub(crate) offset: i32,
    #[serde(default)]
    pub(crate) owner_id: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VrchatFavoriteAddInput {
    #[serde(rename = "type")]
    pub(crate) type_name: VrchatFavoriteType,
    #[serde(default)]
    pub(crate) favorite_id: String,
    #[serde(default)]
    pub(crate) tags: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VrchatFavoriteDeleteInput {
    #[serde(default)]
    pub(crate) object_id: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VrchatFavoriteGroupSaveInput {
    #[serde(rename = "type")]
    pub(crate) type_name: VrchatFavoriteType,
    #[serde(default)]
    pub(crate) group: String,
    pub(crate) display_name: Option<String>,
    pub(crate) visibility: Option<FavoriteGroupVisibility>,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VrchatFavoriteGroupClearInput {
    #[serde(rename = "type")]
    pub(crate) type_name: VrchatFavoriteType,
    #[serde(default)]
    pub(crate) group: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalFavoriteInput {
    pub(crate) kind: FavoriteEntityKind,
    #[serde(default)]
    pub(crate) entity_id: String,
    #[serde(default)]
    pub(crate) group_name: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalFavoriteGroupInput {
    pub(crate) kind: FavoriteEntityKind,
    #[serde(default)]
    pub(crate) group_name: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalFavoriteGroupRenameInput {
    pub(crate) kind: FavoriteEntityKind,
    #[serde(default)]
    pub(crate) group_name: String,
    #[serde(default)]
    pub(crate) new_group_name: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalFavoriteGroupReorderInput {
    pub(crate) kind: FavoriteEntityKind,
    pub(crate) group_names: Vec<String>,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalFavoriteReorderInput {
    pub(crate) kind: FavoriteEntityKind,
    #[serde(default)]
    pub(crate) group_name: String,
    pub(crate) entity_ids: Vec<String>,
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use vrcx_0_contracts::VrchatFavoriteType;

    use super::VrchatFavoriteAddInput;

    #[test]
    fn favorite_add_accepts_vrc_plus_world_from_ipc() {
        let input: VrchatFavoriteAddInput = serde_json::from_value(json!({
            "type": "vrcPlusWorld",
            "favoriteId": "wrld_1",
            "tags": "worlds4",
        }))
        .unwrap();

        assert_eq!(input.type_name, VrchatFavoriteType::VrcPlusWorld);
    }
}
