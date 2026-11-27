use vrcx_0_application_core::Result;
use vrcx_0_contracts::vrchat_api::{VrchatRequest, VrchatResponse, VrchatScope};
use vrcx_0_core::vrchat_endpoints::VRCHAT_API_DEFAULT_ENDPOINT;
use vrcx_0_vrchat_protocol::media::{
    asset_upload_input, avatar_gallery_image_upload_input, cosmetics_index_get_input,
    file_delete_input, files_get_input, gallery_file_order_input, image_upload_input,
    inventory_bundle_consume_input, inventory_item_equip_input, inventory_item_update_input,
    inventory_items_get_input, inventory_slot_unequip_input, inventory_template_get_input,
    print_delete_input, print_get_input, print_upload_input, prints_get_input, reward_redeem_input,
    sticker_upload_input, tagged_image_upload_input, user_inventory_item_get_input,
    EmojiUploadParams, InventoryItemUpdateRequest, InventoryListParams, MediaAssetUploadRequest,
    MediaFileListParams, PrintUploadParams, ProfileDecorationEquipSlot,
};

use crate::media::prepare_media_upload_request;
use crate::social::ensure_print_deletable;

use super::VrchatRemoteFacade;

impl VrchatRemoteFacade {
    pub async fn media_files(&self, params: MediaFileListParams) -> Result<VrchatResponse> {
        self.execute(
            "app__vrchat_media_files_get",
            "Getting media files.",
            files_get_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), params),
            VrchatScope::VrchatMedia,
        )
        .await
    }

    pub async fn delete_media_file(&self, file_id: String) -> Result<VrchatResponse> {
        let detail = format!("Deleting media file {file_id}.");
        let request = file_delete_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), file_id)?;
        self.execute(
            "app__vrchat_media_file_delete",
            detail,
            request,
            VrchatScope::VrchatMedia,
        )
        .await
    }

    pub async fn set_avatar_gallery_order(
        &self,
        avatar_id: String,
        file_ids: Vec<String>,
    ) -> Result<VrchatResponse> {
        let detail = format!("Reordering avatar gallery {avatar_id}.");
        let request =
            gallery_file_order_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), avatar_id, file_ids)?;
        self.execute(
            "app__vrchat_media_avatar_gallery_order_set",
            detail,
            request,
            VrchatScope::VrchatMedia,
        )
        .await
    }

    pub async fn upload_gallery_image(&self, image_data: String) -> Result<VrchatResponse> {
        let request = tagged_image_upload_input(
            VRCHAT_API_DEFAULT_ENDPOINT.into(),
            image_data,
            "gallery",
            false,
        )?;
        self.execute_media_upload(
            "app__vrchat_media_gallery_image_upload",
            "Uploading gallery image.",
            request,
        )
        .await
    }

    pub async fn upload_avatar_gallery_image(
        &self,
        image_data: String,
        avatar_id: String,
    ) -> Result<VrchatResponse> {
        let request = avatar_gallery_image_upload_input(
            VRCHAT_API_DEFAULT_ENDPOINT.into(),
            image_data,
            avatar_id,
        )?;
        self.execute_media_upload(
            "app__vrchat_media_avatar_gallery_image_upload",
            "Uploading avatar gallery image.",
            request,
        )
        .await
    }

    pub async fn upload_vrc_plus_icon(&self, image_data: String) -> Result<VrchatResponse> {
        let request = tagged_image_upload_input(
            VRCHAT_API_DEFAULT_ENDPOINT.into(),
            image_data,
            "icon",
            true,
        )?;
        self.execute_media_upload(
            "app__vrchat_media_vrc_plus_icon_upload",
            "Uploading VRC+ icon.",
            request,
        )
        .await
    }

    pub async fn upload_emoji(
        &self,
        image_data: String,
        params: EmojiUploadParams,
    ) -> Result<VrchatResponse> {
        let request = image_upload_input(
            VRCHAT_API_DEFAULT_ENDPOINT.into(),
            "file/image",
            image_data,
            params,
            true,
        )?;
        self.execute_media_upload(
            "app__vrchat_media_emoji_upload",
            "Uploading emoji.",
            request,
        )
        .await
    }

    pub async fn upload_sticker(&self, image_data: String) -> Result<VrchatResponse> {
        let request = sticker_upload_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), image_data)?;
        self.execute_media_upload(
            "app__vrchat_media_sticker_upload",
            "Uploading sticker.",
            request,
        )
        .await
    }

    pub async fn upload_print(
        &self,
        image_data: String,
        crop_white_border: bool,
        params: PrintUploadParams,
    ) -> Result<VrchatResponse> {
        let request = print_upload_input(
            VRCHAT_API_DEFAULT_ENDPOINT.into(),
            image_data,
            crop_white_border,
            params,
        )?;
        self.execute_media_upload(
            "app__vrchat_media_print_upload",
            "Uploading print.",
            request,
        )
        .await
    }

    pub async fn upload_media_asset(
        &self,
        input: MediaAssetUploadRequest,
    ) -> Result<VrchatResponse> {
        let (asset_kind, request) = asset_upload_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), input)?;
        self.execute_media_upload(
            "app__vrchat_media_asset_upload",
            format!("Uploading media asset {asset_kind}."),
            request,
        )
        .await
    }

    pub async fn prints(&self, user_id: String, n: i32) -> Result<VrchatResponse> {
        let detail = format!("Getting prints for user {user_id}.");
        let request = prints_get_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), user_id, n)?;
        self.execute(
            "app__vrchat_media_prints_get",
            detail,
            request,
            VrchatScope::VrchatMedia,
        )
        .await
    }

    pub async fn print(&self, print_id: String) -> Result<VrchatResponse> {
        let detail = format!("Getting print {print_id}.");
        let request = print_get_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), print_id)?;
        self.execute(
            "app__vrchat_media_print_get",
            detail,
            request,
            VrchatScope::VrchatMedia,
        )
        .await
    }

    pub async fn delete_print(&self, print_id: String) -> Result<VrchatResponse> {
        ensure_print_deletable(
            self.prints.as_ref(),
            &self.auth_scope.snapshot().current_user_id,
            &print_id,
        )?;
        let detail = format!("Deleting print {print_id}.");
        let request = print_delete_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), print_id)?;
        self.execute(
            "app__vrchat_media_print_delete",
            detail,
            request,
            VrchatScope::VrchatMedia,
        )
        .await
    }

    pub async fn inventory_items(&self, params: InventoryListParams) -> Result<VrchatResponse> {
        self.execute(
            "app__vrchat_media_inventory_items_get",
            "Getting inventory items.",
            inventory_items_get_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), params),
            VrchatScope::VrchatMedia,
        )
        .await
    }

    pub async fn inventory_template(
        &self,
        inventory_template_id: String,
    ) -> Result<VrchatResponse> {
        let detail = format!("Getting inventory template {inventory_template_id}.");
        let request = inventory_template_get_input(
            VRCHAT_API_DEFAULT_ENDPOINT.into(),
            inventory_template_id,
        )?;
        self.execute(
            "app__vrchat_media_inventory_template_get",
            detail,
            request,
            VrchatScope::VrchatMedia,
        )
        .await
    }

    pub async fn cosmetics_index(
        &self,
        item_type: ProfileDecorationEquipSlot,
    ) -> Result<VrchatResponse> {
        self.execute(
            "app__vrchat_media_cosmetics_index_get",
            format!("Getting {} cosmetics.", item_type.as_str()),
            cosmetics_index_get_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), item_type),
            VrchatScope::VrchatMedia,
        )
        .await
    }

    pub async fn equip_profile_decoration(
        &self,
        inventory_id: String,
        equip_slot: ProfileDecorationEquipSlot,
    ) -> Result<VrchatResponse> {
        let detail = format!("Equipping profile decoration {inventory_id}.");
        let request = inventory_item_equip_input(
            VRCHAT_API_DEFAULT_ENDPOINT.into(),
            inventory_id,
            equip_slot,
        )?;
        self.execute(
            "app__vrchat_media_profile_decoration_equip",
            detail,
            request,
            VrchatScope::VrchatMedia,
        )
        .await
    }

    pub async fn unequip_profile_decoration(
        &self,
        equip_slot: ProfileDecorationEquipSlot,
    ) -> Result<VrchatResponse> {
        let detail = format!(
            "Unequipping profile decoration slot {}.",
            equip_slot.as_str()
        );
        let request = inventory_slot_unequip_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), equip_slot)?;
        self.execute(
            "app__vrchat_media_profile_decoration_unequip",
            detail,
            request,
            VrchatScope::VrchatMedia,
        )
        .await
    }

    pub async fn user_inventory_item(
        &self,
        user_id: String,
        inventory_id: String,
    ) -> Result<VrchatResponse> {
        let detail = format!("Getting inventory item {inventory_id}.");
        let request = user_inventory_item_get_input(
            VRCHAT_API_DEFAULT_ENDPOINT.into(),
            user_id,
            inventory_id,
        )?;
        self.execute(
            "app__vrchat_media_user_inventory_item_get",
            detail,
            request,
            VrchatScope::VrchatMedia,
        )
        .await
    }

    pub async fn update_inventory_item(
        &self,
        inventory_id: String,
        params: InventoryItemUpdateRequest,
    ) -> Result<VrchatResponse> {
        let detail = format!("Updating inventory item {inventory_id}.");
        let request = inventory_item_update_input(
            VRCHAT_API_DEFAULT_ENDPOINT.into(),
            inventory_id,
            InventoryItemUpdateRequest {
                is_archived: params.is_archived,
            },
        )?;
        self.execute(
            "app__vrchat_media_inventory_item_update",
            detail,
            request,
            VrchatScope::VrchatMedia,
        )
        .await
    }

    pub async fn consume_inventory_bundle(&self, inventory_id: String) -> Result<VrchatResponse> {
        let detail = format!("Consuming inventory bundle {inventory_id}.");
        let request =
            inventory_bundle_consume_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), inventory_id)?;
        self.execute(
            "app__vrchat_media_inventory_bundle_consume",
            detail,
            request,
            VrchatScope::VrchatMedia,
        )
        .await
    }

    pub async fn redeem_reward(&self, code: String) -> Result<VrchatResponse> {
        let request = reward_redeem_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), code)?;
        self.execute(
            "app__vrchat_media_reward_redeem",
            "Redeeming reward.",
            request,
            VrchatScope::VrchatMedia,
        )
        .await
    }

    async fn execute_media_upload(
        &self,
        command: &str,
        detail: impl Into<String>,
        request: VrchatRequest,
    ) -> Result<VrchatResponse> {
        let request = prepare_media_upload_request(self.media_upload.as_ref(), request)?;
        self.execute(command, detail, request, VrchatScope::VrchatMedia)
            .await
    }
}
