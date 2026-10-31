use super::*;
use super::{
    platform::{ensure_platform, to_slint_color},
    wrist::{wrist_device_item, wrist_device_tokens, wrist_feed_item, wrist_muted_text},
};
use crate::{
    AvatarBitmap, DeviceChip, DeviceRole, DeviceStatus, FeedAccent, FeedKind, FeedLine,
    FeedRelation, FeedSeverity, MainSurfaceModel, OverlayFooter, OverlayNowPlaying, OverlaySize,
    RgbaFrame, ToastCard, WristSurfaceModel,
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
fn hmd_toasts_put_the_newest_card_on_the_inner_edge_of_the_stack() {
    use slint::Model;

    let mut model = sample_main_model();
    model.toasts = ["oldest", "middle", "newest", "latest"]
        .into_iter()
        .map(|actor| ToastCard {
            actor_name: actor.to_string(),
            show_avatar: false,
            avatar: None,
            ..model.toasts[0].clone()
        })
        .collect();
    let actors = |model: &MainSurfaceModel| {
        ensure_platform().unwrap();
        let items = hmd::hmd_toast_model(model, &mut platform::AvatarImageCache::new());
        (0..items.row_count())
            .filter_map(|row| items.row_data(row))
            .map(|item| item.actor.to_string())
            .collect::<Vec<_>>()
    };

    assert_eq!(actors(&model), ["latest", "newest", "middle"]);
    model.stack_upward = true;
    assert_eq!(actors(&model), ["middle", "newest", "latest"]);
}

#[test]
fn compact_hmd_newest_card_keeps_its_center_when_it_wraps_to_two_lines() {
    let painted_rows = |frame: &RgbaFrame| {
        let column = frame.size.width / 2;
        let rows = (0..frame.size.height)
            .filter(|y| frame.data[((y * frame.size.width + column) * 4 + 3) as usize] > 0)
            .collect::<Vec<_>>();
        (rows[0], rows[rows.len() - 1])
    };

    for stack_upward in [false, true] {
        let mut renderer = SlintHmdRenderer::new();
        let mut model = sample_main_model();
        model.compact = true;
        model.stack_upward = stack_upward;
        model.toasts[0].show_avatar = false;
        let (top, bottom) = painted_rows(&renderer.render(&model).unwrap());

        model.toasts[0].action = "joined wrld_4cf5a0c2-7f7b-4e19-9a3a-6b2e5c8d9f01:12345~private(usr_c1644b5b-3ca4-45b4-97c6-a2a0de70d469)~region(jp)".to_string();
        let (wrapped_top, wrapped_bottom) = painted_rows(&renderer.render(&model).unwrap());

        assert!(wrapped_bottom - wrapped_top > bottom - top);
        assert_eq!(
            wrapped_top + wrapped_bottom,
            top + bottom,
            "stack_upward = {stack_upward}"
        );
    }
}

#[test]
fn short_hmd_cards_keep_the_minimum_width() {
    let painted_width = |frame: &RgbaFrame, row: u32| {
        let columns = (0..frame.size.width)
            .filter(|x| frame.data[((row * frame.size.width + x) * 4 + 3) as usize] > 0)
            .collect::<Vec<_>>();
        columns[columns.len() - 1] - columns[0] + 1
    };

    for compact in [false, true] {
        let mut renderer = SlintHmdRenderer::new();
        let mut model = sample_main_model();
        model.compact = compact;
        model.toasts[0].show_avatar = false;
        model.toasts[0].action = "online".to_string();

        let frame = renderer.render(&model).unwrap();

        assert_eq!(painted_width(&frame, 40), 640, "compact = {compact}");
    }
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
fn wrist_panel_stops_painting_below_the_last_feed_row() {
    let mut renderer = SlintWristRenderer::new();
    let mut model = sample_wrist_model();
    let alpha_at =
        |frame: &RgbaFrame, y: u32| frame.data[((y * frame.size.width + 250) * 4 + 3) as usize];

    model.feed_rows = Vec::new();
    let empty = renderer.render(&model).unwrap();
    model.feed_rows = (0..2).map(feed_row).collect();
    let short = renderer.render(&model).unwrap();
    model.feed_rows = (0..8).map(feed_row).collect();
    let tall = renderer.render(&model).unwrap();

    assert!(alpha_at(&empty, 40) > 200);
    assert_eq!(alpha_at(&empty, 100), 0);
    assert!(alpha_at(&short, 100) > 200);
    assert_eq!(alpha_at(&short, 300), 0);
    assert!(alpha_at(&tall, 300) > 200);
}

#[test]
fn wrist_panel_fills_the_width_of_every_overlay_size_preset() {
    for size in overlay_size_presets() {
        let mut renderer = SlintWristRenderer::new();
        let mut model = sample_wrist_model();
        model.size = size;
        model.feed_rows = (0..4).map(feed_row).collect();

        let frame = renderer.render(&model).unwrap();

        let right_edge = ((60 * size.width + size.width - 4) * 4 + 3) as usize;
        assert!(
            frame.data[right_edge] > 200,
            "panel does not reach the right edge at {}x{}",
            size.width,
            size.height
        );
    }
}

#[test]
fn wrist_panel_clamps_the_feed_to_the_rows_that_fit_each_preset() {
    for size in overlay_size_presets() {
        let capacity = (size.height - 49 - 34) / 38;
        let panel_bottom = 49 + capacity * 38 + 34;
        let mut renderer = SlintWristRenderer::new();
        let mut model = sample_wrist_model();
        model.size = size;
        model.feed_rows = (0..capacity + 3).map(feed_row).collect();

        let frame = renderer.render(&model).unwrap();
        let alpha_at = |y: u32| frame.data[((y * size.width + 250) * 4 + 3) as usize];

        assert!(
            panel_bottom + 2 < size.height,
            "clamped panel fills {}x{} with no transparent margin left to assert on",
            size.width,
            size.height
        );
        assert!(
            alpha_at(panel_bottom - 2) > 200,
            "panel ends before its clamped height at {}x{}",
            size.width,
            size.height
        );
        assert_eq!(
            alpha_at(panel_bottom + 2),
            0,
            "panel paints past the rows that fit at {}x{}",
            size.width,
            size.height
        );
    }
}

#[test]
fn wrist_panel_reserves_up_to_two_title_lines_for_now_playing_above_the_footer() {
    let mut renderer = SlintWristRenderer::new();
    let mut model = sample_wrist_model();
    model.feed_rows = (0..2).map(feed_row).collect();
    let panel_bottom = |frame: &RgbaFrame| {
        (0..frame.size.height)
            .rev()
            .find(|y| frame.data[((y * frame.size.width + 250) * 4 + 3) as usize] > 200)
            .unwrap()
    };

    let without = panel_bottom(&renderer.render(&model).unwrap());
    model.now_playing = Some(now_playing("Never Gonna Give You Up", Some(400)));
    let one_line = panel_bottom(&renderer.render(&model).unwrap());
    model.now_playing = Some(now_playing(
        "【MV】YOASOBI「アイドル」/ Idol (Official Music Video) - TVアニメ『【推しの子】』OPテーマ 4K Remaster",
        Some(400),
    ));
    let two_lines = panel_bottom(&renderer.render(&model).unwrap());
    model.now_playing = Some(now_playing(
        &"【MV】YOASOBI「アイドル」/ Idol (Official Music Video) - TVアニメ ".repeat(6),
        Some(400),
    ));
    let truncated = panel_bottom(&renderer.render(&model).unwrap());
    model.now_playing = Some(now_playing("https://stream.example.test/live", None));
    let unknown_length = panel_bottom(&renderer.render(&model).unwrap());

    assert!(one_line > without + 40);
    assert!(two_lines > one_line + 10);
    assert!((two_lines..=two_lines + 2).contains(&truncated));
    assert_eq!(unknown_length, one_line);
}

#[test]
fn wrist_panel_redraws_only_when_the_now_playing_model_changes() {
    let mut renderer = SlintWristRenderer::new();
    let mut model = sample_wrist_model();
    model.now_playing = Some(now_playing("Never Gonna Give You Up", Some(400)));

    let first = renderer.render(&model).unwrap();
    let second = renderer.render(&model).unwrap();
    assert_eq!(first, second);
    assert_eq!(renderer.render_count(), 1);

    model.now_playing = Some(now_playing("Never Gonna Give You Up", Some(405)));
    let advanced = renderer.render(&model).unwrap();
    assert_ne!(first, advanced);
    assert_eq!(renderer.render_count(), 2);
}

fn now_playing(title: &str, progress_permille: Option<u16>) -> OverlayNowPlaying {
    OverlayNowPlaying {
        title: title.to_string(),
        time_text: "1:25 / 3:32".to_string(),
        progress_permille,
    }
}
fn overlay_size_presets() -> [OverlaySize; 3] {
    [
        OverlaySize::new(448, 448),
        OverlaySize::new(512, 512),
        OverlaySize::new(640, 640),
    ]
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

    let tokens = wrist_device_tokens(&devices, 2);
    let labels = tokens
        .iter()
        .map(|token| token.label.as_str())
        .collect::<Vec<_>>();

    assert_eq!(labels, ["HMD", "L", "R", "T2", "T1", "T×2", "Dongle"]);
    assert_eq!(
        wrist_device_item(&tokens[5], true, true).percent.as_str(),
        "21%"
    );
}

#[test]
fn wrist_shows_each_tracker_battery_while_the_header_has_room() {
    let mut devices = headset_and_controllers();
    devices.extend((1..=3).map(|index| tracker(index, DeviceStatus::Normal, 60 + index as u8)));

    ensure_platform().unwrap();

    for size in overlay_size_presets() {
        let mut host = SlintWristHost::new(size).unwrap();
        let mut model = sample_wrist_model();
        model.size = size;
        model.devices = devices.clone();

        host.write_model(&model);

        assert_eq!(
            host.device_labels(),
            ["HMD", "L", "R", "T1", "T2", "T3"],
            "at {}x{}",
            size.width,
            size.height
        );
    }
}

#[test]
fn wrist_collapses_overflowing_trackers_into_their_lowest_battery() {
    let mut devices = headset_and_controllers();
    devices.extend((1..=11).map(|index| tracker(index, DeviceStatus::Normal, 40 + index as u8)));
    devices.push(tracker(12, DeviceStatus::LowBattery, 19));

    let tokens = wrist_device_tokens(&devices, 2);
    let labels = tokens
        .iter()
        .map(|token| token.label.as_str())
        .collect::<Vec<_>>();

    assert_eq!(labels, ["HMD", "L", "R", "T12", "T1", "T×10"]);
    assert_eq!(
        wrist_device_item(&tokens[5], true, true).percent.as_str(),
        "42%"
    );
}

#[test]
fn wrist_header_keeps_trackers_clear_of_the_edge_at_every_overlay_size_preset() {
    let header_right_edge = |frame: &RgbaFrame| {
        let width = frame.size.width;
        (10..34)
            .flat_map(|y| (0..width - 2).map(move |x| (x, y)))
            .filter(|(x, y)| {
                let pixel = ((y * width + x) * 4) as usize;
                frame.data[pixel..pixel + 3]
                    .iter()
                    .any(|channel| *channel > 120)
            })
            .map(|(x, _)| x)
            .max()
            .unwrap()
    };
    let scenarios = [
        (DeviceStatus::Normal, 100, 3),
        (DeviceStatus::Normal, 100, 12),
        (DeviceStatus::Charging, 100, 8),
        (DeviceStatus::LowBattery, 19, 12),
    ];

    for size in overlay_size_presets() {
        for show_battery_percent in [true, false] {
            for (status, battery, count) in scenarios {
                let mut renderer = SlintWristRenderer::new();
                let mut model = sample_wrist_model();
                model.size = size;
                model.show_battery_percent = show_battery_percent;
                model.devices = headset_and_controllers();
                model
                    .devices
                    .extend((1..=count).map(|index| tracker(index, status, battery)));

                let frame = renderer.render(&model).unwrap();

                assert!(
                    header_right_edge(&frame) + 16 < size.width - 18,
                    "{count} {status:?} trackers crowd the edge at {}x{} with percent {show_battery_percent}",
                    size.width,
                    size.height
                );
            }
        }
    }
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
    let tokens = wrist_device_tokens(&devices, usize::MAX);
    let item = wrist_device_item(&tokens[0], true, true);

    assert!(!item.show_battery);
    assert!(!item.show_percent);
    assert_eq!(item.battery_fill, 0.0);
}

#[test]
fn wrist_battery_glyph_only_survives_when_it_still_carries_information() {
    let healthy = [device(
        "HMD",
        DeviceRole::Hmd,
        DeviceStatus::Normal,
        Some(82),
        20,
    )];
    let low = [device(
        "L",
        DeviceRole::LeftController,
        DeviceStatus::LowBattery,
        Some(18),
        20,
    )];
    let healthy_token = &wrist_device_tokens(&healthy, usize::MAX)[0];

    assert!(!wrist_device_item(healthy_token, true, true).show_battery);
    assert!(wrist_device_item(healthy_token, false, true).show_battery);
    assert!(wrist_device_item(&wrist_device_tokens(&low, usize::MAX)[0], true, true).show_battery);
}

#[test]
fn wrist_secondary_text_lifts_when_the_background_stops_being_opaque() {
    let devices = [device(
        "HMD",
        DeviceRole::Hmd,
        DeviceStatus::Normal,
        Some(82),
        20,
    )];
    let token = &wrist_device_tokens(&devices, usize::MAX)[0];

    let opaque = wrist_device_item(token, true, true);
    let translucent = wrist_device_item(token, true, false);

    assert_eq!(opaque.label_color, to_slint_color(wrist_muted_text(true)));
    assert_eq!(
        translucent.label_color,
        to_slint_color(wrist_muted_text(false))
    );
    assert!(wrist_muted_text(false).r > wrist_muted_text(true).r);
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
    let tokens = wrist_device_tokens(&devices, usize::MAX);
    let item = wrist_device_item(&tokens[0], true, true);

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
        accent: FeedAccent::None,
    };
    let media = FeedLine {
        time_text: String::new(),
        kind: FeedKind::Media,
        actor_text: "Player".to_string(),
        detail: "Muted media row".to_string(),
        relation: FeedRelation::None,
        severity: FeedSeverity::Normal,
        accent: FeedAccent::None,
    };

    let favorite_item = wrist_feed_item(&favorite, true);
    let media_item = wrist_feed_item(&media, true);

    assert!(favorite_item.has_actor);
    assert_eq!(favorite_item.actor.to_string(), "Ada");
    assert_eq!(favorite_item.detail.to_string(), "invited you");
    assert!(favorite_item.show_accent);
    assert!(!media_item.has_actor);
    assert_eq!(media_item.detail.to_string(), "Muted media row");
    assert_eq!(
        media_item.detail_color,
        to_slint_color(wrist_muted_text(true))
    );
}

#[test]
fn wrist_feed_item_uses_feed_type_accents_and_keeps_severity_precedence() {
    let mut row = FeedLine {
        time_text: "16:31".to_string(),
        kind: FeedKind::Friend,
        actor_text: "Ada".to_string(),
        detail: "Ada is online".to_string(),
        relation: FeedRelation::Friend,
        severity: FeedSeverity::Normal,
        accent: FeedAccent::Online,
    };

    let online = wrist_feed_item(&row, true);
    assert!(online.show_accent);
    assert_eq!(
        online.accent_color,
        to_slint_color(crate::Color::rgba(46, 211, 25, 255))
    );

    row.accent = FeedAccent::Location;
    let location = wrist_feed_item(&row, true);
    assert_eq!(
        location.accent_color,
        to_slint_color(crate::Color::rgba(14, 165, 233, 255))
    );

    row.severity = FeedSeverity::Warning;
    let warning = wrist_feed_item(&row, true);
    assert_eq!(
        warning.accent_color,
        to_slint_color(crate::Color::rgba(239, 68, 68, 255))
    );
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
            accent: FeedAccent::None,
        }],
        now_playing: None,
        footer: OverlayFooter {
            left: "8 players".to_string(),
            center: "Instance 12m".to_string(),
            right: "12:34".to_string(),
        },
    }
}

fn sample_main_model() -> MainSurfaceModel {
    MainSurfaceModel {
        size: OverlaySize::new(960, 528),
        dark_background: true,
        accent: crate::Color::rgba(94, 234, 212, 255),
        compact: false,
        stack_upward: false,
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
        }],
    }
}

fn feed_row(index: u32) -> FeedLine {
    FeedLine {
        time_text: format!("12:{index:02}"),
        kind: FeedKind::System,
        actor_text: String::new(),
        detail: format!("row {index}"),
        relation: FeedRelation::None,
        severity: FeedSeverity::Normal,
        accent: FeedAccent::None,
    }
}

fn headset_and_controllers() -> Vec<DeviceChip> {
    vec![
        device("HMD", DeviceRole::Hmd, DeviceStatus::Normal, Some(100), 10),
        device(
            "L",
            DeviceRole::LeftController,
            DeviceStatus::Normal,
            Some(100),
            10,
        ),
        device(
            "R",
            DeviceRole::RightController,
            DeviceStatus::Normal,
            Some(100),
            10,
        ),
    ]
}

fn tracker(index: usize, status: DeviceStatus, battery_percent: u8) -> DeviceChip {
    device(
        &format!("T{index}"),
        DeviceRole::Tracker,
        status,
        Some(battery_percent),
        if status == DeviceStatus::LowBattery {
            30
        } else {
            10
        },
    )
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
