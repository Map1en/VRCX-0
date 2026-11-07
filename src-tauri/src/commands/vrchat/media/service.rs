#![allow(non_snake_case)]

use tauri::State;

use crate::error::AppError;
use crate::state::AppState;
use vrcx_0_application::media::{
    InventoryItemsCollectInput, InventoryItemsCollectOutput, LegacyEntityImageKind,
    LegacyEntityImageUploadInput,
};
use vrcx_0_application::remote::MediaAssetUploadRequest;
use vrcx_0_application::social::{PrintFavoriteBulkResult, PrintFavoriteState};
use vrcx_0_contracts::vrchat_api::VrchatResponse;

use super::types::{
    VrchatMediaAvatarGalleryImageUploadInput, VrchatMediaAvatarGalleryOrderInput,
    VrchatMediaCosmeticsIndexInput, VrchatMediaEmojiUploadInput, VrchatMediaFileIdInput,
    VrchatMediaFilesInput, VrchatMediaImageUploadInput, VrchatMediaInventoryItemInput,
    VrchatMediaInventoryItemUpdateInput, VrchatMediaInventoryItemsInput,
    VrchatMediaInventoryTemplateInput, VrchatMediaLegacyImageUploadInput, VrchatMediaPrintIdInput,
    VrchatMediaPrintUploadInput, VrchatMediaPrintsInput, VrchatMediaProfileDecorationEquipInput,
    VrchatMediaProfileDecorationUnequipInput, VrchatMediaRewardRedeemInput,
    VrchatMediaUserInventoryItemInput, VrchatPrintFavoriteSetInput, VrchatPrintFavoritesSetInput,
};

async fn run_legacy_entity_image_upload(
    state: State<'_, AppState>,
    input: VrchatMediaLegacyImageUploadInput,
    kind: LegacyEntityImageKind,
    command: &str,
) -> Result<VrchatResponse, AppError> {
    Ok(state
        .runtime_host()
        .media()
        .upload_legacy_entity_image(
            LegacyEntityImageUploadInput {
                entity_id: input.entity_id,
                image_url: input.image_url,
                base64_file: input.base64_file,
                file_size_in_bytes: input.file_size_in_bytes,
            },
            kind,
            command,
        )
        .await?)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_media_files_get(
    state: State<'_, AppState>,
    input: VrchatMediaFilesInput,
) -> Result<VrchatResponse, AppError> {
    state
        .runtime_host()
        .vrchat_remote()
        .media_files(input.params)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_media_file_delete(
    state: State<'_, AppState>,
    input: VrchatMediaFileIdInput,
) -> Result<VrchatResponse, AppError> {
    state
        .runtime_host()
        .vrchat_remote()
        .delete_media_file(input.file_id)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_media_gallery_image_upload(
    state: State<'_, AppState>,
    input: VrchatMediaImageUploadInput,
) -> Result<VrchatResponse, AppError> {
    state
        .runtime_host()
        .vrchat_remote()
        .upload_gallery_image(input.image_data)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_media_avatar_gallery_image_upload(
    state: State<'_, AppState>,
    input: VrchatMediaAvatarGalleryImageUploadInput,
) -> Result<VrchatResponse, AppError> {
    state
        .runtime_host()
        .vrchat_remote()
        .upload_avatar_gallery_image(input.image_data, input.avatar_id)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_media_avatar_gallery_order_set(
    state: State<'_, AppState>,
    input: VrchatMediaAvatarGalleryOrderInput,
) -> Result<VrchatResponse, AppError> {
    state
        .runtime_host()
        .vrchat_remote()
        .set_avatar_gallery_order(input.avatar_id, input.file_ids)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_media_vrc_plus_icon_upload(
    state: State<'_, AppState>,
    input: VrchatMediaImageUploadInput,
) -> Result<VrchatResponse, AppError> {
    state
        .runtime_host()
        .vrchat_remote()
        .upload_vrc_plus_icon(input.image_data)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_media_emoji_upload(
    state: State<'_, AppState>,
    input: VrchatMediaEmojiUploadInput,
) -> Result<VrchatResponse, AppError> {
    state
        .runtime_host()
        .vrchat_remote()
        .upload_emoji(input.image_data, input.params)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_media_sticker_upload(
    state: State<'_, AppState>,
    input: VrchatMediaImageUploadInput,
) -> Result<VrchatResponse, AppError> {
    state
        .runtime_host()
        .vrchat_remote()
        .upload_sticker(input.image_data)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_media_print_upload(
    state: State<'_, AppState>,
    input: VrchatMediaPrintUploadInput,
) -> Result<VrchatResponse, AppError> {
    state
        .runtime_host()
        .vrchat_remote()
        .upload_print(input.image_data, input.crop_white_border, input.params)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_media_asset_upload(
    state: State<'_, AppState>,
    input: MediaAssetUploadRequest,
) -> Result<VrchatResponse, AppError> {
    state
        .runtime_host()
        .vrchat_remote()
        .upload_media_asset(input)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_media_prints_get(
    state: State<'_, AppState>,
    input: VrchatMediaPrintsInput,
) -> Result<VrchatResponse, AppError> {
    state
        .runtime_host()
        .vrchat_remote()
        .prints(input.user_id, input.n)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_media_print_get(
    state: State<'_, AppState>,
    input: VrchatMediaPrintIdInput,
) -> Result<VrchatResponse, AppError> {
    state
        .runtime_host()
        .vrchat_remote()
        .print(input.print_id)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_media_print_delete(
    state: State<'_, AppState>,
    input: VrchatMediaPrintIdInput,
) -> Result<VrchatResponse, AppError> {
    state
        .runtime_host()
        .vrchat_remote()
        .delete_print(input.print_id)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_prints_favorites_list(
    state: State<'_, AppState>,
) -> Result<PrintFavoriteState, AppError> {
    Ok(state.runtime_host().media().print_favorites()?)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_prints_favorite_set(
    state: State<'_, AppState>,
    input: VrchatPrintFavoriteSetInput,
) -> Result<PrintFavoriteState, AppError> {
    Ok(state
        .runtime_host()
        .media()
        .set_print_favorite(&input.print_id, input.favorite)?)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_prints_favorites_set(
    state: State<'_, AppState>,
    input: VrchatPrintFavoritesSetInput,
) -> Result<PrintFavoriteBulkResult, AppError> {
    Ok(state
        .runtime_host()
        .media()
        .set_print_favorites(&input.print_ids, input.favorite)?)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_media_inventory_items_get(
    state: State<'_, AppState>,
    input: VrchatMediaInventoryItemsInput,
) -> Result<VrchatResponse, AppError> {
    state
        .runtime_host()
        .vrchat_remote()
        .inventory_items(input.params)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_media_inventory_items_collect(
    state: State<'_, AppState>,
    input: InventoryItemsCollectInput,
) -> Result<InventoryItemsCollectOutput, AppError> {
    Ok(state
        .runtime_host()
        .media()
        .collect_inventory_items(input)
        .await?)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_media_inventory_template_get(
    state: State<'_, AppState>,
    input: VrchatMediaInventoryTemplateInput,
) -> Result<VrchatResponse, AppError> {
    state
        .runtime_host()
        .vrchat_remote()
        .inventory_template(input.inventory_template_id)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_media_cosmetics_index_get(
    state: State<'_, AppState>,
    input: VrchatMediaCosmeticsIndexInput,
) -> Result<VrchatResponse, AppError> {
    state
        .runtime_host()
        .vrchat_remote()
        .cosmetics_index(input.item_type)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_media_profile_decoration_equip(
    state: State<'_, AppState>,
    input: VrchatMediaProfileDecorationEquipInput,
) -> Result<VrchatResponse, AppError> {
    state
        .runtime_host()
        .vrchat_remote()
        .equip_profile_decoration(input.inventory_id, input.equip_slot)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_media_profile_decoration_unequip(
    state: State<'_, AppState>,
    input: VrchatMediaProfileDecorationUnequipInput,
) -> Result<VrchatResponse, AppError> {
    state
        .runtime_host()
        .vrchat_remote()
        .unequip_profile_decoration(input.equip_slot)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_media_user_inventory_item_get(
    state: State<'_, AppState>,
    input: VrchatMediaUserInventoryItemInput,
) -> Result<VrchatResponse, AppError> {
    state
        .runtime_host()
        .vrchat_remote()
        .user_inventory_item(input.user_id, input.inventory_id)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_media_inventory_item_update(
    state: State<'_, AppState>,
    input: VrchatMediaInventoryItemUpdateInput,
) -> Result<VrchatResponse, AppError> {
    state
        .runtime_host()
        .vrchat_remote()
        .update_inventory_item(input.inventory_id, input.params)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_media_inventory_bundle_consume(
    state: State<'_, AppState>,
    input: VrchatMediaInventoryItemInput,
) -> Result<VrchatResponse, AppError> {
    state
        .runtime_host()
        .vrchat_remote()
        .consume_inventory_bundle(input.inventory_id)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_media_reward_redeem(
    state: State<'_, AppState>,
    input: VrchatMediaRewardRedeemInput,
) -> Result<VrchatResponse, AppError> {
    state
        .runtime_host()
        .vrchat_remote()
        .redeem_reward(input.code)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_media_avatar_image_upload_legacy(
    state: State<'_, AppState>,
    input: VrchatMediaLegacyImageUploadInput,
) -> Result<VrchatResponse, AppError> {
    run_legacy_entity_image_upload(
        state,
        input,
        LegacyEntityImageKind::Avatar,
        "app__vrchat_media_avatar_image_upload_legacy",
    )
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_media_world_image_upload_legacy(
    state: State<'_, AppState>,
    input: VrchatMediaLegacyImageUploadInput,
) -> Result<VrchatResponse, AppError> {
    run_legacy_entity_image_upload(
        state,
        input,
        LegacyEntityImageKind::World,
        "app__vrchat_media_world_image_upload_legacy",
    )
    .await
}
