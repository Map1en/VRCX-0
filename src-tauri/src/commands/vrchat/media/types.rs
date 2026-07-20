use std::collections::HashMap;

use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatMediaParamsInput {
    #[serde(default)]
    pub(crate) params: HashMap<String, Value>,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatMediaFileIdInput {
    #[serde(default)]
    pub(crate) file_id: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatMediaImageUploadInput {
    #[serde(default)]
    pub(crate) image_data: String,
    #[serde(default)]
    pub(crate) params: HashMap<String, Value>,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatMediaAvatarGalleryImageUploadInput {
    #[serde(default)]
    pub(crate) image_data: String,
    pub(crate) avatar_id: Value,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatMediaPrintUploadInput {
    #[serde(default)]
    pub(crate) image_data: String,
    #[serde(default)]
    pub(crate) crop_white_border: bool,
    #[serde(default)]
    pub(crate) params: HashMap<String, Value>,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatMediaAssetUploadInput {
    #[serde(default)]
    pub(crate) asset_kind: String,
    #[serde(default)]
    pub(crate) image_data: String,
    #[serde(default)]
    pub(crate) crop_white_border: bool,
    #[serde(default)]
    pub(crate) params: HashMap<String, Value>,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatMediaPrintsInput {
    #[serde(default)]
    pub(crate) user_id: String,
    #[serde(default)]
    pub(crate) n: i64,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatMediaPrintIdInput {
    #[serde(default)]
    pub(crate) print_id: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatPrintFavoriteSetInput {
    #[serde(default)]
    pub(crate) print_id: String,
    #[serde(default)]
    pub(crate) favorite: bool,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatMediaUserInventoryItemInput {
    #[serde(default)]
    pub(crate) user_id: String,
    #[serde(default)]
    pub(crate) inventory_id: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatMediaInventoryItemInput {
    #[serde(default)]
    pub(crate) inventory_id: String,
    #[serde(default)]
    pub(crate) params: HashMap<String, Value>,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatMediaRewardRedeemInput {
    #[serde(default)]
    pub(crate) code: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatMediaFileVersionCreateInput {
    #[serde(default)]
    pub(crate) file_id: String,
    #[serde(default)]
    pub(crate) file_md5: String,
    #[serde(default)]
    pub(crate) file_size_in_bytes: i64,
    #[serde(default)]
    pub(crate) signature_md5: String,
    #[serde(default)]
    pub(crate) signature_size_in_bytes: i64,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatMediaFileUploadStageInput {
    #[serde(default)]
    pub(crate) file_id: String,
    #[serde(default)]
    pub(crate) version: i64,
    #[serde(default)]
    pub(crate) kind: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatMediaFilePutInput {
    #[serde(default)]
    pub(crate) url: String,
    #[serde(default)]
    pub(crate) file_data: String,
    #[serde(default, rename = "fileMIME")]
    pub(crate) file_mime: String,
    #[serde(default, rename = "fileMD5")]
    pub(crate) file_md5: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatMediaEntityImageInput {
    #[serde(default)]
    pub(crate) entity_id: String,
    #[serde(default)]
    pub(crate) image_url: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrchatMediaLegacyImageUploadInput {
    #[serde(default)]
    pub(crate) entity_id: String,
    #[serde(default)]
    pub(crate) image_url: String,
    #[serde(default)]
    pub(crate) base64_file: String,
    #[serde(default)]
    pub(crate) file_size_in_bytes: Option<i64>,
}
