use serde_json::json;
use vrcx_0_application_activity::{
    OverlayActivityActorRelation, OverlayActivityCategory, OverlayActivityContent,
    OverlayActivityEntry, OverlayActivitySnapshot, OverlayActivityText,
};
use vrcx_0_host_desktop::vr_overlay::{VrDeviceSnapshot, VrDeviceStatus};
use vrcx_0_overlay_runtime::{
    build_wrist_surface_model, WristOverlayFrameInput, WristOverlayRenderOptions,
    WristRuntimeFooter, WristRuntimeNowPlaying,
};
use vrcx_0_vr_overlay::{
    DeviceStatus, FeedAccent, FeedKind, FeedRelation, FeedSeverity, OverlayNowPlaying, OverlaySize,
};

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
        now_playing: None,
        footer: WristRuntimeFooter {
            player_count: 8,
            instance_duration: "12m".to_string(),
            local_time: "12:34".to_string(),
        },
        options: WristOverlayRenderOptions::default(),
        locale: "zh-CN".to_string(),
        show_instance_id_in_location: false,
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
    assert_eq!(model.feed_rows[2].accent, FeedAccent::Online);
    assert_eq!(model.footer.left, "8 名玩家");
    assert_eq!(model.footer.center, "停留 12m");
    assert_eq!(model.footer.right, "12:34");
}

#[test]
fn wrist_builder_maps_feed_icon_types_to_matching_accents() {
    let snapshot = OverlayActivitySnapshot {
        entries: [
            "GPS",
            "Online",
            "Offline",
            "Status",
            "Avatar",
            "Bio",
            "OnPlayerJoined",
        ]
        .into_iter()
        .enumerate()
        .map(|(index, activity_type)| {
            activity_entry(
                index as u64,
                activity_type,
                OverlayActivityCategory::FavoriteMovement,
                activity_type,
            )
        })
        .collect(),
    };

    let model = build_wrist_surface_model(WristOverlayFrameInput {
        activity: snapshot,
        devices: Vec::new(),
        now_playing: None,
        footer: WristRuntimeFooter::default(),
        options: WristOverlayRenderOptions::default(),
        locale: "en".to_string(),
        show_instance_id_in_location: false,
        captured_at_ms: 42,
    });

    assert_eq!(
        model
            .feed_rows
            .iter()
            .map(|row| row.accent)
            .collect::<Vec<_>>(),
        vec![
            FeedAccent::None,
            FeedAccent::Muted,
            FeedAccent::Muted,
            FeedAccent::Muted,
            FeedAccent::Offline,
            FeedAccent::Online,
            FeedAccent::Location,
        ]
    );
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
        now_playing: None,
        footer: WristRuntimeFooter::default(),
        options: WristOverlayRenderOptions::default(),
        locale: "en".to_string(),
        show_instance_id_in_location: false,
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
        now_playing: None,
        footer: WristRuntimeFooter::default(),
        options: WristOverlayRenderOptions::default(),
        locale: "en".to_string(),
        show_instance_id_in_location: false,
        captured_at_ms: 42,
    });

    assert_eq!(model.feed_rows.len(), 18);
}

#[test]
fn wrist_builder_quantizes_now_playing_progress_and_shows_the_total_length() {
    let started_at = "2026-06-01T12:00:00.000Z";
    let started_at_ms = 1_780_315_200_000;
    let now_playing = |captured_at_ms: i64, position_seconds: i64| {
        build_wrist_surface_model(now_playing_input(
            WristRuntimeNowPlaying {
                title: "  Never Gonna Give You Up  ".to_string(),
                length_seconds: 212,
                position_seconds,
                started_at: started_at.to_string(),
            },
            captured_at_ms,
        ))
        .now_playing
        .expect("now playing model")
    };

    assert_eq!(
        now_playing(started_at_ms, 0),
        OverlayNowPlaying {
            title: "Never Gonna Give You Up".to_string(),
            time_text: "3:32".to_string(),
            progress_percent: Some(0),
        }
    );
    assert_eq!(
        now_playing(started_at_ms + 83_000, 0).progress_percent,
        Some(38)
    );
    assert_eq!(
        now_playing(started_at_ms + 84_000, 0).progress_percent,
        Some(38)
    );
    assert_eq!(
        now_playing(started_at_ms + 85_000, 0).progress_percent,
        Some(40)
    );
    assert_eq!(
        now_playing(started_at_ms + 5_000, 80).progress_percent,
        Some(40)
    );
    assert_eq!(
        now_playing(started_at_ms + 900_000, 0).progress_percent,
        Some(100)
    );
    assert_eq!(
        now_playing(started_at_ms - 10_000, 0).progress_percent,
        Some(0)
    );
    assert_eq!(
        build_wrist_surface_model(now_playing_input(
            WristRuntimeNowPlaying {
                title: "Long mix".to_string(),
                length_seconds: 3_725,
                position_seconds: 0,
                started_at: started_at.to_string(),
            },
            started_at_ms,
        ))
        .now_playing
        .expect("now playing model")
        .time_text,
        "1:02:05"
    );
}

#[test]
fn wrist_builder_shows_elapsed_minutes_without_a_bar_when_the_length_is_unknown() {
    let started_at_ms = 1_780_315_200_000;
    let model = build_wrist_surface_model(now_playing_input(
        WristRuntimeNowPlaying {
            title: "https://stream.example.test/live".to_string(),
            length_seconds: 0,
            position_seconds: 0,
            started_at: "2026-06-01T12:00:00.000Z".to_string(),
        },
        started_at_ms + 12 * 60_000 + 30_000,
    ));

    assert_eq!(
        model.now_playing,
        Some(OverlayNowPlaying {
            title: "https://stream.example.test/live".to_string(),
            time_text: "12m".to_string(),
            progress_percent: None,
        })
    );
}

#[test]
fn wrist_builder_drops_now_playing_without_a_title() {
    let model = build_wrist_surface_model(now_playing_input(
        WristRuntimeNowPlaying {
            title: "   ".to_string(),
            length_seconds: 212,
            position_seconds: 0,
            started_at: "2026-06-01T12:00:00.000Z".to_string(),
        },
        1_780_315_200_000,
    ));

    assert_eq!(model.now_playing, None);
}

fn now_playing_input(
    now_playing: WristRuntimeNowPlaying,
    captured_at_ms: i64,
) -> WristOverlayFrameInput {
    WristOverlayFrameInput {
        activity: OverlayActivitySnapshot::default(),
        devices: Vec::new(),
        now_playing: Some(now_playing),
        footer: WristRuntimeFooter::default(),
        options: WristOverlayRenderOptions::default(),
        locale: "en".to_string(),
        show_instance_id_in_location: false,
        captured_at_ms,
    }
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
            title: OverlayActivityText::literal(summary),
            body: OverlayActivityText::literal(summary),
            summary: summary.to_string(),
            detail: summary.to_string(),
            location: String::new(),
            world_name: String::new(),
            group_name: String::new(),
            status: String::new(),
            status_description: String::new(),
            avatar_name: String::new(),
            image_url: String::new(),
            ..OverlayActivityContent::default()
        },
        actor_relation,
        payload: json!({}).into(),
    }
}
