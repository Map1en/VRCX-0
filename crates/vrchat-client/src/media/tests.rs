use std::collections::HashMap;

use serde_json::{json, Value};

use super::*;

const ENDPOINT: &str = "https://api.vrchat.cloud/api/1";

fn post_data(request: &HttpApiRequestInput) -> Value {
    serde_json::from_str(request.post_data.as_deref().unwrap()).unwrap()
}

#[test]
fn gallery_and_icon_assets_use_expected_tags_and_matching_modes() {
    let (kind, gallery) = asset_upload_input(
        ENDPOINT.into(),
        " gallery ".into(),
        "gallery-image".into(),
        true,
        HashMap::new(),
    )
    .unwrap();
    assert_eq!(kind, "gallery");
    assert_eq!(gallery.path.as_deref(), Some("file/image"));
    assert_eq!(gallery.upload_image, Some(true));
    assert_eq!(gallery.matching_dimensions, Some(false));
    assert_eq!(post_data(&gallery), json!({ "tag": "gallery" }));

    let (_, icons) = asset_upload_input(
        ENDPOINT.into(),
        "icons".into(),
        "icon-image".into(),
        false,
        HashMap::new(),
    )
    .unwrap();
    assert_eq!(icons.path.as_deref(), Some("file/image"));
    assert_eq!(icons.upload_image, Some(true));
    assert_eq!(icons.matching_dimensions, Some(true));
    assert_eq!(post_data(&icons), json!({ "tag": "icon" }));
}

#[test]
fn emoji_and_sticker_assets_use_expected_params_and_mask() {
    let (_, emojis) = asset_upload_input(
        ENDPOINT.into(),
        "emojis".into(),
        "emoji-image".into(),
        false,
        HashMap::from([
            ("tag".into(), json!("emoji")),
            ("animated".into(), json!(true)),
        ]),
    )
    .unwrap();
    assert_eq!(emojis.path.as_deref(), Some("file/image"));
    assert_eq!(emojis.upload_image, Some(true));
    assert_eq!(emojis.matching_dimensions, Some(true));
    assert_eq!(
        post_data(&emojis),
        json!({ "tag": "emoji", "animated": true })
    );

    let (_, stickers) = asset_upload_input(
        ENDPOINT.into(),
        "stickers".into(),
        "sticker-image".into(),
        false,
        HashMap::new(),
    )
    .unwrap();
    assert_eq!(stickers.path.as_deref(), Some("file/image"));
    assert_eq!(stickers.upload_image, Some(true));
    assert_eq!(stickers.matching_dimensions, Some(true));
    assert_eq!(
        post_data(&stickers),
        json!({ "tag": "sticker", "maskTag": "square" })
    );
}

#[test]
fn print_assets_use_print_route_and_crop_flag() {
    let (_, request) = asset_upload_input(
        ENDPOINT.into(),
        "prints".into(),
        "print-image".into(),
        true,
        HashMap::from([("note".into(), json!("caption"))]),
    )
    .unwrap();

    assert_eq!(request.path.as_deref(), Some("prints"));
    assert_eq!(request.upload_image_print, Some(true));
    assert_eq!(request.crop_white_border, Some(true));
    assert_eq!(request.image_data.as_deref(), Some("print-image"));
    assert_eq!(post_data(&request), json!({ "note": "caption" }));
}

#[test]
fn asset_upload_rejects_unknown_kind() {
    assert!(asset_upload_input(
        ENDPOINT.into(),
        "videos".into(),
        "data".into(),
        false,
        HashMap::new(),
    )
    .is_err());
}

#[test]
fn file_upload_stage_accepts_only_file_and_signature_with_encoded_id() {
    assert_eq!(
        file_upload_stage_path(" file_1/unsafe ".into(), 4, " file ".into()).unwrap(),
        "file/file%5F1%2Funsafe/4/file"
    );
    assert_eq!(
        file_upload_stage_path("file_1/unsafe".into(), 4, "signature".into()).unwrap(),
        "file/file%5F1%2Funsafe/4/signature"
    );
    assert!(file_upload_stage_path("file_1".into(), 4, "manifest".into()).is_err());
}

#[test]
fn file_upload_start_and_finish_use_put_paths_and_bodies() {
    let path = "file/file%5F1/3/file".to_string();
    let start = file_upload_start_input(ENDPOINT.into(), path.clone());
    assert_eq!(start.method.as_deref(), Some("PUT"));
    assert_eq!(start.path.as_deref(), Some("file/file%5F1/3/file/start"));
    assert_eq!(start.body, Some(json!({})));

    let finish = file_upload_finish_input(ENDPOINT.into(), path);
    assert_eq!(finish.method.as_deref(), Some("PUT"));
    assert_eq!(finish.path.as_deref(), Some("file/file%5F1/3/file/finish"));
    assert_eq!(
        finish.body,
        Some(json!({ "maxParts": 0, "nextPartNumber": 0 }))
    );
}

#[test]
fn file_put_sets_all_upload_fields() {
    let request = file_put_input(
        "https://files.vrchat.cloud/upload".into(),
        "file-data".into(),
        "application/octet-stream".into(),
        "base64-md5".into(),
    );

    assert_eq!(
        request.url.as_deref(),
        Some("https://files.vrchat.cloud/upload")
    );
    assert_eq!(request.upload_file_put, Some(true));
    assert_eq!(request.file_data.as_deref(), Some("file-data"));
    assert_eq!(
        request.file_mime.as_deref(),
        Some("application/octet-stream")
    );
    assert_eq!(request.file_md5.as_deref(), Some("base64-md5"));
}

#[test]
fn media_id_requests_reject_empty_text() {
    assert!(file_delete_input(ENDPOINT.into(), " ".into()).is_err());
    assert!(prints_get_input(ENDPOINT.into(), " ".into(), 10).is_err());
    assert!(print_get_input(ENDPOINT.into(), " ".into()).is_err());
    assert!(print_delete_input(ENDPOINT.into(), " ".into()).is_err());
    assert!(user_inventory_item_get_input(ENDPOINT.into(), " ".into(), "inv_1".into(),).is_err());
    assert!(user_inventory_item_get_input(ENDPOINT.into(), "usr_1".into(), " ".into(),).is_err());
    assert!(inventory_item_update_input(ENDPOINT.into(), " ".into(), HashMap::new()).is_err());
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
    assert!(file_upload_stage_path(" ".into(), 1, "file".into()).is_err());
    assert!(avatar_image_set_input(ENDPOINT.into(), " ".into(), "url".into()).is_err());
    assert!(world_image_set_input(ENDPOINT.into(), " ".into(), "url".into()).is_err());
}
