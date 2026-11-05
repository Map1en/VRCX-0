use std::sync::Arc;

use serde_json::json;
use vrcx_0_contracts::social_aggregates::{FavoriteAction, FavoriteLocalInput};

use super::*;
use crate::favorites::test_support::{TestFavoriteRemote, TestFavoriteStore};
use crate::favorites::{
    FavoriteBulkRemoveItem, FavoriteBulkRemoveSource, FavoriteStore, FavoriteTransferInput,
    FavoriteTransferItem, FavoriteTransferLocation, FavoriteTransferMode, FavoriteTransferSource,
    FavoriteTransferTarget,
};
use vrcx_0_application_core::MemoryWorldCachePort;

struct Harness {
    coordinator: FavoriteMutationCoordinator,
    store: Arc<TestFavoriteStore>,
    event_bus: RuntimeEventBus,
    world_cache: Arc<WorldCache>,
}

fn harness(_name: &str) -> Harness {
    let store = Arc::new(TestFavoriteStore::default());
    let auth_scope = RuntimeAuthScope::new();
    auth_scope.set("usr_self", "https://api.vrchat.cloud/api/1");
    let event_bus = RuntimeEventBus::new();
    let world_cache = Arc::new(WorldCache::new(MemoryWorldCachePort::default()));
    let coordinator = FavoriteMutationCoordinator::new(
        Arc::clone(&store) as Arc<dyn FavoriteStore>,
        Arc::new(TestFavoriteRemote::default()),
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
