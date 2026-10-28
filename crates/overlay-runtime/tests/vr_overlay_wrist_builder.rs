use vrcx_0_application_activity::{
    ActivityActorRelation, ActivityCategory, ActivityContent, ActivityEntry, ActivitySnapshot,
    ActivityText,
};
use vrcx_0_contracts::activity::ActivityKind;
use vrcx_0_host_desktop::vr_overlay::{VrDeviceRole, VrDeviceSnapshot, VrDeviceStatus};
use vrcx_0_overlay_runtime::{
    build_wrist_surface_model, WristOverlayFrameInput, WristOverlayRenderOptions,
    WristRuntimeFooter, WristRuntimeNowPlaying,
};
use vrcx_0_vr_overlay::{
    DeviceStatus, FeedAccent, FeedKind, FeedRelation, FeedSeverity, OverlayNowPlaying, OverlaySize,
};

#[test]
fn wrist_builder_keeps_renderer_model_free_of_application_entry_shape() {
    let snapshot = ActivitySnapshot {
        entries: vec![
            activity_entry(
                1,
                "Online",
                ActivityCategory::FavoriteMovement,
                "Ada online",
            ),
            activity_entry(2, "invite", ActivityCategory::ActionRequired, "Mika invite"),
            activity_entry(3, "Event", ActivityCategory::SystemSafety, "Safety event"),
        ],
    };
    let model = build_wrist_surface_model(WristOverlayFrameInput {
        activity: snapshot,
        devices: vec![VrDeviceSnapshot {
            label: "HMD".to_string(),
            role: VrDeviceRole::Hmd,
            serial: Some("abc".to_string()),
            status: VrDeviceStatus::LowBattery,
            battery_percent: Some(18),
        }],
        now_playing: None,
        live_now_playing: false,
        footer: WristRuntimeFooter {
            player_count: 8,
            instance_duration: "12m".to_string(),
            online_duration: "2h 5m".to_string(),
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
    assert_eq!(model.footer.center, "停留 12m · 在线 2h 5m");
    assert_eq!(model.footer.right, "12:34");
}

#[test]
fn wrist_builder_maps_feed_icon_types_to_matching_accents() {
    let snapshot = ActivitySnapshot {
        entries: [
            "GPS",
            "Online",
            "Offline",
            "Status",
            "AvatarChange",
            "Bio",
            "OnPlayerJoined",
        ]
        .into_iter()
        .enumerate()
        .map(|(index, activity_type)| {
            activity_entry(
                index as u64,
                activity_type,
                ActivityCategory::FavoriteMovement,
                activity_type,
            )
        })
        .collect(),
    };

    let model = build_wrist_surface_model(WristOverlayFrameInput {
        activity: snapshot,
        devices: Vec::new(),
        now_playing: None,
        live_now_playing: false,
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
    let snapshot = ActivitySnapshot {
        entries: vec![
            activity_entry_with_relation(
                1,
                "OnPlayerJoined",
                ActivityCategory::CurrentInstance,
                "Friend User",
                ActivityActorRelation::Friend,
            ),
            activity_entry_with_relation(
                2,
                "OnPlayerJoined",
                ActivityCategory::CurrentInstance,
                "Favorite User",
                ActivityActorRelation::Favorite,
            ),
        ],
    };

    let model = build_wrist_surface_model(WristOverlayFrameInput {
        activity: snapshot,
        devices: Vec::new(),
        now_playing: None,
        live_now_playing: false,
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
    let snapshot = ActivitySnapshot {
        entries: (1..=18)
            .map(|sequence| {
                activity_entry(
                    sequence,
                    "OnPlayerJoined",
                    ActivityCategory::CurrentInstance,
                    &format!("User {sequence} joined"),
                )
            })
            .collect(),
    };

    let model = build_wrist_surface_model(WristOverlayFrameInput {
        activity: snapshot,
        devices: Vec::new(),
        now_playing: None,
        live_now_playing: false,
        footer: WristRuntimeFooter::default(),
        options: WristOverlayRenderOptions::default(),
        locale: "en".to_string(),
        show_instance_id_in_location: false,
        captured_at_ms: 42,
    });

    assert_eq!(model.feed_rows.len(), 18);
}

const STARTED_AT: &str = "2026-06-01T12:00:00.000Z";
const STARTED_AT_MS: i64 = 1_780_315_200_000;

fn song_now_playing(captured_at_ms: i64, position_seconds: i64, live: bool) -> OverlayNowPlaying {
    build_wrist_surface_model(now_playing_input(
        WristRuntimeNowPlaying {
            title: "  Never Gonna Give You Up  ".to_string(),
            length_seconds: 212,
            position_seconds,
            started_at: STARTED_AT.to_string(),
        },
        captured_at_ms,
        live,
    ))
    .now_playing
    .expect("now playing model")
}

#[test]
fn wrist_builder_ticks_now_playing_elapsed_every_second_while_visible() {
    assert_eq!(
        song_now_playing(STARTED_AT_MS, 0, true),
        OverlayNowPlaying {
            title: "Never Gonna Give You Up".to_string(),
            time_text: "0:00 / 3:32".to_string(),
            progress_permille: Some(0),
        }
    );
    assert_eq!(
        song_now_playing(STARTED_AT_MS + 83_000, 0, true),
        OverlayNowPlaying {
            title: "Never Gonna Give You Up".to_string(),
            time_text: "1:23 / 3:32".to_string(),
            progress_permille: Some(391),
        }
    );
    assert_eq!(
        song_now_playing(STARTED_AT_MS + 84_000, 0, true).progress_permille,
        Some(396)
    );
    assert_eq!(
        song_now_playing(STARTED_AT_MS + 5_000, 80, true).time_text,
        "1:25 / 3:32"
    );
    assert_eq!(
        song_now_playing(STARTED_AT_MS + 900_000, 0, true),
        OverlayNowPlaying {
            title: "Never Gonna Give You Up".to_string(),
            time_text: "3:32 / 3:32".to_string(),
            progress_permille: Some(1000),
        }
    );
    assert_eq!(
        song_now_playing(STARTED_AT_MS - 10_000, 0, true).progress_permille,
        Some(0)
    );
    assert_eq!(
        build_wrist_surface_model(now_playing_input(
            WristRuntimeNowPlaying {
                title: "Long mix".to_string(),
                length_seconds: 3_725,
                position_seconds: 0,
                started_at: STARTED_AT.to_string(),
            },
            STARTED_AT_MS + 65_000,
            true,
        ))
        .now_playing
        .expect("now playing model")
        .time_text,
        "1:05 / 1:02:05"
    );
}

#[test]
fn wrist_builder_holds_now_playing_to_the_minute_while_hidden() {
    let first = song_now_playing(STARTED_AT_MS + 60_000, 0, false);
    assert_eq!(
        first,
        OverlayNowPlaying {
            title: "Never Gonna Give You Up".to_string(),
            time_text: "1:00 / 3:32".to_string(),
            progress_permille: Some(283),
        }
    );
    assert_eq!(song_now_playing(STARTED_AT_MS + 119_000, 0, false), first);
    assert_eq!(
        song_now_playing(STARTED_AT_MS + 120_000, 0, false).time_text,
        "2:00 / 3:32"
    );
}

#[test]
fn wrist_builder_shows_elapsed_time_without_a_bar_when_the_length_is_unknown() {
    let stream = |live: bool| {
        build_wrist_surface_model(now_playing_input(
            WristRuntimeNowPlaying {
                title: "https://stream.example.test/live".to_string(),
                length_seconds: 0,
                position_seconds: 0,
                started_at: STARTED_AT.to_string(),
            },
            STARTED_AT_MS + 12 * 60_000 + 30_000,
            live,
        ))
        .now_playing
    };

    assert_eq!(
        stream(true),
        Some(OverlayNowPlaying {
            title: "https://stream.example.test/live".to_string(),
            time_text: "12:30".to_string(),
            progress_permille: None,
        })
    );
    assert_eq!(
        stream(false).map(|now_playing| now_playing.time_text),
        Some("12:00".to_string())
    );
}

#[test]
fn wrist_builder_drops_now_playing_without_a_title() {
    let model = build_wrist_surface_model(now_playing_input(
        WristRuntimeNowPlaying {
            title: "   ".to_string(),
            length_seconds: 212,
            position_seconds: 0,
            started_at: STARTED_AT.to_string(),
        },
        STARTED_AT_MS,
        true,
    ));

    assert_eq!(model.now_playing, None);
}

fn now_playing_input(
    now_playing: WristRuntimeNowPlaying,
    captured_at_ms: i64,
    live_now_playing: bool,
) -> WristOverlayFrameInput {
    WristOverlayFrameInput {
        activity: ActivitySnapshot::default(),
        devices: Vec::new(),
        now_playing: Some(now_playing),
        live_now_playing,
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
    category: ActivityCategory,
    summary: &str,
) -> ActivityEntry {
    activity_entry_with_relation(
        sequence,
        activity_type,
        category,
        summary,
        ActivityActorRelation::None,
    )
}

fn activity_entry_with_relation(
    sequence: u64,
    activity_type: &str,
    category: ActivityCategory,
    summary: &str,
    actor_relation: ActivityActorRelation,
) -> ActivityEntry {
    ActivityEntry {
        sequence,
        source_id: format!("source-{sequence}"),
        kind: ActivityKind::from_key(activity_type).expect("known activity kind"),
        category,
        created_at: "2026-06-01T12:34:56.000Z".to_string(),
        actor_user_id: format!("usr_{sequence}"),
        actor_display_name: format!("User {sequence}"),
        content: ActivityContent {
            icon: String::new(),
            title: ActivityText::literal(summary),
            body: ActivityText::literal(summary),
            summary: summary.to_string(),
            detail: summary.to_string(),
            location: String::new(),
            world_name: String::new(),
            group_name: String::new(),
            status: String::new(),
            status_description: String::new(),
            avatar_name: String::new(),
            image_url: String::new(),
            ..ActivityContent::default()
        },
        actor_relation,
    }
}
