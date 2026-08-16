use tokio::runtime::{Handle, RuntimeFlavor};

pub(crate) fn run_blocking_db<T>(f: impl FnOnce() -> T) -> T {
    match Handle::try_current() {
        Ok(handle) if handle.runtime_flavor() == RuntimeFlavor::MultiThread => {
            tokio::task::block_in_place(f)
        }
        _ => f(),
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;

    use super::*;

    #[tokio::test]
    async fn runs_inline_on_the_current_thread_runtime() {
        assert_eq!(run_blocking_db(|| 7), 7);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 1)]
    async fn runs_via_block_in_place_on_the_multi_thread_runtime() {
        assert_eq!(run_blocking_db(|| 7), 7);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 1)]
    async fn another_task_runs_while_the_blocking_call_is_still_in_progress() {
        let progressed = Arc::new(AtomicBool::new(false));
        let flag = Arc::clone(&progressed);

        let blocking = tokio::spawn(async move {
            run_blocking_db(|| {
                for _ in 0..200 {
                    if progressed.load(Ordering::SeqCst) {
                        return true;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(5));
                }
                false
            })
        });
        tokio::spawn(async move {
            flag.store(true, Ordering::SeqCst);
        });

        assert!(
            blocking.await.unwrap(),
            "the other task never ran while the worker was blocked, so the \
             runtime was not handed off"
        );
    }
}
