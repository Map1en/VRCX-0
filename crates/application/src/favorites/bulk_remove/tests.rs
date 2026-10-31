use futures_util::future::BoxFuture;

use std::{
    collections::VecDeque,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};

use super::*;
use crate::favorites::test_support::{TestFavoriteRemote, TestFavoriteStore};
use crate::favorites::FavoriteStore;
use vrcx_0_application_core::{RemoteMutationGate, RuntimeAuthScope};

struct FakeActions {
    local_outcomes: Mutex<VecDeque<Result<i64>>>,
    remote_outcomes: Mutex<VecDeque<Result<RemoteMutationOutcome>>>,
    scope_current: AtomicBool,
}

impl FavoriteBulkRemoveActions for FakeActions {
    fn remove_local(
        &self,
        _kind: FavoriteEntityKind,
        _item: &FavoriteBulkRemoveItem,
    ) -> Result<i64> {
        self.local_outcomes
            .lock()
            .unwrap()
            .pop_front()
            .unwrap_or(Ok(1))
    }

    fn remove_remote<'a>(
        &'a self,
        _item: &'a FavoriteBulkRemoveItem,
    ) -> BoxFuture<'a, Result<RemoteMutationOutcome>> {
        Box::pin(async move {
            self.remote_outcomes
                .lock()
                .unwrap()
                .pop_front()
                .unwrap_or(Ok(RemoteMutationOutcome::Applied))
        })
    }

    fn scope_matches(&self) -> bool {
        self.scope_current.load(Ordering::SeqCst)
    }
}

fn item(key: &str, source: FavoriteBulkRemoveSource) -> FavoriteBulkRemoveWorkItem {
    FavoriteBulkRemoveWorkItem {
        item: FavoriteBulkRemoveItem {
            key: key.into(),
            source,
            entity_id: format!("wrld_{key}"),
            group_name: "Worlds".into(),
        },
        rejection: None,
    }
}

#[tokio::test]
async fn mixed_batch_keeps_per_item_results_and_continues_failures() {
    let actions = FakeActions {
        local_outcomes: Mutex::new(vec![Ok(1)].into()),
        remote_outcomes: Mutex::new(
            vec![
                Err(Error::Custom("remote denied".into())),
                Ok(RemoteMutationOutcome::Applied),
            ]
            .into(),
        ),
        scope_current: AtomicBool::new(true),
    };

    let result = run_favorite_bulk_remove(
        &actions,
        OwnerId::new("usr_self"),
        FavoriteEntityKind::World,
        vec![
            item("local", FavoriteBulkRemoveSource::Local),
            item("remote_failed", FavoriteBulkRemoveSource::Remote),
            item("remote_ok", FavoriteBulkRemoveSource::Remote),
        ],
    )
    .await;

    assert_eq!(result.succeeded, 2);
    assert_eq!(result.failed, 1);
    assert!(result.local_changed);
    assert!(result.remote_changed);
    assert_eq!(
        result
            .items
            .iter()
            .map(|item| item.state)
            .collect::<Vec<_>>(),
        vec![
            FavoriteBulkRemoveItemState::Removed,
            FavoriteBulkRemoveItemState::Failed,
            FavoriteBulkRemoveItemState::Removed,
        ]
    );
}

#[tokio::test]
async fn remote_success_then_scope_change_stops_remaining_items() {
    let actions = FakeActions {
        local_outcomes: Mutex::new(VecDeque::new()),
        remote_outcomes: Mutex::new(vec![Ok(RemoteMutationOutcome::AppliedScopeChanged)].into()),
        scope_current: AtomicBool::new(true),
    };

    let result = run_favorite_bulk_remove(
        &actions,
        OwnerId::new("usr_self"),
        FavoriteEntityKind::World,
        vec![
            item("first", FavoriteBulkRemoveSource::Remote),
            item("second", FavoriteBulkRemoveSource::Remote),
        ],
    )
    .await;

    assert_eq!(result.items[0].state, FavoriteBulkRemoveItemState::Removed);
    assert_eq!(
        result.items[1].state,
        FavoriteBulkRemoveItemState::NotAttempted
    );
}

#[tokio::test]
async fn local_items_are_removed_from_account_scoped_persistence() {
    let store = TestFavoriteStore::default();
    let remote = TestFavoriteRemote::default();
    let auth_scope = RuntimeAuthScope::new();
    auth_scope.set("usr_self", "");
    let remote_mutation_gate = RemoteMutationGate::default();
    store
        .add(
            Some(&OwnerId::new("usr_self")),
            FavoriteEntityKind::Friend,
            "usr_target".into(),
            "Friends".into(),
        )
        .unwrap();

    let result = remove_favorites_bulk(
        &FavoriteBulkRemoveDeps {
            store: &store,
            remote: &remote,
            mutation: AuthenticatedMutationContext::capture(
                &auth_scope,
                &remote_mutation_gate,
                "Favorite bulk remove",
            )
            .unwrap(),
        },
        FavoriteBulkRemoveInput {
            kind: FavoriteEntityKind::Friend,
            items: vec![FavoriteBulkRemoveItem {
                key: "local:Friends:usr_target".into(),
                source: FavoriteBulkRemoveSource::Local,
                entity_id: "usr_target".into(),
                group_name: "Friends".into(),
            }],
        },
    )
    .await
    .unwrap();

    assert_eq!(result.succeeded, 1);
    assert!(store
        .list(Some(&OwnerId::new("usr_self")), FavoriteEntityKind::Friend,)
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn selection_chunks_more_than_one_protected_batch() {
    let store = TestFavoriteStore::default();
    let remote = TestFavoriteRemote::default();
    let auth_scope = RuntimeAuthScope::new();
    auth_scope.set("usr_self", "");
    let remote_mutation_gate = RemoteMutationGate::default();
    let items = (0..=FAVORITE_BULK_REMOVE_MAX_ITEMS)
        .map(|index| {
            let entity_id = format!("usr_{index}");
            store
                .add(
                    Some(&OwnerId::new("usr_self")),
                    FavoriteEntityKind::Friend,
                    entity_id.clone(),
                    "Friends".into(),
                )
                .unwrap();
            FavoriteBulkRemoveItem {
                key: format!("local:Friends:{entity_id}"),
                source: FavoriteBulkRemoveSource::Local,
                entity_id,
                group_name: "Friends".into(),
            }
        })
        .collect();

    let result = remove_favorites_selection(
        &FavoriteBulkRemoveDeps {
            store: &store,
            remote: &remote,
            mutation: AuthenticatedMutationContext::capture(
                &auth_scope,
                &remote_mutation_gate,
                "Favorite bulk remove",
            )
            .unwrap(),
        },
        FavoriteBulkRemoveInput {
            kind: FavoriteEntityKind::Friend,
            items,
        },
    )
    .await
    .unwrap();

    assert_eq!(
        result.total,
        crate::wire_count(FAVORITE_BULK_REMOVE_MAX_ITEMS + 1)
    );
    assert_eq!(
        result.succeeded,
        crate::wire_count(FAVORITE_BULK_REMOVE_MAX_ITEMS + 1)
    );
    assert_eq!(result.failed, 0);
    assert!(store
        .list(Some(&OwnerId::new("usr_self")), FavoriteEntityKind::Friend,)
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn invalid_items_fail_individually_and_valid_items_still_run() {
    let actions = FakeActions {
        local_outcomes: Mutex::new(VecDeque::new()),
        remote_outcomes: Mutex::new(vec![Ok(RemoteMutationOutcome::Applied)].into()),
        scope_current: AtomicBool::new(true),
    };
    let work_items = normalize_items(
        FavoriteEntityKind::World,
        vec![
            FavoriteBulkRemoveItem {
                key: "dirty".into(),
                source: FavoriteBulkRemoveSource::Remote,
                entity_id: "not-a-world-id".into(),
                group_name: String::new(),
            },
            FavoriteBulkRemoveItem {
                key: "valid".into(),
                source: FavoriteBulkRemoveSource::Remote,
                entity_id: "wrld_valid".into(),
                group_name: String::new(),
            },
        ],
    )
    .unwrap();

    let result = run_favorite_bulk_remove(
        &actions,
        OwnerId::new("usr_self"),
        FavoriteEntityKind::World,
        work_items,
    )
    .await;

    assert_eq!(result.items[0].state, FavoriteBulkRemoveItemState::Failed);
    assert_eq!(result.items[1].state, FavoriteBulkRemoveItemState::Removed);
    assert_eq!(result.succeeded, 1);
    assert_eq!(result.failed, 1);
}

#[test]
fn input_enforces_item_limit() {
    let items = (0..=FAVORITE_BULK_REMOVE_MAX_ITEMS)
        .map(|index| FavoriteBulkRemoveItem {
            key: format!("key-{index}"),
            source: FavoriteBulkRemoveSource::Remote,
            entity_id: format!("wrld_{index}"),
            group_name: String::new(),
        })
        .collect();

    assert!(normalize_items(FavoriteEntityKind::World, items).is_err());
}
