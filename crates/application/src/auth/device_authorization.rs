use std::future::Future;
use std::time::Duration;

use tokio::sync::Notify;
use tokio::time::Instant;
use vrcx_0_contracts::vrchat_api::VrchatResponse;
use vrcx_0_contracts::vrchat_device_login::{
    interpret_device_status_response, slowed_device_poll_interval, VrchatDeviceStatus,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DeviceApprovalOutcome {
    Approved,
    Expired,
    Denied,
    Failed(String),
    Superseded,
}

pub async fn wait_for_device_approval<Poll, PollFuture>(
    mut interval: Duration,
    deadline: Instant,
    wake: &Notify,
    is_current: impl Fn() -> bool,
    mut poll: Poll,
) -> DeviceApprovalOutcome
where
    Poll: FnMut() -> PollFuture,
    PollFuture: Future<Output = Result<VrchatResponse, String>>,
{
    loop {
        let now = Instant::now();
        if now >= deadline {
            return DeviceApprovalOutcome::Expired;
        }
        let woken = wake.notified();
        if !is_current() {
            return DeviceApprovalOutcome::Superseded;
        }
        tokio::select! {
            () = tokio::time::sleep(interval.min(deadline - now)) => {}
            () = woken => {}
        }
        if !is_current() {
            return DeviceApprovalOutcome::Superseded;
        }
        if Instant::now() >= deadline {
            return DeviceApprovalOutcome::Expired;
        }
        let result = poll().await;
        if !is_current() {
            return DeviceApprovalOutcome::Superseded;
        }
        let response = match result {
            Ok(response) => response,
            Err(reason) => {
                tracing::warn!(reason, "device approval poll failed; retrying");
                continue;
            }
        };
        match interpret_device_status_response(&response) {
            VrchatDeviceStatus::Approved => return DeviceApprovalOutcome::Approved,
            VrchatDeviceStatus::Pending => {}
            VrchatDeviceStatus::SlowDown => interval = slowed_device_poll_interval(interval),
            VrchatDeviceStatus::Expired => return DeviceApprovalOutcome::Expired,
            VrchatDeviceStatus::Denied => return DeviceApprovalOutcome::Denied,
            VrchatDeviceStatus::Failed { reason } => return DeviceApprovalOutcome::Failed(reason),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::collections::VecDeque;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex};

    use serde_json::json;
    use vrcx_0_contracts::vrchat_api::vrchat_response;

    use super::*;

    fn pending() -> VrchatResponse {
        vrchat_response(
            400,
            json!({ "error": { "message": "authorization_pending" } }).to_string(),
        )
    }

    fn slow_down() -> VrchatResponse {
        vrchat_response(
            400,
            json!({ "error": { "message": "slow_down" } }).to_string(),
        )
    }

    fn approved() -> VrchatResponse {
        vrchat_response(200, json!({ "user": { "id": "usr_1" } }).to_string())
    }

    struct Poller {
        responses: Mutex<VecDeque<VrchatResponse>>,
        polled_at: Mutex<Vec<Instant>>,
    }

    impl Poller {
        fn new(responses: Vec<VrchatResponse>) -> Arc<Self> {
            Arc::new(Self {
                responses: Mutex::new(responses.into()),
                polled_at: Mutex::new(Vec::new()),
            })
        }

        fn poll(self: &Arc<Self>) -> impl Future<Output = Result<VrchatResponse, String>> {
            let poller = Arc::clone(self);
            async move {
                poller.polled_at.lock().unwrap().push(Instant::now());
                poller
                    .responses
                    .lock()
                    .unwrap()
                    .pop_front()
                    .ok_or_else(|| "no more responses".to_string())
            }
        }
    }

    #[tokio::test(start_paused = true)]
    async fn keeps_polling_until_the_phone_approves_and_backs_off_on_slow_down() {
        let started = Instant::now();
        let poller = Poller::new(vec![pending(), slow_down(), approved()]);
        let wake = Notify::new();

        let outcome = wait_for_device_approval(
            Duration::from_secs(5),
            started + Duration::from_secs(300),
            &wake,
            || true,
            || poller.poll(),
        )
        .await;

        assert_eq!(outcome, DeviceApprovalOutcome::Approved);
        let offsets = poller
            .polled_at
            .lock()
            .unwrap()
            .iter()
            .map(|at| (*at - started).as_secs())
            .collect::<Vec<_>>();
        assert_eq!(offsets, vec![5, 10, 20]);
    }

    #[tokio::test(start_paused = true)]
    async fn stops_at_the_deadline_without_polling_after_it() {
        let started = Instant::now();
        let poller = Poller::new(vec![pending(), pending(), pending()]);
        let wake = Notify::new();

        let outcome = wait_for_device_approval(
            Duration::from_secs(5),
            started + Duration::from_secs(12),
            &wake,
            || true,
            || poller.poll(),
        )
        .await;

        assert_eq!(outcome, DeviceApprovalOutcome::Expired);
        assert_eq!(poller.polled_at.lock().unwrap().len(), 2);
    }

    #[tokio::test(start_paused = true)]
    async fn a_cancel_wakes_the_wait_immediately() {
        let started = Instant::now();
        let poller = Poller::new(vec![pending()]);
        let wake = Arc::new(Notify::new());
        let current = Arc::new(AtomicBool::new(true));

        let task = {
            let wake = Arc::clone(&wake);
            let current = Arc::clone(&current);
            let poller = Arc::clone(&poller);
            tokio::spawn(async move {
                wait_for_device_approval(
                    Duration::from_secs(60),
                    started + Duration::from_secs(300),
                    &wake,
                    || current.load(Ordering::SeqCst),
                    || poller.poll(),
                )
                .await
            })
        };
        tokio::time::sleep(Duration::from_secs(1)).await;
        current.store(false, Ordering::SeqCst);
        wake.notify_waiters();

        assert_eq!(task.await.unwrap(), DeviceApprovalOutcome::Superseded);
        assert!(Instant::now() - started < Duration::from_secs(2));
        assert!(poller.polled_at.lock().unwrap().is_empty());
    }
}
