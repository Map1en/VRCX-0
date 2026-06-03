use serde_json::json;
use vrcx_0_application::{
    OverlayActivityActorRelation, OverlayActivityCategory, OverlayActivityContent,
    OverlayActivityEntry, OverlayActivitySnapshot, OverlayActivityText,
};
use vrcx_0_host::vr_overlay::{VrDeviceSnapshot, VrDeviceStatus};
use vrcx_0_runtime_host::vr_overlay::{
    build_wrist_surface_model, WristOverlayFrameInput, WristOverlayRenderOptions,
    WristRuntimeFooter,
};
use vrcx_0_vr_overlay::{DeviceStatus, FeedKind, FeedRelation, FeedSeverity, OverlaySize};

#[test]
fn wrist_builder_keeps_renderer_model_free_of_application_entry_shape() {
    let snapshot = OverlayActivitySnapshot {
        entries: vec![
            activity_entry(
                1,
                "Online",
                OverlayActivityCategory::FavoriteMovement,
                "Ada online",
            ),
            activity_entry(
                2,
                "invite",
                OverlayActivityCategory::ActionRequired,
                "Mika invite",
            ),
            activity_entry(
                3,
                "Event",
                OverlayActivityCategory::SystemSafety,
                "Safety event",
            ),
        ],
    };
    let model = build_wrist_surface_model(WristOverlayFrameInput {
        activity: snapshot,
        devices: vec![VrDeviceSnapshot {
            label: "HMD".to_string(),
            serial: Some("abc".to_string()),
            status: VrDeviceStatus::LowBattery,
            battery_percent: Some(18),
        }],
        footer: WristRuntimeFooter {
            player_count: 8,
            instance_duration: "12m".to_string(),
            local_time: "12:34".to_string(),
        },
        options: WristOverlayRenderOptions::default(),
        locale: "zh-CN".to_string(),
        captured_at_ms: 42,
    });

    assert_eq!(model.size, OverlaySize::new(512, 512));
    assert!(!model.show_battery_percent);
    assert_eq!(model.devices[0].status, DeviceStatus::LowBattery);
    assert_eq!(model.devices[0].battery_percent, Some(18));
    assert_eq!(model.feed_rows.len(), 3);
    assert_eq!(model.feed_rows[0].kind, FeedKind::System);
    assert_eq!(model.feed_rows[0].severity, FeedSeverity::Warning);
    assert_eq!(model.feed_rows[1].kind, FeedKind::Invite);
    assert_eq!(model.feed_rows[1].severity, FeedSeverity::Important);
    assert_eq!(model.footer.left, "8 名玩家");
    assert_eq!(model.footer.center, "停留 12m");
    assert_eq!(model.footer.right, "12:34");
}

#[test]
fn wrist_builder_preserves_actor_relation_for_renderer_highlighting() {
    let snapshot = OverlayActivitySnapshot {
        entries: vec![
            activity_entry_with_relation(
                1,
                "OnPlayerJoined",
                OverlayActivityCategory::CurrentInstance,
                "Friend User",
                OverlayActivityActorRelation::Friend,
            ),
            activity_entry_with_relation(
                2,
                "OnPlayerJoined",
                OverlayActivityCategory::CurrentInstance,
                "Favorite User",
                OverlayActivityActorRelation::Favorite,
            ),
        ],
    };

    let model = build_wrist_surface_model(WristOverlayFrameInput {
        activity: snapshot,
        devices: Vec::new(),
        footer: WristRuntimeFooter::default(),
        options: WristOverlayRenderOptions::default(),
        locale: "en".to_string(),
        captured_at_ms: 42,
    });

    assert_eq!(model.feed_rows[0].actor_text, "Favorite User");
    assert_eq!(model.feed_rows[0].relation, FeedRelation::Favorite);
    assert_eq!(model.feed_rows[1].actor_text, "Friend User");
    assert_eq!(model.feed_rows[1].relation, FeedRelation::Friend);
}

#[test]
fn wrist_builder_keeps_enough_feed_rows_for_expanded_compact_layout() {
    let snapshot = OverlayActivitySnapshot {
        entries: (1..=18)
            .map(|sequence| {
                activity_entry(
                    sequence,
                    "OnPlayerJoined",
                    OverlayActivityCategory::CurrentInstance,
                    &format!("User {sequence} joined"),
                )
            })
            .collect(),
    };

    let model = build_wrist_surface_model(WristOverlayFrameInput {
        activity: snapshot,
        devices: Vec::new(),
        footer: WristRuntimeFooter::default(),
        options: WristOverlayRenderOptions::default(),
        locale: "en".to_string(),
        captured_at_ms: 42,
    });

    assert_eq!(model.feed_rows.len(), 18);
}

fn activity_entry(
    sequence: u64,
    activity_type: &str,
    category: OverlayActivityCategory,
    summary: &str,
) -> OverlayActivityEntry {
    activity_entry_with_relation(
        sequence,
        activity_type,
        category,
        summary,
        OverlayActivityActorRelation::None,
    )
}

fn activity_entry_with_relation(
    sequence: u64,
    activity_type: &str,
    category: OverlayActivityCategory,
    summary: &str,
    actor_relation: OverlayActivityActorRelation,
) -> OverlayActivityEntry {
    OverlayActivityEntry {
        sequence,
        source_id: format!("source-{sequence}"),
        activity_type: activity_type.to_string(),
        category,
        created_at: "2026-06-01T12:34:56.000Z".to_string(),
        actor_user_id: format!("usr_{sequence}"),
        actor_display_name: format!("User {sequence}"),
        content: OverlayActivityContent {
            icon: String::new(),
            title: OverlayActivityText {
                key: String::new(),
                fallback: summary.to_string(),
                params: json!({}),
            },
            body: OverlayActivityText {
                key: String::new(),
                fallback: summary.to_string(),
                params: json!({}),
            },
            summary: summary.to_string(),
            detail: summary.to_string(),
            location: String::new(),
            world_name: String::new(),
            group_name: String::new(),
            status: String::new(),
            status_description: String::new(),
            avatar_name: String::new(),
            image_url: String::new(),
        },
        actor_relation,
        payload: json!({}),
    }
}
