use super::test_support::*;
use super::*;

#[test]
fn sync_friend_snapshot_updates_overlay_friend_scope() -> Result<()> {
    let dir = TestDir::new("overlay-friend-scope");
    let db = Arc::new(DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?);
    let storage = StorageService::new(&dir.path.join("storage.json"))?;
    let web = Arc::new(WebClient::new(
        &storage,
        db.as_ref(),
        "wss://pipeline.vrchat.cloud".to_string(),
        env!("CARGO_PKG_VERSION"),
    )?);
    let session = HostSessionRuntime::new();
    let host_session_generation =
        session.set_realtime_context(crate::session::RealtimeSessionContext::new(
            "usr_self".into(),
            "https://api.vrchat.cloud/api/1".into(),
            "wss://pipeline.vrchat.cloud".into(),
        ));
    let overlay_activity =
        OverlayActivityRuntime::with_filters(OverlayActivityFilters::from_json(json!({
            "version": 1,
            "wrist": {
                "types": {
                    "invite": {
                        "scope": "friends",
                        "favoriteGroupKeys": "all"
                    }
                }
            }
        })));
    let world_cache = Arc::new(crate::world_cache::WorldCache::new(
        Arc::clone(&db),
        512,
        Duration::from_secs(30 * 60),
    ));
    let runtime = Arc::new(RealtimeHostRuntime::new(RealtimeHostRuntimeDeps {
        db,
        web,
        event_bus: RuntimeEventBus::new(),
        sync: RuntimeSyncEngine::new(),
        tasks: TaskSupervisor::new(),
        session,
        auth_scope: RuntimeAuthScope::new(),
        game_log_snapshot: Arc::new(Mutex::new(RuntimeSnapshot::default())),
        overlay_activity: overlay_activity.clone(),
        world_cache,
        print_cleanup: PrintCleanupQueue::new(),
        friend_note_change_sink: None,
    }));
    let active_session = RealtimeSessionContext::new(
        "usr_self".into(),
        "https://api.vrchat.cloud/api/1".into(),
        "wss://pipeline.vrchat.cloud".into(),
    );
    {
        let mut state = runtime.state.lock().unwrap();
        *state = RealtimeHostRuntimeState {
            generation: 7,
            active_context: Some(ActiveRealtimeContext {
                session: active_session.clone(),
                generation: 7,
                client_run_id: 1,
                session_generation: host_session_generation,
            }),
            ..RealtimeHostRuntimeState::default()
        };
    }
    let mut friends_by_id = HashMap::new();
    friends_by_id.insert(
        "usr_new".to_string(),
        FriendRecord {
            id: "usr_new".to_string(),
            display_name: "New Friend".to_string(),
            state: "online".to_string(),
            state_bucket: "online".to_string(),
            ..FriendRecord::default()
        },
    );

    let result = runtime.sync_friend_snapshot(
        active_session.user_id.clone(),
        active_session.endpoint.clone(),
        active_session.websocket.clone(),
        Some(7),
        friends_by_id,
    )?;

    assert!(result.accepted);
    assert!(overlay_activity
        .ingest_candidate(invite_candidate("usr_new"))
        .is_some());
    Ok(())
}

#[test]
fn sync_friend_snapshot_debounces_online_to_offline() -> Result<()> {
    let (_dir, runtime, active_session) = runtime_with_active_session("baseline-projection")?;
    let mut initial_friends = HashMap::new();
    initial_friends.insert(
        "usr_friend".to_string(),
        FriendRecord {
            id: "usr_friend".to_string(),
            display_name: "Friend".to_string(),
            state: "online".to_string(),
            state_bucket: "online".to_string(),
            location: "wrld_old:123".to_string(),
            ..FriendRecord::default()
        },
    );
    runtime.sync_friend_snapshot(
        active_session.user_id.clone(),
        active_session.endpoint.clone(),
        active_session.websocket.clone(),
        Some(7),
        initial_friends,
    )?;
    runtime.deps.event_bus.take_events_for_test();

    let mut refreshed_friends = HashMap::new();
    refreshed_friends.insert(
        "usr_friend".to_string(),
        FriendRecord {
            id: "usr_friend".to_string(),
            display_name: "Friend".to_string(),
            state: "offline".to_string(),
            state_bucket: "offline".to_string(),
            location: "offline".to_string(),
            ..FriendRecord::default()
        },
    );
    let result = runtime.sync_friend_snapshot(
        active_session.user_id.clone(),
        active_session.endpoint.clone(),
        active_session.websocket.clone(),
        Some(7),
        refreshed_friends,
    )?;

    let events = runtime.deps.event_bus.take_events_for_test();
    let projection = events
        .iter()
        .find(|event| event.name == "realtimeFriendProjection")
        .expect("baseline refresh should emit a friend projection");
    assert!(result.accepted);
    assert_eq!(result.baseline_revision, 1);
    assert_eq!(projection.payload["generation"], 7);
    assert_eq!(projection.payload["baselineRevision"], 1);
    assert_eq!(projection.payload["patches"].as_array().unwrap().len(), 1);
    assert_eq!(projection.payload["patches"][0]["userId"], "usr_friend");
    assert_eq!(projection.payload["patches"][0]["stateBucket"], "online");
    assert_eq!(
        projection.payload["patches"][0]["patch"]["stateBucket"],
        "online"
    );
    assert_eq!(
        projection.payload["patches"][0]["patch"]["location"],
        "wrld_old:123"
    );
    assert_eq!(
        projection.payload["patches"][0]["patch"]["pendingOffline"],
        true
    );
    Ok(())
}

#[test]
fn sync_friend_snapshot_emits_projection_for_active_removals() -> Result<()> {
    let (_dir, runtime, active_session) = runtime_with_active_session("baseline-removal")?;
    let mut initial_friends = HashMap::new();
    initial_friends.insert(
        "usr_removed".to_string(),
        FriendRecord {
            id: "usr_removed".to_string(),
            display_name: "Removed Friend".to_string(),
            state: "offline".to_string(),
            state_bucket: "offline".to_string(),
            ..FriendRecord::default()
        },
    );
    runtime.sync_friend_snapshot(
        active_session.user_id.clone(),
        active_session.endpoint.clone(),
        active_session.websocket.clone(),
        Some(7),
        initial_friends,
    )?;
    runtime.deps.event_bus.take_events_for_test();

    let result = runtime.sync_friend_snapshot(
        active_session.user_id.clone(),
        active_session.endpoint.clone(),
        active_session.websocket.clone(),
        Some(7),
        HashMap::new(),
    )?;

    let events = runtime.deps.event_bus.take_events_for_test();
    let projection = events
        .iter()
        .find(|event| event.name == "realtimeFriendProjection")
        .expect("baseline removal should emit a friend projection");
    assert!(result.accepted);
    assert_eq!(result.baseline_revision, 1);
    assert!(projection.payload["patches"].as_array().unwrap().is_empty());
    assert_eq!(
        projection.payload["removals"].as_array().unwrap(),
        &vec![json!("usr_removed")]
    );
    Ok(())
}

#[test]
fn apply_friend_profile_refresh_updates_existing_friend_only() -> Result<()> {
    let (_dir, runtime, active_session) = runtime_with_active_session("profile-refresh")?;
    let mut friends_by_id = HashMap::new();
    friends_by_id.insert(
        "usr_friend".to_string(),
        FriendRecord {
            id: "usr_friend".to_string(),
            display_name: "Friend".to_string(),
            state: "online".to_string(),
            state_bucket: "online".to_string(),
            location: "wrld_old:123".to_string(),
            ..FriendRecord::default()
        },
    );
    runtime.sync_friend_snapshot(
        active_session.user_id.clone(),
        active_session.endpoint.clone(),
        active_session.websocket.clone(),
        Some(7),
        friends_by_id,
    )?;

    let updated = runtime.apply_friend_profile_refresh(
        active_session.endpoint.clone(),
        "usr_friend".into(),
        json!({
            "id": "usr_friend",
            "displayName": "Fresh Friend",
            "state": "online",
            "location": "wrld_fresh:456"
        }),
    )?;
    let stranger_added = runtime.apply_friend_profile_refresh(
        active_session.endpoint.clone(),
        "usr_stranger".into(),
        json!({
            "id": "usr_stranger",
            "displayName": "Stranger",
            "state": "online"
        }),
    )?;

    let snapshot = runtime.friend_snapshot().unwrap();
    let friend = snapshot.friends_by_id.get("usr_friend").unwrap();
    assert!(updated);
    assert!(!stranger_added);
    assert_eq!(friend.display_name, "Fresh Friend");
    assert_eq!(friend.location, "wrld_fresh:456");
    assert!(!snapshot.friends_by_id.contains_key("usr_stranger"));
    Ok(())
}

#[test]
fn friend_projection_clears_feed_entries_when_persistence_fails() -> Result<()> {
    let (_dir, runtime, active_session) =
        runtime_with_active_session("friend-persist-failure-clears-feed")?;
    let feed_entry = json!({
        "created_at": "2026-06-21T00:00:00.000Z",
        "type": "NewFeedType",
        "userId": "usr_friend",
        "displayName": "Friend"
    });

    runtime.apply_friend_output(RealtimeFriendOutput {
        owner_user_id: active_session.user_id,
        projection: FriendProjection {
            generation: 7,
            feed_entries: vec![feed_entry.clone()],
            ..FriendProjection::default()
        },
        persistence: RealtimePersistenceBatch {
            feed_entries: vec![feed_entry],
            ..RealtimePersistenceBatch::default()
        },
        ..RealtimeFriendOutput::default()
    });

    let events = runtime.deps.event_bus.take_events_for_test();
    let projection = events
        .iter()
        .find(|event| event.name == "realtimeFriendProjection")
        .expect("friend projection should still be emitted after persistence failure");
    assert_eq!(
        projection.payload["feedEntries"].as_array().unwrap().len(),
        0
    );
    assert!(events.iter().all(|event| {
        event.name != "backendRuntimeTelemetry" || event.payload["kind"] != "wsPersisted"
    }));
    Ok(())
}

#[test]
fn friend_note_change_notifies_note_cache_sink() -> Result<()> {
    let dir = TestDir::new("friend-note-cache-sink");
    let db = Arc::new(DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?);
    let storage = StorageService::new(&dir.path.join("storage.json"))?;
    let web = Arc::new(WebClient::new(
        &storage,
        db.as_ref(),
        "wss://pipeline.vrchat.cloud".to_string(),
        env!("CARGO_PKG_VERSION"),
    )?);
    let session = HostSessionRuntime::new();
    let host_session_generation =
        session.set_realtime_context(crate::session::RealtimeSessionContext::new(
            "usr_self".into(),
            "https://api.vrchat.cloud/api/1".into(),
            "wss://pipeline.vrchat.cloud".into(),
        ));
    let world_cache = Arc::new(crate::world_cache::WorldCache::new(
        Arc::clone(&db),
        512,
        Duration::from_secs(30 * 60),
    ));
    let invalidations = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let runtime = Arc::new(RealtimeHostRuntime::new(RealtimeHostRuntimeDeps {
        db,
        web,
        event_bus: RuntimeEventBus::new(),
        sync: RuntimeSyncEngine::new(),
        tasks: TaskSupervisor::new(),
        session,
        auth_scope: RuntimeAuthScope::new(),
        game_log_snapshot: Arc::new(Mutex::new(RuntimeSnapshot::default())),
        overlay_activity: OverlayActivityRuntime::default(),
        world_cache,
        print_cleanup: PrintCleanupQueue::new(),
        friend_note_change_sink: Some({
            let invalidations = Arc::clone(&invalidations);
            Arc::new(move || {
                invalidations.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            })
        }),
    }));
    let active_session = RealtimeSessionContext::new(
        "usr_self".into(),
        "https://api.vrchat.cloud/api/1".into(),
        "wss://pipeline.vrchat.cloud".into(),
    );
    {
        let mut state = runtime.state.lock().unwrap();
        *state = RealtimeHostRuntimeState {
            generation: 7,
            active_context: Some(ActiveRealtimeContext {
                session: active_session.clone(),
                generation: 7,
                client_run_id: 1,
                session_generation: host_session_generation,
            }),
            ..RealtimeHostRuntimeState::default()
        };
    }
    let mut friend = FriendRecord {
        id: "usr_friend".to_string(),
        display_name: "Friend".to_string(),
        state: "online".to_string(),
        state_bucket: "online".to_string(),
        ..FriendRecord::default()
    };
    friend.extra.insert("note".into(), json!("old note"));
    runtime.sync_friend_snapshot(
        active_session.user_id.clone(),
        active_session.endpoint.clone(),
        active_session.websocket.clone(),
        Some(7),
        [("usr_friend".to_string(), friend)].into_iter().collect(),
    )?;
    assert_eq!(invalidations.load(std::sync::atomic::Ordering::SeqCst), 0);

    let output = runtime.friends.apply_ws_message(&RealtimeWsMessagePayload {
        json: json!({
            "type": "friend-update",
            "content": {
                "userId": "usr_friend",
                "user": {
                    "id": "usr_friend",
                    "displayName": "Friend",
                    "note": "new note"
                }
            }
        }),
        raw: String::new(),
        received_at: "2026-07-05T00:00:00.000Z".to_string(),
    });
    let RealtimeFriendApplyResult::Output(output) = output else {
        panic!("friend note update should emit output");
    };
    runtime.apply_friend_output(*output);

    assert_eq!(invalidations.load(std::sync::atomic::Ordering::SeqCst), 1);
    Ok(())
}
