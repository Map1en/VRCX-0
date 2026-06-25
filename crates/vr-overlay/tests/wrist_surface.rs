use vrcx_0_vr_overlay::{
    build_wrist_scene, Color, DeviceChip, DeviceRole, DeviceStatus, DrawCommand, FeedKind,
    FeedLine, FeedRelation, FeedSeverity, OverlayFooter, OverlayRenderer, OverlayScene,
    OverlaySize, OverlaySurfaceId, Rect, TextStyle, TinySkiaRenderer, WristSurfaceModel,
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

#[test]
fn wrist_surface_renders_one_pixel_surface_without_panicking() {
    let mut model = sample_wrist_model();
    model.size = OverlaySize::new(1, 1);
    model.devices.clear();
    model.feed_rows.clear();
    model.footer = OverlayFooter {
        left: String::new(),
        center: String::new(),
        right: String::new(),
    };

    let scene = build_wrist_scene(&model);
    let frame = render_scene(&scene);

    assert_eq!(frame.size, OverlaySize::new(1, 1));
    assert_eq!(frame.data.len(), 4);
    assert!(frame.is_valid_len());
}

#[test]
fn wrist_surface_renders_empty_devices_and_unusual_text_without_panicking() {
    let mut model = sample_wrist_model();
    model.devices.clear();
    model.feed_rows = vec![
        FeedLine {
            time_text: "25:99".to_string(),
            kind: FeedKind::Invite,
            actor_text: "A very very very long favorite user name 🎮👾🕹️".to_string(),
            detail: "A very very very long favorite user name 🎮👾🕹️ invited you to こんにちは世界 a\u{0301}\u{200d}b 🇯🇵🇺🇸".to_string(),
            relation: FeedRelation::Favorite,
            severity: FeedSeverity::Important,
        },
        FeedLine {
            time_text: String::new(),
            kind: FeedKind::System,
            actor_text: String::new(),
            detail: "System row with combining marks \u{0301}\u{0301}\u{200d} and CJK 測試世界"
                .to_string(),
            relation: FeedRelation::None,
            severity: FeedSeverity::Normal,
        },
    ];
    model.footer = OverlayFooter {
        left: "left footer with emoji 🎯".to_string(),
        center: "center footer こんにちは".to_string(),
        right: "right".to_string(),
    };

    let scene = build_wrist_scene(&model);
    let frame = render_scene(&scene);

    assert_eq!(frame.size, model.size);
    assert!(frame.is_valid_len());
}

#[test]
fn wrist_surface_renders_large_device_sets_without_unbounded_scene_growth() {
    let mut model = sample_wrist_model();
    model.show_battery_percent = false;
    model.devices = vec![
        device("HMD", DeviceRole::Hmd, DeviceStatus::Normal, Some(100)),
        device(
            "L",
            DeviceRole::LeftController,
            DeviceStatus::Normal,
            Some(100),
        ),
        device(
            "R",
            DeviceRole::RightController,
            DeviceStatus::Normal,
            Some(100),
        ),
    ];
    for index in 1..=80 {
        let status = match index % 5 {
            0 => DeviceStatus::Disconnected,
            1 => DeviceStatus::TrackingWarning,
            2 => DeviceStatus::CriticalBattery,
            3 => DeviceStatus::LowBattery,
            _ => DeviceStatus::Normal,
        };
        model.devices.push(device(
            &format!("Tracker-{index:02}-with-long-label"),
            DeviceRole::Tracker,
            status,
            Some((index % 101) as u8),
        ));
    }
    for index in 1..=12 {
        model.devices.push(device(
            &format!("Other-{index:02}-with-long-label"),
            DeviceRole::Other,
            DeviceStatus::Disconnected,
            None,
        ));
    }

    let scene = build_wrist_scene(&model);
    let frame = render_scene(&scene);

    assert!(
        scene.commands.len() < 80,
        "device bar should summarize large device sets instead of emitting one command per device"
    );
    assert_eq!(frame.size, model.size);
    assert!(frame.is_valid_len());
}

#[test]
fn tiny_skia_renderer_clips_out_of_bounds_commands_without_panicking() {
    let mut scene = OverlayScene::new(OverlaySurfaceId::new("clip-test"), OverlaySize::new(8, 8));
    scene.push(DrawCommand::FillRect {
        rect: Rect::new(-20.0, -20.0, 12.0, 12.0),
        color: Color::rgba(255, 0, 0, 255),
    });
    scene.push(DrawCommand::FillRect {
        rect: Rect::new(100.0, 100.0, 20.0, 20.0),
        color: Color::rgba(0, 255, 0, 255),
    });
    scene.push(DrawCommand::StrokeRect {
        rect: Rect::new(-4.0, 2.0, 20.0, 20.0),
        color: Color::rgba(0, 0, 255, 255),
        width: 2.0,
    });
    scene.push(DrawCommand::Circle {
        center_x: 20.0,
        center_y: -8.0,
        radius: 16.0,
        color: Color::rgba(255, 255, 0, 255),
    });
    scene.push(DrawCommand::Text {
        origin_x: -64.0,
        origin_y: -32.0,
        max_width: 200.0,
        text: "Out of bounds text 🎮 測試".to_string(),
        style: TextStyle::new(18.0, 22.0, Color::rgba(255, 255, 255, 255)),
    });

    let frame = render_scene(&scene);

    assert_eq!(frame.size, OverlaySize::new(8, 8));
    assert_eq!(frame.data.len(), 8 * 8 * 4);
    assert!(frame.is_valid_len());
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

fn render_scene(scene: &OverlayScene) -> vrcx_0_vr_overlay::RgbaFrame {
    let mut renderer = TinySkiaRenderer::new();
    renderer.render(scene).expect("render overlay scene")
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
