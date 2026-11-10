use serde_json::json;

use super::{
    EmojiUploadParams, ImageAnimationStyle, ImageMaskTag, InstanceCreateRegion,
    InstanceCreateRequest, InstanceCreateType, MediaFileListParams, ProfileDecorationEquipSlot,
};

#[test]
fn remote_inputs_reject_invalid_pagination_and_unknown_fields() {
    assert!(serde_json::from_value::<MediaFileListParams>(json!({ "n": -1 })).is_err());
    assert!(serde_json::from_value::<MediaFileListParams>(json!({ "future": true })).is_err());
}

#[test]
fn instance_create_contract_keeps_protocol_field_names() {
    let input = InstanceCreateRequest {
        r#type: InstanceCreateType::Public,
        can_request_invite: false,
        world_id: "wrld_test".into(),
        owner_id: None,
        region: InstanceCreateRegion::Jp,
        group_access_type: None,
        queue_enabled: None,
        role_ids: None,
        age_gate: None,
        display_name: None,
        description: None,
        category_id: None,
        vibe_ids: None,
        languages: None,
        minimum_avatar_performance: None,
    };

    assert_eq!(
        serde_json::to_value(&input).unwrap(),
        json!({
            "type": "public",
            "canRequestInvite": false,
            "worldId": "wrld_test",
            "region": "jp"
        })
    );

    let described = InstanceCreateRequest {
        description: Some("Movie night".into()),
        category_id: Some("icat_watch".into()),
        vibe_ids: Some(vec!["ivib_chill".into()]),
        languages: Some(vec!["jpn".into()]),
        ..input
    };
    assert_eq!(
        serde_json::to_value(described).unwrap(),
        json!({
            "type": "public",
            "canRequestInvite": false,
            "worldId": "wrld_test",
            "region": "jp",
            "description": "Movie night",
            "categoryId": "icat_watch",
            "vibeIds": ["ivib_chill"],
            "languages": ["jpn"]
        })
    );
}

#[test]
fn tagged_media_input_and_equip_slot_keep_ipc_shape() {
    let params = EmojiUploadParams::Emoji {
        animation_style: ImageAnimationStyle::Aura,
        mask_tag: ImageMaskTag::Square,
    };
    assert_eq!(
        serde_json::to_value(params).unwrap(),
        json!({ "tag": "emoji", "animationStyle": "aura", "maskTag": "square" })
    );
    assert_eq!(
        serde_json::to_value(ProfileDecorationEquipSlot::NameplateEffect).unwrap(),
        json!("nameplateEffect")
    );
}
