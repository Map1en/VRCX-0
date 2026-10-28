use serde_json::json;
use vrcx_0_contracts::game_log::{GameLogLocationEntry, GameLogLocationTimeUpdate};
use vrcx_0_core::realtime::RealtimeWsMessagePayload;

use vrcx_0_application_core::LocalGameContextSnapshot;

use super::runtime::RealtimeCurrentUserRuntime;
use crate::realtime::RealtimeCurrentUserOutput;
use vrcx_0_contracts::realtime::SelfProfileField;

fn game_not_running(available: bool) -> LocalGameContextSnapshot {
    if !available {
        return LocalGameContextSnapshot::Unavailable;
    }
    LocalGameContextSnapshot::Available {
        is_game_running: false,
        location: String::new(),
        destination: String::new(),
        world_name: String::new(),
        player_user_ids: Vec::new(),
    }
}

fn game_running_at(location: &str, world_name: &str) -> LocalGameContextSnapshot {
    LocalGameContextSnapshot::Available {
        is_game_running: true,
        location: location.into(),
        destination: String::new(),
        world_name: world_name.into(),
        player_user_ids: Vec::new(),
    }
}

fn current_user_location_message(
    location: &str,
    traveling_to_location: &str,
    received_at: &str,
) -> RealtimeWsMessagePayload {
    RealtimeWsMessagePayload {
        json: json!({
            "type": "user-location",
            "content": {
                "userId": "usr_self",
                "location": location,
                "travelingToLocation": traveling_to_location
            }
        }),
        raw: String::new(),
        received_at: received_at.into(),
    }
}

#[test]
fn current_user_projection_serializes_object_shape() {
    let runtime = RealtimeCurrentUserRuntime::new();
    runtime.set_snapshot(
        "usr_self".into(),
        7,
        json!({
            "id": "usr_self",
            "displayName": "Self",
            "location": "offline"
        }),
    );

    let output = runtime
        .apply_ws_message(
            7,
            &RealtimeWsMessagePayload {
                json: json!({
                    "type": "user-location",
                    "content": {
                        "userId": "usr_self",
                        "location": "wrld_1:123~group(grp_1)",
                        "travelingToLocation": "",
                        "worldId": "wrld_1"
                    }
                }),
                raw: String::new(),
                received_at: "2026-05-15T00:00:00Z".into(),
            },
            game_not_running(true),
        )
        .expect("current user location output");

    let serialized = serde_json::to_value(&output.projection).unwrap();
    assert_eq!(serialized["patch"]["id"], json!("usr_self"));
    assert_eq!(
        serialized["patch"]["location"],
        json!("wrld_1:123~group(grp_1)")
    );
    assert_eq!(
        serialized["gameStatePatch"]["currentLocation"],
        json!("wrld_1:123~group(grp_1)")
    );
    assert_eq!(
        serialized["patch"]["$location"]["tag"],
        json!("wrld_1:123~group(grp_1)")
    );
    assert_eq!(serialized["patch"]["$location"]["worldId"], json!("wrld_1"));
    assert_eq!(
        serialized["patch"]["$location"]["accessType"],
        json!("group")
    );
    assert_eq!(serialized["patch"]["$location"]["groupId"], json!("grp_1"));
    assert_eq!(
        serialized["patch"]["$travelingToLocation"]["isRealInstance"],
        json!(false)
    );
}

#[test]
fn refreshed_current_user_snapshot_preserves_local_authority_fields() {
    let runtime = RealtimeCurrentUserRuntime::new();
    runtime.set_snapshot(
        "usr_self".into(),
        7,
        json!({
            "id": "usr_self",
            "displayName": "Self",
            "location": "wrld_local:1",
            "worldId": "wrld_local",
            "instanceId": "1",
            "state": "online",
            "stateBucket": "online",
            "status": "join me",
            "statusDescription": "Local status",
            "worldName": "Local World",
            "bio": "old bio"
        }),
    );

    let output = runtime
        .apply_refreshed_snapshot_if_sequence(
            7,
            runtime.snapshot_sequence(7).expect("sequence"),
            json!({
                "id": "usr_self",
                "displayName": "Self Fresh",
                "location": "offline",
                "worldId": "offline",
                "instanceId": "offline",
                "state": "offline",
                "stateBucket": "offline",
                "status": "busy",
                "statusDescription": "REST status",
                "worldName": "REST World",
                "bio": "fresh bio"
            }),
            json!({}),
            game_running_at("wrld_auth:123", "Authoritative World"),
        )
        .expect("refreshed snapshot should update profile fields");

    assert_eq!(output.snapshot["displayName"], json!("Self Fresh"));
    assert_eq!(output.snapshot["bio"], json!("fresh bio"));
    assert_eq!(output.snapshot["status"], json!("join me"));
    assert_eq!(output.snapshot["statusDescription"], json!("Local status"));
    assert_eq!(output.snapshot["$presence"]["kind"], json!("online"));
    assert_eq!(output.snapshot["location"], json!("wrld_auth:123"));
    assert_eq!(output.snapshot["worldId"], json!("wrld_auth"));
    assert_eq!(output.snapshot["instanceId"], json!("123"));
    assert_eq!(output.snapshot["worldName"], json!("Authoritative World"));
    assert_eq!(output.projection.patch["location"], json!("wrld_auth:123"));
    assert_eq!(
        output.projection.patch["$location"]["tag"],
        json!("wrld_auth:123")
    );
}

#[test]
fn refreshed_snapshot_with_stale_sequence_is_dropped() {
    let runtime = RealtimeCurrentUserRuntime::new();
    runtime.set_snapshot(
        "usr_self".into(),
        7,
        json!({ "id": "usr_self", "bio": "old bio" }),
    );
    let stale_sequence = runtime.snapshot_sequence(7).expect("sequence");

    runtime
        .apply_ws_message(
            7,
            &current_user_location_message("wrld_remote:456", "", "2026-05-15T00:00:00Z"),
            game_not_running(true),
        )
        .expect("interleaved location apply");

    assert!(runtime
        .apply_refreshed_snapshot_if_sequence(
            7,
            stale_sequence,
            json!({ "id": "usr_self", "bio": "stale bio" }),
            json!({}),
            game_not_running(true),
        )
        .is_none());
    let fresh_sequence = runtime.snapshot_sequence(7).expect("sequence");
    let output = runtime
        .apply_refreshed_snapshot_if_sequence(
            7,
            fresh_sequence,
            json!({ "id": "usr_self", "bio": "fresh bio" }),
            json!({}),
            game_not_running(true),
        )
        .expect("fresh sequence applies");
    assert_eq!(output.snapshot["bio"], json!("fresh bio"));
}

fn user_update_message(user: serde_json::Value) -> RealtimeWsMessagePayload {
    RealtimeWsMessagePayload {
        json: json!({
            "type": "user-update",
            "content": { "userId": "usr_self", "user": user }
        }),
        raw: String::new(),
        received_at: "2026-05-15T00:00:00Z".into(),
    }
}

fn self_profile_observations(
    output: Option<RealtimeCurrentUserOutput>,
) -> Vec<(SelfProfileField, String)> {
    output
        .expect("current user output")
        .persistence
        .self_profile_observations
        .into_iter()
        .map(|observation| (observation.field, observation.value))
        .collect()
}

fn refresh_with(
    runtime: &RealtimeCurrentUserRuntime,
    user: serde_json::Value,
) -> Option<RealtimeCurrentUserOutput> {
    let sequence = runtime.snapshot_sequence(7).expect("sequence");
    runtime.apply_refreshed_snapshot_if_sequence(
        7,
        sequence,
        user,
        json!({}),
        game_not_running(true),
    )
}

fn runtime_with_profile() -> RealtimeCurrentUserRuntime {
    let runtime = RealtimeCurrentUserRuntime::new();
    runtime.set_snapshot(
        "usr_self".into(),
        7,
        json!({ "id": "usr_self", "status": "join me", "statusDescription": "hi", "bio": "same" }),
    );
    runtime
}

#[test]
fn ws_user_update_reports_every_profile_field_it_carries() {
    let runtime = runtime_with_profile();
    let update = || {
        self_profile_observations(runtime.apply_ws_message(
            7,
            &user_update_message(json!({
                "id": "usr_self", "status": "join me", "statusDescription": "hi", "bio": "same"
            })),
            game_not_running(true),
        ))
    };
    let expected = vec![
        (SelfProfileField::Status, "join me".to_string()),
        (SelfProfileField::StatusDescription, "hi".to_string()),
        (SelfProfileField::Bio, "same".to_string()),
    ];

    assert_eq!(update(), expected);
    assert_eq!(update(), expected);
}

#[test]
fn api_refresh_reports_bio_but_leaves_status_to_realtime() {
    let runtime = runtime_with_profile();

    assert_eq!(
        self_profile_observations(refresh_with(
            &runtime,
            json!({ "id": "usr_self", "status": "busy", "statusDescription": "away", "bio": "edited" }),
        )),
        vec![(SelfProfileField::Bio, "edited".to_string())]
    );
}

#[test]
fn updates_without_profile_fields_report_nothing() {
    let runtime = runtime_with_profile();

    assert!(self_profile_observations(runtime.apply_ws_message(
        7,
        &current_user_location_message("wrld_remote:456", "", "2026-05-15T00:00:00Z"),
        game_not_running(true),
    ))
    .is_empty());
    assert!(self_profile_observations(refresh_with(
        &runtime,
        json!({ "id": "usr_self", "bio": null })
    ))
    .is_empty());
}

#[test]
fn projection_patch_carries_the_avatar_wear_start_while_the_game_runs() {
    let runtime = RealtimeCurrentUserRuntime::new();
    runtime.set_snapshot(
        "usr_self".into(),
        7,
        json!({ "id": "usr_self", "currentAvatar": "avtr_worn" }),
    );

    let started = runtime
        .apply_game_running_state(7, game_running_at("wrld_1:1", "World"))
        .expect("game start output");
    let stopped = runtime
        .apply_game_running_state(7, game_not_running(true))
        .expect("game stop output");

    let started = serde_json::to_value(&started.projection.patch).unwrap();
    let stopped = serde_json::to_value(&stopped.projection.patch).unwrap();
    assert!(started["$previousAvatarSwapTime"]
        .as_i64()
        .is_some_and(|started_at| started_at > 0));
    assert_eq!(stopped["$previousAvatarSwapTime"], json!(null));
}

#[test]
fn interleaved_avatar_and_fallback_selection_drops_the_stale_response() {
    let runtime = RealtimeCurrentUserRuntime::new();
    runtime.set_snapshot(
        "usr_self".into(),
        7,
        json!({
            "id": "usr_self",
            "currentAvatar": "avtr_old",
            "fallbackAvatar": "avtr_old_fallback"
        }),
    );
    let shared_sequence = runtime.snapshot_sequence(7).expect("sequence");

    let avatar_output = runtime
        .apply_refreshed_snapshot_if_sequence(
            7,
            shared_sequence,
            json!({
                "id": "usr_self",
                "currentAvatar": "avtr_new",
                "fallbackAvatar": "avtr_old_fallback"
            }),
            json!({}),
            game_not_running(true),
        )
        .expect("avatar selection response applies");
    assert_eq!(avatar_output.snapshot["currentAvatar"], json!("avtr_new"));

    assert!(runtime
        .apply_refreshed_snapshot_if_sequence(
            7,
            shared_sequence,
            json!({
                "id": "usr_self",
                "currentAvatar": "avtr_old",
                "fallbackAvatar": "avtr_new_fallback"
            }),
            json!({}),
            game_not_running(true),
        )
        .is_none());
    let snapshot = runtime.snapshot_value().expect("snapshot");
    assert_eq!(snapshot["currentAvatar"], json!("avtr_new"));
    assert_eq!(snapshot["fallbackAvatar"], json!("avtr_old_fallback"));
}

#[test]
fn unavailable_local_game_context_skips_game_dependent_side_effects() {
    let runtime = RealtimeCurrentUserRuntime::new();
    runtime.set_snapshot(
        "usr_self".into(),
        7,
        json!({
            "id": "usr_self",
            "currentAvatar": "avtr_current",
            "$previousAvatarSwapTime": 1_000
        }),
    );
    let game = LocalGameContextSnapshot::Unavailable;

    let output = runtime
        .apply_ws_message(
            7,
            &RealtimeWsMessagePayload {
                json: json!({
                    "type": "user-location",
                    "content": {
                        "userId": "usr_self",
                        "location": "wrld_1:123",
                        "travelingToLocation": "",
                        "worldId": "wrld_1"
                    }
                }),
                raw: String::new(),
                received_at: "2026-05-15T00:00:02Z".into(),
            },
            game.clone(),
        )
        .expect("current user location output");

    assert_eq!(output.snapshot["location"], json!("wrld_1:123"));
    assert_eq!(output.snapshot["$previousAvatarSwapTime"], json!(1_000));
    assert!(output.projection.game_state_patch.is_none());
    assert!(output.persistence.is_empty());
    assert!(runtime.apply_game_running_state(7, game).is_none());
}

#[test]
fn running_local_game_keeps_authoritative_location_above_remote_ws_location() {
    let runtime = RealtimeCurrentUserRuntime::new();
    runtime.set_snapshot(
        "usr_self".into(),
        7,
        json!({
            "id": "usr_self",
            "location": "wrld_local:123",
            "worldId": "wrld_local",
            "instanceId": "123",
            "state": "online",
            "stateBucket": "online"
        }),
    );

    let output = runtime
        .apply_ws_message(
            7,
            &RealtimeWsMessagePayload {
                json: json!({
                    "type": "user-location",
                    "content": {
                        "userId": "usr_self",
                        "location": "wrld_remote:456",
                        "travelingToLocation": "",
                        "worldId": "wrld_remote"
                    }
                }),
                raw: String::new(),
                received_at: "2026-05-15T00:00:00Z".into(),
            },
            game_running_at("wrld_local:123", "Local World"),
        )
        .expect("current user location output");

    assert_eq!(output.snapshot["location"], json!("wrld_local:123"));
    assert_eq!(output.snapshot["worldId"], json!("wrld_local"));
    assert!(output.projection.game_state_patch.is_none());
    assert!(output.persistence.game_log_locations.is_empty());
}

#[test]
fn stopped_local_game_projects_remote_location_as_online_and_starts_gamelog_interval() {
    let runtime = RealtimeCurrentUserRuntime::new();
    runtime.set_snapshot(
        "usr_self".into(),
        7,
        json!({
            "id": "usr_self",
            "status": "busy",
            "location": "offline",
            "state": "offline",
            "stateBucket": "offline"
        }),
    );

    let output = runtime
        .apply_ws_message(
            7,
            &current_user_location_message(
                "wrld_remote:456~group(grp_remote)",
                "",
                "2026-05-15T00:00:00Z",
            ),
            game_not_running(true),
        )
        .expect("remote location output");

    assert_eq!(output.snapshot["$presence"]["kind"], json!("online"));
    assert_eq!(
        output.snapshot["location"],
        json!("wrld_remote:456~group(grp_remote)")
    );
    assert!(output.snapshot.get("pendingOffline").is_none());
    assert_eq!(output.persistence.game_log_locations.len(), 1);
    assert_eq!(
        output.persistence.game_log_locations[0],
        GameLogLocationEntry {
            created_at: "2026-05-15T00:00:00Z".into(),
            location: "wrld_remote:456~group(grp_remote)".into(),
            world_id: "wrld_remote".into(),
            world_name: "".into(),
            time: 0,
            group_name: "grp_remote".into(),
        }
    );
    assert_eq!(output.wake_at_ms, None);
}

#[test]
fn false_remote_offline_keeps_location_until_same_location_cancels_pending() {
    let runtime = RealtimeCurrentUserRuntime::new();
    runtime.set_snapshot("usr_self".into(), 7, json!({ "id": "usr_self" }));
    runtime
        .apply_ws_message(
            7,
            &current_user_location_message("wrld_remote:456", "", "2026-05-15T00:00:00Z"),
            game_not_running(true),
        )
        .expect("remote interval start");

    let pending = runtime
        .apply_ws_message(
            7,
            &current_user_location_message("offline:offline", "", "2026-05-15T00:00:10Z"),
            game_not_running(true),
        )
        .expect("remote offline pending output");
    assert_eq!(
        pending.wake_at_ms,
        Some(
            chrono::DateTime::parse_from_rfc3339("2026-05-15T00:03:00Z")
                .expect("valid timestamp")
                .timestamp_millis()
        )
    );
    assert_eq!(pending.snapshot["location"], json!("wrld_remote:456"));
    assert_eq!(pending.snapshot["$presence"]["kind"], json!("online"));
    assert!(pending.persistence.is_empty());

    let resumed = runtime
        .apply_ws_message(
            7,
            &current_user_location_message("wrld_remote:456", "", "2026-05-15T00:00:10.004Z"),
            game_not_running(true),
        )
        .expect("same remote location should cancel pending");

    assert_eq!(resumed.wake_at_ms, None);
    assert!(resumed.persistence.is_empty());
    assert!(runtime
        .wake_pending_offline(7, "2026-05-15T00:03:00Z".into(), game_not_running(true),)
        .is_none());
}

#[test]
fn an_earlier_wake_does_not_confirm_a_newer_pending_offline() {
    let runtime = RealtimeCurrentUserRuntime::new();
    runtime.set_snapshot("usr_self".into(), 7, json!({ "id": "usr_self" }));
    for (location, received_at) in [
        ("wrld_remote:456", "2026-05-15T00:00:00Z"),
        ("offline", "2026-05-15T00:00:10Z"),
        ("wrld_remote:456", "2026-05-15T00:00:15Z"),
        ("offline", "2026-05-15T00:00:20Z"),
    ] {
        runtime.apply_ws_message(
            7,
            &current_user_location_message(location, "", received_at),
            game_not_running(true),
        );
    }

    assert!(runtime
        .wake_pending_offline(7, "2026-05-15T00:03:00Z".into(), game_not_running(true))
        .is_none());
    let confirmed = runtime
        .wake_pending_offline(7, "2026-05-15T00:03:10Z".into(), game_not_running(true))
        .expect("the newer pending offline confirms at its own deadline");
    assert_eq!(confirmed.snapshot["$presence"]["kind"], json!("active"));
}

#[test]
fn confirmed_remote_offline_ends_interval_and_same_location_can_start_again() {
    let runtime = RealtimeCurrentUserRuntime::new();
    runtime.set_snapshot("usr_self".into(), 7, json!({ "id": "usr_self" }));
    runtime
        .apply_ws_message(
            7,
            &current_user_location_message("wrld_remote:456", "", "2026-05-15T00:00:00Z"),
            game_not_running(true),
        )
        .expect("remote interval start");
    let pending = runtime
        .apply_ws_message(
            7,
            &current_user_location_message("offline", "", "2026-05-15T00:00:10Z"),
            game_not_running(true),
        )
        .expect("remote offline pending output");
    assert!(pending.wake_at_ms.is_some());

    let confirmed = runtime
        .wake_pending_offline(7, "2026-05-15T00:03:00Z".into(), game_not_running(true))
        .expect("pending remote offline should fire");

    assert_eq!(confirmed.snapshot["$presence"]["kind"], json!("active"));
    assert_eq!(confirmed.snapshot["location"], json!("offline"));
    assert_eq!(
        confirmed.persistence.game_log_location_time_updates,
        vec![GameLogLocationTimeUpdate {
            created_at: "2026-05-15T00:00:00Z".into(),
            time: 180_000,
        }]
    );

    let restarted = runtime
        .apply_ws_message(
            7,
            &current_user_location_message("wrld_remote:456", "", "2026-05-15T00:03:20Z"),
            game_not_running(true),
        )
        .expect("same location after confirmed offline starts a new interval");
    assert_eq!(restarted.persistence.game_log_locations.len(), 1);
    assert_eq!(
        restarted.persistence.game_log_locations[0].created_at,
        "2026-05-15T00:03:20Z"
    );
}

#[test]
fn remote_presence_remains_visible_when_gamelog_is_disabled_without_writes() {
    let runtime = RealtimeCurrentUserRuntime::new();
    runtime.set_snapshot("usr_self".into(), 7, json!({ "id": "usr_self" }));

    let output = runtime
        .apply_ws_message(
            7,
            &current_user_location_message("wrld_remote:456", "", "2026-05-15T00:00:00Z"),
            game_not_running(false),
        )
        .expect("remote presence output");

    assert_eq!(output.snapshot["$presence"]["kind"], json!("online"));
    assert!(output.persistence.is_empty());
}

#[test]
fn local_game_start_invalidates_remote_offline_timer_and_keeps_local_authority() {
    let runtime = RealtimeCurrentUserRuntime::new();
    runtime.set_snapshot("usr_self".into(), 7, json!({ "id": "usr_self" }));
    runtime
        .apply_ws_message(
            7,
            &current_user_location_message("wrld_remote:456", "", "2026-05-15T00:00:00Z"),
            game_not_running(true),
        )
        .expect("remote interval start");
    let pending = runtime
        .apply_ws_message(
            7,
            &current_user_location_message("offline", "", "2026-05-15T00:00:10Z"),
            game_not_running(true),
        )
        .expect("remote offline pending output");
    assert!(pending.wake_at_ms.is_some());
    let local_game = game_running_at("wrld_local:123", "Local World");

    let local = runtime
        .apply_game_running_state(7, local_game.clone())
        .expect("local game state output");

    assert_eq!(local.snapshot["location"], json!("wrld_local:123"));
    assert_eq!(local.snapshot["$presence"]["kind"], json!("online"));
    assert!(runtime
        .wake_pending_offline(7, "2026-05-15T00:03:00Z".into(), local_game,)
        .is_none());
}

#[test]
fn stopping_local_game_does_not_start_remote_gamelog_from_stale_snapshot() {
    let runtime = RealtimeCurrentUserRuntime::new();
    runtime.set_snapshot(
        "usr_self".into(),
        7,
        json!({
            "id": "usr_self",
            "location": "wrld_for_two:94665",
            "worldId": "wrld_for_two",
            "instanceId": "94665",
            "state": "online",
            "stateBucket": "online"
        }),
    );
    runtime
        .apply_game_running_state(7, game_running_at("wrld_for_two:94665", "For Two"))
        .expect("local game state output");

    let stopped = runtime
        .apply_game_running_state(
            7,
            LocalGameContextSnapshot::Available {
                is_game_running: false,
                location: "wrld_for_two:94665".into(),
                destination: String::new(),
                world_name: "For Two".into(),
                player_user_ids: Vec::new(),
            },
        )
        .expect("stopped game state output");

    assert_eq!(stopped.snapshot["location"], json!("wrld_for_two:94665"));
    assert!(stopped.projection.game_state_patch.is_some());
    assert!(stopped.persistence.game_log_locations.is_empty());
}

#[test]
fn reconnect_preserves_remote_interval_and_invalidates_old_pending_timer() {
    let runtime = RealtimeCurrentUserRuntime::new();
    runtime.set_snapshot("usr_self".into(), 7, json!({ "id": "usr_self" }));
    runtime
        .apply_ws_message(
            7,
            &current_user_location_message("wrld_remote:456", "", "2026-05-15T00:00:00Z"),
            game_not_running(true),
        )
        .expect("remote interval start");
    let pending = runtime
        .apply_ws_message(
            7,
            &current_user_location_message("offline", "", "2026-05-15T00:00:10Z"),
            game_not_running(true),
        )
        .expect("remote offline pending output");
    assert!(pending.wake_at_ms.is_some());

    runtime.set_snapshot(
        "usr_self".into(),
        8,
        json!({
            "id": "usr_self",
            "location": "wrld_remote:456",
            "state": "online",
            "stateBucket": "online"
        }),
    );

    assert!(runtime
        .wake_pending_offline(7, "2026-05-15T00:03:00Z".into(), game_not_running(true),)
        .is_none());
    let duplicate = runtime
        .apply_ws_message(
            8,
            &current_user_location_message("wrld_remote:456", "", "2026-05-15T00:00:20Z"),
            game_not_running(true),
        )
        .expect("reconnected remote location output");
    assert!(duplicate.persistence.game_log_locations.is_empty());

    let pending = runtime
        .apply_ws_message(
            8,
            &current_user_location_message("offline", "", "2026-05-15T00:00:30Z"),
            game_not_running(true),
        )
        .expect("remote offline after reconnect");
    assert!(pending.wake_at_ms.is_some());
    let confirmed = runtime
        .wake_pending_offline(8, "2026-05-15T00:03:20Z".into(), game_not_running(true))
        .expect("remote offline should close original interval");

    assert_eq!(
        confirmed.persistence.game_log_location_time_updates,
        vec![GameLogLocationTimeUpdate {
            created_at: "2026-05-15T00:00:00Z".into(),
            time: 200_000,
        }]
    );
}

#[test]
fn transport_interruption_does_not_end_remote_interval_or_change_presence() {
    let runtime = RealtimeCurrentUserRuntime::new();
    runtime.set_snapshot("usr_self".into(), 7, json!({ "id": "usr_self" }));
    runtime
        .apply_ws_message(
            7,
            &current_user_location_message("wrld_remote:456", "", "2026-05-15T00:00:00Z"),
            game_not_running(true),
        )
        .expect("remote interval start");

    let finalized = runtime
        .interrupt_transport(7, game_not_running(true))
        .expect("transport finalization output");

    assert_eq!(finalized.snapshot["location"], json!("wrld_remote:456"));
    assert_eq!(finalized.snapshot["$presence"]["kind"], json!("online"));
    assert!(finalized
        .persistence
        .game_log_location_time_updates
        .is_empty());
}

#[test]
fn explicit_transport_finalization_ends_remote_interval() {
    let runtime = RealtimeCurrentUserRuntime::new();
    runtime.set_snapshot("usr_self".into(), 7, json!({ "id": "usr_self" }));
    runtime
        .apply_ws_message(
            7,
            &current_user_location_message("wrld_remote:456", "", "2026-05-15T00:00:00Z"),
            game_not_running(true),
        )
        .expect("remote interval start");

    let finalized = runtime
        .finalize_transport(7, game_not_running(true))
        .expect("explicit transport finalization output");

    assert_eq!(
        finalized.persistence.game_log_location_time_updates.len(),
        1
    );
    assert_eq!(
        finalized.persistence.game_log_location_time_updates[0].created_at,
        "2026-05-15T00:00:00Z"
    );
    assert!(finalized.persistence.game_log_location_time_updates[0].time > 0);
}

fn presence_of(output: &crate::realtime::RealtimeCurrentUserOutput) -> serde_json::Value {
    serde_json::to_value(&output.projection).unwrap()["patch"]["$presence"].clone()
}

#[test]
fn current_user_presence_follows_the_local_game_then_remote_presence_then_active() {
    let runtime = RealtimeCurrentUserRuntime::new();
    runtime.set_snapshot(
        "usr_self".into(),
        7,
        json!({ "id": "usr_self", "location": "offline", "last_platform": "standalonewindows" }),
    );

    let local = runtime
        .refresh_local_presence(7, game_running_at("wrld_local:1", "Local"))
        .expect("local presence output");
    assert_eq!(presence_of(&local)["kind"], "online");
    assert_eq!(
        presence_of(&local)["place"]["location"]["tag"],
        "wrld_local:1"
    );
    assert_eq!(presence_of(&local)["platform"], "standalonewindows");
    assert!(runtime
        .refresh_local_presence(7, game_running_at("wrld_local:1", "Local"))
        .is_none());

    let remote = runtime
        .apply_ws_message(
            7,
            &current_user_location_message("wrld_remote:2", "", "2026-05-15T00:00:00Z"),
            game_not_running(false),
        )
        .expect("remote presence output");
    assert_eq!(presence_of(&remote)["kind"], "online");
    assert_eq!(
        presence_of(&remote)["place"]["location"]["tag"],
        "wrld_remote:2"
    );

    let confirmed_offline = runtime
        .apply_refreshed_snapshot_if_sequence(
            7,
            runtime.snapshot_sequence(7).expect("sequence"),
            json!({ "id": "usr_self" }),
            json!({ "location": "offline" }),
            game_not_running(false),
        )
        .expect("refreshed output");
    assert_eq!(presence_of(&confirmed_offline)["kind"], "active");
}

#[test]
fn current_user_presence_reports_the_travel_destination_from_the_local_game() {
    let runtime = RealtimeCurrentUserRuntime::new();
    runtime.set_snapshot("usr_self".into(), 7, json!({ "id": "usr_self" }));
    let traveling = LocalGameContextSnapshot::Available {
        is_game_running: true,
        location: "traveling".into(),
        destination: "wrld_next:3".into(),
        world_name: String::new(),
        player_user_ids: Vec::new(),
    };

    let output = runtime
        .refresh_local_presence(7, traveling)
        .expect("traveling presence output");
    let presence = presence_of(&output);
    assert_eq!(presence["place"]["location"]["isTraveling"], true);
    assert_eq!(presence["place"]["travelingTo"]["tag"], "wrld_next:3");
}

#[test]
fn avatar_wear_checkpoint_saves_the_open_segment_and_closing_adds_only_the_rest() {
    let runtime = RealtimeCurrentUserRuntime::new();
    runtime.set_snapshot(
        "usr_self".into(),
        7,
        json!({ "id": "usr_self", "currentAvatar": "avtr_worn" }),
    );
    runtime
        .apply_game_running_state(7, game_running_at("wrld_1:1", "World"))
        .expect("game start output");
    std::thread::sleep(std::time::Duration::from_millis(5));

    let (owner, checkpoint) = runtime
        .checkpoint_avatar_wear(7, game_running_at("wrld_1:1", "World"))
        .expect("checkpoint while wearing");
    let saved = &checkpoint.avatar_time_spent_upserts[0];
    assert_eq!(owner.as_str(), "usr_self");
    assert_eq!(saved.avatar_id, "avtr_worn");
    assert!(saved.time_spent > 0);
    assert_eq!(saved.time_spent, saved.ended_at_ms - saved.started_at_ms);
    std::thread::sleep(std::time::Duration::from_millis(5));

    let stopped = runtime
        .apply_game_running_state(7, game_not_running(true))
        .expect("game stop output");
    let closing = &stopped.persistence.avatar_time_spent_upserts[0];
    assert_eq!(closing.started_at_ms, saved.started_at_ms);
    assert_eq!(closing.time_spent, closing.ended_at_ms - saved.ended_at_ms);
    assert!(runtime
        .checkpoint_avatar_wear(7, game_not_running(true))
        .is_none());
}

#[test]
fn an_avatar_wear_checkpoint_that_was_not_stored_is_counted_again_by_the_next_one() {
    let runtime = RealtimeCurrentUserRuntime::new();
    runtime.set_snapshot(
        "usr_self".into(),
        7,
        json!({ "id": "usr_self", "currentAvatar": "avtr_worn" }),
    );
    runtime
        .apply_game_running_state(7, game_running_at("wrld_1:1", "World"))
        .expect("game start output");
    std::thread::sleep(std::time::Duration::from_millis(5));
    let (_, failed) = runtime
        .checkpoint_avatar_wear(7, game_running_at("wrld_1:1", "World"))
        .expect("first checkpoint");
    let failed = &failed.avatar_time_spent_upserts[0];

    runtime.restore_avatar_wear_checkpoint(7, failed);
    std::thread::sleep(std::time::Duration::from_millis(5));
    let (_, next) = runtime
        .checkpoint_avatar_wear(7, game_running_at("wrld_1:1", "World"))
        .expect("next checkpoint");
    let next = &next.avatar_time_spent_upserts[0];

    assert_eq!(
        next.ended_at_ms - next.time_spent,
        failed.ended_at_ms - failed.time_spent
    );
}
