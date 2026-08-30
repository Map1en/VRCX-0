use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde_json::Value;
use tokio::time::{sleep, Instant};
use vrcx_0_application_core::vrchat_api::VrchatScope;
use vrcx_0_application_realtime::RealtimeHostRuntime;
use vrcx_0_core::json::RawJson;

use super::types::{
    MutualGraphFetchStartInput, MutualGraphFriendRefreshInput, MutualGraphFriendRefreshOutput,
    MutualGraphFriendRefreshStatus, MutualGraphMetaInput, MutualGraphRemoteRequests,
    MutualGraphRequestDeps, MutualGraphSnapshotEntryInput, MutualGraphSnapshotOutput,
    UserMutualFriendsListInput, UserMutualFriendsListOutput,
};
use crate::remote::VrchatRequestPort;
use vrcx_0_application_core::{Error, Result, RuntimeAuthScope, RuntimeAuthScopeSnapshot};
use vrcx_0_core::OwnerId;

#[cfg(test)]
mod tests;

const MUTUAL_GRAPH_PAGE_SIZE: i32 = 100;
const MUTUAL_GRAPH_REQUEST_INTERVAL: Duration = Duration::from_millis(200);
const MUTUAL_GRAPH_MAX_RETRIES: usize = 4;
const MUTUAL_GRAPH_MAX_PAGES: usize = 50;
const MUTUAL_GRAPH_EMPTY_USER_ID: &str = "usr_00000000-0000-0000-0000-000000000000";

pub(super) struct MutualGraphFetchContext<'a> {
    pub(super) remote: &'a dyn VrchatRequestPort,
    pub(super) remote_requests: &'a dyn MutualGraphRemoteRequests,
    pub(super) endpoint: &'a str,
    pub(super) cancel_flag: &'a AtomicBool,
    pub(super) auth_scope: &'a RuntimeAuthScope,
    pub(super) expected_scope: &'a RuntimeAuthScopeSnapshot,
    pub(super) last_request_at: Option<Instant>,
}

pub(super) enum FriendFetchResult {
    MutualIds {
        mutual_ids: Vec<String>,
        total_count: usize,
    },
    OptedOut,
    Cancelled,
    Failed(String),
}

pub async fn refresh_mutual_graph_friend(
    deps: MutualGraphRequestDeps<'_>,
    input: MutualGraphFriendRefreshInput,
) -> Result<MutualGraphFriendRefreshOutput> {
    let expected_scope = require_mutual_scope(deps.auth_scope, &input.owner_user_id)?;
    let friend_id = normalize_id(&input.friend_id);
    if friend_id.is_empty() {
        return Err(Error::Custom(
            "Mutual graph friend refresh requires a friend id.".into(),
        ));
    }
    let cancel_flag = AtomicBool::new(false);
    let mut context = MutualGraphFetchContext {
        remote: deps.remote,
        remote_requests: deps.remote_requests,
        endpoint: &expected_scope.endpoint,
        cancel_flag: &cancel_flag,
        auth_scope: deps.auth_scope,
        expected_scope: &expected_scope,
        last_request_at: None,
    };
    let (status, mutual_ids, total_count, opted_out) =
        match fetch_friend_mutuals(&mut context, &friend_id).await {
            FriendFetchResult::MutualIds {
                mutual_ids,
                total_count,
            } => (
                MutualGraphFriendRefreshStatus::Refreshed,
                Some(mutual_ids),
                Some(total_count),
                false,
            ),
            FriendFetchResult::OptedOut => {
                (MutualGraphFriendRefreshStatus::OptedOut, None, None, true)
            }
            FriendFetchResult::Cancelled => {
                return Err(Error::Custom(
                    "Mutual graph friend refresh authentication scope changed.".into(),
                ));
            }
            FriendFetchResult::Failed(error) => return Err(Error::Custom(error)),
        };
    ensure_mutual_scope_matches(deps.auth_scope, &expected_scope)?;
    deps.store.friend_refresh_commit(
        expected_scope.current_user_id,
        friend_id,
        mutual_ids,
        total_count,
        opted_out,
    )?;
    Ok(MutualGraphFriendRefreshOutput { status })
}

pub async fn get_user_mutual_friends_list(
    deps: MutualGraphRequestDeps<'_>,
    realtime: &RealtimeHostRuntime,
    input: UserMutualFriendsListInput,
) -> Result<UserMutualFriendsListOutput> {
    let expected_scope =
        crate::scope_gate::require_active_scope(deps.auth_scope, "User mutual friends list")?;
    let user_id = normalize_id(&input.user_id);
    if user_id.is_empty() {
        return Err(Error::Custom(
            "User mutual friends list requires a user id.".into(),
        ));
    }
    let cancel_flag = AtomicBool::new(false);
    let mut context = MutualGraphFetchContext {
        remote: deps.remote,
        remote_requests: deps.remote_requests,
        endpoint: &expected_scope.endpoint,
        cancel_flag: &cancel_flag,
        auth_scope: deps.auth_scope,
        expected_scope: &expected_scope,
        last_request_at: None,
    };
    let result = fetch_mutual_friend_rows(&mut context, &user_id).await?;
    ensure_mutual_scope_matches(deps.auth_scope, &expected_scope)?;

    let backfills_graph =
        user_id != expected_scope.current_user_id && realtime.is_current_friend(&user_id);
    let owner_user_id = OwnerId::new(expected_scope.current_user_id);

    match result {
        MutualFriendRowsResult::OptedOut => {
            if backfills_graph {
                deps.store.friend_refresh_commit(
                    owner_user_id.to_string(),
                    user_id,
                    None,
                    None,
                    true,
                )?;
            }
            Err(Error::Custom(
                "VRChat mutual friends request is unavailable (403 or 404).".into(),
            ))
        }
        MutualFriendRowsResult::Rows { rows, complete } => {
            let persisted = complete && backfills_graph;
            if persisted {
                let total_count = rows.len();
                let mutual_ids =
                    normalize_friend_ids(rows.iter().filter_map(mutual_id_from_value).collect());
                deps.store.friend_refresh_commit(
                    owner_user_id.to_string(),
                    user_id,
                    Some(mutual_ids),
                    Some(total_count),
                    false,
                )?;
            }
            Ok(UserMutualFriendsListOutput {
                rows: rows.into_iter().map(RawJson::from).collect(),
                persisted,
            })
        }
    }
}

pub(super) async fn fetch_friend_mutuals(
    context: &mut MutualGraphFetchContext<'_>,
    friend_id: &str,
) -> FriendFetchResult {
    let mut collected = Vec::new();
    let mut seen = HashSet::new();
    let mut total_count = 0usize;
    let mut offset = 0;

    loop {
        if fetch_should_cancel(
            context.cancel_flag,
            context.auth_scope,
            context.expected_scope,
        ) {
            return FriendFetchResult::Cancelled;
        }

        match fetch_mutual_page(context, friend_id, offset).await {
            PageFetchResult::Rows(rows) => {
                let page_len = rows.len();
                total_count += page_len;
                for row in rows {
                    if let Some(id) = mutual_id_from_value(&row) {
                        if seen.insert(id.clone()) {
                            collected.push(id);
                        }
                    }
                }
                if page_len < MUTUAL_GRAPH_PAGE_SIZE as usize {
                    return FriendFetchResult::MutualIds {
                        mutual_ids: collected,
                        total_count,
                    };
                }
                offset += page_len as i32;
                if offset / MUTUAL_GRAPH_PAGE_SIZE >= MUTUAL_GRAPH_MAX_PAGES as i32 {
                    return FriendFetchResult::MutualIds {
                        mutual_ids: collected,
                        total_count,
                    };
                }
            }
            PageFetchResult::OptedOut => return FriendFetchResult::OptedOut,
            PageFetchResult::Cancelled => return FriendFetchResult::Cancelled,
            PageFetchResult::Failed(error) => return FriendFetchResult::Failed(error),
        }
    }
}

enum PageFetchResult {
    Rows(Vec<Value>),
    OptedOut,
    Cancelled,
    Failed(String),
}

async fn fetch_mutual_page(
    context: &mut MutualGraphFetchContext<'_>,
    friend_id: &str,
    offset: i32,
) -> PageFetchResult {
    let mut attempt = 0usize;
    loop {
        if fetch_should_cancel(
            context.cancel_flag,
            context.auth_scope,
            context.expected_scope,
        ) {
            return PageFetchResult::Cancelled;
        }

        wait_for_rate_limit(&mut context.last_request_at).await;
        if fetch_should_cancel(
            context.cancel_flag,
            context.auth_scope,
            context.expected_scope,
        ) {
            return PageFetchResult::Cancelled;
        }

        let request = match context.remote_requests.mutual_friends(
            context.endpoint.to_string(),
            friend_id.to_string(),
            MUTUAL_GRAPH_PAGE_SIZE,
            offset,
        ) {
            Ok(request) => request,
            Err(error) => return PageFetchResult::Failed(error.to_string()),
        };
        let response = match context.remote.send(request, VrchatScope::Vrchat).await {
            Ok(response) => response,
            Err(error) => {
                if attempt < MUTUAL_GRAPH_MAX_RETRIES {
                    sleep(backoff_delay(attempt)).await;
                    attempt += 1;
                    continue;
                }
                return PageFetchResult::Failed(error.to_string());
            }
        };

        if response.status == 403 || response.status == 404 {
            return PageFetchResult::OptedOut;
        }

        if (200..=399).contains(&response.status) {
            let json = match serde_json::from_str::<Value>(&response.data) {
                Ok(value) => value,
                Err(error) => return PageFetchResult::Failed(error.to_string()),
            };
            if json.get("error").is_some() {
                return PageFetchResult::Failed(response.data);
            }
            let rows = json.as_array().cloned().unwrap_or_default();
            return PageFetchResult::Rows(rows);
        }

        if is_retryable_status(response.status) && attempt < MUTUAL_GRAPH_MAX_RETRIES {
            sleep(backoff_delay(attempt)).await;
            attempt += 1;
            continue;
        }

        return PageFetchResult::Failed(format!(
            "VRChat mutual friends request for {friend_id} failed with HTTP {}.",
            response.status
        ));
    }
}

enum MutualFriendRowsResult {
    Rows { rows: Vec<Value>, complete: bool },
    OptedOut,
}

async fn fetch_mutual_friend_rows(
    context: &mut MutualGraphFetchContext<'_>,
    user_id: &str,
) -> Result<MutualFriendRowsResult> {
    let mut rows = Vec::new();
    for page in 0..MUTUAL_GRAPH_MAX_PAGES {
        let offset = (page as i32) * MUTUAL_GRAPH_PAGE_SIZE;
        match fetch_mutual_page(context, user_id, offset).await {
            PageFetchResult::Rows(next_rows) => {
                let page_len = next_rows.len();
                rows.extend(next_rows);
                if page_len < MUTUAL_GRAPH_PAGE_SIZE as usize {
                    return Ok(MutualFriendRowsResult::Rows {
                        rows,
                        complete: true,
                    });
                }
            }
            PageFetchResult::OptedOut => {
                return Ok(MutualFriendRowsResult::OptedOut);
            }
            PageFetchResult::Cancelled => {
                return Err(Error::Custom(
                    "User mutual friends list authentication scope changed.".into(),
                ));
            }
            PageFetchResult::Failed(error) => return Err(Error::Custom(error)),
        }
    }
    Ok(MutualFriendRowsResult::Rows {
        rows,
        complete: false,
    })
}

async fn wait_for_rate_limit(last_request_at: &mut Option<Instant>) {
    if let Some(last_request_at) = last_request_at {
        let interval = MUTUAL_GRAPH_REQUEST_INTERVAL;
        let elapsed = last_request_at.elapsed();
        if elapsed < interval {
            sleep(interval - elapsed).await;
        }
    }
    *last_request_at = Some(Instant::now());
}

fn backoff_delay(attempt: usize) -> Duration {
    Duration::from_millis(500 * 2u64.saturating_pow(attempt as u32))
}

fn is_retryable_status(status: i32) -> bool {
    matches!(status, 408 | 409 | 425 | 429 | 500..=599)
}

fn mutual_id_from_value(value: &Value) -> Option<String> {
    let id = value
        .get("id")
        .and_then(Value::as_str)
        .map(normalize_id)
        .unwrap_or_default();
    if id.is_empty() || id == MUTUAL_GRAPH_EMPTY_USER_ID {
        None
    } else {
        Some(id)
    }
}

pub(super) fn normalize_friend_ids(values: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    values
        .into_iter()
        .map(|value| normalize_id(&value))
        .filter(|value| !value.is_empty() && value != MUTUAL_GRAPH_EMPTY_USER_ID)
        .filter(|value| seen.insert(value.clone()))
        .collect()
}

pub(super) fn normalize_id(value: &str) -> String {
    value.trim().to_string()
}

pub(super) fn resolve_fetch_scope(
    input: &MutualGraphFetchStartInput,
    auth_scope: &RuntimeAuthScope,
) -> Result<(String, String, RuntimeAuthScopeSnapshot)> {
    let owner_user_id = normalize_id(input.owner_user_id.as_str());
    if owner_user_id.is_empty() {
        return Err(Error::Custom(
            "MutualGraphFetchStart requires ownerUserId.".into(),
        ));
    }
    let expected_scope = auth_scope.snapshot();
    if !expected_scope.active || expected_scope.current_user_id != owner_user_id {
        return Err(Error::Custom(
            "Mutual graph fetch requires the active authenticated user.".into(),
        ));
    }
    Ok((
        expected_scope.current_user_id.clone(),
        expected_scope.endpoint.clone(),
        expected_scope,
    ))
}

fn require_mutual_scope(
    auth_scope: &RuntimeAuthScope,
    owner_user_id: &OwnerId,
) -> Result<RuntimeAuthScopeSnapshot> {
    let expected_scope = crate::scope_gate::require_active_scope(auth_scope, "Mutual graph")?;
    if expected_scope.current_user_id == normalize_id(owner_user_id.as_str()) {
        Ok(expected_scope)
    } else {
        Err(Error::Custom(
            "Mutual graph requires the active authenticated user.".into(),
        ))
    }
}

fn ensure_mutual_scope_matches(
    auth_scope: &RuntimeAuthScope,
    expected_scope: &RuntimeAuthScopeSnapshot,
) -> Result<()> {
    crate::scope_gate::ensure_scope_matches(auth_scope, expected_scope, "Mutual graph")
}

pub(super) fn fetch_should_cancel(
    cancel_flag: &AtomicBool,
    auth_scope: &RuntimeAuthScope,
    expected_scope: &RuntimeAuthScopeSnapshot,
) -> bool {
    cancel_flag.load(Ordering::Acquire) || !auth_scope.snapshot().generation_matches(expected_scope)
}

pub(super) fn preserve_failed_friend_cache(
    entries: &mut Vec<MutualGraphSnapshotEntryInput>,
    meta_entries: &mut Vec<MutualGraphMetaInput>,
    failed_friend_ids: &HashSet<String>,
    cached: MutualGraphSnapshotOutput,
) {
    let mut mutual_ids_by_friend: HashMap<String, Vec<String>> = HashMap::new();
    for link in cached.links {
        if failed_friend_ids.contains(&link.friend_id) {
            mutual_ids_by_friend
                .entry(link.friend_id)
                .or_default()
                .push(link.mutual_id);
        }
    }
    for friend_id in cached.friend_ids {
        if failed_friend_ids.contains(&friend_id) {
            entries.push(MutualGraphSnapshotEntryInput {
                mutual_ids: mutual_ids_by_friend.remove(&friend_id).unwrap_or_default(),
                friend_id,
            });
        }
    }
    for meta in cached.meta {
        if failed_friend_ids.contains(&meta.friend_id) {
            meta_entries.push(MutualGraphMetaInput {
                friend_id: meta.friend_id,
                last_fetched_at: meta.last_fetched_at,
                opted_out: meta.opted_out,
                total_count: meta.total_count,
            });
        }
    }
}
