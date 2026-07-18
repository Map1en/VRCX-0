use super::test_support::*;
use super::*;

#[test]
fn enrich_projection_world_names_returns_unresolved_world_ids() -> Result<()> {
    let (_dir, runtime, _active_session) = runtime_with_active_session("world-name-enrichment")?;
    let mut entries = vec![json!({
        "type": "GPS",
        "created_at": "2026-06-21T00:00:00.000Z",
        "userId": "usr_location",
        "location": "wrld_missing:123",
        "worldName": "wrld_missing"
    })];

    let unresolved_world_ids = runtime.enrich_projection_world_names(&mut entries);

    assert_eq!(unresolved_world_ids.len(), 1);
    assert_eq!(unresolved_world_ids[0].world_id, "wrld_missing");
    let entry = unresolved_world_ids[0].entry.as_ref().unwrap();
    assert_eq!(entry.stream, RealtimeEntryCorrectionStream::Feed);
    assert_eq!(
        entry.id,
        "GPS:2026-06-21T00:00:00.000Z:usr_location:wrld_missing:123:"
    );
    assert_eq!(entries[0]["worldName"], "wrld_missing");
    Ok(())
}

#[test]
fn feed_entry_correction_id_matches_frontend_golden_vectors() {
    let vectors = [
        (
            json!({
                "id": "feed-entry-1",
                "type": "GPS",
                "rowId": "10",
                "sourceRank": "2"
            }),
            "id:feed-entry-1",
        ),
        (
            json!({
                "type": "GPS",
                "rowId": "10",
                "sourceRank": "2"
            }),
            "row:GPS:2:10",
        ),
        (
            json!({
                "type": "Online",
                "row_id": "11",
                "source_rank": "3"
            }),
            "row:Online:3:11",
        ),
        (
            json!({
                "type": "invite",
                "created_at": "2026-06-21T00:00:00.000Z",
                "userId": "usr_sender",
                "details": {
                    "location": "wrld_world:123"
                },
                "message": "Join me"
            }),
            "invite:2026-06-21T00:00:00.000Z:usr_sender:wrld_world:123:Join me",
        ),
    ];

    for (input, expected) in vectors {
        let object = input.as_object().unwrap();
        assert_eq!(
            super::enrichment::feed_entry_correction_id(object),
            expected
        );
    }
}

#[test]
fn world_cache_name_lookup_does_not_fallback_to_db_hot_path() -> Result<()> {
    let (dir, db) = {
        let dir = TestDir::new("world-cache-fast-path");
        let db = Arc::new(DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?);
        (dir, db)
    };
    world_cache_upsert(
        db.as_ref(),
        cached_world_entry("wrld_db_only", "DB Only World", "2026-01-01T00:00:00.000Z"),
    )?;
    let cache =
        vrcx_0_application_core::WorldCache::new(Arc::clone(&db), 1, Duration::from_secs(60));

    assert_eq!(cache.get_name("wrld_db_only"), None);
    drop(dir);
    Ok(())
}

#[test]
fn world_cache_init_pins_favorites_and_bounds_working_set() -> Result<()> {
    let (dir, db) = {
        let dir = TestDir::new("world-cache-init-bounds");
        let db = Arc::new(DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?);
        (dir, db)
    };
    world_cache_upsert(
        db.as_ref(),
        cached_world_entry(
            "wrld_favorite",
            "Favorite World",
            "2026-01-01T00:00:00.000Z",
        ),
    )?;
    world_cache_upsert(
        db.as_ref(),
        cached_world_entry("wrld_recent", "Recent World", "2026-03-01T00:00:00.000Z"),
    )?;
    world_cache_upsert(
        db.as_ref(),
        cached_world_entry("wrld_old", "Old World", "2026-02-01T00:00:00.000Z"),
    )?;
    favorite_add(
        db.as_ref(),
        None,
        "world".into(),
        "wrld_favorite".into(),
        "Favorites".into(),
    )?;
    let cache =
        vrcx_0_application_core::WorldCache::new(Arc::clone(&db), 1, Duration::from_secs(60));

    cache.init_load();

    assert_eq!(
        cache.get_name("wrld_favorite").as_deref(),
        Some("Favorite World")
    );
    assert_eq!(
        cache.get_name("wrld_recent").as_deref(),
        Some("Recent World")
    );
    assert_eq!(cache.get_name("wrld_old"), None);
    drop(dir);
    Ok(())
}

#[test]
fn failed_world_name_warm_drains_pending_corrections_without_emit() -> Result<()> {
    let (_dir, runtime, _active_session) = runtime_with_active_session("world-warm-failure-drain")?;
    {
        let mut state = runtime.state.lock().unwrap();
        state.world_enrichment.inflight.insert("wrld_fail".into());
        state.world_enrichment.pending_corrections.insert(
            "wrld_fail".into(),
            vec![PendingEntryCorrection {
                stream: RealtimeEntryCorrectionStream::Feed,
                id: "GPS:2026-06-21T00:00:00.000Z:usr_location:wrld_fail:123:".into(),
                location: "wrld_fail:123".into(),
                group_name: String::new(),
            }],
        );
    }

    runtime.resolve_pending_world_corrections("wrld_fail", None);

    let state = runtime.state.lock().unwrap();
    assert!(!state.world_enrichment.inflight.contains("wrld_fail"));
    assert!(!state
        .world_enrichment
        .pending_corrections
        .contains_key("wrld_fail"));
    drop(state);
    assert!(runtime.deps.event_bus.take_events_for_test().is_empty());
    Ok(())
}

#[test]
fn notify_favorites_changed_emits_event_and_normalizes_vrc_plus_world() -> Result<()> {
    let (_dir, runtime, _active_session) = runtime_with_active_session("favorites-changed-notify")?;

    runtime.notify_favorites_changed("vrcPlusWorld", true, false);

    let events = runtime.deps.event_bus.take_events_for_test();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].name, "favoritesChanged");
    assert_eq!(events[0].payload["kind"], "world");
    assert_eq!(events[0].payload["local"], true);
    assert_eq!(events[0].payload["remote"], false);
    Ok(())
}
