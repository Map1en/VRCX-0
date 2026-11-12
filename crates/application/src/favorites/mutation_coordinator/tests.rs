use std::sync::Arc;

use serde_json::json;
use vrcx_0_contracts::social_aggregates::{FavoriteAction, FavoriteLocalInput};

use super::*;
use crate::favorites::test_support::{TestFavoriteRemote, TestFavoriteStore};
use crate::favorites::{
    FavoriteBulkRemoveItem, FavoriteBulkRemoveSource, FavoriteRemoteListInput,
    FavoriteRemoteMoveInput, FavoriteRemoteMoveOutput, FavoriteRemoteMoveStatus, FavoriteStore,
    FavoriteTransferInput, FavoriteTransferItem, FavoriteTransferLocation, FavoriteTransferMode,
    FavoriteTransferSource, FavoriteTransferTarget,
};
use vrcx_0_application_core::MemoryWorldCachePort;

struct Harness {
    coordinator: FavoriteMutationCoordinator,
    store: Arc<TestFavoriteStore>,
    event_bus: RuntimeEventBus,
    world_cache: Arc<WorldCache>,
}

fn harness(_name: &str) -> Harness {
    harness_with_remote(Arc::new(TestFavoriteRemote::default()))
}

fn harness_with_remote(remote: Arc<TestFavoriteRemote>) -> Harness {
    let store = Arc::new(TestFavoriteStore::default());
    let auth_scope = RuntimeAuthScope::new();
    auth_scope.set("usr_self", "https://api.vrchat.cloud/api/1");
    let event_bus = RuntimeEventBus::new();
    let world_cache = Arc::new(WorldCache::new(MemoryWorldCachePort::default()));
    let coordinator = FavoriteMutationCoordinator::new(
        Arc::clone(&store) as Arc<dyn FavoriteStore>,
        remote,
        FavoriteMutationRuntimeDeps::new(
            RuntimeDiagnostics::new(),
            RuntimeSyncEngine::new(),
            event_bus.clone(),
            auth_scope,
            Arc::new(RemoteMutationGate::default()),
            Arc::clone(&world_cache),
        ),
    );
    Harness {
        coordinator,
        store,
        event_bus,
        world_cache,
    }
}

fn assert_single_local_invalidation(event_bus: &RuntimeEventBus) {
    let events = event_bus.take_events_for_test();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].name, "favoritesChanged");
    assert_eq!(
        events[0].payload,
        json!({
            "ownerUserId": "usr_self",
            "endpoint": "https://api.vrchat.cloud/api/1",
            "kind": "friend",
            "local": true,
            "remote": false,
            "changes": [],
            "requiresRefresh": true
        })
        .into()
    );
}

#[test]
fn local_mutation_persists_and_emits_one_exact_delta() {
    let harness = harness("local-delta");

    let affected = harness
        .coordinator
        .add_local(
            FavoriteEntityKind::Friend,
            "usr_friend".into(),
            "Close".into(),
        )
        .unwrap();

    assert_eq!(affected, 1);
    assert_eq!(
        harness
            .store
            .list(Some(&OwnerId::new("usr_self")), FavoriteEntityKind::Friend,)
            .unwrap()
            .len(),
        1
    );
    let events = harness.event_bus.take_events_for_test();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].name, "favoritesChanged");
    assert_eq!(
        events[0].payload,
        json!({
            "ownerUserId": "usr_self",
            "endpoint": "https://api.vrchat.cloud/api/1",
            "kind": "friend",
            "local": true,
            "remote": false,
            "changes": [{
                "type": "localAdded",
                "kind": "friend",
                "entityId": "usr_friend",
                "groupName": "Close"
            }],
            "requiresRefresh": false
        })
        .into()
    );
}

#[test]
fn tool_dry_run_does_not_persist_or_emit() {
    let harness = harness("tool-dry-run");

    let output = harness
        .coordinator
        .mutate_local(
            "MCP local favorite mutation",
            FavoriteLocalInput {
                kind: FavoriteEntityKind::Friend,
                entity_id: "usr_friend".into(),
                group: "Close".into(),
                action: FavoriteAction::Add,
                dry_run: true,
            },
        )
        .unwrap();

    assert_eq!(output.affected_rows, 0);
    assert!(harness
        .store
        .list(Some(&OwnerId::new("usr_self")), FavoriteEntityKind::Friend,)
        .unwrap()
        .is_empty());
    assert!(harness.event_bus.take_events_for_test().is_empty());
}

#[test]
fn tool_write_persists_and_emits_one_invalidation() {
    let harness = harness("tool-write");

    let output = harness
        .coordinator
        .mutate_local(
            "MCP local favorite mutation",
            FavoriteLocalInput {
                kind: FavoriteEntityKind::Friend,
                entity_id: "usr_friend".into(),
                group: "Close".into(),
                action: FavoriteAction::Add,
                dry_run: false,
            },
        )
        .unwrap();

    assert_eq!(output.affected_rows, 1);
    assert_single_local_invalidation(&harness.event_bus);
}

#[tokio::test]
async fn local_transfer_emits_once_with_exact_changed_sides() {
    let harness = harness("local-transfer");
    harness
        .store
        .add(
            Some(&OwnerId::new("usr_self")),
            FavoriteEntityKind::Friend,
            "usr_friend".into(),
            "Source".into(),
        )
        .unwrap();

    let output = harness
        .coordinator
        .transfer_selection(FavoriteTransferSelectionInput {
            batches: vec![FavoriteTransferInput {
                kind: FavoriteEntityKind::Friend,
                mode: FavoriteTransferMode::Move,
                source: FavoriteTransferSource {
                    location: FavoriteTransferLocation::Local,
                    group: "Source".into(),
                },
                target: FavoriteTransferTarget {
                    location: FavoriteTransferLocation::Local,
                    group: "Target".into(),
                    favorite_type: None,
                },
                items: vec![FavoriteTransferItem {
                    key: "local:Source:usr_friend".into(),
                    entity_id: "usr_friend".into(),
                    entity: None,
                }],
            }],
        })
        .await
        .unwrap();

    assert_eq!(output.succeeded, 1);
    assert_eq!(output.failed, 0);
    assert!(output.local_changed);
    assert!(!output.remote_changed);
    let rows = harness
        .store
        .list(Some(&OwnerId::new("usr_self")), FavoriteEntityKind::Friend)
        .unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].group_name, "Target");
    assert_single_local_invalidation(&harness.event_bus);
}

#[tokio::test]
async fn local_bulk_remove_emits_once_with_exact_changed_sides() {
    let harness = harness("local-bulk-remove");
    harness
        .store
        .add(
            Some(&OwnerId::new("usr_self")),
            FavoriteEntityKind::Friend,
            "usr_friend".into(),
            "Close".into(),
        )
        .unwrap();

    let output = harness
        .coordinator
        .remove_selection(FavoriteBulkRemoveInput {
            kind: FavoriteEntityKind::Friend,
            items: vec![FavoriteBulkRemoveItem {
                key: "local:Close:usr_friend".into(),
                source: FavoriteBulkRemoveSource::Local,
                entity_id: "usr_friend".into(),
                group_name: "Close".into(),
            }],
        })
        .await
        .unwrap();

    assert_eq!(output.succeeded, 1);
    assert_eq!(output.failed, 0);
    assert!(output.local_changed);
    assert!(!output.remote_changed);
    assert_single_local_invalidation(&harness.event_bus);
}

#[test]
fn import_completion_emits_only_for_successful_import_writes() {
    let harness = harness("import-completion");
    let scope = RuntimeAuthScopeSnapshot {
        current_user_id: "usr_self".into(),
        endpoint: "https://api.vrchat.cloud/api/1".into(),
        generation: 1,
        active: true,
    };
    let mut status = FavoriteImportStatus {
        operation: FavoriteImportOperation::Hydrate,
        kind: FavoriteEntityKind::Friend,
        succeeded: 1,
        ..FavoriteImportStatus::default()
    };

    harness
        .coordinator
        .complete_import(&scope, &status, Some(FavoriteImportLocation::Local));
    assert!(harness.event_bus.take_events_for_test().is_empty());

    status.operation = FavoriteImportOperation::Import;
    harness
        .coordinator
        .complete_import(&scope, &status, Some(FavoriteImportLocation::Remote));
    let events = harness.event_bus.take_events_for_test();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].name, "favoritesChanged");
    assert_eq!(events[0].payload["local"], false);
    assert_eq!(events[0].payload["remote"], true);
    assert_eq!(events[0].payload["requiresRefresh"], true);
}

#[tokio::test]
async fn remote_group_clear_rejects_scope_replaced_while_request_is_in_flight() {
    let store = Arc::new(TestFavoriteStore::default());
    let auth_scope = RuntimeAuthScope::new();
    auth_scope.set("usr_self", "https://api.vrchat.cloud/api/1");
    let event_bus = RuntimeEventBus::new();
    let coordinator = FavoriteMutationCoordinator::new(
        Arc::clone(&store) as Arc<dyn FavoriteStore>,
        Arc::new(TestFavoriteRemote::replacing_scope_on_clear(
            auth_scope.clone(),
        )),
        FavoriteMutationRuntimeDeps::new(
            RuntimeDiagnostics::new(),
            RuntimeSyncEngine::new(),
            event_bus.clone(),
            auth_scope,
            Arc::new(RemoteMutationGate::default()),
            Arc::new(WorldCache::new(MemoryWorldCachePort::default())),
        ),
    );

    let error = coordinator
        .clear_remote_group(
            "Remote favorite mutation",
            FavoriteRemoteGroupClearInput {
                kind: vrcx_0_contracts::VrchatFavoriteType::World,
                group: "worlds1".into(),
            },
        )
        .await
        .unwrap_err();

    assert_eq!(
        error.to_string(),
        "Remote favorite mutation authentication scope changed."
    );
    assert!(event_bus.take_events_for_test().is_empty());
}

#[tokio::test]
async fn local_world_transfer_caches_the_world_through_the_world_cache_owner() {
    let harness = harness("local-world-transfer-cache");
    harness
        .store
        .add(
            Some(&OwnerId::new("usr_self")),
            FavoriteEntityKind::World,
            "wrld_transfer".into(),
            "Source".into(),
        )
        .unwrap();

    let output = harness
        .coordinator
        .transfer_selection(FavoriteTransferSelectionInput {
            batches: vec![FavoriteTransferInput {
                kind: FavoriteEntityKind::World,
                mode: FavoriteTransferMode::Copy,
                source: FavoriteTransferSource {
                    location: FavoriteTransferLocation::Local,
                    group: "Source".into(),
                },
                target: FavoriteTransferTarget {
                    location: FavoriteTransferLocation::Local,
                    group: "Target".into(),
                    favorite_type: None,
                },
                items: vec![FavoriteTransferItem {
                    key: "local:Source:wrld_transfer".into(),
                    entity_id: "wrld_transfer".into(),
                    entity: Some(
                        json!({
                            "id": "wrld_transfer",
                            "name": "Transferred world",
                            "releaseStatus": "public",
                            "imageUrl": "https://example.test/world.png"
                        })
                        .into(),
                    ),
                }],
            }],
        })
        .await
        .unwrap();

    assert_eq!(output.succeeded, 1);
    assert_eq!(
        harness.world_cache.get_name("wrld_transfer").as_deref(),
        Some("Transferred world")
    );
}

fn world_move_remote(extra: Vec<serde_json::Value>) -> Arc<TestFavoriteRemote> {
    Arc::new(world_move_fixture(extra))
}

fn world_move_fixture(extra: Vec<serde_json::Value>) -> TestFavoriteRemote {
    let mut favorites = vec![
        json!({"type": "world", "favoriteId": "wrld_a", "tags": ["worlds1"]}),
        json!({"type": "world", "favoriteId": "wrld_b", "tags": ["worlds3"]}),
        json!({"type": "world", "favoriteId": "wrld_c", "tags": ["worlds2"]}),
        json!({"type": "avatar", "favoriteId": "avtr_x", "tags": ["avatars1"]}),
    ];
    favorites.extend(extra);
    TestFavoriteRemote::with_online_favorites(
        favorites,
        vec![
            json!({"name": "worlds1", "displayName": "Chill", "type": "world"}),
            json!({"name": "worlds2", "displayName": "Often", "type": "world"}),
            json!({"name": "worlds3", "displayName": "", "type": "world"}),
            json!({"name": "vrcPlusWorlds1", "displayName": "Often", "type": "vrcPlusWorld"}),
            json!({"name": "avatars1", "displayName": "Chill", "type": "avatar"}),
        ],
    )
}

fn world_move(entity_ids: &[&str], target_group: &str, dry_run: bool) -> FavoriteRemoteMoveInput {
    FavoriteRemoteMoveInput {
        kind: FavoriteEntityKind::World,
        entity_ids: entity_ids.iter().map(|id| id.to_string()).collect(),
        target_group: target_group.into(),
        dry_run,
    }
}

fn statuses(output: &FavoriteRemoteMoveOutput) -> Vec<(&str, FavoriteRemoteMoveStatus)> {
    output
        .items
        .iter()
        .map(|item| (item.entity_id.as_str(), item.status))
        .collect()
}

#[tokio::test]
async fn remote_move_batch_moves_from_each_source_and_skips_what_needs_no_move() {
    let remote = world_move_remote(Vec::new());
    let harness = harness_with_remote(Arc::clone(&remote));

    let output = harness
        .coordinator
        .move_remote(world_move(
            &["wrld_a", "wrld_b", "wrld_c", "wrld_missing", "wrld_a"],
            "WORLDS2",
            false,
        ))
        .await
        .unwrap();

    assert_eq!(output.target.name, "worlds2");
    assert_eq!(
        statuses(&output),
        vec![
            ("wrld_a", FavoriteRemoteMoveStatus::Moved),
            ("wrld_b", FavoriteRemoteMoveStatus::Moved),
            ("wrld_c", FavoriteRemoteMoveStatus::AlreadyInTarget),
            ("wrld_missing", FavoriteRemoteMoveStatus::NotFavorited),
        ]
    );
    assert_eq!(
        output.items[0]
            .source
            .as_ref()
            .map(|group| group.display_name.as_str()),
        Some("Chill")
    );
    assert_eq!(
        remote.remote_writes(),
        vec![
            "delete wrld_a",
            "add world wrld_a worlds2",
            "delete wrld_b",
            "add world wrld_b worlds2",
        ]
    );
    let events = harness.event_bus.take_events_for_test();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].payload["remote"], true);
    assert_eq!(events[0].payload["local"], false);
}

#[tokio::test]
async fn remote_move_dry_run_previews_names_and_sources_without_writing() {
    let remote = world_move_remote(Vec::new());
    let harness = harness_with_remote(Arc::clone(&remote));
    harness
        .world_cache
        .store_from_payload(&json!({"id": "wrld_a", "name": "Sleepy Room"}))
        .unwrap();

    let output = harness
        .coordinator
        .move_remote(world_move(&["wrld_a", "wrld_c"], "Often", true))
        .await
        .unwrap_err();
    assert!(output.to_string().contains("Several"), "{output}");

    let output = harness
        .coordinator
        .move_remote(world_move(&["wrld_a", "wrld_c"], "worlds2", true))
        .await
        .unwrap();

    assert!(output.dry_run);
    assert_eq!(
        statuses(&output),
        vec![
            ("wrld_a", FavoriteRemoteMoveStatus::WouldMove),
            ("wrld_c", FavoriteRemoteMoveStatus::AlreadyInTarget),
        ]
    );
    assert_eq!(output.items[0].name.as_deref(), Some("Sleepy Room"));
    assert!(remote.remote_writes().is_empty());
    assert!(harness.event_bus.take_events_for_test().is_empty());
}

#[tokio::test]
async fn remote_move_rejects_a_batch_that_does_not_fit_the_target_group() {
    let filler = (0..99)
        .map(|index| {
            json!({"type": "world", "favoriteId": format!("wrld_fill{index}"), "tags": ["worlds2"]})
        })
        .collect();
    let remote = world_move_remote(filler);
    let harness = harness_with_remote(Arc::clone(&remote));

    let error = harness
        .coordinator
        .move_remote(world_move(&["wrld_a", "wrld_b"], "worlds2", false))
        .await
        .unwrap_err()
        .to_string();

    assert!(error.contains("0 free slots"), "{error}");
    assert!(remote.remote_writes().is_empty());
}

#[tokio::test]
async fn remote_move_names_the_tags_when_the_target_is_unknown_or_ambiguous() {
    let remote = world_move_remote(Vec::new());
    let harness = harness_with_remote(Arc::clone(&remote));

    let ambiguous = harness
        .coordinator
        .move_remote(world_move(&["wrld_a"], "often", false))
        .await
        .unwrap_err()
        .to_string();
    assert!(ambiguous.contains("worlds2"), "{ambiguous}");
    assert!(ambiguous.contains("vrcPlusWorlds1"), "{ambiguous}");

    let unknown = harness
        .coordinator
        .move_remote(world_move(&["wrld_a"], "Nope", false))
        .await
        .unwrap_err()
        .to_string();
    assert!(unknown.contains("worlds1 (\"Chill\")"), "{unknown}");
    assert!(!unknown.contains("avatars1"), "{unknown}");
    assert!(remote.remote_writes().is_empty());
}

#[tokio::test]
async fn remote_move_limits_the_batch_size() {
    let harness = harness_with_remote(world_move_remote(Vec::new()));
    let ids = (0..=crate::favorites::FAVORITE_REMOTE_MOVE_MAX_ITEMS)
        .map(|index| format!("wrld_{index}"))
        .collect::<Vec<_>>();
    let ids = ids.iter().map(String::as_str).collect::<Vec<_>>();

    let error = harness
        .coordinator
        .move_remote(world_move(&ids, "worlds2", true))
        .await
        .unwrap_err()
        .to_string();

    assert!(error.contains("at most"), "{error}");
}

#[tokio::test]
async fn remote_move_into_a_vrc_plus_group_uses_its_favorite_type() {
    let remote = world_move_remote(Vec::new());
    let harness = harness_with_remote(Arc::clone(&remote));

    harness
        .coordinator
        .move_remote(world_move(&["wrld_a"], "vrcPlusWorlds1", false))
        .await
        .unwrap();

    assert_eq!(
        remote.remote_writes(),
        vec!["delete wrld_a", "add vrcPlusWorld wrld_a vrcPlusWorlds1"]
    );
}

#[tokio::test]
async fn remote_listing_counts_every_group_and_names_uncached_worlds() {
    let harness = harness_with_remote(Arc::new(
        world_move_fixture(Vec::new()).and_favorite_worlds([(
            "worlds1",
            vec![json!({"id": "wrld_a", "name": "Sleepy Room"})],
        )]),
    ));
    harness
        .world_cache
        .store_from_payload(&json!({"id": "wrld_b", "name": "Night Lake"}))
        .unwrap();

    let listing = harness
        .coordinator
        .list_remote(FavoriteRemoteListInput {
            kind: FavoriteEntityKind::World,
            group: None,
        })
        .await
        .unwrap();
    let groups = listing
        .groups
        .iter()
        .map(|summary| (summary.group.name.as_str(), summary.count, summary.capacity))
        .collect::<Vec<_>>();
    assert_eq!(
        groups,
        vec![
            ("vrcPlusWorlds1", 0, 100),
            ("worlds1", 1, 100),
            ("worlds2", 1, 100),
            ("worlds3", 1, 100),
        ]
    );
    let names = listing
        .favorites
        .iter()
        .map(|entry| (entry.entity_id.as_str(), entry.name.as_deref()))
        .collect::<Vec<_>>();
    assert_eq!(
        names,
        vec![
            ("wrld_a", Some("Sleepy Room")),
            ("wrld_c", None),
            ("wrld_b", Some("Night Lake")),
        ]
    );

    let only = harness
        .coordinator
        .list_remote(FavoriteRemoteListInput {
            kind: FavoriteEntityKind::World,
            group: Some("worlds3".into()),
        })
        .await
        .unwrap();
    assert_eq!(only.favorites.len(), 1);
    assert_eq!(only.favorites[0].entity_id, "wrld_b");
    assert_eq!(only.favorites[0].name.as_deref(), Some("Night Lake"));
}
