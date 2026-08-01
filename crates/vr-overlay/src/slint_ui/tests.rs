use super::*;
use super::{
    platform::{ensure_platform, to_slint_color},
    wrist::{wrist_device_item, wrist_device_tokens, wrist_feed_item, WRIST_MUTED_TEXT},
};
use crate::{
    AvatarBitmap, DeviceChip, DeviceRole, DeviceStatus, FeedKind, FeedLine, FeedRelation,
    FeedSeverity, MainSurfaceModel, OverlayFooter, RgbaFrame, ToastCard, WristSurfaceModel,
};
#[cfg(feature = "friends-panel")]
use crate::{
    FavoriteFriendsPanelModel, FriendPanelCategory, FriendPanelRow, FriendPanelRowActions,
    FriendPanelRowPrimaryAction, FriendPanelStatusTone,
};
use std::{sync::Arc, thread};

#[test]
fn slint_platform_init_is_available_on_each_render_thread() {
    ensure_platform().unwrap();
    thread::spawn(|| {
        let mut renderer = SlintWristRenderer::new();
        let frame = renderer.render(&sample_wrist_model()).unwrap();
        assert_eq!(frame.size, OverlaySize::new(512, 512));
    })
    .join()
    .unwrap();
}

#[cfg(feature = "friends-panel")]
#[test]
fn slint_panel_host_renders_friends_model_and_dispatches_pointer_input() {
    let mut host = SlintPanelHost::new(OverlaySize::new(1080, 720)).unwrap();
    host.set_model(&sample_friends_model());
    let initial = host.render_if_needed().unwrap().unwrap();
    assert_eq!(initial.frame.size, OverlaySize::new(1080, 720));
    assert_eq!(initial.frame.data[3], 240);
    assert!(host.render_if_needed().unwrap().is_none());
    host.dispatch(SlintPanelPointerEvent::Moved { x: 350.0, y: 190.0 })
        .unwrap();
    let hover = host.render_if_needed().unwrap().unwrap();

    assert_ne!(initial.frame.data, hover.frame.data);
    assert!(hover.stats.dirty_area > 0);
    assert!(hover.stats.dirty_area < u64::from(1080_u32 * 720_u32));
}

#[test]
fn slint_wrist_renderer_reuses_cached_frame_for_equal_model() {
    let mut renderer = SlintWristRenderer::new();
    let model = sample_wrist_model();

    let first = renderer.render(&model).unwrap();
    let second = renderer.render(&model).unwrap();

    assert_eq!(first, second);
    assert_eq!(renderer.render_count(), 1);

    let mut changed = model.clone();
    changed.footer.right = "12:35".to_string();
    let third = renderer.render(&changed).unwrap();

    assert_ne!(first, third);
    assert_eq!(renderer.render_count(), 2);
}

#[test]
fn slint_hmd_renderer_reuses_cached_frame_for_equal_model() {
    let mut renderer = SlintHmdRenderer::new();
    let model = sample_main_model();

    let first = renderer.render(&model).unwrap();
    let second = renderer.render(&model).unwrap();

    assert_eq!(first, second);
    assert_eq!(renderer.render_count(), 1);

    let mut changed = model.clone();
    changed.toasts[0].action = "joined a private instance".to_string();
    let third = renderer.render(&changed).unwrap();

    assert_ne!(first, third);
    assert_eq!(renderer.render_count(), 2);
}

#[test]
fn slint_hmd_renderer_shows_late_arriving_avatar() {
    let mut renderer = SlintHmdRenderer::new();
    let mut model = sample_main_model();
    let avatar = model.toasts[0].avatar.take();

    let without_avatar = renderer.render(&model).unwrap();

    model.toasts[0].avatar = avatar;
    let with_avatar = renderer.render(&model).unwrap();

    assert_ne!(without_avatar, with_avatar);
    assert_eq!(renderer.render_count(), 2);
}

#[test]
fn slint_hmd_renderer_hides_avatar_placeholder_when_avatar_slot_is_disabled() {
    let mut renderer = SlintHmdRenderer::new();
    let mut model = sample_main_model();
    model.toasts[0].avatar = None;
    model.toasts[0].show_avatar = true;

    let with_placeholder = renderer.render(&model).unwrap();

    model.toasts[0].show_avatar = false;
    let without_slot = renderer.render(&model).unwrap();

    assert_ne!(with_placeholder, without_slot);
    assert_eq!(renderer.render_count(), 2);
}

#[test]
fn slint_hmd_card_alpha_tracks_toast_opacity_from_an_opaque_baseline() {
    let mut renderer = SlintHmdRenderer::new();
    let mut model = sample_main_model();
    let pixel_alpha = |frame: &RgbaFrame| {
        let index = ((440 * frame.size.width + 800) * 4 + 3) as usize;
        frame.data[index]
    };

    let opaque = renderer.render(&model).unwrap();
    assert_eq!(pixel_alpha(&opaque), 255);

    model.toasts[0].opacity = 0.5;
    let fading = renderer.render(&model).unwrap();
    assert!((126..=129).contains(&pixel_alpha(&fading)));
}

#[test]
fn wrist_device_tokens_prioritize_abnormal_trackers_and_filter_normal_other_devices() {
    let devices = vec![
        device("HMD", DeviceRole::Hmd, DeviceStatus::Normal, Some(90), 10),
        device(
            "L",
            DeviceRole::LeftController,
            DeviceStatus::LowBattery,
            Some(20),
            30,
        ),
        device(
            "R",
            DeviceRole::RightController,
            DeviceStatus::Normal,
            Some(80),
            10,
        ),
        device(
            "T1",
            DeviceRole::Tracker,
            DeviceStatus::TrackingWarning,
            None,
            30,
        ),
        device(
            "T2",
            DeviceRole::Tracker,
            DeviceStatus::CriticalBattery,
            Some(7),
            40,
        ),
        device(
            "T3",
            DeviceRole::Tracker,
            DeviceStatus::Normal,
            Some(70),
            10,
        ),
        device(
            "T5",
            DeviceRole::Tracker,
            DeviceStatus::LowBattery,
            Some(21),
            30,
        ),
        device(
            "Dongle",
            DeviceRole::Other,
            DeviceStatus::Disconnected,
            None,
            40,
        ),
        device("Camera", DeviceRole::Other, DeviceStatus::Normal, None, 10),
    ];

    let labels = wrist_device_tokens(&devices, 512.0)
        .into_iter()
        .map(|token| token.label)
        .collect::<Vec<_>>();

    assert_eq!(labels, ["HMD", "L", "R", "T2", "T1", "+1", "T×1", "Dongle"]);
}

#[test]
fn wrist_device_without_a_battery_reading_does_not_draw_a_full_battery() {
    let devices = [device(
        "L",
        DeviceRole::LeftController,
        DeviceStatus::Normal,
        None,
        10,
    )];
    let tokens = wrist_device_tokens(&devices, 512.0);
    let item = wrist_device_item(&tokens[0], true);

    assert!(!item.show_battery);
    assert!(!item.show_percent);
    assert_eq!(item.battery_fill, 0.0);
}

#[test]
fn wrist_charging_device_shows_a_charging_marker() {
    let devices = [device(
        "HMD",
        DeviceRole::Hmd,
        DeviceStatus::Charging,
        Some(82),
        20,
    )];
    let tokens = wrist_device_tokens(&devices, 512.0);
    let item = wrist_device_item(&tokens[0], true);

    assert_eq!(item.percent.as_str(), "82% ⚡");
}

#[test]
fn wrist_feed_item_preserves_actor_detail_and_muted_media_detail() {
    let favorite = FeedLine {
        time_text: "16:31".to_string(),
        kind: FeedKind::Invite,
        actor_text: "Ada".to_string(),
        detail: "Ada invited you".to_string(),
        relation: FeedRelation::Favorite,
        severity: FeedSeverity::Important,
    };
    let media = FeedLine {
        time_text: String::new(),
        kind: FeedKind::Media,
        actor_text: "Player".to_string(),
        detail: "Muted media row".to_string(),
        relation: FeedRelation::None,
        severity: FeedSeverity::Normal,
    };

    let favorite_item = wrist_feed_item(&favorite);
    let media_item = wrist_feed_item(&media);

    assert!(favorite_item.has_actor);
    assert_eq!(favorite_item.actor.to_string(), "Ada");
    assert_eq!(favorite_item.detail.to_string(), "invited you");
    assert!(favorite_item.show_severity);
    assert!(!media_item.has_actor);
    assert_eq!(media_item.detail.to_string(), "Muted media row");
    assert_eq!(media_item.detail_color, to_slint_color(WRIST_MUTED_TEXT));
}

fn sample_wrist_model() -> WristSurfaceModel {
    WristSurfaceModel {
        size: OverlaySize::new(512, 512),
        dark_background: true,
        show_battery_percent: true,
        devices: vec![
            DeviceChip {
                label: "HMD".to_string(),
                role: DeviceRole::Hmd,
                status: DeviceStatus::Normal,
                battery_percent: Some(82),
                text: "82".to_string(),
                priority: 10,
            },
            DeviceChip {
                label: "L".to_string(),
                role: DeviceRole::LeftController,
                status: DeviceStatus::LowBattery,
                battery_percent: Some(18),
                text: "18 low".to_string(),
                priority: 20,
            },
        ],
        feed_rows: vec![FeedLine {
            time_text: "16:31".to_string(),
            kind: FeedKind::Invite,
            actor_text: "Ada".to_string(),
            detail: "Ada invited you to 测试世界".to_string(),
            relation: FeedRelation::Favorite,
            severity: FeedSeverity::Important,
        }],
        footer: OverlayFooter {
            left: "8 players".to_string(),
            center: "Instance 12m".to_string(),
            right: "12:34".to_string(),
        },
        accent: crate::Color::rgba(94, 234, 212, 255),
    }
}

fn sample_main_model() -> MainSurfaceModel {
    MainSurfaceModel {
        size: OverlaySize::new(960, 528),
        dark_background: true,
        accent: crate::Color::rgba(94, 234, 212, 255),
        toasts: vec![ToastCard {
            actor_name: "Ada".to_string(),
            relation: FeedRelation::Favorite,
            action: "joined your instance".to_string(),
            severity: FeedSeverity::Important,
            avatar: Some(AvatarBitmap {
                width: 2,
                height: 2,
                rgba: Arc::from(vec![
                    255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255,
                ]),
            }),
            show_avatar: true,
            opacity: 1.0,
            slide_offset: 0.0,
        }],
    }
}

#[cfg(feature = "friends-panel")]
fn sample_friends_model() -> FavoriteFriendsPanelModel {
    FavoriteFriendsPanelModel {
        categories: vec![FriendPanelCategory {
            key: "all".to_string(),
            label: "All".to_string(),
            count: 1,
        }],
        rows: vec![FriendPanelRow {
            section_label: None,
            user_id: "usr_friend".to_string(),
            display_name: "Ada".to_string(),
            status: FriendPanelStatusTone::Online,
            location_text: "测试世界 Public".to_string(),
            is_traveling: false,
            traveling_text: None,
            note: Some("VRChat note".to_string()),
            memo: Some("Local memo".to_string()),
            avatar: Some(AvatarBitmap {
                width: 2,
                height: 2,
                rgba: Arc::from(vec![
                    255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255,
                ]),
            }),
            actions: FriendPanelRowActions {
                primary: Some(FriendPanelRowPrimaryAction::Open),
                invite: true,
            },
        }],
        ..FavoriteFriendsPanelModel::default()
    }
}

fn device(
    label: &str,
    role: DeviceRole,
    status: DeviceStatus,
    battery_percent: Option<u8>,
    priority: u8,
) -> DeviceChip {
    DeviceChip {
        label: label.to_string(),
        role,
        status,
        battery_percent,
        text: String::new(),
        priority,
    }
}
