use vrcx_0_vr_overlay::{
    build_dummy_panel_scene, build_friends_panel_scene, grab_follow_transform,
    ray_quad_intersection, recenter_transform, Color, DrawCommand, DummyPanelAction,
    DummyPanelModel, FavoriteFriendsPanelModel, FriendPanelAction, FriendPanelCategory,
    FriendPanelRow, FriendPanelStatusTone, HitRegion, OverlayQuadSize, OverlaySize,
    OverlaySurfaceId, OverlayTransform, Ray3, Rect, UvPoint, FRIENDS_PANEL_SURFACE_ID,
};

fn friend_panel_row(user_id: impl Into<String>, display_name: impl Into<String>) -> FriendPanelRow {
    FriendPanelRow {
        user_id: user_id.into(),
        display_name: display_name.into(),
        status: FriendPanelStatusTone::Online,
        location_text: "World Name".to_string(),
        is_traveling: false,
        traveling_text: None,
        note: None,
        memo: None,
        avatar: None,
    }
}

#[test]
fn raycast_hits_quad_center_and_boundaries() {
    let transform = OverlayTransform::identity();
    let ray = Ray3::new([0.0, 0.0, 1.0], [0.0, 0.0, -1.0]);
    let quad = OverlayQuadSize::new(0.8, 0.6);

    let hit = ray_quad_intersection(ray, transform, quad).expect("center hit");

    assert!((hit.distance - 1.0).abs() < 0.001);
    assert!((hit.uv.x - 0.5).abs() < 0.001);
    assert!((hit.uv.y - 0.5).abs() < 0.001);

    let edge_ray = Ray3::new([0.4, 0.3, 1.0], [0.0, 0.0, -1.0]);
    let edge = ray_quad_intersection(edge_ray, transform, quad).expect("edge hit");
    assert!((edge.uv.x - 1.0).abs() < 0.001);
    assert!(edge.uv.y.abs() < 0.001);
}

#[test]
fn raycast_rejects_backface_and_misses() {
    let transform = OverlayTransform::identity();
    let quad = OverlayQuadSize::new(0.8, 0.6);

    assert!(ray_quad_intersection(
        Ray3::new([0.0, 0.0, -1.0], [0.0, 0.0, 1.0]),
        transform,
        quad,
    )
    .is_none());
    assert!(ray_quad_intersection(
        Ray3::new([0.9, 0.0, 1.0], [0.0, 0.0, -1.0]),
        transform,
        quad,
    )
    .is_none());
}

#[test]
fn recenter_transform_places_panel_in_front_of_hmd() {
    let hmd = OverlayTransform::from_translation_rotation(
        [2.0, 1.5, -3.0],
        [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
    );

    let panel = recenter_transform(hmd, 1.25, -0.15);

    assert!((panel.translation[0] - 2.0).abs() < 0.001);
    assert!((panel.translation[1] - 1.35).abs() < 0.001);
    assert!((panel.translation[2] - -4.25).abs() < 0.001);
    assert_eq!(panel.rotation, hmd.rotation);
}

#[test]
fn grab_follow_transform_preserves_controller_to_panel_offset() {
    let panel = OverlayTransform::from_translation([0.0, 1.0, -1.0]);
    let grab_start = OverlayTransform::from_translation([0.2, 0.9, -0.8]);
    let grab_move = OverlayTransform::from_translation([0.4, 1.1, -1.2]);

    let next_panel = grab_follow_transform(panel, grab_start, grab_move);

    assert!((next_panel.translation[0] - 0.2).abs() < 0.001);
    assert!((next_panel.translation[1] - 1.2).abs() < 0.001);
    assert!((next_panel.translation[2] - -1.4).abs() < 0.001);
}

#[test]
fn hit_region_consumes_uv_coordinates() {
    let region = HitRegion {
        id: "button:primary".to_string(),
        rect: Rect::new(25.0, 25.0, 50.0, 50.0),
    };
    let size = OverlaySize::new(100, 100);

    assert!(region.contains_uv(size, UvPoint::new(0.5, 0.5)));
    assert!(region.contains_uv(size, UvPoint::new(0.25, 0.25)));
    assert!(!region.contains_uv(size, UvPoint::new(0.9, 0.9)));
    assert!(!region.contains_uv(size, UvPoint::new(-1.0, -1.0)));
    assert!(!region.contains_uv(size, UvPoint::new(1.5, 0.5)));
}

#[test]
fn dummy_panel_scene_emits_stable_hit_regions() {
    let model = DummyPanelModel::default();
    let scene = build_dummy_panel_scene(&model);
    let region_ids: Vec<&str> = scene
        .hit_regions
        .iter()
        .map(|region| region.id.as_str())
        .collect();

    assert_eq!(scene.surface_id, OverlaySurfaceId::new("interactive-dummy"));
    assert_eq!(scene.size, OverlaySize::new(768, 576));
    assert!(region_ids.contains(&"button:primary"));
    assert!(region_ids.contains(&"button:secondary"));
    assert!(region_ids.contains(&"list"));
}

#[test]
fn dummy_panel_updates_hover_press_and_scroll_state() {
    let mut model = DummyPanelModel::default();
    let size = model.size;
    let scene = build_dummy_panel_scene(&model);
    let primary_uv = scene
        .hit_regions
        .iter()
        .find(|region| region.id == "button:primary")
        .map(|region| region.rect.center_uv(size))
        .expect("primary button region");

    let hovered = model.apply_uv_action(primary_uv, DummyPanelAction::Hover);
    assert_eq!(hovered.as_deref(), Some("button:primary"));
    assert_eq!(model.hovered_region_id.as_deref(), Some("button:primary"));

    let pressed = model.apply_uv_action(primary_uv, DummyPanelAction::ClickDown);
    assert_eq!(pressed.as_deref(), Some("button:primary"));
    assert_eq!(model.pressed_region_id.as_deref(), Some("button:primary"));
    assert_eq!(model.primary_click_count, 0);

    let released = model.apply_uv_action(primary_uv, DummyPanelAction::ClickUp);
    assert_eq!(released.as_deref(), Some("button:primary"));
    assert_eq!(model.pressed_region_id, None);
    assert_eq!(model.primary_click_count, 1);

    model.apply_uv_action(
        UvPoint::new(0.5, 0.5),
        DummyPanelAction::Scroll { delta: 10.0 },
    );
    assert_eq!(model.scroll_offset_rows, model.max_scroll_offset_rows());

    model.apply_uv_action(
        UvPoint::new(0.5, 0.5),
        DummyPanelAction::Scroll { delta: -100.0 },
    );
    assert_eq!(model.scroll_offset_rows, 0);

    let scene_after = build_dummy_panel_scene(&model);
    assert!(scene_after.commands.iter().any(|command| {
        matches!(
            command,
            vrcx_0_vr_overlay::DrawCommand::FillRect { color, .. }
                if color == &Color::rgba(14, 116, 144, 255)
        )
    }));
}

#[test]
fn friends_panel_scene_emits_group_and_row_hit_regions() {
    let model = FavoriteFriendsPanelModel {
        categories: vec![
            FriendPanelCategory {
                key: "all".to_string(),
                label: "All".to_string(),
                count: 1,
            },
            FriendPanelCategory {
                key: "local:Best".to_string(),
                label: "Best".to_string(),
                count: 1,
            },
        ],
        rows: vec![FriendPanelRow {
            note: Some("VRChat note".to_string()),
            memo: Some("Local memo".to_string()),
            ..friend_panel_row("usr_1", "Aki")
        }],
        ..FavoriteFriendsPanelModel::default()
    };

    let scene = build_friends_panel_scene(&model);
    let region_ids: Vec<&str> = scene
        .hit_regions
        .iter()
        .map(|region| region.id.as_str())
        .collect();

    assert_eq!(
        scene.surface_id,
        OverlaySurfaceId::new(FRIENDS_PANEL_SURFACE_ID)
    );
    assert_eq!(scene.size, OverlaySize::new(1080, 720));
    assert!(region_ids.contains(&"cat:all"));
    assert!(region_ids.contains(&"cat:local:Best"));
    assert!(region_ids.contains(&"row:usr_1"));
    assert!(region_ids.contains(&"category-list"));
    assert!(region_ids.contains(&"list"));
    assert!(scene.commands.iter().any(|command| {
        matches!(command, DrawCommand::Text { text, .. } if text.contains("Note: VRChat note"))
    }));
    assert!(scene.commands.iter().any(|command| {
        matches!(command, DrawCommand::Text { text, .. } if text.contains("Memo: Local memo"))
    }));
}

#[test]
fn friends_panel_hover_draws_pointer_reticle() {
    let mut model = FavoriteFriendsPanelModel::default();
    let pointer_uv = UvPoint::new(0.5, 0.5);

    assert_eq!(
        model
            .apply_uv_action(pointer_uv, FriendPanelAction::Hover)
            .as_deref(),
        Some("list")
    );

    let scene = build_friends_panel_scene(&model);

    assert!(scene.commands.iter().any(|command| {
        matches!(
            command,
            DrawCommand::Circle {
                center_x,
                center_y,
                radius,
                ..
            } if (*center_x - model.size.width as f32 * pointer_uv.x).abs() < 0.001
                && (*center_y - model.size.height as f32 * pointer_uv.y).abs() < 0.001
                && *radius >= 8.0
        )
    }));

    model.apply_uv_action(UvPoint::new(-1.0, -1.0), FriendPanelAction::Hover);
    let scene_after_miss = build_friends_panel_scene(&model);
    assert!(!scene_after_miss.commands.iter().any(|command| {
        matches!(
            command,
            DrawCommand::Circle {
                center_x,
                center_y,
                radius,
                ..
            } if (*center_x - model.size.width as f32 * pointer_uv.x).abs() < 0.001
                && (*center_y - model.size.height as f32 * pointer_uv.y).abs() < 0.001
                && *radius >= 8.0
        )
    }));
}

#[test]
fn friends_panel_categories_use_left_column_and_independent_scroll() {
    let mut model = FavoriteFriendsPanelModel {
        categories: (0..9)
            .map(|index| FriendPanelCategory {
                key: format!("group:{index}"),
                label: format!("Group {index}"),
                count: index,
            })
            .collect(),
        selected_category_key: "group:0".to_string(),
        rows: (0..8)
            .map(|index| friend_panel_row(format!("usr_{index}"), format!("Friend {index}")))
            .collect(),
        ..FavoriteFriendsPanelModel::default()
    };
    let size = model.size;
    let scene = build_friends_panel_scene(&model);
    let second_category_uv = scene
        .hit_regions
        .iter()
        .find(|region| region.id == "cat:group:1")
        .map(|region| region.rect.center_uv(size))
        .expect("second category region");
    let first_row_uv = scene
        .hit_regions
        .iter()
        .find(|region| region.id.starts_with("row:"))
        .map(|region| region.rect.center_uv(size))
        .expect("first row region");

    model.apply_uv_action(second_category_uv, FriendPanelAction::ClickDown);
    model.apply_uv_action(second_category_uv, FriendPanelAction::ClickUp);
    assert_eq!(model.selected_category_key, "group:1");
    assert_eq!(model.row_scroll_offset, 0);

    model.apply_uv_action(
        second_category_uv,
        FriendPanelAction::Scroll { delta: 10.0 },
    );
    assert_eq!(
        model.category_scroll_offset,
        model.max_category_scroll_offset()
    );
    assert_eq!(model.row_scroll_offset, 0);

    model.apply_uv_action(first_row_uv, FriendPanelAction::Scroll { delta: 10.0 });
    assert_eq!(model.row_scroll_offset, model.max_row_scroll_offset());
    assert_eq!(
        model.category_scroll_offset,
        model.max_category_scroll_offset()
    );

    let category_scroll = model.category_scroll_offset;
    let row_scroll = model.row_scroll_offset;
    model.apply_uv_action(
        UvPoint::new(0.5, 0.05),
        FriendPanelAction::Scroll { delta: -10.0 },
    );
    assert_eq!(model.category_scroll_offset, category_scroll);
    assert_eq!(model.row_scroll_offset, row_scroll);
}

#[test]
fn friends_panel_updates_category_scroll_and_keeps_row_click_read_only() {
    let mut model = FavoriteFriendsPanelModel {
        categories: vec![
            FriendPanelCategory {
                key: "all".to_string(),
                label: "All".to_string(),
                count: 7,
            },
            FriendPanelCategory {
                key: "local:Best".to_string(),
                label: "Best".to_string(),
                count: 2,
            },
        ],
        rows: (0..7)
            .map(|index| FriendPanelRow {
                status: FriendPanelStatusTone::Active,
                location_text: "World".to_string(),
                ..friend_panel_row(format!("usr_{index}"), format!("Friend {index}"))
            })
            .collect(),
        ..FavoriteFriendsPanelModel::default()
    };
    let size = model.size;
    let scene = build_friends_panel_scene(&model);
    let best_category_uv = scene
        .hit_regions
        .iter()
        .find(|region| region.id == "cat:local:Best")
        .map(|region| region.rect.center_uv(size))
        .expect("best category region");

    assert_eq!(
        model
            .apply_uv_action(best_category_uv, FriendPanelAction::ClickDown)
            .as_deref(),
        Some("cat:local:Best")
    );
    assert_eq!(
        model
            .apply_uv_action(best_category_uv, FriendPanelAction::ClickUp)
            .as_deref(),
        Some("cat:local:Best")
    );
    assert_eq!(model.selected_category_key, "local:Best");

    model.apply_uv_action(
        UvPoint::new(0.5, 0.5),
        FriendPanelAction::Scroll { delta: 10.0 },
    );
    assert_eq!(model.row_scroll_offset, model.max_row_scroll_offset());

    let scene_after_scroll = build_friends_panel_scene(&model);
    let row_uv = scene_after_scroll
        .hit_regions
        .iter()
        .find(|region| region.id.starts_with("row:"))
        .map(|region| region.rect.center_uv(size))
        .expect("visible row region");
    model.apply_uv_action(row_uv, FriendPanelAction::ClickDown);
    let hit = model.apply_uv_action(row_uv, FriendPanelAction::ClickUp);

    assert!(hit.as_deref().is_some_and(|id| id.starts_with("row:")));
    assert_eq!(model.selected_category_key, "local:Best");
    assert_eq!(model.pressed_region_id, None);
}

#[test]
fn friends_panel_spinner_phase_changes_traveling_row_commands() {
    let mut model = FavoriteFriendsPanelModel {
        rows: vec![FriendPanelRow {
            location_text: "Traveling".to_string(),
            is_traveling: true,
            traveling_text: Some("Target World".to_string()),
            ..friend_panel_row("usr_1", "Aki")
        }],
        ..FavoriteFriendsPanelModel::default()
    };

    let first = build_friends_panel_scene(&model).commands;
    model.spinner_phase = 0.5;
    let second = build_friends_panel_scene(&model).commands;

    assert_ne!(first, second);
}
