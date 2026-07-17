use std::future::Future;
use std::pin::Pin;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, Instant};

pub type RuntimeTask = Pin<Box<dyn Future<Output = ()> + Send + 'static>>;

pub trait RuntimeTaskHandle: Send {
    fn abort(&self);
    fn is_finished(&self) -> bool;
    fn join_or_abort(&mut self, timeout: Duration);
}

pub trait RuntimeTaskExecutor: Send + Sync {
    fn spawn(&self, task: RuntimeTask) -> Box<dyn RuntimeTaskHandle>;
}

fn wait_until_deadline(deadline: Instant, mut is_finished: impl FnMut() -> bool) {
    loop {
        if is_finished() || Instant::now() >= deadline {
            return;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}

#[derive(Clone)]
pub struct TaskStopToken {
    stop_requested: Arc<AtomicBool>,
}

impl TaskStopToken {
    pub fn is_stop_requested(&self) -> bool {
        self.stop_requested.load(Ordering::Acquire)
    }
}

#[derive(Clone, Default)]
pub struct TaskSupervisor {
    executor: Arc<Mutex<Option<Arc<dyn RuntimeTaskExecutor>>>>,
    task_handles: Arc<Mutex<Vec<Box<dyn RuntimeTaskHandle>>>>,
    fallback_threads: Arc<Mutex<Vec<std::thread::JoinHandle<()>>>>,
    stop_tokens: Arc<Mutex<Vec<Arc<AtomicBool>>>>,
}

impl TaskSupervisor {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set_executor<E>(&self, executor: E)
    where
        E: RuntimeTaskExecutor + 'static,
    {
        match self.executor.lock() {
            Ok(mut current) => {
                *current = Some(Arc::new(executor));
            }
            Err(error) => tracing::warn!("failed to lock runtime task executor: {error}"),
        }
    }

    pub fn has_executor(&self) -> bool {
        match self.executor.lock() {
            Ok(executor) => executor.is_some(),
            Err(error) => {
                tracing::warn!("failed to lock runtime task executor: {error}");
                false
            }
        }
    }

    pub fn spawn<F>(&self, task: F)
    where
        F: Future<Output = ()> + Send + 'static,
    {
        self.join_finished_task_handles();
        self.join_finished_fallback_tasks();

        let executor = match self.executor.lock() {
            Ok(executor) => executor.clone(),
            Err(error) => {
                tracing::warn!("failed to lock runtime task executor: {error}");
                None
            }
        };
        if let Some(executor) = executor {
            let handle = executor.spawn(Box::pin(task));
            match self.task_handles.lock() {
                Ok(mut handles) => {
                    handles.retain(|handle| !handle.is_finished());
                    handles.push(handle);
                }
                Err(error) => tracing::warn!("failed to track runtime task handle: {error}"),
            }
            return;
        }

        let handle = match std::thread::Builder::new()
            .name("runtime-task-fallback".into())
            .spawn(move || {
                match tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                {
                    Ok(runtime) => runtime.block_on(task),
                    Err(error) => tracing::warn!("failed to start runtime task runtime: {error}"),
                }
            }) {
            Ok(handle) => handle,
            Err(error) => {
                tracing::warn!("failed to spawn runtime task fallback thread: {error}");
                return;
            }
        };

        match self.fallback_threads.lock() {
            Ok(mut handles) => handles.push(handle),
            Err(error) => tracing::warn!("failed to track runtime task fallback thread: {error}"),
        }
    }

    pub fn spawn_cancellable<F, Fut>(&self, task: F)
    where
        F: FnOnce(TaskStopToken) -> Fut + Send + 'static,
        Fut: Future<Output = ()> + Send + 'static,
    {
        let stop_requested = Arc::new(AtomicBool::new(false));
        match self.stop_tokens.lock() {
            Ok(mut tokens) => {
                tokens
                    .retain(|token| Arc::strong_count(token) > 1 && !token.load(Ordering::Acquire));
                tokens.push(Arc::clone(&stop_requested));
            }
            Err(error) => tracing::warn!("failed to track runtime task stop token: {error}"),
        }
        self.spawn(task(TaskStopToken { stop_requested }));
    }

    pub fn spawn_cancellable_thread<F>(&self, name: impl Into<String>, task: F)
    where
        F: FnOnce(TaskStopToken) + Send + 'static,
    {
        let stop_requested = Arc::new(AtomicBool::new(false));
        match self.stop_tokens.lock() {
            Ok(mut tokens) => {
                tokens
                    .retain(|token| Arc::strong_count(token) > 1 && !token.load(Ordering::Acquire));
                tokens.push(Arc::clone(&stop_requested));
            }
            Err(error) => tracing::warn!("failed to track runtime thread stop token: {error}"),
        }
        self.spawn_thread(name, move || task(TaskStopToken { stop_requested }));
    }

    pub fn spawn_thread<F>(&self, name: impl Into<String>, task: F)
    where
        F: FnOnce() + Send + 'static,
    {
        self.join_finished_fallback_tasks();
        let handle = match std::thread::Builder::new().name(name.into()).spawn(task) {
            Ok(handle) => handle,
            Err(error) => {
                tracing::warn!("failed to spawn runtime managed thread: {error}");
                return;
            }
        };

        match self.fallback_threads.lock() {
            Ok(mut handles) => handles.push(handle),
            Err(error) => tracing::warn!("failed to track runtime managed thread: {error}"),
        }
    }

    pub fn stop_all(&self) {
        const GRACE_PERIOD: Duration = Duration::from_millis(200);
        let deadline = Instant::now() + GRACE_PERIOD;

        match self.stop_tokens.lock() {
            Ok(tokens) => {
                for token in tokens.iter() {
                    token.store(true, Ordering::Release);
                }
            }
            Err(error) => tracing::warn!("failed to lock runtime task stop tokens: {error}"),
        }
        self.finish_or_abort_tracked_tasks(deadline);
        self.join_fallback_threads(deadline);
    }

    fn join_finished_task_handles(&self) {
        let Ok(mut handles) = self.task_handles.lock() else {
            return;
        };

        let mut pending = Vec::with_capacity(handles.len());
        for mut handle in handles.drain(..) {
            if handle.is_finished() {
                handle.join_or_abort(Duration::ZERO);
            } else {
                pending.push(handle);
            }
        }
        *handles = pending;
    }

    fn finish_or_abort_tracked_tasks(&self, deadline: Instant) {
        wait_until_deadline(deadline, || match self.task_handles.lock() {
            Ok(handles) => handles.iter().all(|handle| handle.is_finished()),
            Err(error) => {
                tracing::warn!("failed to inspect runtime task handles: {error}");
                true
            }
        });

        let Ok(mut handles) = self.task_handles.lock() else {
            return;
        };
        for mut handle in handles.drain(..) {
            if handle.is_finished() {
                handle.join_or_abort(Duration::ZERO);
            } else {
                handle.abort();
            }
        }
    }

    pub fn join_finished_fallback_tasks(&self) {
        let Ok(mut handles) = self.fallback_threads.lock() else {
            return;
        };

        let mut pending = Vec::with_capacity(handles.len());
        for handle in handles.drain(..) {
            if handle.is_finished() {
                if let Err(error) = handle.join() {
                    tracing::warn!("runtime task fallback thread panicked: {error:?}");
                }
            } else {
                pending.push(handle);
            }
        }
        *handles = pending;
    }

    fn join_fallback_threads(&self, deadline: Instant) {
        wait_until_deadline(deadline, || match self.fallback_threads.lock() {
            Ok(handles) => handles.iter().all(std::thread::JoinHandle::is_finished),
            Err(error) => {
                tracing::warn!("failed to inspect runtime fallback threads: {error}");
                true
            }
        });

        let Ok(mut handles) = self.fallback_threads.lock() else {
            return;
        };
        let mut pending = Vec::new();
        for handle in handles.drain(..) {
            if handle.is_finished() {
                if let Err(error) = handle.join() {
                    tracing::warn!("runtime fallback thread panicked: {error:?}");
                }
            } else {
                tracing::warn!("runtime fallback thread did not stop before timeout");
                pending.push(handle);
            }
        }
        *handles = pending;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicBool;

    #[derive(Clone, Default)]
    struct TestExecutor {
        joined: Arc<AtomicBool>,
        aborted: Arc<AtomicBool>,
    }

    struct TestHandle {
        joined: Arc<AtomicBool>,
        aborted: Arc<AtomicBool>,
        finished: bool,
    }

    impl RuntimeTaskExecutor for TestExecutor {
        fn spawn(&self, _task: RuntimeTask) -> Box<dyn RuntimeTaskHandle> {
            Box::new(TestHandle {
                joined: Arc::clone(&self.joined),
                aborted: Arc::clone(&self.aborted),
                finished: false,
            })
        }
    }

    impl RuntimeTaskHandle for TestHandle {
        fn abort(&self) {
            self.aborted.store(true, Ordering::Release);
        }

        fn is_finished(&self) -> bool {
            self.finished
        }

        fn join_or_abort(&mut self, _timeout: Duration) {
            self.joined.store(true, Ordering::Release);
            if !self.finished {
                self.abort();
            }
        }
    }

    #[test]
    fn stop_all_aborts_unfinished_tracked_async_tasks() {
        let supervisor = TaskSupervisor::new();
        let executor = TestExecutor::default();
        let joined = Arc::clone(&executor.joined);
        let aborted = Arc::clone(&executor.aborted);
        supervisor.set_executor(executor);

        supervisor.spawn(async {});
        supervisor.stop_all();

        assert!(!joined.load(Ordering::Acquire));
        assert!(aborted.load(Ordering::Acquire));
    }

    #[test]
    fn stop_all_signals_and_joins_cancellable_threads() {
        let supervisor = TaskSupervisor::new();
        let stopped = Arc::new(AtomicBool::new(false));
        let stopped_for_task = Arc::clone(&stopped);

        supervisor.spawn_cancellable_thread("test-cancellable-thread", move |token| {
            while !token.is_stop_requested() {
                std::thread::sleep(Duration::from_millis(1));
            }
            stopped_for_task.store(true, Ordering::Release);
        });
        supervisor.stop_all();

        assert!(stopped.load(Ordering::Acquire));
        assert!(supervisor.fallback_threads.lock().unwrap().is_empty());
    }
}
