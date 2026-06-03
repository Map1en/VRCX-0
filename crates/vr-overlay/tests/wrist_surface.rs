use vrcx_0_vr_overlay::{
    build_wrist_scene, Color, DeviceChip, DeviceRole, DeviceStatus, DrawCommand, FeedKind,
    FeedLine, FeedRelation, FeedSeverity, OverlayFooter, OverlayRenderer, OverlaySize,
    OverlaySurfaceId, TinySkiaRenderer, WristSurfaceModel,
};

#[test]
fn wrist_surface_builds_scene_with_future_hit_region_boundary() {
    let model = sample_wrist_model();

    let scene = build_wrist_scene(&model);

    assert_eq!(scene.surface_id, OverlaySurfaceId::new("wrist"));
    assert_eq!(scene.size, OverlaySize::new(512, 512));
    assert!(
        scene.commands.len() >= 12,
        "wrist scene should contain background, device chips, feed rows, and footer commands"
    );
    assert!(
        scene.hit_regions.is_empty(),
        "first wrist proof is read-only but must keep the interaction boundary explicit"
    );
}

#[test]
fn tiny_skia_renderer_outputs_non_empty_rgba_frame() {
    let scene = build_wrist_scene(&sample_wrist_model());
    let mut renderer = TinySkiaRenderer::new();

    let frame = renderer.render(&scene).expect("render wrist scene");

    assert_eq!(frame.size, OverlaySize::new(512, 512));
    assert_eq!(frame.data.len(), 512 * 512 * 4);
    assert!(
        frame
            .data
            .chunks_exact(4)
            .any(|pixel| pixel[3] > 0 && (pixel[0] > 0 || pixel[1] > 0 || pixel[2] > 0)),
        "rendered frame should contain visible non-transparent pixels"
    );
}

#[test]
fn wrist_surface_aggregates_normal_trackers_and_expands_abnormal_trackers() {
    let mut model = sample_wrist_model();
    model.show_battery_percent = false;
    model.devices = vec![
        device("HMD", DeviceRole::Hmd, DeviceStatus::Normal, Some(82)),
        device(
            "L",
            DeviceRole::LeftController,
            DeviceStatus::Normal,
            Some(64),
        ),
        device(
            "R",
            DeviceRole::RightController,
            DeviceStatus::Charging,
            Some(71),
        ),
    ];
    for index in 1..=10 {
        let status = match index {
            3 => DeviceStatus::LowBattery,
            8 => DeviceStatus::Disconnected,
            9 => DeviceStatus::TrackingWarning,
            _ => DeviceStatus::Normal,
        };
        model.devices.push(device(
            &format!("T{index}"),
            DeviceRole::Tracker,
            status,
            Some(80),
        ));
    }

    let scene = build_wrist_scene(&model);
    let texts = scene_texts(&scene.commands);

    assert!(texts.iter().any(|text| text == "HMD"));
    assert!(
        text_max_width(&scene.commands, "HMD").is_some_and(|width| width >= 34.0),
        "HMD label must reserve enough width for all three letters"
    );
    assert!(texts.iter().any(|text| text == "L"));
    assert!(texts.iter().any(|text| text == "R"));
    assert!(texts.iter().any(|text| text == "T8"));
    assert!(texts.iter().any(|text| text == "T3"));
    assert!(texts.iter().any(|text| text == "+1"));
    assert!(texts.iter().any(|text| text == "T×7"));
    assert!(
        texts.iter().all(|text| !["LOW", "CRIT", "OFF", "WARN"]
            .iter()
            .any(|suffix| text.contains(suffix))),
        "device strip should use battery shape/color instead of status words"
    );
    assert!(
        !texts.iter().any(|text| text == "T1"),
        "normal trackers should be summarized instead of listed one by one"
    );
}

#[test]
fn wrist_surface_shows_percent_for_each_specific_device_when_enabled() {
    let mut model = sample_wrist_model();
    model.show_battery_percent = true;
    model.devices = vec![
        device("HMD", DeviceRole::Hmd, DeviceStatus::Normal, Some(82)),
        device(
            "L",
            DeviceRole::LeftController,
            DeviceStatus::LowBattery,
            Some(18),
        ),
        device(
            "R",
            DeviceRole::RightController,
            DeviceStatus::Charging,
            Some(67),
        ),
        device(
            "T1",
            DeviceRole::Tracker,
            DeviceStatus::CriticalBattery,
            Some(9),
        ),
    ];

    let scene = build_wrist_scene(&model);
    let texts = scene_texts(&scene.commands);

    assert!(texts.iter().any(|text| text == "82%"));
    assert!(texts.iter().any(|text| text == "18%"));
    assert!(texts.iter().any(|text| text == "67%"));
    assert!(texts.iter().any(|text| text == "9%"));
    assert_eq!(
        text_color(&scene.commands, "9%"),
        Some(Color::rgba(239, 68, 68, 255))
    );
}

#[test]
fn wrist_surface_uses_extra_width_to_expand_more_tracker_statuses() {
    let mut model = sample_wrist_model();
    model.size = OverlaySize::new(640, 640);
    model.show_battery_percent = false;
    model.devices = vec![
        device("HMD", DeviceRole::Hmd, DeviceStatus::Normal, Some(82)),
        device(
            "L",
            DeviceRole::LeftController,
            DeviceStatus::Normal,
            Some(64),
        ),
        device(
            "R",
            DeviceRole::RightController,
            DeviceStatus::Charging,
            Some(71),
        ),
    ];
    for index in 1..=10 {
        let status = match index {
            3 => DeviceStatus::LowBattery,
            8 => DeviceStatus::Disconnected,
            9 => DeviceStatus::TrackingWarning,
            _ => DeviceStatus::Normal,
        };
        model.devices.push(device(
            &format!("T{index}"),
            DeviceRole::Tracker,
            status,
            Some(80),
        ));
    }

    let scene = build_wrist_scene(&model);
    let texts = scene_texts(&scene.commands);

    assert!(texts.iter().any(|text| text == "T3"));
    assert!(texts.iter().any(|text| text == "T8"));
    assert!(texts.iter().any(|text| text == "T9"));
    assert!(!texts.iter().any(|text| text == "+1"));
    assert!(texts.iter().any(|text| text == "T×7"));
}

#[test]
fn wrist_surface_draws_actor_text_with_relation_hierarchy() {
    let mut model = sample_wrist_model();
    model.feed_rows = vec![
        FeedLine {
            time_text: "16:31".to_string(),
            kind: FeedKind::Friend,
            actor_text: "Fav User".to_string(),
            detail: "Fav User joined current instance".to_string(),
            relation: FeedRelation::Favorite,
            severity: FeedSeverity::Normal,
        },
        FeedLine {
            time_text: "16:30".to_string(),
            kind: FeedKind::Friend,
            actor_text: "Friend User".to_string(),
            detail: "Friend User joined current instance".to_string(),
            relation: FeedRelation::Friend,
            severity: FeedSeverity::Normal,
        },
    ];

    let scene = build_wrist_scene(&model);

    let fav_color = text_color(&scene.commands, "Fav User").expect("favorite actor text");
    let friend_color = text_color(&scene.commands, "Friend User").expect("friend actor text");

    assert_eq!(fav_color, Color::rgba(245, 205, 84, 255));
    assert_eq!(friend_color, Color::rgba(246, 246, 246, 255));
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
            DeviceChip {
                label: "T4".to_string(),
                role: DeviceRole::Tracker,
                status: DeviceStatus::TrackingWarning,
                battery_percent: Some(44),
                text: "warn".to_string(),
                priority: 30,
            },
        ],
        feed_rows: vec![
            FeedLine {
                time_text: "16:31".to_string(),
                kind: FeedKind::Invite,
                actor_text: "Ada".to_string(),
                detail: "Ada invited you to 测试世界".to_string(),
                relation: FeedRelation::Favorite,
                severity: FeedSeverity::Important,
            },
            FeedLine {
                time_text: "16:30".to_string(),
                kind: FeedKind::Friend,
                actor_text: "Mika".to_string(),
                detail: "Mika joined current instance".to_string(),
                relation: FeedRelation::Friend,
                severity: FeedSeverity::Normal,
            },
            FeedLine {
                time_text: "16:28".to_string(),
                kind: FeedKind::System,
                actor_text: String::new(),
                detail: "Instance queue ready".to_string(),
                relation: FeedRelation::None,
                severity: FeedSeverity::Normal,
            },
        ],
        footer: OverlayFooter {
            left: "8 players".to_string(),
            center: "Instance 12m".to_string(),
            right: "12:34".to_string(),
        },
        accent: Color::rgba(94, 234, 212, 255),
        captured_at_ms: 1_717_200_000_000,
    }
}

fn device(
    label: &str,
    role: DeviceRole,
    status: DeviceStatus,
    battery_percent: Option<u8>,
) -> DeviceChip {
    DeviceChip {
        label: label.to_string(),
        role,
        status,
        battery_percent,
        text: String::new(),
        priority: 10,
    }
}

fn scene_texts(commands: &[DrawCommand]) -> Vec<String> {
    commands
        .iter()
        .filter_map(|command| match command {
            DrawCommand::Text { text, .. } => Some(text.clone()),
            _ => None,
        })
        .collect()
}

fn text_color(commands: &[DrawCommand], expected_text: &str) -> Option<Color> {
    commands.iter().find_map(|command| match command {
        DrawCommand::Text { text, style, .. } if text == expected_text => Some(style.color),
        _ => None,
    })
}

fn text_max_width(commands: &[DrawCommand], expected_text: &str) -> Option<f32> {
    commands.iter().find_map(|command| match command {
        DrawCommand::Text {
            text, max_width, ..
        } if text == expected_text => Some(*max_width),
        _ => None,
    })
}
