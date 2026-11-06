use serde::Deserialize;
use vrcx_0_application::remote::deserialize_nonnegative_i32;

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VrchatEconomyPageInput {
    #[specta(type = i32)]
    #[serde(deserialize_with = "deserialize_nonnegative_i32")]
    pub(crate) n: i32,
    #[specta(type = i32)]
    #[serde(default, deserialize_with = "deserialize_nonnegative_i32")]
    pub(crate) offset: i32,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VrchatEconomyPurchasesInput {
    pub(crate) buyer_id: String,
    #[specta(type = i32)]
    #[serde(deserialize_with = "deserialize_nonnegative_i32")]
    pub(crate) n: i32,
    #[specta(type = i32)]
    #[serde(default, deserialize_with = "deserialize_nonnegative_i32")]
    pub(crate) offset: i32,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VrchatEconomyTransactionsInput {
    pub(crate) user_id: String,
    #[specta(type = i32)]
    #[serde(deserialize_with = "deserialize_nonnegative_i32")]
    pub(crate) n: i32,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VrchatEconomyUserInput {
    pub(crate) user_id: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VrchatEconomyStoreInput {
    pub(crate) store_id: String,
}
