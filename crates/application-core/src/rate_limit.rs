use std::future::Future;
use std::time::Duration;

use tokio::sync::Mutex;
use tokio::time::Instant;

#[derive(Clone, Copy, Debug)]
pub struct RateLimitBackoff {
    base_delay: Duration,
    max_retries: u32,
}

impl RateLimitBackoff {
    pub const fn new(base_delay: Duration, max_retries: u32) -> Self {
        Self {
            base_delay,
            max_retries,
        }
    }

    pub fn max_retries(self) -> u32 {
        self.max_retries
    }

    pub fn delay(self, attempt: u32) -> Duration {
        self.base_delay.saturating_mul(2u32.saturating_pow(attempt))
    }

    pub async fn retry<T, F, Fut>(self, mut operation: F, should_retry: impl Fn(&T) -> bool) -> T
    where
        F: FnMut() -> Fut,
        Fut: Future<Output = T>,
    {
        let mut attempt = 0;
        loop {
            let outcome = operation().await;
            if attempt >= self.max_retries || !should_retry(&outcome) {
                return outcome;
            }
            tokio::time::sleep(self.delay(attempt)).await;
            attempt += 1;
        }
    }

    pub async fn retry_paced<T, F, Fut>(
        self,
        pacer: &RequestPacer,
        mut operation: F,
        should_retry: impl Fn(&T) -> bool,
    ) -> T
    where
        F: FnMut() -> Fut,
        Fut: Future<Output = T>,
    {
        let mut attempt = 0;
        loop {
            pacer.acquire_slot().await;
            let outcome = operation().await;
            if attempt >= self.max_retries || !should_retry(&outcome) {
                return outcome;
            }
            pacer.delay_next_slots(self.delay(attempt)).await;
            attempt += 1;
        }
    }
}

pub struct RequestPacer {
    spacing: Duration,
    next_slot: Mutex<Option<Instant>>,
}

impl RequestPacer {
    pub fn new(spacing: Duration) -> Self {
        Self {
            spacing,
            next_slot: Mutex::new(None),
        }
    }

    pub async fn acquire_slot(&self) {
        let slot = {
            let mut next_slot = self.next_slot.lock().await;
            let now = Instant::now();
            let slot = next_slot.map(|at| at.max(now)).unwrap_or(now);
            *next_slot = Some(slot + self.spacing);
            slot
        };
        tokio::time::sleep_until(slot).await;
    }

    pub async fn delay_next_slots(&self, delay: Duration) {
        let mut next_slot = self.next_slot.lock().await;
        let resume_at = Instant::now() + delay;
        *next_slot = Some(next_slot.map(|at| at.max(resume_at)).unwrap_or(resume_at));
    }
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;

    use super::*;

    const BACKOFF: RateLimitBackoff = RateLimitBackoff::new(Duration::from_millis(500), 2);

    #[test]
    fn backoff_delay_doubles_from_the_base() {
        assert_eq!(BACKOFF.delay(0), Duration::from_millis(500));
        assert_eq!(BACKOFF.delay(1), Duration::from_secs(1));
        assert_eq!(BACKOFF.delay(3), Duration::from_secs(4));
    }

    #[tokio::test(start_paused = true)]
    async fn retry_sleeps_between_attempts_and_stops_at_the_budget() {
        let calls = Cell::new(0);
        let start = Instant::now();
        let outcome = BACKOFF
            .retry(
                || {
                    calls.set(calls.get() + 1);
                    async { 429 }
                },
                |status| *status == 429,
            )
            .await;

        assert_eq!(outcome, 429);
        assert_eq!(calls.get(), 3);
        assert_eq!(start.elapsed(), Duration::from_millis(1_500));
    }

    #[tokio::test(start_paused = true)]
    async fn retry_returns_the_first_outcome_that_is_not_retried() {
        let calls = Cell::new(0);
        let outcome = BACKOFF
            .retry(
                || {
                    calls.set(calls.get() + 1);
                    let status = if calls.get() == 1 { 429 } else { 200 };
                    async move { status }
                },
                |status| *status == 429,
            )
            .await;

        assert_eq!(outcome, 200);
        assert_eq!(calls.get(), 2);
    }

    #[tokio::test(start_paused = true)]
    async fn paced_retry_pushes_the_pacer_back() {
        let pacer = RequestPacer::new(Duration::from_millis(300));
        let calls = Cell::new(0);
        let start = Instant::now();
        BACKOFF
            .retry_paced(
                &pacer,
                || {
                    calls.set(calls.get() + 1);
                    let status = if calls.get() == 1 { 429 } else { 200 };
                    async move { status }
                },
                |status| *status == 429,
            )
            .await;
        assert_eq!(start.elapsed(), Duration::from_millis(500));

        pacer.acquire_slot().await;
        assert_eq!(start.elapsed(), Duration::from_millis(800));
    }

    #[tokio::test(start_paused = true)]
    async fn slots_are_spaced_apart() {
        let pacer = RequestPacer::new(Duration::from_millis(300));
        let start = Instant::now();
        pacer.acquire_slot().await;
        pacer.acquire_slot().await;
        pacer.acquire_slot().await;
        assert_eq!(start.elapsed(), Duration::from_millis(600));
    }

    #[tokio::test(start_paused = true)]
    async fn a_delay_holds_back_every_later_slot() {
        let pacer = RequestPacer::new(Duration::from_millis(300));
        pacer.acquire_slot().await;
        pacer.delay_next_slots(Duration::from_millis(2_000)).await;

        let start = Instant::now();
        pacer.acquire_slot().await;
        assert_eq!(start.elapsed(), Duration::from_millis(2_000));
    }
}
