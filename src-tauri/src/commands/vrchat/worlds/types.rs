use serde::Deserialize;
use vrcx_0_application::remote::{
    deserialize_nonnegative_i32, QueryOrder, ReleaseStatusFilter, WorldRatingValue,
    WorldSearchSort, WorldUpdateRequest,
};

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VrchatWorldRatingSetInput {
    #[serde(default)]
    pub(crate) world_id: String,
    pub(crate) value: Option<WorldRatingValue>,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VrchatWorldIdInput {
    #[serde(default)]
    pub(crate) world_id: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VrchatWorldListByUserInput {
    #[serde(default)]
    pub(crate) user_id: String,
    #[specta(type = i32)]
    #[serde(default, deserialize_with = "deserialize_nonnegative_i32")]
    pub(crate) n: i32,
    #[specta(type = i32)]
    #[serde(default, deserialize_with = "deserialize_nonnegative_i32")]
    pub(crate) offset: i32,
    pub(crate) sort: WorldSearchSort,
    pub(crate) order: QueryOrder,
    pub(crate) release_status: ReleaseStatusFilter,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VrchatWorldSaveInput {
    #[serde(default)]
    pub(crate) world_id: String,
    pub(crate) params: WorldUpdateRequest,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VrchatWorldPersistentDataDeleteInput {
    #[serde(default)]
    pub(crate) user_id: String,
    #[serde(default)]
    pub(crate) world_id: String,
}
