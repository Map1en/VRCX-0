use std::time::{Duration, Instant};

const DEFAULT_VISIBLE_DURATION: Duration = Duration::from_secs(10);

#[derive(Clone, Copy, Debug)]
pub(super) struct WristVisibilityPolicy {
    visible_duration: Duration,
    opened_until: Option<Instant>,
}

impl Default for WristVisibilityPolicy {
    fn default() -> Self {
        Self::new(DEFAULT_VISIBLE_DURATION)
    }
}

impl WristVisibilityPolicy {
    pub fn new(visible_duration: Duration) -> Self {
        Self {
            visible_duration,
            opened_until: None,
        }
    }

    pub fn open(&mut self, now: Instant) {
        self.opened_until = Some(now + self.visible_duration);
    }

    pub fn close(&mut self) {
        self.opened_until = None;
    }

    pub fn evaluate(&mut self, now: Instant, device_present: bool) -> bool {
        let open = self.opened_until.is_some_and(|until| now <= until);
        if !open {
            self.opened_until = None;
        }
        device_present && open
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const VISIBLE: Duration = Duration::from_secs(10);

    #[test]
    fn closed_by_default() {
        let mut policy = WristVisibilityPolicy::new(VISIBLE);
        assert!(!policy.evaluate(Instant::now(), true));
    }

    #[test]
    fn open_keeps_surface_visible_until_window_expires() {
        let mut policy = WristVisibilityPolicy::new(VISIBLE);
        let now = Instant::now();
        policy.open(now);
        assert!(policy.evaluate(now, true));
        assert!(policy.evaluate(now + VISIBLE, true));
        assert!(!policy.evaluate(now + VISIBLE + Duration::from_millis(1), true));
        assert!(!policy.evaluate(now, true));
    }

    #[test]
    fn missing_device_hides_surface_without_clearing_window() {
        let mut policy = WristVisibilityPolicy::new(VISIBLE);
        let now = Instant::now();
        policy.open(now);
        assert!(!policy.evaluate(now, false));
        assert!(policy.evaluate(now, true));
    }

    #[test]
    fn close_hides_immediately() {
        let mut policy = WristVisibilityPolicy::new(VISIBLE);
        let now = Instant::now();
        policy.open(now);
        policy.close();
        assert!(!policy.evaluate(now, true));
    }
}
