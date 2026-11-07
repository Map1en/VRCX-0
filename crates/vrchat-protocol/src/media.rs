use std::collections::HashMap;
use std::fmt;

use serde::{Deserialize, Serialize};

use crate::http_api::{
    api_input, encode_path_segment, get_input, normalize_vrchat_api_endpoint, require_text,
    HttpApiError,
};
use crate::query::serialize_query;
use vrcx_0_contracts::vrchat_api::{VrchatRequest, VrchatRequestBody, VrchatUpload};

pub use vrcx_0_contracts::vrchat_requests::{
    EmojiLoopStyle, EmojiUploadParams, ImageAnimationStyle, ImageMaskTag,
    InventoryItemUpdateRequest, InventoryListParams, InventoryOrder, MediaAssetUploadRequest,
    MediaFileListParams, MediaFileTag, PrintUploadParams, ProfileDecorationEquipSlot,
};

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum MediaAssetKind {
    Gallery,
    Icons,
    Emojis,
    Stickers,
    Prints,
}

impl MediaAssetKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Gallery => "gallery",
            Self::Icons => "icons",
            Self::Emojis => "emojis",
            Self::Stickers => "stickers",
            Self::Prints => "prints",
        }
    }
}

impl fmt::Display for MediaAssetKind {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum FileUploadStageKind {
    File,
    Signature,
}

impl FileUploadStageKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::File => "file",
            Self::Signature => "signature",
        }
    }
}

impl fmt::Display for FileUploadStageKind {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

pub fn normalize_media_endpoint(endpoint: &str) -> String {
    normalize_vrchat_api_endpoint(Some(endpoint))
}

pub fn image_upload_input(
    endpoint: String,
    path: impl Into<String>,
    image_data: String,
    params: EmojiUploadParams,
    matching_dimensions: bool,
) -> Result<VrchatRequest, HttpApiError> {
    image_upload_with_params(endpoint, path, image_data, &params, matching_dimensions)
}

fn image_upload_with_params(
    endpoint: String,
    path: impl Into<String>,
    image_data: String,
    params: &impl Serialize,
    matching_dimensions: bool,
) -> Result<VrchatRequest, HttpApiError> {
    let post_data = serde_json::to_string(&params)
        .map_err(|error| HttpApiError::Custom(format!("serialize media upload params: {error}")))?;
    Ok(VrchatRequest {
        endpoint: Some(endpoint),
        path: Some(path.into()),
        body: VrchatRequestBody::Upload(VrchatUpload::Image {
            image_data,
            post_data: Some(post_data),
            matching_dimensions,
        }),
        ..Default::default()
    })
}

pub fn file_delete_input(endpoint: String, file_id: String) -> Result<VrchatRequest, HttpApiError> {
    let file_id = require_text(file_id, "VrchatMediaFileDelete requires fileId.")?;
    Ok(api_input(
        endpoint,
        "DELETE",
        format!("file/{}", encode_path_segment(&file_id)),
        None,
    ))
}

pub fn gallery_file_order_input(
    endpoint: String,
    gallery_id: String,
    file_ids: Vec<String>,
) -> Result<VrchatRequest, HttpApiError> {
    let gallery_id = require_text(
        gallery_id,
        "VrchatMediaGalleryFileOrder requires galleryId.",
    )?;
    let file_ids: Vec<String> = file_ids
        .into_iter()
        .map(|file_id| file_id.trim().to_string())
        .filter(|file_id| !file_id.is_empty())
        .collect();
    if file_ids.is_empty() {
        return Err(HttpApiError::Custom(
            "VrchatMediaGalleryFileOrder requires fileIds.".into(),
        ));
    }
    Ok(api_input(
        endpoint,
        "PUT",
        "files/order",
        Some(serde_json::json!({ "ids": file_ids, "galleryId": gallery_id })),
    ))
}

pub fn files_get_input(endpoint: String, params: MediaFileListParams) -> VrchatRequest {
    get_input(endpoint, "files", serialize_query(&params))
}

pub fn tagged_image_upload_input(
    endpoint: String,
    image_data: String,
    tag: &str,
    matching_dimensions: bool,
) -> Result<VrchatRequest, HttpApiError> {
    image_upload_with_params(
        endpoint,
        "file/image",
        image_data,
        &HashMap::from([("tag", tag)]),
        matching_dimensions,
    )
}

pub fn avatar_gallery_image_upload_input(
    endpoint: String,
    image_data: String,
    avatar_id: String,
) -> Result<VrchatRequest, HttpApiError> {
    let avatar_id = require_text(
        avatar_id,
        "VrchatMediaAvatarGalleryImageUpload requires avatarId.",
    )?;
    image_upload_with_params(
        endpoint,
        "file/image",
        image_data,
        &HashMap::from([("tag", "avatargallery"), ("galleryId", avatar_id.as_str())]),
        false,
    )
}

pub fn sticker_upload_input(
    endpoint: String,
    image_data: String,
) -> Result<VrchatRequest, HttpApiError> {
    image_upload_with_params(
        endpoint,
        "file/image",
        image_data,
        &HashMap::from([("tag", "sticker"), ("maskTag", "square")]),
        true,
    )
}

pub fn print_upload_input(
    endpoint: String,
    image_data: String,
    crop_white_border: bool,
    params: PrintUploadParams,
) -> Result<VrchatRequest, HttpApiError> {
    let post_data = serde_json::to_string(&params)
        .map_err(|error| HttpApiError::Custom(format!("serialize print upload params: {error}")))?;
    Ok(VrchatRequest {
        endpoint: Some(endpoint),
        path: Some("prints".into()),
        body: VrchatRequestBody::Upload(VrchatUpload::PrintImage {
            image_data,
            post_data: Some(post_data),
            crop_white_border,
        }),
        ..Default::default()
    })
}

pub fn asset_upload_input(
    endpoint: String,
    input: MediaAssetUploadRequest,
) -> Result<(MediaAssetKind, VrchatRequest), HttpApiError> {
    let (asset_kind, request) = match input {
        MediaAssetUploadRequest::Gallery { image_data } => (
            MediaAssetKind::Gallery,
            tagged_image_upload_input(endpoint, image_data, "gallery", false)?,
        ),
        MediaAssetUploadRequest::Icons { image_data } => (
            MediaAssetKind::Icons,
            tagged_image_upload_input(endpoint, image_data, "icon", true)?,
        ),
        MediaAssetUploadRequest::Emojis { image_data, params } => (
            MediaAssetKind::Emojis,
            image_upload_input(endpoint, "file/image", image_data, params, true)?,
        ),
        MediaAssetUploadRequest::Stickers { image_data } => (
            MediaAssetKind::Stickers,
            sticker_upload_input(endpoint, image_data)?,
        ),
        MediaAssetUploadRequest::Prints {
            image_data,
            crop_white_border,
            params,
        } => (
            MediaAssetKind::Prints,
            print_upload_input(endpoint, image_data, crop_white_border, params)?,
        ),
    };
    Ok((asset_kind, request))
}

pub fn prints_get_input(
    endpoint: String,
    user_id: String,
    n: i32,
) -> Result<VrchatRequest, HttpApiError> {
    let user_id = require_text(user_id, "VrchatMediaPrintsGet requires userId.")?;
    Ok(get_input(
        endpoint,
        format!("prints/user/{}", encode_path_segment(&user_id)),
        HashMap::from([("n".to_string(), serde_json::json!(n))]),
    ))
}

pub fn print_get_input(endpoint: String, print_id: String) -> Result<VrchatRequest, HttpApiError> {
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
) -> Result<VrchatRequest, HttpApiError> {
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
) -> Result<VrchatRequest, HttpApiError> {
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

pub fn inventory_items_get_input(endpoint: String, params: InventoryListParams) -> VrchatRequest {
    get_input(endpoint, "inventory", serialize_query(&params))
}

pub fn inventory_template_get_input(
    endpoint: String,
    inventory_template_id: String,
) -> Result<VrchatRequest, HttpApiError> {
    let inventory_template_id = require_text(
        inventory_template_id,
        "VrchatMediaInventoryTemplateGet requires inventoryTemplateId.",
    )?;
    Ok(get_input(
        endpoint,
        format!(
            "inventory/template/{}",
            encode_path_segment(&inventory_template_id)
        ),
        HashMap::new(),
    ))
}

pub fn cosmetics_index_get_input(
    endpoint: String,
    item_type: ProfileDecorationEquipSlot,
) -> VrchatRequest {
    get_input(
        endpoint,
        format!("cosmetics/index/{}", item_type.as_str()),
        HashMap::new(),
    )
}

pub fn inventory_item_equip_input(
    endpoint: String,
    inventory_id: String,
    equip_slot: ProfileDecorationEquipSlot,
) -> Result<VrchatRequest, HttpApiError> {
    let inventory_id = require_text(
        inventory_id,
        "VrchatMediaProfileDecorationEquip requires inventoryId.",
    )?;
    Ok(api_input(
        endpoint,
        "PUT",
        format!("inventory/{}/equip", encode_path_segment(&inventory_id)),
        Some(serde_json::json!({ "equipSlot": equip_slot.as_str() })),
    ))
}

pub fn inventory_slot_unequip_input(
    endpoint: String,
    equip_slot: ProfileDecorationEquipSlot,
) -> Result<VrchatRequest, HttpApiError> {
    Ok(api_input(
        endpoint,
        "DELETE",
        format!(
            "inventory/{}/equip",
            encode_path_segment(equip_slot.as_str())
        ),
        None,
    ))
}

pub fn inventory_item_update_input(
    endpoint: String,
    inventory_id: String,
    params: InventoryItemUpdateRequest,
) -> Result<VrchatRequest, HttpApiError> {
    let inventory_id = require_text(
        inventory_id,
        "VrchatMediaInventoryItemUpdate requires inventoryId.",
    )?;
    Ok(api_input(
        endpoint,
        "PUT",
        format!("inventory/{}", encode_path_segment(&inventory_id)),
        Some(serde_json::json!(params)),
    ))
}

pub fn inventory_bundle_consume_input(
    endpoint: String,
    inventory_id: String,
) -> Result<VrchatRequest, HttpApiError> {
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

pub fn reward_redeem_input(endpoint: String, code: String) -> Result<VrchatRequest, HttpApiError> {
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
) -> Result<VrchatRequest, HttpApiError> {
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
    kind: FileUploadStageKind,
) -> Result<String, HttpApiError> {
    let file_id = require_text(file_id, "VrchatMediaFileUploadStage requires fileId.")?;
    Ok(format!(
        "file/{}/{}/{}",
        encode_path_segment(&file_id),
        version,
        kind.as_str()
    ))
}

pub fn file_upload_start_input(endpoint: String, path: String) -> VrchatRequest {
    api_input(
        endpoint,
        "PUT",
        format!("{path}/start"),
        Some(serde_json::json!({})),
    )
}

pub fn file_upload_finish_input(endpoint: String, path: String) -> VrchatRequest {
    api_input(
        endpoint,
        "PUT",
        format!("{path}/finish"),
        Some(serde_json::json!({ "maxParts": 0, "nextPartNumber": 0 })),
    )
}

pub fn file_put_input(
    url: String,
    file_data: Vec<u8>,
    file_mime: String,
    file_md5: String,
) -> VrchatRequest {
    VrchatRequest {
        url: Some(url),
        body: VrchatRequestBody::Upload(VrchatUpload::FilePut {
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
) -> Result<VrchatRequest, HttpApiError> {
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
) -> Result<VrchatRequest, HttpApiError> {
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
) -> Result<VrchatRequest, HttpApiError> {
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
