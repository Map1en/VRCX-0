use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpApiRequestInput {
    pub url: Option<String>,
    pub path: Option<String>,
    pub endpoint: Option<String>,
    pub method: Option<String>,
    pub params: Option<HashMap<String, Value>>,
    pub query_params: Option<HashMap<String, Value>>,
    pub headers: Option<HashMap<String, String>>,
    pub body: Option<Value>,
    pub json_body: Option<bool>,
    pub skip_empty_query_string: Option<bool>,

    #[serde(rename = "uploadFilePUT")]
    pub upload_file_put: Option<bool>,
    #[serde(rename = "uploadImage")]
    pub upload_image: Option<bool>,
    #[serde(rename = "uploadImagePrint")]
    pub upload_image_print: Option<bool>,
    #[serde(rename = "uploadImageLegacy")]
    pub upload_image_legacy: Option<bool>,
    pub matching_dimensions: Option<bool>,
    pub crop_white_border: Option<bool>,
    pub post_data: Option<String>,
    pub image_data: Option<String>,
    pub file_data: Option<String>,
    #[serde(rename = "fileMIME")]
    pub file_mime: Option<String>,
    #[serde(rename = "fileMD5")]
    pub file_md5: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct HttpApiExecuteResponse {
    pub status: i32,
    pub data: String,
    pub raw: Value,
}
