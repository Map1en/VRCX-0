use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

use tokio::time::Instant;
use vrcx_0_application_core::{sleep_until_due_or_stopped, TaskSpawnOutcome, TaskSupervisor};

const RETRY_DELAYS_SECONDS: [u64; 4] = [5, 15, 30, 60];
const RETRY_JITTER_RATIO: f64 = 0.5;
const RETRY_SLEEP_POLL_INTERVAL: Duration = Duration::from_millis(250);
const RESUME_SKIP_WINDOW: Duration = Duration::from_secs(60);
pub(super) const REALTIME_INTERRUPTION_GRACE: Duration = Duration::from_secs(10);
const SYSTEM_RESUME_TICK: Duration = Duration::from_secs(5);
const SYSTEM_RESUME_GAP: Duration = Duration::from_secs(20);

pub(super) fn retry_delay_seconds(attempt: u32) -> u64 {
    RETRY_DELAYS_SECONDS[(attempt.saturating_sub(1) as usize).min(RETRY_DELAYS_SECONDS.len() - 1)]
}

pub(super) fn jittered_retry_delay(attempt: u32, unit: f64) -> Duration {
    let base = retry_delay_seconds(attempt) as f64;
    let max = *RETRY_DELAYS_SECONDS.last().unwrap_or(&60) as f64;
    let factor = 1.0 + RETRY_JITTER_RATIO * (2.0 * unit.clamp(0.0, 1.0) - 1.0);
    Duration::from_secs_f64((base * factor).clamp(1.0, max))
}

pub(super) fn random_retry_delay(attempt: u32) -> Duration {
    jittered_retry_delay(attempt, fastrand::f64())
}

#[derive(Default)]
pub(super) struct RetryWake {
    epoch: AtomicU64,
    resume_skip_until: Mutex<Option<Instant>>,
}

impl RetryWake {
    pub(super) fn epoch(&self) -> u64 {
        self.epoch.load(Ordering::Acquire)
    }

    pub(super) fn wake(&self) {
        self.epoch.fetch_add(1, Ordering::AcqRel);
    }

    pub(super) fn wake_after_resume(&self) {
        *self.lock_resume_skip() = Some(Instant::now() + RESUME_SKIP_WINDOW);
        self.wake();
    }

    pub(super) async fn wait(
        &self,
        delay: Duration,
        epoch: u64,
        mut keep_waiting: impl FnMut() -> bool,
    ) -> bool {
        if self.take_resume_skip() {
            return keep_waiting();
        }
        let deadline = Instant::now() + delay;
        loop {
            if !keep_waiting() {
                return false;
            }
            if self.epoch() != epoch {
                self.lock_resume_skip().take();
                break;
            }
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                break;
            }
            tokio::time::sleep(remaining.min(RETRY_SLEEP_POLL_INTERVAL)).await;
        }
        keep_waiting()
    }

    fn take_resume_skip(&self) -> bool {
        self.lock_resume_skip()
            .take()
            .is_some_and(|until| Instant::now() < until)
    }

    fn lock_resume_skip(&self) -> std::sync::MutexGuard<'_, Option<Instant>> {
        self.resume_skip_until
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

#[derive(Default)]
pub(super) struct RealtimeOutage {
    since: Option<Instant>,
}

impl RealtimeOutage {
    pub(super) fn is_ongoing(&self) -> bool {
        self.since.is_some()
    }

    pub(super) fn begin(&mut self, now: Instant) {
        self.since.get_or_insert(now);
    }

    pub(super) fn end(&mut self) {
        self.since = None;
    }

    pub(super) fn past_grace(&self, now: Instant) -> bool {
        self.since.is_some_and(|since| {
            now.saturating_duration_since(since) >= REALTIME_INTERRUPTION_GRACE
        })
    }
}

#[derive(Default)]
pub(super) struct SystemResumeWatch {
    started: Arc<AtomicBool>,
}

impl SystemResumeWatch {
    pub(super) fn start<F>(&self, tasks: &TaskSupervisor, on_resume: F) -> bool
    where
        F: Fn() + Send + 'static,
    {
        if self.started.swap(true, Ordering::AcqRel) {
            return false;
        }
        let started = Arc::clone(&self.started);
        let outcome = tasks.spawn_cancellable(move |stop_token| async move {
            let mut detector =
                SystemResumeDetector::new(std::time::Instant::now(), SystemTime::now());
            while sleep_until_due_or_stopped(SYSTEM_RESUME_TICK, &stop_token).await {
                if detector.observe(
                    SYSTEM_RESUME_TICK,
                    std::time::Instant::now(),
                    SystemTime::now(),
                ) {
                    on_resume();
                }
            }
            started.store(false, Ordering::Release);
        });
        if outcome != TaskSpawnOutcome::Scheduled {
            self.started.store(false, Ordering::Release);
            return false;
        }
        true
    }
}

struct SystemResumeDetector {
    last_monotonic: std::time::Instant,
    last_wall: SystemTime,
}

impl SystemResumeDetector {
    fn new(monotonic: std::time::Instant, wall: SystemTime) -> Self {
        Self {
            last_monotonic: monotonic,
            last_wall: wall,
        }
    }

    fn observe(
        &mut self,
        expected: Duration,
        monotonic: std::time::Instant,
        wall: SystemTime,
    ) -> bool {
        let monotonic_gap = monotonic.saturating_duration_since(self.last_monotonic);
        let wall_gap = wall.duration_since(self.last_wall).unwrap_or_default();
        self.last_monotonic = monotonic;
        self.last_wall = wall;
        monotonic_gap.max(wall_gap) >= expected + SYSTEM_RESUME_GAP
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_resume_watch_starts_only_once() {
        let tasks = TaskSupervisor::new();
        let watch = SystemResumeWatch::default();

        assert!(watch.start(&tasks, || {}));
        assert!(!watch.start(&tasks, || {}));

        tasks.stop_all();
    }

    #[test]
    fn retry_schedule_caps_at_sixty_seconds() {
        assert_eq!(retry_delay_seconds(1), 5);
        assert_eq!(retry_delay_seconds(2), 15);
        assert_eq!(retry_delay_seconds(3), 30);
        assert_eq!(retry_delay_seconds(4), 60);
        assert_eq!(retry_delay_seconds(20), 60);
    }

    #[test]
    fn jitter_spreads_each_delay_by_half_and_never_exceeds_the_cap() {
        assert_eq!(jittered_retry_delay(1, 0.0), Duration::from_secs_f64(2.5));
        assert_eq!(jittered_retry_delay(1, 0.5), Duration::from_secs(5));
        assert_eq!(jittered_retry_delay(1, 1.0), Duration::from_secs_f64(7.5));
        assert_eq!(jittered_retry_delay(3, 0.0), Duration::from_secs(15));
        assert_eq!(jittered_retry_delay(3, 1.0), Duration::from_secs(45));
        assert_eq!(jittered_retry_delay(4, 0.0), Duration::from_secs(30));
        assert_eq!(jittered_retry_delay(9, 1.0), Duration::from_secs(60));
        for _ in 0..200 {
            let delay = random_retry_delay(2);
            assert!(delay >= Duration::from_secs_f64(7.5));
            assert!(delay <= Duration::from_secs_f64(22.5));
        }
    }

    #[tokio::test(start_paused = true)]
    async fn retry_wait_runs_the_full_delay_without_a_wake() {
        let wake = RetryWake::default();
        let started = Instant::now();

        assert!(
            wake.wait(Duration::from_secs(5), wake.epoch(), || true)
                .await
        );

        assert!(started.elapsed() >= Duration::from_secs(5));
    }

    #[tokio::test(start_paused = true)]
    async fn retry_now_ends_the_wait_early() {
        let wake = Arc::new(RetryWake::default());
        let epoch = wake.epoch();
        let started = Instant::now();
        let waker = Arc::clone(&wake);
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_secs(2)).await;
            waker.wake();
        });

        assert!(wake.wait(Duration::from_secs(60), epoch, || true).await);

        assert!(started.elapsed() < Duration::from_secs(3));
    }

    #[tokio::test(start_paused = true)]
    async fn a_wake_between_scheduling_and_waiting_is_not_lost() {
        let wake = RetryWake::default();
        let epoch = wake.epoch();
        wake.wake();
        let started = Instant::now();

        assert!(wake.wait(Duration::from_secs(60), epoch, || true).await);

        assert!(started.elapsed() < Duration::from_secs(1));
    }

    #[tokio::test(start_paused = true)]
    async fn resume_skips_the_next_wait_once() {
        let wake = RetryWake::default();
        wake.wake_after_resume();

        let started = Instant::now();
        assert!(
            wake.wait(Duration::from_secs(30), wake.epoch(), || true)
                .await
        );
        assert!(started.elapsed() < Duration::from_secs(1));

        let started = Instant::now();
        assert!(
            wake.wait(Duration::from_secs(15), wake.epoch(), || true)
                .await
        );
        assert!(started.elapsed() >= Duration::from_secs(15));
    }

    #[tokio::test(start_paused = true)]
    async fn resume_during_a_wait_does_not_also_skip_the_following_wait() {
        let wake = Arc::new(RetryWake::default());
        let epoch = wake.epoch();
        let waker = Arc::clone(&wake);
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_secs(1)).await;
            waker.wake_after_resume();
        });
        assert!(wake.wait(Duration::from_secs(30), epoch, || true).await);

        let started = Instant::now();
        assert!(
            wake.wait(Duration::from_secs(15), wake.epoch(), || true)
                .await
        );
        assert!(started.elapsed() >= Duration::from_secs(15));
    }

    #[tokio::test(start_paused = true)]
    async fn resume_skip_expires_when_the_connection_survived() {
        let wake = RetryWake::default();
        wake.wake_after_resume();
        tokio::time::sleep(RESUME_SKIP_WINDOW + Duration::from_secs(1)).await;

        let started = Instant::now();
        assert!(
            wake.wait(Duration::from_secs(5), wake.epoch(), || true)
                .await
        );
        assert!(started.elapsed() >= Duration::from_secs(5));
    }

    #[tokio::test(start_paused = true)]
    async fn stopping_the_runtime_cancels_the_wait() {
        let wake = RetryWake::default();

        assert!(
            !wake
                .wait(Duration::from_secs(5), wake.epoch(), || false)
                .await
        );
    }

    #[test]
    fn realtime_outage_is_only_interrupted_after_the_grace_period() {
        let now = Instant::now();
        let mut outage = RealtimeOutage::default();
        assert!(!outage.past_grace(now));

        outage.begin(now);
        outage.begin(now + Duration::from_secs(8));
        assert!(!outage.past_grace(now + Duration::from_secs(9)));
        assert!(outage.past_grace(now + REALTIME_INTERRUPTION_GRACE));

        outage.end();
        assert!(!outage.is_ongoing());
        assert!(!outage.past_grace(now + Duration::from_secs(60)));
    }

    #[test]
    fn resume_detector_flags_a_wall_clock_or_monotonic_jump() {
        let tick = Duration::from_secs(5);
        let monotonic = std::time::Instant::now();
        let wall = SystemTime::now();
        let mut detector = SystemResumeDetector::new(monotonic, wall);

        assert!(!detector.observe(tick, monotonic + tick, wall + tick));
        assert!(!detector.observe(
            tick,
            monotonic + tick * 2 + Duration::from_secs(3),
            wall + tick * 2 + Duration::from_secs(3)
        ));
        assert!(detector.observe(
            tick,
            monotonic + tick * 3 + Duration::from_secs(3),
            wall + Duration::from_secs(3600)
        ));
        assert!(detector.observe(
            tick,
            monotonic + Duration::from_secs(900),
            wall + Duration::from_secs(3600) + tick
        ));
        assert!(!detector.observe(
            tick,
            monotonic + Duration::from_secs(900) + tick,
            wall + Duration::from_secs(60)
        ));
    }
}
