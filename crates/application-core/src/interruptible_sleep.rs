use std::time::Duration;

// `total` is the caller's poll interval; the wait is split into fixed STEP
// chunks so a stop signal interrupts it instead of blocking a joining caller.
// `keep_waiting` intentionally mirrors the caller's outer loop condition so an
// in-flight wait bails early — that duplication is the point, not redundancy.
pub fn sleep_interruptibly(total: Duration, mut keep_waiting: impl FnMut() -> bool) {
    const STEP: Duration = Duration::from_millis(50);
    let mut remaining = total;
    while remaining > Duration::ZERO && keep_waiting() {
        let nap = remaining.min(STEP);
        std::thread::sleep(nap);
        remaining -= nap;
    }
}
