use std::{collections::HashSet, future::Future, pin::Pin, time::Duration};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use vrcx_0_persistence::{favorites, DatabaseService};
use vrcx_0_vrchat_client::{
    favorites::favorite_delete_input,
    http_api::{ApiScope, HttpApiRequestInput},
};

use crate::{
    Error, RemoteMutationGate, Result, RuntimeAuthScope, RuntimeAuthScopeSnapshot, WebClient,
};

pub const FAVORITE_BULK_REMOVE_MAX_ITEMS: usize = 250;
const FAVORITE_BULK_REMOVE_REMOTE_INTERVAL: Duration = Duration::from_millis(250);

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum FavoriteBulkRemoveSource {
    Local,
    Remote,
}

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteBulkRemoveItem {
    pub key: String,
    pub source: FavoriteBulkRemoveSource,
    pub entity_id: String,
    #[serde(default)]
    pub group_name: String,
}

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteBulkRemoveInput {
    pub expected_owner_user_id: String,
    pub expected_endpoint: String,
    pub kind: String,
    #[serde(default)]
    pub items: Vec<FavoriteBulkRemoveItem>,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum FavoriteBulkRemoveItemState {
    Removed,
    Failed,
    NotAttempted,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteBulkRemoveItemResult {
    pub key: String,
    pub source: FavoriteBulkRemoveSource,
    pub entity_id: String,
    pub state: FavoriteBulkRemoveItemState,
    pub local_affected: i64,
    pub message: String,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteBulkRemoveResult {
    pub owner_user_id: String,
    pub kind: String,
    pub total: usize,
    pub succeeded: usize,
    pub failed: usize,
    pub local_changed: bool,
    pub remote_changed: bool,
    pub items: Vec<FavoriteBulkRemoveItemResult>,
    pub last_error: Option<String>,
}

pub struct FavoriteBulkRemoveDeps<'a> {
    pub db: &'a DatabaseService,
    pub web: &'a WebClient,
    pub auth_scope: &'a RuntimeAuthScope,
    pub expected_scope: RuntimeAuthScopeSnapshot,
    pub remote_mutation_gate: &'a RemoteMutationGate,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum RemoteRemoveOutcome {
    Removed,
    RemovedScopeChanged,
}

struct FavoriteBulkRemoveWorkItem {
    item: FavoriteBulkRemoveItem,
    rejection: Option<String>,
}

trait FavoriteBulkRemoveActions: Send + Sync {
    fn remove_local(&self, kind: &str, item: &FavoriteBulkRemoveItem) -> Result<i64>;
    fn remove_remote<'a>(
        &'a self,
        item: &'a FavoriteBulkRemoveItem,
    ) -> Pin<Box<dyn Future<Output = Result<RemoteRemoveOutcome>> + Send + 'a>>;
    fn scope_matches(&self) -> bool;
    fn wait_for_remote_slot<'a>(&'a self) -> Pin<Box<dyn Future<Output = ()> + Send + 'a>> {
        Box::pin(async {})
    }
}

struct VrchatFavoriteBulkRemoveActions<'a> {
    deps: &'a FavoriteBulkRemoveDeps<'a>,
}

impl VrchatFavoriteBulkRemoveActions<'_> {
    fn ensure_scope(&self) -> Result<()> {
        crate::scope_gate::ensure_scope_matches(
            self.deps.auth_scope,
            &self.deps.expected_scope,
            "Favorite bulk remove",
        )
    }

    async fn execute_remote(&self, request: HttpApiRequestInput) -> Result<RemoteRemoveOutcome> {
        self.ensure_scope()?;
        let response = self
            .deps
            .web
            .execute_api(request, ApiScope::Vrchat, self.deps.db)
            .await?;
        let fallback_payload = Value::String(response.data.clone());
        if !(200..300).contains(&response.status) {
            return Err(Error::Custom(response_error_message(
                &serde_json::from_str::<Value>(&response.data).unwrap_or(fallback_payload),
                response.status,
            )));
        }
        let payload = if response.data.trim().is_empty() {
            Value::Null
        } else {
            serde_json::from_str::<Value>(&response.data).map_err(|error| {
                Error::Custom(format!(
                    "VRChat favorite removal returned invalid JSON: {error}"
                ))
            })?
        };
        if payload.get("error").is_some() {
            return Err(Error::Custom(response_error_message(
                &payload,
                response.status,
            )));
        }
        if self.scope_matches() {
            Ok(RemoteRemoveOutcome::Removed)
        } else {
            Ok(RemoteRemoveOutcome::RemovedScopeChanged)
        }
    }
}

impl FavoriteBulkRemoveActions for VrchatFavoriteBulkRemoveActions<'_> {
    fn remove_local(&self, kind: &str, item: &FavoriteBulkRemoveItem) -> Result<i64> {
        self.ensure_scope()?;
        favorites::favorite_remove(
            self.deps.db,
            Some(&self.deps.expected_scope.current_user_id),
            kind.to_string(),
            item.entity_id.clone(),
            item.group_name.clone(),
        )
        .map_err(Error::from)
    }

    fn remove_remote<'a>(
        &'a self,
        item: &'a FavoriteBulkRemoveItem,
    ) -> Pin<Box<dyn Future<Output = Result<RemoteRemoveOutcome>> + Send + 'a>> {
        Box::pin(async move {
            let (_, request) = favorite_delete_input(
                self.deps.expected_scope.endpoint.clone(),
                item.entity_id.clone(),
            )?;
            self.execute_remote(request).await
        })
    }

    fn scope_matches(&self) -> bool {
        self.deps
            .auth_scope
            .snapshot()
            .generation_matches(&self.deps.expected_scope)
    }

    fn wait_for_remote_slot<'a>(&'a self) -> Pin<Box<dyn Future<Output = ()> + Send + 'a>> {
        Box::pin(async move {
            self.deps
                .remote_mutation_gate
                .wait(
                    &self.deps.expected_scope,
                    FAVORITE_BULK_REMOVE_REMOTE_INTERVAL,
                )
                .await;
        })
    }
}

pub async fn remove_favorites_bulk(
    deps: &FavoriteBulkRemoveDeps<'_>,
    input: FavoriteBulkRemoveInput,
) -> Result<FavoriteBulkRemoveResult> {
    if !deps.expected_scope.active
        || !deps
            .auth_scope
            .snapshot()
            .generation_matches(&deps.expected_scope)
        || input.expected_owner_user_id.trim() != deps.expected_scope.current_user_id
        || input.expected_endpoint.trim() != deps.expected_scope.endpoint
    {
        return Err(Error::Custom(
            "Favorite bulk remove is stale for the current auth scope.".into(),
        ));
    }
    let owner_user_id = deps.expected_scope.current_user_id.clone();
    let kind = normalize_kind(&input.kind)?;
    let items = normalize_items(&kind, input.items)?;
    let actions = VrchatFavoriteBulkRemoveActions { deps };
    Ok(run_favorite_bulk_remove(&actions, owner_user_id, kind, items).await)
}

async fn run_favorite_bulk_remove(
    actions: &dyn FavoriteBulkRemoveActions,
    owner_user_id: String,
    kind: String,
    input_items: Vec<FavoriteBulkRemoveWorkItem>,
) -> FavoriteBulkRemoveResult {
    let mut items = input_items
        .iter()
        .map(|work| not_attempted(&work.item))
        .collect::<Vec<_>>();
    let mut last_error = None;

    for (index, work) in input_items.iter().enumerate() {
        if !actions.scope_matches() {
            let message = "Favorite bulk remove authentication scope changed.".to_string();
            mark_not_attempted(&mut items[index..], &message);
            last_error = Some(message);
            break;
        }
        let item = &work.item;
        if let Some(message) = &work.rejection {
            items[index] = FavoriteBulkRemoveItemResult {
                key: item.key.clone(),
                source: item.source,
                entity_id: item.entity_id.clone(),
                state: FavoriteBulkRemoveItemState::Failed,
                local_affected: 0,
                message: message.clone(),
            };
            last_error = Some(message.clone());
            continue;
        }
        let outcome = match item.source {
            FavoriteBulkRemoveSource::Local => actions
                .remove_local(&kind, item)
                .map(|affected| (affected, false)),
            FavoriteBulkRemoveSource::Remote => {
                actions.wait_for_remote_slot().await;
                actions
                    .remove_remote(item)
                    .await
                    .map(|outcome| (0, outcome == RemoteRemoveOutcome::RemovedScopeChanged))
            }
        };
        match outcome {
            Ok((local_affected, scope_changed)) => {
                items[index] = FavoriteBulkRemoveItemResult {
                    key: item.key.clone(),
                    source: item.source,
                    entity_id: item.entity_id.clone(),
                    state: FavoriteBulkRemoveItemState::Removed,
                    local_affected,
                    message: String::new(),
                };
                if scope_changed {
                    let message = "Favorite bulk remove authentication scope changed.".to_string();
                    mark_not_attempted(&mut items[index + 1..], &message);
                    last_error = Some(message);
                    break;
                }
            }
            Err(error) => {
                let message = error.to_string();
                items[index] = FavoriteBulkRemoveItemResult {
                    key: item.key.clone(),
                    source: item.source,
                    entity_id: item.entity_id.clone(),
                    state: FavoriteBulkRemoveItemState::Failed,
                    local_affected: 0,
                    message: message.clone(),
                };
                last_error = Some(message);
                if !actions.scope_matches() {
                    let message = "Favorite bulk remove authentication scope changed.".to_string();
                    mark_not_attempted(&mut items[index + 1..], &message);
                    last_error = Some(message);
                    break;
                }
            }
        }
    }

    let succeeded = items
        .iter()
        .filter(|item| item.state == FavoriteBulkRemoveItemState::Removed)
        .count();
    FavoriteBulkRemoveResult {
        owner_user_id,
        kind,
        total: items.len(),
        succeeded,
        failed: items.len() - succeeded,
        local_changed: items.iter().any(|item| {
            item.source == FavoriteBulkRemoveSource::Local
                && item.state == FavoriteBulkRemoveItemState::Removed
        }),
        remote_changed: items.iter().any(|item| {
            item.source == FavoriteBulkRemoveSource::Remote
                && item.state == FavoriteBulkRemoveItemState::Removed
        }),
        items,
        last_error,
    }
}

fn normalize_kind(kind: &str) -> Result<String> {
    match kind.trim() {
        "friend" | "world" | "avatar" => Ok(kind.trim().to_string()),
        _ => Err(Error::Custom(
            "Favorite bulk remove contains an unsupported favorite kind.".into(),
        )),
    }
}

fn normalize_items(
    kind: &str,
    input_items: Vec<FavoriteBulkRemoveItem>,
) -> Result<Vec<FavoriteBulkRemoveWorkItem>> {
    let expected_prefix = match kind {
        "friend" => "usr_",
        "world" => "wrld_",
        "avatar" => "avtr_",
        _ => {
            return Err(Error::Custom(
                "Favorite bulk remove contains an unsupported favorite kind.".into(),
            ));
        }
    };
    let mut seen = HashSet::new();
    let mut items = Vec::new();
    for item in input_items {
        let key = item.key.trim().to_string();
        let entity_id = item.entity_id.trim().to_string();
        let group_name = item.group_name.trim().to_string();
        if key.is_empty() {
            return Err(Error::Custom(
                "Favorite bulk remove requires an item key.".into(),
            ));
        }
        let rejection = if !entity_id.starts_with(expected_prefix)
            || entity_id.len() == expected_prefix.len()
        {
            Some("Favorite bulk remove contains an invalid entity id.".to_string())
        } else if item.source == FavoriteBulkRemoveSource::Local && group_name.is_empty() {
            Some("Local favorite bulk remove requires a group name.".to_string())
        } else {
            None
        };
        if seen.insert(key.clone()) {
            items.push(FavoriteBulkRemoveWorkItem {
                item: FavoriteBulkRemoveItem {
                    key,
                    source: item.source,
                    entity_id,
                    group_name,
                },
                rejection,
            });
        }
    }
    if items.is_empty() {
        return Err(Error::Custom(
            "Favorite bulk remove requires at least one item.".into(),
        ));
    }
    if items.len() > FAVORITE_BULK_REMOVE_MAX_ITEMS {
        return Err(Error::Custom(format!(
            "Favorite bulk remove cannot exceed {FAVORITE_BULK_REMOVE_MAX_ITEMS} items."
        )));
    }
    Ok(items)
}

fn not_attempted(item: &FavoriteBulkRemoveItem) -> FavoriteBulkRemoveItemResult {
    FavoriteBulkRemoveItemResult {
        key: item.key.clone(),
        source: item.source,
        entity_id: item.entity_id.clone(),
        state: FavoriteBulkRemoveItemState::NotAttempted,
        local_affected: 0,
        message: String::new(),
    }
}

fn mark_not_attempted(items: &mut [FavoriteBulkRemoveItemResult], message: &str) {
    for item in items {
        item.message = message.to_string();
    }
}

fn response_error_message(payload: &Value, status: i32) -> String {
    crate::scope_gate::response_error_message(payload, status, "favorite removal")
}

#[cfg(test)]
mod tests {
    use std::{
        collections::VecDeque,
        path::PathBuf,
        sync::{
            atomic::{AtomicBool, Ordering},
            Mutex,
        },
    };

    use vrcx_0_persistence::storage::StorageService;

    use super::*;

    struct FakeActions {
        local_outcomes: Mutex<VecDeque<Result<i64>>>,
        remote_outcomes: Mutex<VecDeque<Result<RemoteRemoveOutcome>>>,
        scope_current: AtomicBool,
    }

    impl FavoriteBulkRemoveActions for FakeActions {
        fn remove_local(&self, _kind: &str, _item: &FavoriteBulkRemoveItem) -> Result<i64> {
            self.local_outcomes
                .lock()
                .unwrap()
                .pop_front()
                .unwrap_or(Ok(1))
        }

        fn remove_remote<'a>(
            &'a self,
            _item: &'a FavoriteBulkRemoveItem,
        ) -> Pin<Box<dyn Future<Output = Result<RemoteRemoveOutcome>> + Send + 'a>> {
            Box::pin(async move {
                self.remote_outcomes
                    .lock()
                    .unwrap()
                    .pop_front()
                    .unwrap_or(Ok(RemoteRemoveOutcome::Removed))
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
                    Ok(RemoteRemoveOutcome::Removed),
                ]
                .into(),
            ),
            scope_current: AtomicBool::new(true),
        };

        let result = run_favorite_bulk_remove(
            &actions,
            "usr_self".into(),
            "world".into(),
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
            remote_outcomes: Mutex::new(vec![Ok(RemoteRemoveOutcome::RemovedScopeChanged)].into()),
            scope_current: AtomicBool::new(true),
        };

        let result = run_favorite_bulk_remove(
            &actions,
            "usr_self".into(),
            "world".into(),
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

    struct TestDir(PathBuf);

    impl TestDir {
        fn new(name: &str) -> Self {
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "vrcx-0-favorite-bulk-remove-{name}-{}-{nonce}",
                std::process::id()
            ));
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[tokio::test]
    async fn local_items_are_removed_from_account_scoped_persistence() {
        let dir = TestDir::new("local-persistence");
        let db = DatabaseService::new(&dir.0.join("VRCX-0.sqlite3")).unwrap();
        let storage = StorageService::new(&dir.0.join("storage.json")).unwrap();
        let web = WebClient::new(
            &storage,
            &db,
            "wss://pipeline.vrchat.cloud".into(),
            env!("CARGO_PKG_VERSION"),
        )
        .unwrap();
        let auth_scope = RuntimeAuthScope::new();
        let expected_scope = auth_scope.set("usr_self", "");
        let expected_endpoint = expected_scope.endpoint.clone();
        let remote_mutation_gate = RemoteMutationGate::default();
        favorites::favorite_add(
            &db,
            Some("usr_self"),
            "friend".into(),
            "usr_target".into(),
            "Friends".into(),
        )
        .unwrap();

        let result = remove_favorites_bulk(
            &FavoriteBulkRemoveDeps {
                db: &db,
                web: &web,
                auth_scope: &auth_scope,
                expected_scope,
                remote_mutation_gate: &remote_mutation_gate,
            },
            FavoriteBulkRemoveInput {
                expected_owner_user_id: "usr_self".into(),
                expected_endpoint,
                kind: "friend".into(),
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
        assert!(
            favorites::favorite_list(&db, Some("usr_self"), "friend".into(),)
                .unwrap()
                .is_empty()
        );
    }

    #[tokio::test]
    async fn invalid_items_fail_individually_and_valid_items_still_run() {
        let actions = FakeActions {
            local_outcomes: Mutex::new(VecDeque::new()),
            remote_outcomes: Mutex::new(vec![Ok(RemoteRemoveOutcome::Removed)].into()),
            scope_current: AtomicBool::new(true),
        };
        let work_items = normalize_items(
            "world",
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

        let result =
            run_favorite_bulk_remove(&actions, "usr_self".into(), "world".into(), work_items).await;

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

        assert!(normalize_items("world", items).is_err());
    }
}
