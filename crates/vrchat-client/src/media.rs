use std::collections::HashMap;

use serde_json::Value;

use crate::http_api::{
    api_input, encode_path_segment, get_input, normalize_text, normalize_vrchat_api_endpoint,
    require_text, HttpApiError, HttpApiRequestBody, HttpApiRequestInput, HttpApiUpload,
};

pub fn normalize_media_endpoint(endpoint: &str) -> String {
    normalize_vrchat_api_endpoint(Some(endpoint))
}

pub fn image_upload_input(
    endpoint: String,
    path: impl Into<String>,
    image_data: String,
    params: HashMap<String, Value>,
    matching_dimensions: bool,
) -> Result<HttpApiRequestInput, HttpApiError> {
    let post_data = serde_json::to_string(&params)
        .map_err(|error| HttpApiError::Custom(format!("serialize media upload params: {error}")))?;
    Ok(HttpApiRequestInput {
        endpoint: Some(endpoint),
        path: Some(path.into()),
        body: HttpApiRequestBody::Upload(HttpApiUpload::Image {
            image_data,
            post_data: Some(post_data),
            matching_dimensions,
        }),
        ..Default::default()
    })
}

pub fn file_delete_input(
    endpoint: String,
    file_id: String,
) -> Result<HttpApiRequestInput, HttpApiError> {
    let file_id = require_text(file_id, "VrchatMediaFileDelete requires fileId.")?;
    Ok(api_input(
        endpoint,
        "DELETE",
        format!("file/{}", encode_path_segment(&file_id)),
        None,
    ))
}

pub fn files_get_input(endpoint: String, params: HashMap<String, Value>) -> HttpApiRequestInput {
    get_input(endpoint, "files", params)
}

pub fn tagged_image_upload_input(
    endpoint: String,
    image_data: String,
    tag: &str,
    matching_dimensions: bool,
) -> Result<HttpApiRequestInput, HttpApiError> {
    image_upload_input(
        endpoint,
        "file/image",
        image_data,
        HashMap::from([("tag".to_string(), Value::String(tag.to_string()))]),
        matching_dimensions,
    )
}

pub fn avatar_gallery_image_upload_input(
    endpoint: String,
    image_data: String,
    avatar_id: Value,
) -> Result<HttpApiRequestInput, HttpApiError> {
    image_upload_input(
        endpoint,
        "file/image",
        image_data,
        HashMap::from([
            ("tag".to_string(), Value::String("avatargallery".into())),
            ("galleryId".to_string(), avatar_id),
        ]),
        false,
    )
}

pub fn sticker_upload_input(
    endpoint: String,
    image_data: String,
) -> Result<HttpApiRequestInput, HttpApiError> {
    image_upload_input(
        endpoint,
        "file/image",
        image_data,
        HashMap::from([
            ("tag".to_string(), Value::String("sticker".into())),
            ("maskTag".to_string(), Value::String("square".into())),
        ]),
        true,
    )
}

pub fn print_upload_input(
    endpoint: String,
    image_data: String,
    crop_white_border: bool,
    params: HashMap<String, Value>,
) -> Result<HttpApiRequestInput, HttpApiError> {
    let post_data = serde_json::to_string(&params)
        .map_err(|error| HttpApiError::Custom(format!("serialize print upload params: {error}")))?;
    Ok(HttpApiRequestInput {
        endpoint: Some(endpoint),
        path: Some("prints".into()),
        body: HttpApiRequestBody::Upload(HttpApiUpload::PrintImage {
            image_data,
            post_data: Some(post_data),
            crop_white_border,
        }),
        ..Default::default()
    })
}

pub fn asset_upload_input(
    endpoint: String,
    asset_kind: String,
    image_data: String,
    crop_white_border: bool,
    params: HashMap<String, Value>,
) -> Result<(String, HttpApiRequestInput), HttpApiError> {
    let asset_kind = normalize_text(asset_kind);
    let request = match asset_kind.as_str() {
        "gallery" => tagged_image_upload_input(endpoint, image_data, "gallery", false)?,
        "icons" => tagged_image_upload_input(endpoint, image_data, "icon", true)?,
        "emojis" => image_upload_input(endpoint, "file/image", image_data, params, true)?,
        "stickers" => sticker_upload_input(endpoint, image_data)?,
        "prints" => print_upload_input(endpoint, image_data, crop_white_border, params)?,
        _ => {
            return Err(HttpApiError::Custom(format!(
                "unsupported media asset upload kind: {asset_kind}"
            )))
        }
    };
    Ok((asset_kind, request))
}

pub fn prints_get_input(
    endpoint: String,
    user_id: String,
    n: i64,
) -> Result<HttpApiRequestInput, HttpApiError> {
    let user_id = require_text(user_id, "VrchatMediaPrintsGet requires userId.")?;
    Ok(get_input(
        endpoint,
        format!("prints/user/{}", encode_path_segment(&user_id)),
        HashMap::from([("n".to_string(), serde_json::json!(n))]),
    ))
}

pub fn print_get_input(
    endpoint: String,
    print_id: String,
) -> Result<HttpApiRequestInput, HttpApiError> {
    let print_id = require_text(print_id, "VrchatMediaPrintGet requires printId.")?;
    Ok(get_input(
        endpoint,
        format!("prints/{}", encode_path_segment(&print_id)),
        HashMap::new(),
    ))
}

pub fn print_delete_input(
    endpoint: String,
    print_id: String,
) -> Result<HttpApiRequestInput, HttpApiError> {
    let print_id = require_text(print_id, "VrchatMediaPrintDelete requires printId.")?;
    Ok(api_input(
        endpoint,
        "DELETE",
        format!("prints/{}", encode_path_segment(&print_id)),
        None,
    ))
}

pub fn user_inventory_item_get_input(
    endpoint: String,
    user_id: String,
    inventory_id: String,
) -> Result<HttpApiRequestInput, HttpApiError> {
    let user_id = require_text(user_id, "VrchatMediaUserInventoryItemGet requires userId.")?;
    let inventory_id = require_text(
        inventory_id,
        "VrchatMediaUserInventoryItemGet requires inventoryId.",
    )?;
    Ok(get_input(
        endpoint,
        format!(
            "user/{}/inventory/{}",
            encode_path_segment(&user_id),
            encode_path_segment(&inventory_id)
        ),
        HashMap::new(),
    ))
}

pub fn inventory_items_get_input(
    endpoint: String,
    params: HashMap<String, Value>,
) -> HttpApiRequestInput {
    get_input(endpoint, "inventory", params)
}

pub fn inventory_item_update_input(
    endpoint: String,
    inventory_id: String,
    params: HashMap<String, Value>,
) -> Result<HttpApiRequestInput, HttpApiError> {
    let inventory_id = require_text(
        inventory_id,
        "VrchatMediaInventoryItemUpdate requires inventoryId.",
    )?;
    Ok(api_input(
        endpoint,
        "PUT",
        format!("inventory/{}", encode_path_segment(&inventory_id)),
        Some(Value::Object(params.into_iter().collect())),
    ))
}

pub fn inventory_bundle_consume_input(
    endpoint: String,
    inventory_id: String,
) -> Result<HttpApiRequestInput, HttpApiError> {
    let inventory_id = require_text(
        inventory_id,
        "VrchatMediaInventoryBundleConsume requires inventoryId.",
    )?;
    Ok(api_input(
        endpoint,
        "PUT",
        format!("inventory/{}/consume", encode_path_segment(&inventory_id)),
        Some(serde_json::json!({ "inventoryId": inventory_id })),
    ))
}

pub fn reward_redeem_input(
    endpoint: String,
    code: String,
) -> Result<HttpApiRequestInput, HttpApiError> {
    let code = require_text(code, "VrchatMediaRewardRedeem requires code.")?;
    Ok(api_input(
        endpoint,
        "POST",
        "reward/redeem",
        Some(serde_json::json!({ "code": code })),
    ))
}

pub fn file_version_create_input(
    endpoint: String,
    file_id: String,
    file_md5: String,
    file_size_in_bytes: i64,
    signature_md5: String,
    signature_size_in_bytes: i64,
) -> Result<HttpApiRequestInput, HttpApiError> {
    let file_id = require_text(file_id, "VrchatMediaFileVersionCreate requires fileId.")?;
    Ok(api_input(
        endpoint,
        "POST",
        format!("file/{}", encode_path_segment(&file_id)),
        Some(serde_json::json!({
            "fileMd5": file_md5,
            "fileSizeInBytes": file_size_in_bytes,
            "signatureMd5": signature_md5,
            "signatureSizeInBytes": signature_size_in_bytes,
        })),
    ))
}

pub fn file_upload_stage_path(
    file_id: String,
    version: i64,
    kind: String,
) -> Result<String, HttpApiError> {
    let file_id = require_text(file_id, "VrchatMediaFileUploadStage requires fileId.")?;
    let kind = match normalize_text(kind).as_str() {
        "file" => "file".to_string(),
        "signature" => "signature".to_string(),
        _ => {
            return Err(HttpApiError::Custom(
                "unsupported file upload stage kind".into(),
            ))
        }
    };
    Ok(format!(
        "file/{}/{}/{}",
        encode_path_segment(&file_id),
        version,
        kind
    ))
}

pub fn file_upload_start_input(endpoint: String, path: String) -> HttpApiRequestInput {
    api_input(
        endpoint,
        "PUT",
        format!("{path}/start"),
        Some(serde_json::json!({})),
    )
}

pub fn file_upload_finish_input(endpoint: String, path: String) -> HttpApiRequestInput {
    api_input(
        endpoint,
        "PUT",
        format!("{path}/finish"),
        Some(serde_json::json!({ "maxParts": 0, "nextPartNumber": 0 })),
    )
}

pub fn file_put_input(
    url: String,
    file_data: String,
    file_mime: String,
    file_md5: String,
) -> HttpApiRequestInput {
    HttpApiRequestInput {
        url: Some(url),
        body: HttpApiRequestBody::Upload(HttpApiUpload::FilePut {
            file_data,
            file_mime,
            file_md5: Some(file_md5),
        }),
        ..Default::default()
    }
}

pub fn entity_image_set_input(
    endpoint: String,
    entity_path: &str,
    entity_id: String,
    image_url: String,
    message: &str,
) -> Result<HttpApiRequestInput, HttpApiError> {
    let entity_id = require_text(entity_id, message)?;
    Ok(api_input(
        endpoint,
        "PUT",
        format!("{}/{}", entity_path, encode_path_segment(&entity_id)),
        Some(serde_json::json!({ "id": entity_id, "imageUrl": image_url })),
    ))
}

pub fn avatar_image_set_input(
    endpoint: String,
    avatar_id: String,
    image_url: String,
) -> Result<HttpApiRequestInput, HttpApiError> {
    entity_image_set_input(
        endpoint,
        "avatars",
        avatar_id,
        image_url,
        "VrchatMediaAvatarImageSet requires avatarId.",
    )
}

pub fn world_image_set_input(
    endpoint: String,
    world_id: String,
    image_url: String,
) -> Result<HttpApiRequestInput, HttpApiError> {
    entity_image_set_input(
        endpoint,
        "worlds",
        world_id,
        image_url,
        "VrchatMediaWorldImageSet requires worldId.",
    )
}

#[cfg(test)]
mod tests;
