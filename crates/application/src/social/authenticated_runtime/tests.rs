use std::collections::BTreeMap;

use super::*;
use serde_json::json;
use vrcx_0_application_realtime::FriendRosterSnapshot;

#[test]
fn typed_favorite_membership_normalizes_ids_and_prefixes_local_groups() {
    let memberships = BTreeMap::from([(
        "Friends".to_string(),
        vec![" usr_one ".to_string(), String::new()],
    )]);
    let mut groups = HashMap::new();

    append_typed_favorite_group_membership(&mut groups, &memberships, "local:");

    assert_eq!(
        groups,
        HashMap::from([("local:Friends".to_string(), vec!["usr_one".to_string()])])
    );
}

#[test]
fn compact_friend_ids_preserve_record_ids_and_fall_back_to_roster_keys() {
    let friend_ids = friend_ids_by_roster_id_from_records(HashMap::from([
        (
            "roster_one".to_string(),
            FriendRecord {
                id: " usr_one ".into(),
                ..FriendRecord::default()
            },
        ),
        ("usr_two".to_string(), FriendRecord::default()),
    ]));

    assert_eq!(friend_ids["roster_one"], "usr_one");
    assert_eq!(friend_ids["usr_two"], "usr_two");
}

#[test]
fn recognizes_only_typed_vrchat_auth_failures() {
    assert_eq!(
        vrchat_auth_failure_status(&Error::VrchatApi {
            status_code: 401,
            message: "opaque auth failure".into(),
        }),
        Some(401)
    );
    assert_eq!(
        vrchat_auth_failure_status(&Error::VrchatApi {
            status_code: 403,
            message: "opaque auth failure".into(),
        }),
        Some(403)
    );
    assert_eq!(
        vrchat_auth_failure_status(&Error::Custom("HTTP 401".into())),
        None
    );
}

#[test]
fn session_match_includes_scope_and_transport_identity() {
    let session = AuthenticatedRuntimeSession::from_user(
        json!({"id": "usr_one", "displayName": "One"}),
        "https://api.example.test/api/1".into(),
        "wss://pipeline.example.test".into(),
    );
    let snapshot = AuthenticatedRuntimePhaseSnapshot {
        auth_scope_generation: 4,
        user_id: session.user_id.clone(),
        endpoint: session.endpoint.clone(),
        websocket: session.websocket.clone(),
        ..Default::default()
    };

    assert!(snapshot_matches_session(&snapshot, &session, 4));
    assert!(!snapshot_matches_session(&snapshot, &session, 5));

    let mut other_transport = session.clone();
    other_transport.websocket = "wss://other.example.test".into();
    assert!(!snapshot_matches_session(&snapshot, &other_transport, 4));
}

#[test]
fn realtime_lifecycle_requires_matching_transport_identity() {
    let transport = RealtimeTransportStartResult {
        generation: 2,
        client_run_id: 4,
        session_generation: 6,
    };
    let mut snapshot = AuthenticatedRuntimePhaseSnapshot {
        realtime_transport: Some(transport.clone()),
        ..Default::default()
    };
    let stale = RealtimeTransportStartResult {
        generation: 1,
        ..transport.clone()
    };

    apply_realtime_connected(&mut snapshot, 1, &stale);
    assert_eq!(
        snapshot.realtime.status,
        AuthenticatedRuntimeStepStatus::Pending
    );

    apply_realtime_connected(&mut snapshot, 1, &transport);
    assert_eq!(
        snapshot.realtime.status,
        AuthenticatedRuntimeStepStatus::Ready
    );
}

#[test]
fn realtime_counts_as_interrupted_only_while_running_after_a_disconnect() {
    let mut snapshot = AuthenticatedRuntimePhaseSnapshot {
        phase: AuthenticatedRuntimePhase::Ready,
        realtime_health: AuthenticatedRuntimeRealtimeHealth {
            interrupted: true,
            disconnected_at: Some("2026-10-31T00:00:00.000Z".into()),
            retry_at: None,
        },
        ..Default::default()
    };
    assert!(snapshot.realtime_interrupted());

    snapshot.phase = AuthenticatedRuntimePhase::Starting;
    assert!(snapshot.realtime_interrupted());

    snapshot.phase = AuthenticatedRuntimePhase::Stopped;
    assert!(!snapshot.realtime_interrupted());

    snapshot.phase = AuthenticatedRuntimePhase::Ready;
    snapshot.realtime_health.disconnected_at = None;
    assert!(!snapshot.realtime_interrupted());
}

#[test]
fn runtime_is_ready_only_after_every_step_is_ready() {
    let mut snapshot = AuthenticatedRuntimePhaseSnapshot {
        friends: ready_step(1, "friends".into()),
        favorites: ready_step(1, "favorites".into()),
        ..Default::default()
    };
    assert!(!all_steps_ready(&snapshot));

    snapshot.realtime = ready_step(1, "realtime".into());
    assert!(all_steps_ready(&snapshot));
}

#[test]
fn friend_rebaseline_emits_full_output_without_storing_it_in_phase() {
    let mut state = AuthenticatedRuntimeState::default();
    let output = SocialFriendRosterBaselineOutput {
        user_id: "usr_self".into(),
        stale: false,
        count: 1,
        detail: "Friends ready.".into(),
        snapshot: Some(FriendRosterSnapshot::default()),
        friend_log_changed: false,
    };

    let emitted = commit_friend_baseline(&mut state, 1, output.clone());

    assert_eq!(state.phase.friend_baseline_revision, 1);
    assert!(state.phase.friend_baseline.is_none());
    let committed = emitted.friend_baseline.as_ref().unwrap();
    assert_eq!(committed.user_id, "usr_self");
    assert_eq!(committed.count, 1);
    assert_eq!(committed.detail, "Friends ready.");
    assert_eq!(
        committed.snapshot.as_ref(),
        Some(&FriendRosterSnapshot::default())
    );

    let emitted = commit_friend_baseline(&mut state, 1, output);
    assert_eq!(state.phase.friend_baseline_revision, 2);
    assert!(state.phase.friend_baseline.is_none());
    assert!(emitted.friend_baseline.is_some());
}

#[test]
fn favorites_baseline_emits_full_output_without_storing_it_in_phase() {
    let mut state = AuthenticatedRuntimeState::default();
    let output = SocialFavoritesBaselineOutput {
        user_id: "usr_self".into(),
        stale: false,
        count: 1,
        snapshot: Some(FavoriteBaselineSnapshot {
            current_user_id: "usr_self".into(),
            ..Default::default()
        }),
    };

    let emitted = commit_favorites_baseline(&mut state, 1, output);

    assert_eq!(
        state.phase.favorites.status,
        AuthenticatedRuntimeStepStatus::Ready
    );
    assert!(state.phase.favorites_baseline.is_none());
    assert!(state.favorites_baseline.is_some());
    assert!(emitted.favorites_baseline.is_some());
}

#[test]
fn a_favorites_baseline_for_the_active_session_is_accepted_for_the_activity_router() {
    let output = |user_id: &str| SocialFavoritesBaselineOutput {
        user_id: user_id.into(),
        stale: false,
        count: 1,
        snapshot: Some(FavoriteBaselineSnapshot {
            current_user_id: user_id.into(),
            grouped_favorite_friend_ids_by_group_key: [(
                "group_1".to_string(),
                vec!["usr_friend".to_string()],
            )]
            .into(),
            ..Default::default()
        }),
    };
    let mut state = AuthenticatedRuntimeState::default();
    state.phase.user_id = "usr_self".into();
    state.phase.phase = AuthenticatedRuntimePhase::Ready;

    assert!(accept_favorites_baseline(&mut state, output("usr_other")).is_none());
    let accepted = accept_favorites_baseline(&mut state, output("usr_self"))
        .expect("the active session accepts its own favorites baseline");

    assert_eq!(
        accepted.grouped_favorite_friend_ids_by_group_key["group_1"],
        ["usr_friend"]
    );
    assert_eq!(
        state
            .favorite_group_memberships
            .as_ref()
            .map(|memberships| memberships.friend_groups_by_key.len()),
        Some(1)
    );

    state.phase.phase = AuthenticatedRuntimePhase::Stopped;
    assert!(accept_favorites_baseline(&mut state, output("usr_self")).is_none());
}

#[test]
fn combined_favorite_group_memberships_preserve_remote_and_local_groups() {
    let snapshot = FavoriteBaselineSnapshot {
        grouped_favorite_friend_ids_by_group_key: BTreeMap::from([(
            "group_friend".into(),
            vec!["usr_friend".into()],
        )]),
        local_friend_favorites: BTreeMap::from([("local_friend".into(), vec!["usr_local".into()])]),
        grouped_favorite_world_ids_by_group_key: BTreeMap::from([(
            "group_world".into(),
            vec!["wrld_remote".into()],
        )]),
        local_world_favorites: BTreeMap::from([("local_world".into(), vec!["wrld_local".into()])]),
        ..Default::default()
    };

    let memberships = favorite_group_memberships_from_baseline(&snapshot);

    assert_eq!(
        memberships.friend_groups_by_key["group_friend"],
        ["usr_friend"]
    );
    assert_eq!(
        memberships.friend_groups_by_key["local:local_friend"],
        ["usr_local"]
    );
    assert_eq!(
        memberships.world_groups_by_key["group_world"],
        ["wrld_remote"]
    );
    assert_eq!(
        memberships.world_groups_by_key["local:local_world"],
        ["wrld_local"]
    );
}

#[test]
fn combined_snapshot_reattaches_current_friend_and_favorites_baselines() {
    let mut state = AuthenticatedRuntimeState {
        phase: AuthenticatedRuntimePhaseSnapshot {
            user_id: "usr_self".into(),
            endpoint: "https://api.example.test".into(),
            websocket: "wss://ws.example.test".into(),
            ..Default::default()
        },
        ..Default::default()
    };
    commit_friend_baseline(
        &mut state,
        1,
        SocialFriendRosterBaselineOutput {
            user_id: "usr_self".into(),
            stale: false,
            count: 1,
            detail: "Friends ready.".into(),
            snapshot: Some(FriendRosterSnapshot::default()),
            friend_log_changed: true,
        },
    );
    commit_favorites_baseline(
        &mut state,
        1,
        SocialFavoritesBaselineOutput {
            user_id: "usr_self".into(),
            stale: false,
            count: 1,
            snapshot: Some(FavoriteBaselineSnapshot {
                current_user_id: "usr_self".into(),
                ..Default::default()
            }),
        },
    );

    let snapshot = assemble_authenticated_runtime_snapshot(
        state.phase.clone(),
        state.friend_baseline.clone(),
        Some(RealtimeFriendRosterSnapshot {
            current_user_id: "usr_self".into(),
            endpoint: "https://api.example.test".into(),
            websocket: "wss://ws.example.test".into(),
            friend_count: 1,
            snapshot: FriendRosterSnapshot {
                current_user_id: "usr_self".into(),
                generation: 1,
                ..FriendRosterSnapshot::default()
            },
        }),
        state.favorites_baseline.clone(),
    );

    assert!(state.phase.friend_baseline.is_none());
    assert!(state.phase.favorites_baseline.is_none());
    assert_eq!(snapshot.friend_baseline.as_ref().unwrap().count, 1);
    assert!(
        !snapshot
            .friend_baseline
            .as_ref()
            .unwrap()
            .friend_log_changed
    );
    assert_eq!(snapshot.favorites_baseline.as_ref().unwrap().count, 1);
}
