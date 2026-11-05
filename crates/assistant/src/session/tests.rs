use super::*;
use crate::charts::{AssistantChartAxis, AssistantChartKind, AssistantChartPoint};
use crate::test_support::TestAssistantSessionPersistence;

const TEST_OWNER: &str = "usr_test";

fn test_persistence() -> TestAssistantSessionPersistence {
    TestAssistantSessionPersistence::default()
}

impl SessionStore {
    fn with_test_persistence(persistence: &TestAssistantSessionPersistence) -> Self {
        Self::with_persistence(Arc::new(persistence.clone()))
    }
}

fn create_test_session(store: &SessionStore) -> Session {
    store.create_session_with_runtime(
        &OwnerId::new(TEST_OWNER),
        AssistantRuntimeSelection::default(),
    )
}

#[test]
fn reopened_session_keeps_history_for_followups() {
    let persistence = test_persistence();
    let session = {
        let store = SessionStore::with_test_persistence(&persistence);
        let session = create_test_session(&store);
        store
            .push_message(&session.id, Role::User, "who do I play with?".into())
            .unwrap();
        store
            .push_message(&session.id, Role::Assistant, "Alice and Bob.".into())
            .unwrap();
        session
    };

    // Simulate an app restart: a fresh store over the same database must
    // hydrate the prior turns so the next question is sent with context.
    let reopened = SessionStore::with_test_persistence(&persistence);
    let history = reopened
        .get(&OwnerId::new(TEST_OWNER), &session.id)
        .unwrap()
        .unwrap()
        .messages;
    assert_eq!(history.len(), 2);
    assert_eq!(history[0].role, Role::User);
    assert_eq!(history[0].content, "who do I play with?");
    assert_eq!(history[1].role, Role::Assistant);
    assert_eq!(history[1].content, "Alice and Bob.");
}

#[test]
fn reopened_session_restores_tool_rows_with_full_content_for_the_model() {
    let persistence = test_persistence();
    let session = {
        let store = SessionStore::with_test_persistence(&persistence);
        let session = create_test_session(&store);
        store
            .push_message(&session.id, Role::User, "who do I play with?".into())
            .unwrap();
        store
            .push_tool_call(
                &session.id,
                ToolCallRecord {
                    id: "call_1".into(),
                    name: "get_copresence_summary".into(),
                    arguments: "{\"limit\":5}".into(),
                    extra_content: None,
                },
            )
            .unwrap();
        store
            .push_tool_result(
                &session.id,
                ToolResultRecord {
                    tool_call_id: "call_1".into(),
                    name: "get_copresence_summary".into(),
                    ok: true,
                    summary: "Alice tops the list.".into(),
                    entities: vec![Entity {
                        kind: crate::entities::EntityKind::User,
                        id: "usr_alice".into(),
                        display_name: "Alice".into(),
                    }],
                    charts: vec![AssistantChart {
                        kind: AssistantChartKind::TopCompanions,
                        axis: AssistantChartAxis::Label,
                        subject: None,
                        points: vec![AssistantChartPoint {
                            key: "Alice".into(),
                            value: 120,
                        }],
                    }],
                    screenshots: Some(crate::screenshots::AssistantScreenshots {
                        total: 3,
                        ids: vec!["VRChat_a.png".into()],
                        filter: vrcx_0_core::screenshots::ScreenshotFilter::default(),
                    }),
                },
                "{\"summary\":\"Alice tops the list.\",\"rows\":[{\"userId\":\"usr_alice\"}]}"
                    .into(),
            )
            .unwrap();
        session
    };

    let reopened = SessionStore::with_test_persistence(&persistence);
    let history = reopened
        .get(&OwnerId::new(TEST_OWNER), &session.id)
        .unwrap()
        .unwrap()
        .messages;
    assert_eq!(history.len(), 3);
    assert_eq!(history[0].role, Role::User);
    assert_eq!(history[1].role, Role::ToolCall);
    assert_eq!(
        history[1].tool_call.as_ref().unwrap().arguments,
        "{\"limit\":5}"
    );
    assert!(history[1].content.is_empty());
    assert_eq!(history[2].role, Role::ToolResult);
    let result = history[2].tool_result.as_ref().unwrap();
    assert_eq!(result.tool_call_id, "call_1");
    assert_eq!(result.summary, "Alice tops the list.");
    assert_eq!(result.entities[0].id, "usr_alice");
    assert_eq!(result.charts[0].points[0].value, 120);
    assert_eq!(result.screenshots.as_ref().unwrap().ids, ["VRChat_a.png"]);
    assert_eq!(
        history[2].tool_content.as_deref(),
        Some("{\"summary\":\"Alice tops the list.\",\"rows\":[{\"userId\":\"usr_alice\"}]}")
    );
    let ui_payload = serde_json::to_value(&history[2]).unwrap();
    assert!(ui_payload.get("toolContent").is_none());
    assert_eq!(ui_payload["toolResult"]["summary"], "Alice tops the list.");
    assert_eq!(ui_payload["role"], "tool_result");
}

#[test]
fn message_load_failure_retries_without_caching_partial_history() {
    let persistence = test_persistence();
    let session_id = {
        let store = SessionStore::with_test_persistence(&persistence);
        let session = create_test_session(&store);
        assert!(store
            .push_message(&session.id, Role::User, "persisted".into())
            .unwrap());
        session.id
    };
    let reopened = SessionStore::with_test_persistence(&persistence);
    assert_eq!(reopened.list(&OwnerId::new(TEST_OWNER)).len(), 1);

    persistence.set_load_messages_failure(true);
    assert!(reopened
        .push_message(&session_id, Role::User, "must not append".into())
        .is_err());
    assert!(!reopened
        .state
        .lock()
        .unwrap()
        .contents
        .contains_key(&session_id));

    persistence.set_load_messages_failure(false);
    let restored = reopened
        .get(&OwnerId::new(TEST_OWNER), &session_id)
        .unwrap()
        .unwrap();
    assert_eq!(restored.messages.len(), 1);
    assert_eq!(restored.messages[0].content, "persisted");
    assert!(reopened
        .push_message(&session_id, Role::User, "after recovery".into())
        .unwrap());
    assert_eq!(reopened.history(&session_id).len(), 2);
}

#[test]
fn session_content_cache_evicts_clean_inactive_histories() {
    let store = SessionStore::with_test_persistence(&test_persistence());
    let mut session_ids = Vec::new();
    for _ in 0..SESSION_CONTENT_CACHE_CAPACITY + 3 {
        session_ids.push(create_test_session(&store).id);
    }
    assert_eq!(
        store.state.lock().unwrap().contents.len(),
        SESSION_CONTENT_CACHE_CAPACITY
    );

    let oldest = &session_ids[0];
    assert!(store
        .get(&OwnerId::new(TEST_OWNER), oldest)
        .unwrap()
        .is_some());
    let state = store.state.lock().unwrap();
    assert_eq!(state.contents.len(), SESSION_CONTENT_CACHE_CAPACITY);
    assert!(state.contents.contains_key(oldest));
}

#[test]
fn failed_message_write_is_not_evicted() {
    let persistence = test_persistence();
    let store = SessionStore::with_test_persistence(&persistence);
    let session = create_test_session(&store);
    persistence.set_write_failure(true);

    assert!(store
        .push_message(&session.id, Role::User, "memory only".into())
        .unwrap());
    for _ in 0..SESSION_CONTENT_CACHE_CAPACITY + 3 {
        create_test_session(&store);
    }
    let state = store.state.lock().unwrap();
    let content = state.contents.get(&session.id).unwrap();
    assert!(content.write_failed);
    assert_eq!(content.messages[0].content, "memory only");
    drop(state);
}

#[test]
fn session_snapshot_keeps_title_and_messages_consistent_during_push() {
    let store = Arc::new(SessionStore::with_test_persistence(&test_persistence()));
    let session = create_test_session(&store);
    let session_id = session.id.clone();
    let writer_store = Arc::clone(&store);
    let writer_session_id = session_id.clone();
    let writer = std::thread::spawn(move || {
        writer_store
            .push_message(&writer_session_id, Role::User, "first message".into())
            .unwrap();
    });

    while !writer.is_finished() {
        let snapshot = store
            .get(&OwnerId::new(TEST_OWNER), &session_id)
            .unwrap()
            .unwrap();
        if !snapshot.messages.is_empty() {
            assert_eq!(snapshot.title, "first message");
        }
    }
    writer.join().unwrap();
    let snapshot = store
        .get(&OwnerId::new(TEST_OWNER), &session_id)
        .unwrap()
        .unwrap();
    assert_eq!(snapshot.title, "first message");
    assert_eq!(snapshot.messages.len(), 1);
}

#[test]
fn reopened_session_restores_panel_state() {
    let persistence = test_persistence();
    let session_id = {
        let store = SessionStore::with_test_persistence(&persistence);
        let session = create_test_session(&store);
        store.set_surfaced_entities(
            &session.id,
            &[Entity {
                kind: crate::entities::EntityKind::User,
                id: "usr_1".into(),
                display_name: "Alice".into(),
            }],
        );
        session.id
    };

    // Surfacing entities auto-opens the panel; both must survive a restart.
    let reopened = SessionStore::with_test_persistence(&persistence)
        .get(&OwnerId::new(TEST_OWNER), &session_id)
        .unwrap()
        .unwrap();
    assert!(reopened.entity_panel_open);
    assert_eq!(reopened.surfaced_entities.len(), 1);
    assert_eq!(reopened.surfaced_entities[0].id, "usr_1");
    assert_eq!(reopened.surfaced_entities[0].display_name, "Alice");
}

#[test]
fn runtime_selection_round_trips_and_lazy_seeds_old_sessions() {
    let persistence = test_persistence();
    let session_id = {
        let store = SessionStore::with_test_persistence(&persistence);
        let session = create_test_session(&store);
        store
            .set_runtime(
                &OwnerId::new(TEST_OWNER),
                &session.id,
                AssistantRuntimeSelection {
                    endpoint_id: Some("ep_1".into()),
                    model: Some("model-a".into()),
                    allow_writes: true,
                    playbook_mode: PlaybookMode::Guided,
                },
            )
            .unwrap()
            .unwrap()
            .id
    };

    let reopened = SessionStore::with_test_persistence(&persistence)
        .get(&OwnerId::new(TEST_OWNER), &session_id)
        .unwrap()
        .unwrap();
    assert_eq!(reopened.endpoint_id.as_deref(), Some("ep_1"));
    assert_eq!(reopened.model.as_deref(), Some("model-a"));
    assert!(reopened.allow_writes);
    assert_eq!(reopened.playbook_mode, PlaybookMode::Guided);

    let old_session_id = {
        let store = SessionStore::with_test_persistence(&persistence);
        create_test_session(&store).id
    };
    let store = SessionStore::with_test_persistence(&persistence);
    let seeded = store
        .ensure_session_with_runtime(
            &OwnerId::new(TEST_OWNER),
            Some(old_session_id),
            AssistantRuntimeSelection {
                endpoint_id: Some("ep_seed".into()),
                model: Some("seed-model".into()),
                allow_writes: false,
                playbook_mode: PlaybookMode::Open,
            },
        )
        .unwrap()
        .unwrap();
    assert_eq!(seeded.endpoint_id.as_deref(), Some("ep_seed"));
    assert_eq!(seeded.model.as_deref(), Some("seed-model"));
    assert_eq!(seeded.playbook_mode, PlaybookMode::Open);
}

#[test]
fn empty_surfaced_entities_clear_prior_references() {
    let persistence = test_persistence();
    let session_id = {
        let store = SessionStore::with_test_persistence(&persistence);
        let session = create_test_session(&store);
        store.set_surfaced_entities(
            &session.id,
            &[Entity {
                kind: crate::entities::EntityKind::User,
                id: "usr_1".into(),
                display_name: "Alice".into(),
            }],
        );
        store.set_surfaced_entities(&session.id, &[]);
        assert!(store
            .get(&OwnerId::new(TEST_OWNER), &session.id)
            .unwrap()
            .unwrap()
            .surfaced_entities
            .is_empty());
        session.id
    };

    let reopened = SessionStore::with_test_persistence(&persistence)
        .get(&OwnerId::new(TEST_OWNER), &session_id)
        .unwrap()
        .unwrap();
    assert!(reopened.surfaced_entities.is_empty());
}

#[test]
fn manual_panel_toggle_persists() {
    let persistence = test_persistence();
    let session_id = {
        let store = SessionStore::with_test_persistence(&persistence);
        let session = create_test_session(&store);
        store.set_entity_panel_open(&session.id, true);
        store.set_entity_panel_open(&session.id, false);
        session.id
    };
    let reopened = SessionStore::with_test_persistence(&persistence)
        .get(&OwnerId::new(TEST_OWNER), &session_id)
        .unwrap()
        .unwrap();
    assert!(!reopened.entity_panel_open);
}

#[test]
fn owner_switch_hides_other_sessions_and_keeps_shared_legacy_sessions() {
    let persistence = test_persistence();
    let store = SessionStore::with_test_persistence(&persistence);
    let session_a = store
        .create_session_with_runtime(&OwnerId::new("usr_a"), AssistantRuntimeSelection::default());
    let session_b = store
        .create_session_with_runtime(&OwnerId::new("usr_b"), AssistantRuntimeSelection::default());
    let shared =
        store.create_session_with_runtime(&OwnerId::new(""), AssistantRuntimeSelection::default());

    let visible_to_a = store
        .list(&OwnerId::new("usr_a"))
        .into_iter()
        .map(|session| session.id)
        .collect::<std::collections::HashSet<_>>();
    assert_eq!(
        visible_to_a,
        std::collections::HashSet::from([session_a.id.clone(), shared.id.clone()])
    );
    assert!(store
        .get(&OwnerId::new("usr_a"), &session_b.id)
        .unwrap()
        .is_none());
    assert!(store
        .set_runtime(
            &OwnerId::new("usr_b"),
            &session_a.id,
            AssistantRuntimeSelection::default(),
        )
        .unwrap()
        .is_none());

    store.delete(&OwnerId::new("usr_b"), &session_a.id);
    assert!(SessionStore::with_test_persistence(&persistence)
        .get(&OwnerId::new("usr_a"), &session_a.id)
        .unwrap()
        .is_some());
}

#[test]
fn persisted_sessions_load_only_for_the_requested_owner() {
    let persistence = test_persistence();
    persistence.seed_session(&OwnerId::new("usr_a"), "ses_a", "a", "t0", "t0");
    persistence.seed_session(&OwnerId::new("usr_b"), "ses_b", "b", "t0", "t0");
    persistence.seed_session(&OwnerId::new(""), "ses_shared", "shared", "t0", "t0");
    let store = SessionStore::with_test_persistence(&persistence);

    assert!(store.state.lock().unwrap().sessions.is_empty());

    let visible_to_a = store
        .list(&OwnerId::new("usr_a"))
        .into_iter()
        .map(|session| session.id)
        .collect::<HashSet<_>>();

    assert_eq!(
        visible_to_a,
        HashSet::from(["ses_a".to_string(), "ses_shared".to_string()])
    );
    assert!(!store.state.lock().unwrap().sessions.contains_key("ses_b"));

    let visible_to_b = store
        .list(&OwnerId::new("usr_b"))
        .into_iter()
        .map(|session| session.id)
        .collect::<HashSet<_>>();

    assert_eq!(
        visible_to_b,
        HashSet::from(["ses_b".to_string(), "ses_shared".to_string()])
    );
}

#[test]
fn is_current_turn_tracks_the_latest_turn() {
    let store = SessionStore::with_test_persistence(&test_persistence());
    let session = create_test_session(&store);

    store.set_active_turn(
        &session.id,
        Some(ActiveTurn {
            turn_id: "turn_a".into(),
            status: TurnStatus::Running,
        }),
    );
    assert!(store.is_current_turn(&session.id, "turn_a"));
    assert!(!store.is_current_turn(&session.id, "turn_b"));

    // A newer turn takes over: the superseded one is no longer current.
    store.set_active_turn(
        &session.id,
        Some(ActiveTurn {
            turn_id: "turn_b".into(),
            status: TurnStatus::Running,
        }),
    );
    assert!(!store.is_current_turn(&session.id, "turn_a"));
    assert!(store.is_current_turn(&session.id, "turn_b"));
    assert!(!store.is_current_turn("missing", "turn_b"));
}

#[test]
fn title_shows_mentions_by_name_without_their_ids() {
    assert_eq!(
        derive_title("how long with [@Alice [VR]](vrcx-0://user/open?id=usr_a) and [@Bob](vrcx-0://user/open?id=usr_b)?"),
        "how long with @Alice [VR] and @Bob?"
    );
    assert_eq!(
        derive_title("when was I at [@Night Pier](vrcx-0://world/open?id=wrld_p)?"),
        "when was I at @Night Pier?"
    );
    assert_eq!(
        derive_title("see [docs](vrcx-0://user/open?id=) later"),
        "see [docs](vrcx-0://user/open?id=) later"
    );
}

#[test]
fn rename_and_pin_survive_a_reopen_without_reordering() {
    let persistence = test_persistence();
    let owner = OwnerId::new(TEST_OWNER);
    let session = {
        let store = SessionStore::with_test_persistence(&persistence);
        let session = create_test_session(&store);
        store
            .push_message(&session.id, Role::User, "who is online".into())
            .unwrap();
        let before = store.list(&owner)[0].updated_at.clone();
        store
            .rename(&owner, &session.id, "  Weekend recap  ")
            .unwrap();
        store.set_pinned(&owner, &session.id, true).unwrap();
        store.rename(&owner, &session.id, "   ").unwrap();
        assert_eq!(store.list(&owner)[0].updated_at, before);
        session
    };

    let reopened = SessionStore::with_test_persistence(&persistence);
    let summary = &reopened.list(&owner)[0];
    assert_eq!(summary.id, session.id);
    assert_eq!(summary.title, "Weekend recap");
    assert!(summary.pinned);

    reopened
        .push_message(&session.id, Role::User, "and today?".into())
        .unwrap();
    assert_eq!(reopened.list(&owner)[0].title, "Weekend recap");
}
