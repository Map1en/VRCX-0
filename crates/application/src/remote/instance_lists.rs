use std::future::Future;
use std::time::Duration;

use futures_util::stream::{self, StreamExt};
use serde_json::Value;
use vrcx_0_application_core::{Error, RateLimitBackoff, RequestPacer, Result};
use vrcx_0_contracts::vrchat_api::VrchatResponse;

use crate::scope_gate::response_error_message;

pub(super) const INSTANCE_LIST_PAGE_SIZE: i32 = 50;
pub(super) const ACTIVE_INSTANCE_MAX_PAGES: i32 = 4;
pub(super) const INSTANCE_LIST_REQUEST_SPACING: Duration = Duration::from_millis(333);
const INSTANCE_LIST_CONCURRENCY: usize = 3;
const INSTANCE_LIST_BACKOFF: RateLimitBackoff =
    RateLimitBackoff::new(Duration::from_millis(500), 4);
const RATE_LIMITED_STATUS: i32 = 429;

pub(super) async fn send_paced<F, Fut>(pacer: &RequestPacer, send: F) -> Result<Value>
where
    F: Fn() -> Fut,
    Fut: Future<Output = Result<VrchatResponse>>,
{
    let response = INSTANCE_LIST_BACKOFF
        .retry_paced(
            pacer,
            send,
            |result| matches!(result, Ok(response) if response.status == RATE_LIMITED_STATUS),
        )
        .await?;
    let payload = serde_json::from_str(&response.data).unwrap_or(Value::Null);
    if !(200..300).contains(&response.status) {
        return Err(Error::VrchatApi {
            status_code: response.status,
            message: response_error_message(&payload, response.status, "instance list"),
        });
    }
    Ok(payload)
}

pub(super) async fn load_paced_pages<F, Fut>(
    pacer: &RequestPacer,
    max_pages: i32,
    send_page: F,
) -> Result<Vec<Value>>
where
    F: Fn(i32) -> Fut,
    Fut: Future<Output = Result<VrchatResponse>>,
{
    let send_page = &send_page;
    let pages: Vec<Result<Value>> = stream::iter(0..max_pages)
        .map(|page| send_paced(pacer, move || send_page(page * INSTANCE_LIST_PAGE_SIZE)))
        .buffered(INSTANCE_LIST_CONCURRENCY)
        .collect()
        .await;
    let mut rows = Vec::new();
    for (index, page) in pages.into_iter().enumerate() {
        let page_rows = match page {
            Ok(Value::Array(page_rows)) => page_rows,
            Ok(_) => Vec::new(),
            Err(error) if index == 0 => return Err(error),
            Err(_) => break,
        };
        let short_page = page_rows.len() < INSTANCE_LIST_PAGE_SIZE as usize;
        rows.extend(page_rows);
        if short_page {
            break;
        }
    }
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Mutex;

    use serde_json::json;
    use tokio::time::Instant;

    use super::*;

    fn response(status: i32, data: Value) -> VrchatResponse {
        VrchatResponse {
            status,
            data: data.to_string(),
        }
    }

    fn page(len: usize) -> Value {
        Value::Array((0..len).map(|index| json!({ "id": index })).collect())
    }

    #[tokio::test(start_paused = true)]
    async fn rate_limited_requests_back_off_and_retry() {
        let pacer = RequestPacer::new(INSTANCE_LIST_REQUEST_SPACING);
        let calls = Mutex::new(0);
        let start = Instant::now();

        let payload = send_paced(&pacer, || {
            let mut calls = calls.lock().unwrap();
            *calls += 1;
            let status = if *calls < 3 { 429 } else { 200 };
            async move { Ok(response(status, json!({ "instances": [] }))) }
        })
        .await
        .unwrap();

        assert_eq!(payload, json!({ "instances": [] }));
        assert_eq!(*calls.lock().unwrap(), 3);
        assert_eq!(start.elapsed(), Duration::from_millis(1_500));
    }

    #[tokio::test(start_paused = true)]
    async fn rate_limit_surfaces_after_the_retry_budget() {
        let pacer = RequestPacer::new(INSTANCE_LIST_REQUEST_SPACING);
        let error = send_paced(&pacer, || async { Ok(response(429, json!({}))) })
            .await
            .unwrap_err();

        assert!(matches!(
            error,
            Error::VrchatApi {
                status_code: 429,
                ..
            }
        ));
    }

    #[tokio::test(start_paused = true)]
    async fn pages_run_three_at_a_time_and_stop_at_a_short_page() {
        let pacer = RequestPacer::new(INSTANCE_LIST_REQUEST_SPACING);
        let offsets = Mutex::new(Vec::new());
        let in_flight = AtomicUsize::new(0);
        let peak = AtomicUsize::new(0);

        let rows = load_paced_pages(&pacer, ACTIVE_INSTANCE_MAX_PAGES, |offset| {
            offsets.lock().unwrap().push(offset);
            let len = if offset < 100 { 50 } else { 10 };
            let (in_flight, peak) = (&in_flight, &peak);
            async move {
                let running = in_flight.fetch_add(1, Ordering::SeqCst) + 1;
                peak.fetch_max(running, Ordering::SeqCst);
                tokio::time::sleep(Duration::from_secs(5)).await;
                in_flight.fetch_sub(1, Ordering::SeqCst);
                Ok(response(200, page(len)))
            }
        })
        .await
        .unwrap();

        assert_eq!(rows.len(), 110);
        assert_eq!(*offsets.lock().unwrap(), vec![0, 50, 100, 150]);
        assert_eq!(peak.load(Ordering::SeqCst), 3);
    }

    #[tokio::test(start_paused = true)]
    async fn later_page_failures_keep_earlier_rows() {
        let pacer = RequestPacer::new(INSTANCE_LIST_REQUEST_SPACING);
        let rows = load_paced_pages(&pacer, 2, |offset| async move {
            Ok(if offset == 0 {
                response(200, page(50))
            } else {
                response(500, json!({}))
            })
        })
        .await
        .unwrap();
        assert_eq!(rows.len(), 50);

        let error = load_paced_pages(&pacer, 2, |_| async { Ok(response(500, json!({}))) })
            .await
            .unwrap_err();
        assert!(matches!(
            error,
            Error::VrchatApi {
                status_code: 500,
                ..
            }
        ));
    }
}
