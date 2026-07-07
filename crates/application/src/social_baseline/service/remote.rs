use super::*;
use futures_util::stream::{FuturesUnordered, StreamExt};
use std::future::Future;
use std::time::Duration;
use tokio::time::sleep;
use vrcx_0_vrchat_client::users::user_get_input;

const PAGED_ARRAY_CONCURRENCY: usize = 5;
const PAGED_ARRAY_MAX_RETRIES: usize = 5;
#[cfg(not(test))]
const PAGED_ARRAY_RETRY_BASE_DELAY_MS: u64 = 1_000;
#[cfg(test)]
const PAGED_ARRAY_RETRY_BASE_DELAY_MS: u64 = 1;

#[derive(Debug)]
struct PageFetch {
    offset: i64,
    rows: Vec<Value>,
}

pub(super) async fn execute_vrchat_json_request(
    deps: &SocialBaselineDeps,
    request: HttpApiRequestInput,
) -> Result<Value> {
    let response = deps
        .web
        .execute_api(request, ApiScope::Vrchat, deps.db.as_ref())
        .await?;

    let json = parse_response_json(&response.data);
    if response.status >= 400 || response_has_error(&json) {
        return Err(Error::Custom(unwrap_error_message(
            &json,
            response.status,
            "VRChat social baseline request failed",
        )));
    }

    Ok(json)
}

fn parse_response_json(data: &str) -> Value {
    serde_json::from_str(data).unwrap_or_else(|_| Value::String(data.to_string()))
}

fn response_has_error(json: &Value) -> bool {
    json.as_object()
        .is_some_and(|object| object.contains_key("error"))
}

fn value_message(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|message| !message.is_empty())
        .map(|message| message.trim_matches('"').to_string())
}

fn unwrap_error_message(json: &Value, status: i32, fallback: &str) -> String {
    if let Some(message) = value_message(Some(json)) {
        return message;
    }

    let object = json.as_object();
    if let Some(message) = value_message(
        object
            .and_then(|record| record.get("error"))
            .and_then(Value::as_object)
            .and_then(|error| error.get("message")),
    ) {
        return message;
    }
    if let Some(message) = value_message(object.and_then(|record| record.get("message"))) {
        return message;
    }

    format!("{fallback} ({status})")
}

pub(super) async fn fetch_paged_array<F>(
    deps: &SocialBaselineDeps,
    page_size: i64,
    max_offset: Option<i64>,
    build_request: F,
) -> Result<Vec<Value>>
where
    F: Fn(i64, i64) -> HttpApiRequestInput + Clone,
{
    fetch_paged_array_with_page_fetcher(page_size, max_offset, |n, offset| {
        let build_request = build_request.clone();
        async move {
            let json = execute_vrchat_json_page_request(deps, build_request(n, offset)).await?;
            Ok(json.as_array().cloned().unwrap_or_default())
        }
    })
    .await
}

async fn execute_vrchat_json_page_request(
    deps: &SocialBaselineDeps,
    request: HttpApiRequestInput,
) -> Result<Value> {
    let response = deps
        .web
        .execute_api(request, ApiScope::Vrchat, deps.db.as_ref())
        .await?;

    let json = parse_response_json(&response.data);
    if response.status >= 400 || response_has_error(&json) {
        let mut message = unwrap_error_message(
            &json,
            response.status,
            "VRChat social baseline request failed",
        );
        if response.status == 429 && !message.contains("429") {
            message = format!("429: {message}");
        }
        return Err(Error::Custom(message));
    }

    Ok(json)
}

async fn fetch_paged_array_with_page_fetcher<F, Fut>(
    page_size: i64,
    max_offset: Option<i64>,
    fetch_page: F,
) -> Result<Vec<Value>>
where
    F: Fn(i64, i64) -> Fut + Clone,
    Fut: Future<Output = Result<Vec<Value>>>,
{
    if page_size <= 0 {
        return Ok(Vec::new());
    }

    let mut pages = Vec::<PageFetch>::new();
    let mut in_flight = FuturesUnordered::new();
    let mut next_offset = 0i64;
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
    page_size: i64,
    offset: i64,
) -> Result<PageFetch>
where
    F: Fn(i64, i64) -> Fut,
    Fut: Future<Output = Result<Vec<Value>>>,
{
    let mut attempt = 0usize;
    loop {
        match fetch_page(page_size, offset).await {
            Ok(rows) => return Ok(PageFetch { offset, rows }),
            Err(error) if is_rate_limit_error(&error) && attempt < PAGED_ARRAY_MAX_RETRIES => {
                sleep(backoff_delay(attempt)).await;
                attempt += 1;
            }
            Err(error) => return Err(error),
        }
    }
}

fn offset_allowed(offset: i64, max_offset: Option<i64>) -> bool {
    offset >= 0
        && max_offset
            .map(|max_offset| offset <= max_offset)
            .unwrap_or(true)
}

fn backoff_delay(attempt: usize) -> Duration {
    Duration::from_millis(PAGED_ARRAY_RETRY_BASE_DELAY_MS * 2u64.saturating_pow(attempt as u32))
}

fn is_rate_limit_error(error: &Error) -> bool {
    let message = error.to_string();
    message.contains("429") || message.to_ascii_lowercase().contains("ratelimited")
}

pub(super) async fn refetch_users_concurrent(
    deps: &SocialBaselineDeps,
    endpoint: &str,
    user_ids: Vec<String>,
) -> HashMap<String, Value> {
    let mut results = HashMap::new();
    let mut in_flight = FuturesUnordered::new();
    let mut pending = user_ids.into_iter();

    for _ in 0..PAGED_ARRAY_CONCURRENCY {
        match pending.next() {
            Some(user_id) => in_flight.push(refetch_user_with_backoff(deps, endpoint, user_id)),
            None => break,
        }
    }
    while let Some((user_id, value)) = in_flight.next().await {
        if let Some(value) = value {
            results.insert(user_id, value);
        }
        if let Some(next_id) = pending.next() {
            in_flight.push(refetch_user_with_backoff(deps, endpoint, next_id));
        }
    }
    results
}

async fn refetch_user_with_backoff(
    deps: &SocialBaselineDeps,
    endpoint: &str,
    user_id: String,
) -> (String, Option<Value>) {
    let mut attempt = 0usize;
    loop {
        let request = match user_get_input(endpoint.to_string(), user_id.clone()) {
            Ok((_, request)) => request,
            Err(_) => return (user_id, None),
        };
        // execute_vrchat_json_page_request tags 429s so is_rate_limit_error can detect them.
        match execute_vrchat_json_page_request(deps, request).await {
            Ok(value) => return (user_id, Some(value)),
            Err(error) if is_rate_limit_error(&error) && attempt < PAGED_ARRAY_MAX_RETRIES => {
                sleep(backoff_delay(attempt)).await;
                attempt += 1;
            }
            Err(_) => return (user_id, None),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn fetch_paged_array_pages_with_concurrency_five_until_the_first_short_page() {
        let rows = fetch_paged_array_with_page_fetcher(50, None, |_, offset| async move {
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
        })
        .await
        .unwrap();

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
        let attempts = Arc::new(std::sync::Mutex::new(HashMap::<i64, usize>::new()));
        let attempts_for_fetch = Arc::clone(&attempts);

        let rows = fetch_paged_array_with_page_fetcher(50, None, move |_, offset| {
            let attempts_for_fetch = Arc::clone(&attempts_for_fetch);
            async move {
                let mut attempts = attempts_for_fetch.lock().unwrap();
                let entry = attempts.entry(offset).or_default();
                *entry += 1;
                if offset == 50 && *entry == 1 {
                    return Err(Error::Custom("429".into()));
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
}
