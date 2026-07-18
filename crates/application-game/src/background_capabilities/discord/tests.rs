use serde_json::{json, Value};
use vrcx_0_core::location::parse_location;

use super::super::presence_facts::BackgroundPresenceFacts;
use super::activity_builders::{
    build_access_name, build_discord_activity, timestamp_seconds, DEFAULT_APP_ID,
};
use super::{
    set_assets_or_noop, BackgroundDiscordActivityPayload, BackgroundDiscordPresenceCommand,
    BackgroundDiscordPresenceState, DiscordConfig, DiscordLocationDetails, DiscordPresenceLabels,
    GAME_STOP_DISCORD_CLOSE_ATTEMPTS,
};

#[test]
fn discord_non_game_tick_is_quiet_after_close_attempts() {
    let mut state = BackgroundDiscordPresenceState {
        last_game_running: true,
        is_active: true,
        ..Default::default()
    };
    let facts = BackgroundPresenceFacts {
        is_game_running: false,
        ..Default::default()
    };

    if !facts.is_game_running {
        if state.last_game_running {
            state.close_attempts_remaining = GAME_STOP_DISCORD_CLOSE_ATTEMPTS;
        }
        state.last_game_running = false;
    }

    assert_eq!(state.close_attempts_remaining, 5);
}

#[test]
fn discord_rpc_world_uses_now_playing_details_and_thumbnail() {
    let config = DiscordConfig {
        discord_world_integration: true,
        discord_world_name_as_discord_status: true,
        discord_instance: true,
        discord_join_button: true,
        ..Default::default()
    };
    let facts = BackgroundPresenceFacts {
        is_game_running: true,
        is_steamvr_running: true,
        current_location_started_at: "2026-05-19T00:00:00Z".into(),
        current_user: json!({ "status": "active" }),
        now_playing: json!({
            "url": "https://video.example/watch",
            "name": "Example Movie",
            "thumbnailUrl": "https://image.example/thumb.jpg",
            "startedAt": "2026-05-19T01:00:00Z",
            "length": 120,
        }),
        ..Default::default()
    };
    let parsed = parse_location("wrld_266523e8-9161-40da-acd0-6bd82e075833:12345");
    let details = DiscordLocationDetails {
        world_name: "Popcorn Palace".into(),
        thumbnail_image_url: "https://image.example/world.jpg".into(),
        world_capacity: 32,
        world_link: "https://vrchat.com/home/world/wrld_266523e8-9161-40da-acd0-6bd82e075833"
            .into(),
        parsed: Some(parsed.clone()),
        ..Default::default()
    };

    let labels = DiscordPresenceLabels::default();
    let payload = build_discord_activity(&config, &facts, &labels, &details, &parsed);
    let activity = payload.activity.as_object().unwrap();

    assert_eq!(payload.app_id, "1095440531821170820");
    assert_eq!(
        activity.get("details"),
        Some(&Value::String("Example Movie".into()))
    );
    assert_eq!(
        activity
            .get("assets")
            .and_then(|value| value.get("large_image")),
        Some(&Value::String("https://image.example/thumb.jpg".into()))
    );
    assert_eq!(
        activity
            .get("timestamps")
            .and_then(|value| value.get("start"))
            .and_then(Value::as_i64),
        timestamp_seconds("2026-05-19T01:00:00Z")
    );
    assert_eq!(
        activity
            .get("timestamps")
            .and_then(|value| value.get("end"))
            .and_then(Value::as_i64),
        timestamp_seconds("2026-05-19T01:02:00Z")
    );
}

#[test]
fn discord_payload_keeps_platform_spacing_labels_and_session_floor() {
    let config = DiscordConfig {
        discord_instance: true,
        discord_show_platform: true,
        ..Default::default()
    };
    let facts = BackgroundPresenceFacts {
        is_game_running: true,
        is_steamvr_running: true,
        last_game_started_at: Some("2026-05-19T02:00:00Z".into()),
        current_location_started_at: "2026-05-19T01:00:00Z".into(),
        current_user: json!({ "status": "active" }),
        player_count: 2,
        ..Default::default()
    };
    let parsed = parse_location("wrld_test:12345");
    let details = DiscordLocationDetails {
        world_name: "Test World".into(),
        world_capacity: 16,
        parsed: Some(parsed.clone()),
        ..Default::default()
    };
    let labels = DiscordPresenceLabels {
        access_public: "公開".into(),
        platform_vr: "VR".into(),
        status_active: "オンライン".into(),
        ..Default::default()
    };

    let payload = build_discord_activity(&config, &facts, &labels, &details, &parsed);
    let activity = payload.activity.as_object().unwrap();

    assert_eq!(activity.get("state"), Some(&json!("公開 #12345 (VR)")));
    assert_eq!(
        activity
            .get("assets")
            .and_then(|value| value.get("small_text")),
        Some(&json!("オンライン"))
    );
    assert_eq!(
        activity
            .get("timestamps")
            .and_then(|value| value.get("start"))
            .and_then(Value::as_i64),
        timestamp_seconds("2026-05-19T02:00:00Z")
    );
}

#[test]
fn discord_platform_uses_vrchat_launch_mode_instead_of_steamvr_process() {
    let config = DiscordConfig {
        discord_instance: true,
        discord_show_platform: true,
        ..Default::default()
    };
    let facts = BackgroundPresenceFacts {
        is_game_running: true,
        is_steamvr_running: true,
        is_game_no_vr: true,
        current_user: json!({ "status": "active" }),
        ..Default::default()
    };
    let parsed = parse_location("wrld_test:12345");
    let details = DiscordLocationDetails {
        world_name: "Test World".into(),
        parsed: Some(parsed.clone()),
        ..Default::default()
    };

    let payload = build_discord_activity(
        &config,
        &facts,
        &DiscordPresenceLabels::default(),
        &details,
        &parsed,
    );

    assert_eq!(
        payload.activity.get("state"),
        Some(&json!("Public #12345 (Desktop)"))
    );
}

#[test]
fn discord_group_members_access_uses_localized_label() {
    let parsed = parse_location("wrld_test:12345~group(grp_test)~groupAccessType(members)");
    let labels = DiscordPresenceLabels {
        access_group: "群组".into(),
        group_access_members: "仅限成员".into(),
        ..Default::default()
    };

    assert_eq!(
        build_access_name(&parsed, "测试群组", "", &labels),
        "群组 仅限成员(测试群组) #12345"
    );
}

#[test]
fn discord_unknown_status_preserves_private_fallback() {
    let config = DiscordConfig {
        discord_hide_invite: true,
        discord_instance: true,
        ..Default::default()
    };
    let facts = BackgroundPresenceFacts {
        is_game_running: true,
        current_user: json!({ "status": "unknown" }),
        ..Default::default()
    };
    let parsed = parse_location("wrld_test:12345");
    let details = DiscordLocationDetails {
        world_name: "Test World".into(),
        parsed: Some(parsed.clone()),
        ..Default::default()
    };
    let labels = DiscordPresenceLabels {
        private_world: "非公開ワールド".into(),
        status_offline: "オフライン".into(),
        ..Default::default()
    };

    let payload = build_discord_activity(&config, &facts, &labels, &details, &parsed);

    assert_eq!(
        payload.activity.get("details"),
        Some(&json!("非公開ワールド"))
    );
    assert_eq!(
        payload.activity.pointer("/assets/small_text"),
        Some(&json!("オフライン"))
    );
    assert!(payload.activity.get("party").is_none());
    assert!(payload.activity.get("buttons").is_none());
}

#[test]
fn discord_unchanged_payload_is_not_published_twice() {
    let payload = BackgroundDiscordActivityPayload {
        app_id: DEFAULT_APP_ID.into(),
        activity: json!({ "details": "VRChat" }),
        detail: "VRChat".into(),
    };
    let mut state = BackgroundDiscordPresenceState::default();
    state.apply_set_assets_result(&payload, true);

    assert!(matches!(
        set_assets_or_noop(&state, payload.clone(), false),
        BackgroundDiscordPresenceCommand::Noop { .. }
    ));
    assert!(matches!(
        set_assets_or_noop(&state, payload, true),
        BackgroundDiscordPresenceCommand::SetAssets { .. }
    ));
}
