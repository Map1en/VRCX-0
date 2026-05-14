use std::collections::VecDeque;
use std::sync::{Arc, Condvar, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use crate::backend::event_bus::BackendEventBus;
use crate::error::AppError;

const DEFAULT_CAPACITY: usize = 8192;
const DEFAULT_MAX_BATCH: usize = 256;
const DEFAULT_FLUSH_INTERVAL: Duration = Duration::from_millis(50);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[allow(dead_code)]
pub enum OverflowPolicy {
    Backpressure,
    DropOldest,
}

#[derive(Clone, Debug)]
pub struct BackendWorkerOptions {
    pub capacity: usize,
    pub max_batch: usize,
    pub flush_interval: Duration,
    pub overflow_policy: OverflowPolicy,
}

impl Default for BackendWorkerOptions {
    fn default() -> Self {
        Self {
            capacity: DEFAULT_CAPACITY,
            max_batch: DEFAULT_MAX_BATCH,
            flush_interval: DEFAULT_FLUSH_INTERVAL,
            overflow_policy: OverflowPolicy::Backpressure,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct BackendPushReport {
    pub accepted: usize,
    pub dropped: usize,
}

pub trait BackendJobHandler<T>: Send + Sync + 'static {
    fn handle_batch(&self, batch: Vec<T>) -> Result<(), AppError>;
}

impl<T, F> BackendJobHandler<T> for F
where
    F: Fn(Vec<T>) -> Result<(), AppError> + Send + Sync + 'static,
{
    fn handle_batch(&self, batch: Vec<T>) -> Result<(), AppError> {
        self(batch)
    }
}

pub struct BackendWorker<T>
where
    T: Send + 'static,
{
    inner: Arc<WorkerInner<T>>,
    handle: Mutex<Option<JoinHandle<()>>>,
}

struct WorkerInner<T>
where
    T: Send + 'static,
{
    name: String,
    options: BackendWorkerOptions,
    state: Mutex<WorkerState<T>>,
    available: Condvar,
    not_full: Condvar,
    idle: Condvar,
    handler: Arc<dyn BackendJobHandler<T>>,
    event_bus: BackendEventBus,
}

struct WorkerState<T> {
    queue: VecDeque<T>,
    active_batches: usize,
    closed: bool,
}

impl<T> BackendWorker<T>
where
    T: Send + 'static,
{
    pub fn start(
        name: impl Into<String>,
        options: BackendWorkerOptions,
        event_bus: BackendEventBus,
        handler: impl BackendJobHandler<T>,
    ) -> Self {
        let mut options = options;
        options.capacity = options.capacity.max(1);
        options.max_batch = options.max_batch.max(1);

        let inner = Arc::new(WorkerInner {
            name: name.into(),
            options,
            state: Mutex::new(WorkerState {
                queue: VecDeque::new(),
                active_batches: 0,
                closed: false,
            }),
            available: Condvar::new(),
            not_full: Condvar::new(),
            idle: Condvar::new(),
            handler: Arc::new(handler),
            event_bus,
        });
        let thread_inner = Arc::clone(&inner);
        let handle = thread::Builder::new()
            .name(format!("{}-worker", inner.name))
            .spawn(move || worker_loop(thread_inner))
            .expect("failed to spawn backend worker");

        Self {
            inner,
            handle: Mutex::new(Some(handle)),
        }
    }

    pub fn push_batch(
        &self,
        batch: impl IntoIterator<Item = T>,
    ) -> Result<BackendPushReport, AppError> {
        let mut report = BackendPushReport::default();
        let mut state = self.inner.state.lock().map_err(|error| {
            AppError::Custom(format!("{} worker lock: {error}", self.inner.name))
        })?;

        for item in batch {
            while state.queue.len() >= self.inner.options.capacity {
                match self.inner.options.overflow_policy {
                    OverflowPolicy::Backpressure => {
                        if state.closed {
                            return Err(AppError::Custom(format!(
                                "{} worker is stopped",
                                self.inner.name
                            )));
                        }
                        state = self.inner.not_full.wait(state).map_err(|error| {
                            AppError::Custom(format!("{} worker wait: {error}", self.inner.name))
                        })?;
                    }
                    OverflowPolicy::DropOldest => {
                        state.queue.pop_front();
                        report.dropped += 1;
                        break;
                    }
                }
            }

            if state.closed {
                return Err(AppError::Custom(format!(
                    "{} worker is stopped",
                    self.inner.name
                )));
            }
            state.queue.push_back(item);
            report.accepted += 1;
            self.inner.available.notify_one();
        }

        Ok(report)
    }

    #[allow(dead_code)]
    pub fn wait_until_idle(&self, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        let mut state = match self.inner.state.lock() {
            Ok(state) => state,
            Err(_) => return false,
        };

        while !state.queue.is_empty() || state.active_batches > 0 {
            let now = Instant::now();
            if now >= deadline {
                return false;
            }
            let wait_for = deadline.saturating_duration_since(now);
            let Ok((next_state, result)) = self.inner.idle.wait_timeout(state, wait_for) else {
                return false;
            };
            state = next_state;
            if result.timed_out() && (!state.queue.is_empty() || state.active_batches > 0) {
                return false;
            }
        }
        true
    }

    #[allow(dead_code)]
    pub fn stop(&self) {
        {
            let Ok(mut state) = self.inner.state.lock() else {
                return;
            };
            state.closed = true;
            self.inner.available.notify_all();
            self.inner.not_full.notify_all();
        }

        if let Ok(mut handle) = self.handle.lock() {
            if let Some(handle) = handle.take() {
                let _ = handle.join();
            }
        }
    }
}

impl<T> Drop for BackendWorker<T>
where
    T: Send + 'static,
{
    fn drop(&mut self) {
        {
            let Ok(mut state) = self.inner.state.lock() else {
                return;
            };
            state.closed = true;
            self.inner.available.notify_all();
            self.inner.not_full.notify_all();
        }

        if let Ok(mut handle) = self.handle.lock() {
            if let Some(handle) = handle.take() {
                let _ = handle.join();
            }
        }
    }
}

fn worker_loop<T>(inner: Arc<WorkerInner<T>>)
where
    T: Send + 'static,
{
    loop {
        let batch = {
            let mut state = match inner.state.lock() {
                Ok(state) => state,
                Err(error) => {
                    tracing::warn!("{} worker state lock failed: {error}", inner.name);
                    return;
                }
            };

            while state.queue.is_empty() && !state.closed {
                state = match inner.available.wait(state) {
                    Ok(state) => state,
                    Err(error) => {
                        tracing::warn!("{} worker wait failed: {error}", inner.name);
                        return;
                    }
                };
            }

            if state.closed && state.queue.is_empty() {
                inner.idle.notify_all();
                return;
            }

            if !state.closed
                && state.queue.len() < inner.options.max_batch
                && !inner.options.flush_interval.is_zero()
            {
                match inner
                    .available
                    .wait_timeout(state, inner.options.flush_interval)
                {
                    Ok((next_state, _)) => state = next_state,
                    Err(error) => {
                        tracing::warn!("{} worker flush wait failed: {error}", inner.name);
                        return;
                    }
                }
            }

            let take = inner.options.max_batch.min(state.queue.len());
            let batch = state.queue.drain(..take).collect::<Vec<_>>();
            state.active_batches += 1;
            inner.not_full.notify_all();
            batch
        };

        if !batch.is_empty() {
            if let Err(error) = inner.handler.handle_batch(batch) {
                tracing::warn!("{} worker batch failed: {error}", inner.name);
                inner
                    .event_bus
                    .emit_backend_worker_error(&inner.name, &error.to_string());
            }
        }

        if let Ok(mut state) = inner.state.lock() {
            state.active_batches = state.active_batches.saturating_sub(1);
            if state.queue.is_empty() && state.active_batches == 0 {
                inner.idle.notify_all();
            }
            inner.not_full.notify_all();
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    use crate::backend::event_bus::BackendEventBus;
    use crate::error::AppError;

    use super::{BackendWorker, BackendWorkerOptions, OverflowPolicy};

    #[test]
    fn processes_batches_in_order() -> Result<(), AppError> {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let worker_seen = Arc::clone(&seen);
        let worker = BackendWorker::start(
            "test-order",
            BackendWorkerOptions {
                max_batch: 2,
                flush_interval: Duration::from_millis(1),
                ..Default::default()
            },
            BackendEventBus::new(),
            move |batch: Vec<i32>| {
                worker_seen.lock().unwrap().extend(batch);
                Ok(())
            },
        );

        worker.push_batch([1, 2, 3, 4, 5])?;
        assert!(worker.wait_until_idle(Duration::from_secs(2)));
        assert_eq!(*seen.lock().unwrap(), vec![1, 2, 3, 4, 5]);
        worker.stop();
        Ok(())
    }

    #[test]
    fn drop_oldest_keeps_newest_items() -> Result<(), AppError> {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let worker_seen = Arc::clone(&seen);
        let worker = BackendWorker::start(
            "test-drop-oldest",
            BackendWorkerOptions {
                capacity: 3,
                max_batch: 10,
                flush_interval: Duration::from_millis(100),
                overflow_policy: OverflowPolicy::DropOldest,
            },
            BackendEventBus::new(),
            move |batch: Vec<i32>| {
                worker_seen.lock().unwrap().extend(batch);
                Ok(())
            },
        );

        let report = worker.push_batch([1, 2, 3, 4, 5])?;
        assert_eq!(report.accepted, 5);
        assert_eq!(report.dropped, 2);
        assert!(worker.wait_until_idle(Duration::from_secs(2)));
        assert_eq!(*seen.lock().unwrap(), vec![3, 4, 5]);
        worker.stop();
        Ok(())
    }

    #[test]
    fn continues_after_handler_error() -> Result<(), AppError> {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let worker_seen = Arc::clone(&seen);
        let worker = BackendWorker::start(
            "test-error",
            BackendWorkerOptions {
                max_batch: 1,
                flush_interval: Duration::from_millis(1),
                ..Default::default()
            },
            BackendEventBus::new(),
            move |batch: Vec<i32>| {
                let value = batch[0];
                worker_seen.lock().unwrap().push(value);
                if value == 1 {
                    Err(AppError::Custom("expected test error".into()))
                } else {
                    Ok(())
                }
            },
        );

        worker.push_batch([1, 2])?;
        assert!(worker.wait_until_idle(Duration::from_secs(2)));
        assert_eq!(*seen.lock().unwrap(), vec![1, 2]);
        worker.stop();
        Ok(())
    }
}
