use super::test_support::*;
use super::*;
use crate::RealtimeEntryCorrectionStream;
use vrcx_0_core::OwnerId;

#[test]
fn enrich_projection_world_names_returns_unresolved_world_ids() -> Result<()> {
    let (_dir, runtime, _active_session) = runtime_with_active_session("world-name-enrichment")?;
    let mut entries = vec![gps_world_entry("wrld_missing")];

    let unresolved_world_ids = runtime
        .runtime()
        .enrich_projection_world_names(&mut entries);

    assert_eq!(unresolved_world_ids.len(), 1);
    assert_eq!(unresolved_world_ids[0].world_id, "wrld_missing");
    let entry = unresolved_world_ids[0].entry.as_ref().unwrap();
    assert_eq!(entry.stream, RealtimeEntryCorrectionStream::Feed);
    assert_eq!(
        entry.id,
        "GPS:2026-06-21T00:00:00.000Z:usr_location:wrld_missing:123:"
    );
    assert_eq!(entries[0].world_name(), "wrld_missing");
    Ok(())
}

fn gps_world_entry(world_id: &str) -> FeedLiveEntry {
    FeedLiveEntry::Gps {
        created_at: "2026-06-21T00:00:00.000Z".into(),
        user_id: "usr_location".into(),
        display_name: String::new(),
        location: format!("{world_id}:123"),
        world_name: world_id.into(),
        previous_location: String::new(),
        time: 0,
        group_name: String::new(),
        world_id: None,
        display_location: None,
        owner_user_id: String::new(),
    }
}

#[test]
fn feed_entry_correction_id_matches_frontend_golden_vectors() {
    let vectors = [
        (
            FeedLiveEntry::InstanceClosed {
                created_at: "2026-06-21T00:00:00.000Z".into(),
                id: "instance.closed:wrld_world:123:2026-06-21T00:00:00.000Z".into(),
                location: "wrld_world:123".into(),
                message: "Instance Closed".into(),
                world_name: None,
                world_id: None,
                display_location: None,
                owner_user_id: String::new(),
            },
            "id:instance.closed:wrld_world:123:2026-06-21T00:00:00.000Z",
        ),
        (
            gps_world_entry("wrld_world"),
            "GPS:2026-06-21T00:00:00.000Z:usr_location:wrld_world:123:",
        ),
        (
            FeedLiveEntry::Status {
                created_at: "2026-06-21T00:00:00.000Z".into(),
                user_id: "usr_friend".into(),
                display_name: "Friend".into(),
                status: "active".into(),
                status_description: String::new(),
                previous_status: "join me".into(),
                previous_status_description: String::new(),
                owner_user_id: String::new(),
            },
            "Status:2026-06-21T00:00:00.000Z:usr_friend::",
        ),
    ];

    for (entry, expected) in vectors {
        assert_eq!(entry.correction_id(), expected);
    }
}

#[test]
fn failed_world_name_warm_drains_pending_corrections_without_emit() -> Result<()> {
    let (_dir, runtime, _active_session) = runtime_with_active_session("world-warm-failure-drain")?;
    {
        let mut state = runtime.runtime().state.lock().unwrap();
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

    runtime
        .runtime()
        .resolve_pending_world_corrections("wrld_fail", None);

    let state = runtime.runtime().state.lock().unwrap();
    assert!(!state.world_enrichment.inflight.contains("wrld_fail"));
    assert!(!state
        .world_enrichment
        .pending_corrections
        .contains_key("wrld_fail"));
    drop(state);
    assert!(runtime
        .runtime()
        .deps
        .event_bus
        .take_events_for_test()
        .is_empty());
    Ok(())
}

#[test]
fn resolved_feed_world_name_patches_the_rust_cache_and_emits_feed_projection() -> Result<()> {
    let (_dir, runtime, _active_session) =
        runtime_with_active_session("world-warm-feed-correction")?;
    runtime.runtime().emit_feed_entries(
        7,
        &OwnerId::new("usr_self"),
        vec![gps_world_entry("wrld_pending")],
    );
    runtime.runtime().deps.event_bus.take_events_for_test();
    {
        let mut state = runtime.runtime().state.lock().unwrap();
        state
            .world_enrichment
            .inflight
            .insert("wrld_pending".into());
        state.world_enrichment.pending_corrections.insert(
            "wrld_pending".into(),
            vec![PendingEntryCorrection {
                stream: RealtimeEntryCorrectionStream::Feed,
                id: "GPS:2026-06-21T00:00:00.000Z:usr_location:wrld_pending:123:".into(),
                location: "wrld_pending:123".into(),
                group_name: String::new(),
            }],
        );
    }

    runtime
        .runtime()
        .resolve_pending_world_corrections("wrld_pending", Some("Resolved World"));

    let events = runtime.runtime().deps.event_bus.take_events_for_test();
    let projection = events
        .iter()
        .find(|event| event.name == "realtimeFeedProjection")
        .expect("resolved Feed world should emit a Feed correction");
    assert_eq!(projection.payload["patches"][0]["sequence"], 2);
    assert_eq!(
        projection.payload["patches"][0]["fields"]["worldName"],
        "Resolved World"
    );
    assert!(events
        .iter()
        .all(|event| event.name != "realtimeEntryCorrection"));
    Ok(())
}
