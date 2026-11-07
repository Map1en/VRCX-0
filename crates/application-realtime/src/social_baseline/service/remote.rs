use std::collections::HashMap;
use std::future::Future;
use std::time::Duration;

use futures_util::stream::{FuturesUnordered, StreamExt};
use serde_json::Value;
use tokio::time::{timeout_at, Instant};
use vrcx_0_application_core::{Error, RateLimitBackoff, Result};

use super::{object_field, SocialBaselineDeps, VrchatJsonResponse, VrchatRequest, VrchatScope};

#[cfg(test)]
use std::sync::Arc;

#[cfg(test)]
use super::json;

const PAGED_ARRAY_CONCURRENCY: usize = 5;
const FRIEND_STATUS_VERIFICATION_BUDGET: Duration = Duration::from_secs(2);
#[cfg(not(test))]
const PAGED_ARRAY_BACKOFF: RateLimitBackoff = RateLimitBackoff::new(Duration::from_secs(1), 5);
#[cfg(test)]
const PAGED_ARRAY_BACKOFF: RateLimitBackoff = RateLimitBackoff::new(Duration::from_millis(1), 5);

#[derive(Debug)]
struct PageFetch {
    offset: i32,
    rows: Vec<Value>,
}

#[derive(Debug)]
enum RemoteFetchError {
    RateLimited(Error),
    Other(Error),
}

impl RemoteFetchError {
    fn into_error(self) -> Error {
        match self {
            Self::RateLimited(error) | Self::Other(error) => error,
        }
    }
}

impl From<Error> for RemoteFetchError {
    fn from(error: Error) -> Self {
        Self::Other(error)
    }
}

type RemoteFetchResult<T> = std::result::Result<T, RemoteFetchError>;

pub(crate) async fn execute_vrchat_json_request(
    deps: &SocialBaselineDeps,
    request: VrchatRequest,
) -> Result<Value> {
    let response = deps.web.execute_api(request, VrchatScope::Vrchat).await?;

    let response = VrchatJsonResponse::from(&response);
    if response.is_failure() {
        return Err(Error::VrchatApi {
            status_code: response.status,
            message: response
                .error_message_with_http_status("VRChat social baseline request failed"),
        });
    }

    Ok(response.json)
}

pub(super) async fn fetch_paged_array<F>(
    deps: &SocialBaselineDeps,
    page_size: i32,
    max_offset: Option<i32>,
    build_request: F,
) -> Result<Vec<Value>>
where
    F: Fn(i32, i32) -> Result<VrchatRequest> + Clone,
{
    fetch_paged_array_with_page_fetcher(page_size, max_offset, |n, offset| {
        let build_request = build_request.clone();
        async move {
            let request = build_request(n, offset).map_err(RemoteFetchError::from)?;
            let json = execute_vrchat_json_page_request(deps, request).await?;
            Ok(match json {
                Value::Array(rows) => rows,
                _ => Vec::new(),
            })
        }
    })
    .await
    .map_err(RemoteFetchError::into_error)
}

async fn execute_vrchat_json_page_request(
    deps: &SocialBaselineDeps,
    request: VrchatRequest,
) -> RemoteFetchResult<Value> {
    let response = deps.web.execute_api(request, VrchatScope::Vrchat).await?;

    let response = VrchatJsonResponse::from(&response);
    if response.is_failure() {
        let message =
            response.error_message_with_http_status("VRChat social baseline request failed");
        let error = Error::VrchatApi {
            status_code: response.status,
            message,
        };
        return Err(if response.status == 429 {
            RemoteFetchError::RateLimited(error)
        } else {
            RemoteFetchError::Other(error)
        });
    }

    Ok(response.json)
}

async fn fetch_paged_array_with_page_fetcher<F, Fut>(
    page_size: i32,
    max_offset: Option<i32>,
    fetch_page: F,
) -> RemoteFetchResult<Vec<Value>>
where
    F: Fn(i32, i32) -> Fut + Clone,
    Fut: Future<Output = RemoteFetchResult<Vec<Value>>>,
{
    if page_size <= 0 {
        return Ok(Vec::new());
    }

    let mut pages = Vec::<PageFetch>::new();
    let mut in_flight = FuturesUnordered::new();
    let mut next_offset = 0i32;
    let mut should_stop_scheduling = false;

    while in_flight.len() < PAGED_ARRAY_CONCURRENCY && offset_allowed(next_offset, max_offset) {
        in_flight.push(fetch_page_with_backoff(
            fetch_page.clone(),
            page_size,
            next_offset,
        ));
        next_offset += page_size;
    }

    while let Some(page) = in_flight.next().await {
        let page = page?;
        if page.rows.len() < page_size as usize {
            should_stop_scheduling = true;
        }
        pages.push(page);

        if !should_stop_scheduling && offset_allowed(next_offset, max_offset) {
            in_flight.push(fetch_page_with_backoff(
                fetch_page.clone(),
                page_size,
                next_offset,
            ));
            next_offset += page_size;
        }
    }

    pages.sort_by_key(|page| page.offset);
    Ok(pages
        .into_iter()
        .flat_map(|page| page.rows)
        .collect::<Vec<_>>())
}

async fn fetch_page_with_backoff<F, Fut>(
    fetch_page: F,
    page_size: i32,
    offset: i32,
) -> RemoteFetchResult<PageFetch>
where
    F: Fn(i32, i32) -> Fut,
    Fut: Future<Output = RemoteFetchResult<Vec<Value>>>,
{
    PAGED_ARRAY_BACKOFF
        .retry(
            || fetch_page(page_size, offset),
            |result| matches!(result, Err(RemoteFetchError::RateLimited(_))),
        )
        .await
        .map(|rows| PageFetch { offset, rows })
}

fn offset_allowed(offset: i32, max_offset: Option<i32>) -> bool {
    offset >= 0
        && max_offset
            .map(|max_offset| offset <= max_offset)
            .unwrap_or(true)
}

pub(crate) async fn refetch_users_concurrent(
    deps: &SocialBaselineDeps,
    endpoint: &str,
    user_ids: Vec<String>,
) -> HashMap<String, Value> {
    fetch_per_user_concurrent(deps, user_ids, |user_id| {
        deps.remote_requests
            .user(endpoint.to_string(), user_id.to_string())
            .ok()
            .map(|(_, request)| request)
    })
    .await
}

pub(crate) async fn fetch_friend_statuses_concurrent(
    deps: &SocialBaselineDeps,
    endpoint: &str,
    user_ids: Vec<String>,
) -> HashMap<String, bool> {
    let candidate_count = user_ids.len();
    let (results, budget_exhausted) = fetch_per_user_concurrent_with_budget(
        deps,
        user_ids,
        |user_id| {
            deps.remote_requests
                .friend_status(endpoint.to_string(), user_id.to_string())
                .ok()
                .map(|(_, request)| request)
        },
        Some(FRIEND_STATUS_VERIFICATION_BUDGET),
    )
    .await;
    if budget_exhausted {
        tracing::warn!(
            candidate_count,
            response_count = results.len(),
            "friend-status verification budget exhausted; unverified relationship changes will be retried"
        );
    }
    results
        .into_iter()
        .filter_map(|(user_id, value)| {
            object_field(&value, "isFriend")
                .and_then(Value::as_bool)
                .map(|is_friend| (user_id, is_friend))
        })
        .collect()
}

async fn fetch_per_user_concurrent<F>(
    deps: &SocialBaselineDeps,
    user_ids: Vec<String>,
    build_request: F,
) -> HashMap<String, Value>
where
    F: Fn(&str) -> Option<VrchatRequest>,
{
    fetch_per_user_concurrent_with_budget(deps, user_ids, build_request, None)
        .await
        .0
}

async fn fetch_per_user_concurrent_with_budget<F>(
    deps: &SocialBaselineDeps,
    user_ids: Vec<String>,
    build_request: F,
    budget: Option<Duration>,
) -> (HashMap<String, Value>, bool)
where
    F: Fn(&str) -> Option<VrchatRequest>,
{
    collect_per_user_results(user_ids, budget, |user_id| {
        fetch_user_with_backoff(deps, &build_request, user_id)
    })
    .await
}

async fn collect_per_user_results<F, Fut>(
    user_ids: Vec<String>,
    budget: Option<Duration>,
    fetch_user: F,
) -> (HashMap<String, Value>, bool)
where
    F: Fn(String) -> Fut,
    Fut: Future<Output = (String, Option<Value>)>,
{
    let mut results = HashMap::new();
    let mut in_flight = FuturesUnordered::new();
    let mut pending = user_ids.into_iter();
    let deadline = budget.map(|budget| Instant::now() + budget);

    for _ in 0..PAGED_ARRAY_CONCURRENCY {
        match pending.next() {
            Some(user_id) => in_flight.push(fetch_user(user_id)),
            None => break,
        }
    }
    loop {
        let next = if let Some(deadline) = deadline {
            match timeout_at(deadline, in_flight.next()).await {
                Ok(next) => next,
                Err(_) => return (results, true),
            }
        } else {
            in_flight.next().await
        };
        let Some((user_id, value)) = next else {
            return (results, false);
        };
        if let Some(value) = value {
            results.insert(user_id, value);
        }
        if let Some(next_id) = pending.next() {
            in_flight.push(fetch_user(next_id));
        }
    }
}

async fn fetch_user_with_backoff<F>(
    deps: &SocialBaselineDeps,
    build_request: &F,
    user_id: String,
) -> (String, Option<Value>)
where
    F: Fn(&str) -> Option<VrchatRequest>,
{
    let user_id_ref = &user_id;
    let value = PAGED_ARRAY_BACKOFF
        .retry(
            || async move {
                let request = build_request(user_id_ref)?;
                Some(execute_vrchat_json_page_request(deps, request).await)
            },
            |result| matches!(result, Some(Err(RemoteFetchError::RateLimited(_)))),
        )
        .await
        .and_then(|result| result.ok());
    (user_id, value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tokio::time::sleep;

    #[test]
    fn social_error_message_keeps_http_status() {
        let message =
            VrchatJsonResponse::parse(500, r#"{"error":{"message":"Application error."}}"#)
                .error_message_with_http_status("VRChat social baseline request failed");

        assert_eq!(message, "Application error. (HTTP 500)");
    }

    #[tokio::test]
    async fn fetch_paged_array_pages_with_concurrency_five_until_the_first_short_page() {
        let in_flight = Arc::new(AtomicUsize::new(0));
        let max_in_flight = Arc::new(AtomicUsize::new(0));
        let rows = fetch_paged_array_with_page_fetcher(50, None, {
            let in_flight = Arc::clone(&in_flight);
            let max_in_flight = Arc::clone(&max_in_flight);
            move |_, offset| {
                let in_flight = Arc::clone(&in_flight);
                let max_in_flight = Arc::clone(&max_in_flight);
                async move {
                    let current = in_flight.fetch_add(1, Ordering::SeqCst) + 1;
                    max_in_flight.fetch_max(current, Ordering::SeqCst);
                    tokio::task::yield_now().await;
                    in_flight.fetch_sub(1, Ordering::SeqCst);
                    let count = if offset < 250 {
                        50
                    } else if offset == 250 {
                        12
                    } else {
                        0
                    };
                    Ok((0..count)
                        .map(|index| json!({ "offset": offset, "index": index }))
                        .collect())
                }
            }
        })
        .await
        .unwrap();

        assert_eq!(
            max_in_flight.load(Ordering::SeqCst),
            PAGED_ARRAY_CONCURRENCY
        );
        assert_eq!(rows.len(), 262);
        assert_eq!(
            rows.first().and_then(|row| row.get("offset")),
            Some(&json!(0))
        );
        assert_eq!(
            rows.last().and_then(|row| row.get("offset")),
            Some(&json!(250))
        );
    }

    #[tokio::test]
    async fn fetch_paged_array_without_max_offset_continues_past_legacy_friend_limit() {
        let rows = fetch_paged_array_with_page_fetcher(50, None, |_, offset| async move {
            let count = if offset <= 7_500 {
                50
            } else if offset == 7_550 {
                1
            } else {
                0
            };
            Ok((0..count)
                .map(|index| json!({ "offset": offset, "index": index }))
                .collect())
        })
        .await
        .unwrap();

        assert!(rows
            .iter()
            .any(|row| row.get("offset") == Some(&json!(7_550))));
    }

    #[tokio::test]
    async fn fetch_paged_array_retries_rate_limited_pages_with_backoff() {
        let attempts = Arc::new(std::sync::Mutex::new(HashMap::<i32, usize>::new()));
        let attempts_for_fetch = Arc::clone(&attempts);

        let rows = fetch_paged_array_with_page_fetcher(50, None, move |_, offset| {
            let attempts_for_fetch = Arc::clone(&attempts_for_fetch);
            async move {
                let mut attempts = attempts_for_fetch.lock().unwrap();
                let entry = attempts.entry(offset).or_default();
                *entry += 1;
                if offset == 50 && *entry == 1 {
                    return Err(RemoteFetchError::RateLimited(Error::Custom(
                        "rate limited".into(),
                    )));
                }
                let count = if offset < 100 { 50 } else { 0 };
                Ok((0..count)
                    .map(|index| json!({ "offset": offset, "index": index }))
                    .collect())
            }
        })
        .await
        .unwrap();

        assert_eq!(rows.len(), 100);
        assert_eq!(*attempts.lock().unwrap().get(&50).unwrap(), 2);
    }

    #[tokio::test]
    async fn per_user_budget_returns_completed_results_without_waiting_for_every_candidate() {
        let user_ids = (0..8).map(|index| format!("usr_{index}")).collect();

        let (results, budget_exhausted) = collect_per_user_results(
            user_ids,
            Some(Duration::from_millis(50)),
            |user_id| async move {
                if user_id == "usr_0" {
                    sleep(Duration::from_millis(500)).await;
                } else {
                    sleep(Duration::from_millis(1)).await;
                }
                let value = json!({ "isFriend": true });
                (user_id, Some(value))
            },
        )
        .await;

        assert!(budget_exhausted);
        assert_eq!(results.len(), 7);
        assert!(!results.contains_key("usr_0"));
    }
}
