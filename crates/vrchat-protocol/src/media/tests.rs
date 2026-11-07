use std::collections::HashMap;

use serde_json::{json, Value};

use super::*;

const ENDPOINT: &str = "https://api.vrchat.cloud/api/1";

fn post_data(request: &VrchatRequest) -> Value {
    let post_data = match request.body.as_upload().unwrap() {
        VrchatUpload::Image { post_data, .. }
        | VrchatUpload::PrintImage { post_data, .. }
        | VrchatUpload::LegacyImage { post_data, .. } => post_data,
        VrchatUpload::FilePut { .. } => panic!("expected image upload"),
    };
    serde_json::from_str(post_data.as_deref().unwrap()).unwrap()
}

#[test]
fn gallery_and_icon_assets_use_expected_tags_and_matching_modes() {
    let (kind, gallery) = asset_upload_input(
        ENDPOINT.into(),
        MediaAssetUploadRequest::Gallery {
            image_data: "gallery-image".into(),
        },
    )
    .unwrap();
    assert_eq!(kind, MediaAssetKind::Gallery);
    assert_eq!(gallery.path.as_deref(), Some("file/image"));
    assert!(matches!(
        gallery.body.as_upload(),
        Some(VrchatUpload::Image {
            matching_dimensions: false,
            ..
        })
    ));
    assert_eq!(post_data(&gallery), json!({ "tag": "gallery" }));

    let (_, icons) = asset_upload_input(
        ENDPOINT.into(),
        MediaAssetUploadRequest::Icons {
            image_data: "icon-image".into(),
        },
    )
    .unwrap();
    assert_eq!(icons.path.as_deref(), Some("file/image"));
    assert!(matches!(
        icons.body.as_upload(),
        Some(VrchatUpload::Image {
            matching_dimensions: true,
            ..
        })
    ));
    assert_eq!(post_data(&icons), json!({ "tag": "icon" }));
}

#[test]
fn emoji_and_sticker_assets_use_expected_params_and_mask() {
    let (_, emojis) = asset_upload_input(
        ENDPOINT.into(),
        MediaAssetUploadRequest::Emojis {
            image_data: "emoji-image".into(),
            params: EmojiUploadParams::EmojiAnimated {
                animation_style: ImageAnimationStyle::Bounce,
                mask_tag: ImageMaskTag::Square,
                frames: 4,
                frames_over_time: 15,
                loop_style: Some(EmojiLoopStyle::PingPong),
            },
        },
    )
    .unwrap();
    assert_eq!(emojis.path.as_deref(), Some("file/image"));
    assert!(matches!(
        emojis.body.as_upload(),
        Some(VrchatUpload::Image {
            matching_dimensions: true,
            ..
        })
    ));
    assert_eq!(
        post_data(&emojis),
        json!({
            "tag": "emojianimated",
            "animationStyle": "bounce",
            "maskTag": "square",
            "frames": 4,
            "framesOverTime": 15,
            "loopStyle": "pingpong",
        })
    );

    let (_, stickers) = asset_upload_input(
        ENDPOINT.into(),
        MediaAssetUploadRequest::Stickers {
            image_data: "sticker-image".into(),
        },
    )
    .unwrap();
    assert_eq!(stickers.path.as_deref(), Some("file/image"));
    assert!(matches!(
        stickers.body.as_upload(),
        Some(VrchatUpload::Image {
            matching_dimensions: true,
            ..
        })
    ));
    assert_eq!(
        post_data(&stickers),
        json!({ "tag": "sticker", "maskTag": "square" })
    );
}

#[test]
fn print_assets_use_print_route_and_crop_flag() {
    let (_, request) = asset_upload_input(
        ENDPOINT.into(),
        MediaAssetUploadRequest::Prints {
            image_data: "print-image".into(),
            crop_white_border: true,
            params: PrintUploadParams {
                note: "caption".into(),
                timestamp: "2026-08-19T00:00:00Z".into(),
            },
        },
    )
    .unwrap();

    assert_eq!(request.path.as_deref(), Some("prints"));
    assert!(matches!(
        request.body.as_upload(),
        Some(VrchatUpload::PrintImage {
            image_data,
            crop_white_border: true,
            ..
        }) if image_data == "print-image"
    ));
    assert_eq!(
        post_data(&request),
        json!({ "note": "caption", "timestamp": "2026-08-19T00:00:00Z" })
    );
}

#[test]
fn asset_upload_kind_rejects_unknown_wire_value() {
    assert!(serde_json::from_str::<MediaAssetKind>(r#""videos""#).is_err());
}

#[test]
fn media_params_reject_unknown_fields_and_enum_values() {
    assert!(serde_json::from_value::<MediaFileListParams>(json!({
        "tag": "video",
    }))
    .is_err());
    assert!(serde_json::from_value::<EmojiUploadParams>(json!({
        "tag": "emoji",
        "animationStyle": "wave",
        "maskTag": "square",
    }))
    .is_err());
    assert!(serde_json::from_value::<EmojiUploadParams>(json!({
        "tag": "emoji",
        "animationStyle": "stop",
        "maskTag": "square",
        "frames": 4,
    }))
    .is_err());
    assert!(serde_json::from_value::<EmojiUploadParams>(json!({
        "tag": "emojianimated",
        "animationStyle": "stop",
        "maskTag": "square",
        "frames": 1,
        "framesOverTime": 65,
    }))
    .is_err());
    assert!(serde_json::from_value::<EmojiUploadParams>(json!({
        "tag": "emojianimated",
        "animationStyle": "stop",
        "maskTag": "square",
        "frames": 4,
    }))
    .is_err());
    assert!(serde_json::from_value::<InventoryListParams>(json!({
        "order": "oldest",
    }))
    .is_err());
}

#[test]
fn inventory_template_get_trims_and_encodes_the_template_id() {
    let request = inventory_template_get_input(ENDPOINT.into(), " invt_1/雪 ".into()).unwrap();

    assert_eq!(request.method.as_deref(), Some("GET"));
    assert_eq!(
        request.path.as_deref(),
        Some("inventory/template/invt%5F1%2F%E9%9B%AA")
    );
    assert_eq!(request.query_params, Some(HashMap::new()));
}

#[test]
fn cosmetics_index_get_uses_the_item_type_path() {
    let request =
        cosmetics_index_get_input(ENDPOINT.into(), ProfileDecorationEquipSlot::NameplateEffect);

    assert_eq!(request.method.as_deref(), Some("GET"));
    assert_eq!(
        request.path.as_deref(),
        Some("cosmetics/index/nameplateEffect")
    );
    assert_eq!(request.query_params, Some(HashMap::new()));
}

#[test]
fn inventory_item_equip_uses_owned_item_path_and_only_the_slot_body() {
    let request = inventory_item_equip_input(
        ENDPOINT.into(),
        " inv_1/雪 ".into(),
        ProfileDecorationEquipSlot::IconFrame,
    )
    .unwrap();

    assert_eq!(request.method.as_deref(), Some("PUT"));
    assert_eq!(
        request.path.as_deref(),
        Some("inventory/inv%5F1%2F%E9%9B%AA/equip")
    );
    assert_eq!(
        request.body.as_json(),
        Some(&json!({ "equipSlot": "iconFrame" }))
    );
}

#[test]
fn inventory_slot_unequip_uses_the_encoded_slot_path_without_a_body() {
    let request =
        inventory_slot_unequip_input(ENDPOINT.into(), ProfileDecorationEquipSlot::ProfileEffect)
            .unwrap();

    assert_eq!(request.method.as_deref(), Some("DELETE"));
    assert_eq!(
        request.path.as_deref(),
        Some("inventory/profileEffect/equip")
    );
    assert_eq!(request.body, VrchatRequestBody::Empty);
    assert_eq!(request.headers, None);
}

#[test]
fn file_upload_stage_accepts_only_file_and_signature_with_encoded_id() {
    assert_eq!(
        file_upload_stage_path(" file_1/unsafe ".into(), 4, FileUploadStageKind::File).unwrap(),
        "file/file%5F1%2Funsafe/4/file"
    );
    assert_eq!(
        file_upload_stage_path("file_1/unsafe".into(), 4, FileUploadStageKind::Signature,).unwrap(),
        "file/file%5F1%2Funsafe/4/signature"
    );
    assert!(serde_json::from_str::<FileUploadStageKind>(r#""manifest""#).is_err());
}

#[test]
fn file_upload_start_and_finish_use_put_paths_and_bodies() {
    let path = "file/file%5F1/3/file".to_string();
    let start = file_upload_start_input(ENDPOINT.into(), path.clone());
    assert_eq!(start.method.as_deref(), Some("PUT"));
    assert_eq!(start.path.as_deref(), Some("file/file%5F1/3/file/start"));
    assert_eq!(start.body.as_json(), Some(&json!({})));

    let finish = file_upload_finish_input(ENDPOINT.into(), path);
    assert_eq!(finish.method.as_deref(), Some("PUT"));
    assert_eq!(finish.path.as_deref(), Some("file/file%5F1/3/file/finish"));
    assert_eq!(
        finish.body.as_json(),
        Some(&json!({ "maxParts": 0, "nextPartNumber": 0 }))
    );
}

#[test]
fn file_put_sets_all_upload_fields() {
    let request = file_put_input(
        "https://files.vrchat.cloud/upload".into(),
        b"file-data".to_vec(),
        "application/octet-stream".into(),
        "base64-md5".into(),
    );

    assert_eq!(
        request.url.as_deref(),
        Some("https://files.vrchat.cloud/upload")
    );
    assert!(matches!(
        request.body.as_upload(),
        Some(VrchatUpload::FilePut {
            file_data,
            file_mime,
            file_md5: Some(file_md5),
        }) if file_data == b"file-data"
            && file_mime == "application/octet-stream"
            && file_md5 == "base64-md5"
    ));
}

#[test]
fn media_id_requests_reject_empty_text() {
    assert!(file_delete_input(ENDPOINT.into(), " ".into()).is_err());
    assert!(prints_get_input(ENDPOINT.into(), " ".into(), 10).is_err());
    assert!(print_get_input(ENDPOINT.into(), " ".into()).is_err());
    assert!(print_delete_input(ENDPOINT.into(), " ".into()).is_err());
    assert!(user_inventory_item_get_input(ENDPOINT.into(), " ".into(), "inv_1".into(),).is_err());
    assert!(user_inventory_item_get_input(ENDPOINT.into(), "usr_1".into(), " ".into(),).is_err());
    assert!(inventory_item_update_input(
        ENDPOINT.into(),
        " ".into(),
        InventoryItemUpdateRequest { is_archived: true },
    )
    .is_err());
    assert!(inventory_template_get_input(ENDPOINT.into(), " ".into()).is_err());
    assert!(inventory_item_equip_input(
        ENDPOINT.into(),
        " ".into(),
        ProfileDecorationEquipSlot::IconFrame,
    )
    .is_err());
    assert!(serde_json::from_str::<ProfileDecorationEquipSlot>(r#""banner""#).is_err());
    assert!(inventory_bundle_consume_input(ENDPOINT.into(), " ".into()).is_err());
    assert!(file_version_create_input(
        ENDPOINT.into(),
        " ".into(),
        "file-md5".into(),
        1,
        "signature-md5".into(),
        1,
    )
    .is_err());
    assert!(file_upload_stage_path(" ".into(), 1, FileUploadStageKind::File).is_err());
    assert!(avatar_image_set_input(ENDPOINT.into(), " ".into(), "url".into()).is_err());
    assert!(world_image_set_input(ENDPOINT.into(), " ".into(), "url".into()).is_err());
}

#[test]
fn gallery_file_order_puts_trimmed_ids_for_the_gallery() {
    let request = gallery_file_order_input(
        ENDPOINT.into(),
        " avtr_1 ".into(),
        vec![" file_b ".into(), "".into(), "file_a".into()],
    )
    .unwrap();

    assert_eq!(request.method.as_deref(), Some("PUT"));
    assert_eq!(request.path.as_deref(), Some("files/order"));
    assert_eq!(
        request.body.as_json(),
        Some(&json!({ "ids": ["file_b", "file_a"], "galleryId": "avtr_1" }))
    );
    assert!(gallery_file_order_input(ENDPOINT.into(), "avtr_1".into(), Vec::new()).is_err());
}
