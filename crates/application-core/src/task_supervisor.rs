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

pub type TaskJoinFuture<'a> = Pin<Box<dyn Future<Output = bool> + Send + 'a>>;

pub type TaskBlockOn = for<'a> fn(TaskJoinFuture<'a>) -> Option<bool>;

pub struct TokioTaskHandle {
    handle: tokio::task::JoinHandle<()>,
    block_on: TaskBlockOn,
}

impl TokioTaskHandle {
    pub fn new(handle: tokio::task::JoinHandle<()>, block_on: TaskBlockOn) -> Self {
        Self { handle, block_on }
    }
}

impl RuntimeTaskHandle for TokioTaskHandle {
    fn abort(&self) {
        self.handle.abort();
    }

    fn is_finished(&self) -> bool {
        self.handle.is_finished()
    }

    fn join_or_abort(&mut self, timeout: Duration) {
        let block_on = self.block_on;
        let handle = &mut self.handle;
        if handle.is_finished() {
            block_on(Box::pin(async move {
                let _ = handle.await;
                true
            }));
            return;
        }

        let joined = block_on(Box::pin(async {
            tokio::time::timeout(timeout, &mut *handle).await.is_ok()
        }));
        if joined == Some(true) {
            return;
        }

        handle.abort();
        if joined.is_some() {
            block_on(Box::pin(async {
                let _ = tokio::time::timeout(Duration::from_millis(50), &mut *handle).await;
                true
            }));
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TaskSpawnOutcome {
    Scheduled,
    Rejected,
    Failed,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct TaskStopReport {
    pub completed_async_tasks: usize,
    pub aborted_async_tasks: usize,
    pub completed_threads: usize,
    pub pending_threads: usize,
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

struct TaskSupervisorInner {
    lifecycle: Mutex<TaskSupervisorLifecycle>,
    executor: Mutex<Option<Arc<dyn RuntimeTaskExecutor>>>,
    task_handles: Mutex<Vec<Box<dyn RuntimeTaskHandle>>>,
    fallback_threads: Mutex<Vec<std::thread::JoinHandle<()>>>,
    stop_tokens: Mutex<Vec<Arc<AtomicBool>>>,
}

struct TaskSupervisorLifecycle {
    accepting_tasks: bool,
}

impl Default for TaskSupervisorInner {
    fn default() -> Self {
        Self {
            lifecycle: Mutex::new(TaskSupervisorLifecycle {
                accepting_tasks: true,
            }),
            executor: Mutex::default(),
            task_handles: Mutex::default(),
            fallback_threads: Mutex::default(),
            stop_tokens: Mutex::default(),
        }
    }
}

#[derive(Clone, Default)]
pub struct TaskSupervisor {
    inner: Arc<TaskSupervisorInner>,
}

impl TaskSupervisor {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_executor(executor: Arc<dyn RuntimeTaskExecutor>) -> Self {
        Self {
            inner: Arc::new(TaskSupervisorInner {
                executor: Mutex::new(Some(executor)),
                ..TaskSupervisorInner::default()
            }),
        }
    }

    pub fn set_executor<E>(&self, executor: E)
    where
        E: RuntimeTaskExecutor + 'static,
    {
        match self.inner.executor.lock() {
            Ok(mut current) => {
                *current = Some(Arc::new(executor));
            }
            Err(error) => tracing::warn!("failed to lock runtime task executor: {error}"),
        }
    }

    pub fn has_executor(&self) -> bool {
        match self.inner.executor.lock() {
            Ok(executor) => executor.is_some(),
            Err(error) => {
                tracing::warn!("failed to lock runtime task executor: {error}");
                false
            }
        }
    }

    pub fn spawn<F>(&self, task: F) -> TaskSpawnOutcome
    where
        F: Future<Output = ()> + Send + 'static,
    {
        self.spawn_task(Box::pin(task), None)
    }

    fn spawn_task(
        &self,
        task: RuntimeTask,
        stop_requested: Option<Arc<AtomicBool>>,
    ) -> TaskSpawnOutcome {
        self.spawn_task_factory(|| task, stop_requested)
    }

    fn spawn_task_factory(
        &self,
        make_task: impl FnOnce() -> RuntimeTask,
        stop_requested: Option<Arc<AtomicBool>>,
    ) -> TaskSpawnOutcome {
        self.join_finished_task_handles();
        self.join_finished_fallback_tasks();

        let lifecycle = match self.inner.lifecycle.lock() {
            Ok(lifecycle) => lifecycle,
            Err(error) => {
                tracing::warn!("failed to lock runtime task lifecycle: {error}");
                return TaskSpawnOutcome::Failed;
            }
        };
        if !lifecycle.accepting_tasks {
            return TaskSpawnOutcome::Rejected;
        }
        let task = make_task();

        let executor = match self.inner.executor.lock() {
            Ok(executor) => executor.clone(),
            Err(error) => {
                tracing::warn!("failed to lock runtime task executor: {error}");
                None
            }
        };
        if let Some(executor) = executor {
            let handle = executor.spawn(task);
            match self.inner.task_handles.lock() {
                Ok(mut handles) => {
                    handles.retain(|handle| !handle.is_finished());
                    handles.push(handle);
                }
                Err(error) => {
                    tracing::warn!("failed to track runtime task handle: {error}");
                    handle.abort();
                    return TaskSpawnOutcome::Failed;
                }
            }
            self.track_stop_token(stop_requested);
            return TaskSpawnOutcome::Scheduled;
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
                return TaskSpawnOutcome::Failed;
            }
        };

        match self.inner.fallback_threads.lock() {
            Ok(mut handles) => handles.push(handle),
            Err(error) => {
                tracing::warn!("failed to track runtime task fallback thread: {error}");
                return TaskSpawnOutcome::Failed;
            }
        }
        self.track_stop_token(stop_requested);
        TaskSpawnOutcome::Scheduled
    }

    pub fn spawn_cancellable<F, Fut>(&self, task: F) -> TaskSpawnOutcome
    where
        F: FnOnce(TaskStopToken) -> Fut + Send + 'static,
        Fut: Future<Output = ()> + Send + 'static,
    {
        let stop_requested = Arc::new(AtomicBool::new(false));
        let stop_requested_for_task = Arc::clone(&stop_requested);
        self.spawn_task_factory(
            move || {
                Box::pin(task(TaskStopToken {
                    stop_requested: stop_requested_for_task,
                }))
            },
            Some(stop_requested),
        )
    }

    pub fn spawn_cancellable_thread<F>(&self, name: impl Into<String>, task: F) -> TaskSpawnOutcome
    where
        F: FnOnce(TaskStopToken) + Send + 'static,
    {
        let stop_requested = Arc::new(AtomicBool::new(false));
        let stop_requested_for_task = Arc::clone(&stop_requested);
        self.spawn_managed_thread(
            name.into(),
            move || {
                task(TaskStopToken {
                    stop_requested: stop_requested_for_task,
                })
            },
            Some(stop_requested),
        )
    }

    pub fn spawn_thread<F>(&self, name: impl Into<String>, task: F) -> TaskSpawnOutcome
    where
        F: FnOnce() + Send + 'static,
    {
        self.spawn_managed_thread(name.into(), task, None)
    }

    fn spawn_managed_thread<F>(
        &self,
        name: String,
        task: F,
        stop_requested: Option<Arc<AtomicBool>>,
    ) -> TaskSpawnOutcome
    where
        F: FnOnce() + Send + 'static,
    {
        self.join_finished_fallback_tasks();
        let lifecycle = match self.inner.lifecycle.lock() {
            Ok(lifecycle) => lifecycle,
            Err(error) => {
                tracing::warn!("failed to lock runtime task lifecycle: {error}");
                return TaskSpawnOutcome::Failed;
            }
        };
        if !lifecycle.accepting_tasks {
            return TaskSpawnOutcome::Rejected;
        }

        let handle = match std::thread::Builder::new().name(name).spawn(task) {
            Ok(handle) => handle,
            Err(error) => {
                tracing::warn!("failed to spawn runtime managed thread: {error}");
                return TaskSpawnOutcome::Failed;
            }
        };

        match self.inner.fallback_threads.lock() {
            Ok(mut handles) => handles.push(handle),
            Err(error) => {
                tracing::warn!("failed to track runtime managed thread: {error}");
                return TaskSpawnOutcome::Failed;
            }
        }
        self.track_stop_token(stop_requested);
        TaskSpawnOutcome::Scheduled
    }

    pub fn stop_all(&self) -> TaskStopReport {
        const GRACE_PERIOD: Duration = Duration::from_millis(200);
        let deadline = Instant::now() + GRACE_PERIOD;

        let mut lifecycle = match self.inner.lifecycle.lock() {
            Ok(lifecycle) => lifecycle,
            Err(error) => {
                tracing::warn!("failed to lock runtime task lifecycle: {error}");
                return TaskStopReport::default();
            }
        };
        lifecycle.accepting_tasks = false;

        match self.inner.stop_tokens.lock() {
            Ok(tokens) => {
                for token in tokens.iter() {
                    token.store(true, Ordering::Release);
                }
            }
            Err(error) => tracing::warn!("failed to lock runtime task stop tokens: {error}"),
        }
        drop(lifecycle);

        let (completed_async_tasks, aborted_async_tasks) =
            self.finish_or_abort_tracked_tasks(deadline);
        let (completed_threads, pending_threads) = self.join_fallback_threads(deadline);
        TaskStopReport {
            completed_async_tasks,
            aborted_async_tasks,
            completed_threads,
            pending_threads,
        }
    }

    fn track_stop_token(&self, stop_requested: Option<Arc<AtomicBool>>) {
        let Some(stop_requested) = stop_requested else {
            return;
        };
        match self.inner.stop_tokens.lock() {
            Ok(mut tokens) => {
                tokens
                    .retain(|token| Arc::strong_count(token) > 1 && !token.load(Ordering::Acquire));
                tokens.push(stop_requested);
            }
            Err(error) => tracing::warn!("failed to track runtime task stop token: {error}"),
        }
    }

    fn join_finished_task_handles(&self) {
        let Ok(mut handles) = self.inner.task_handles.lock() else {
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

    fn finish_or_abort_tracked_tasks(&self, deadline: Instant) -> (usize, usize) {
        wait_until_deadline(deadline, || match self.inner.task_handles.lock() {
            Ok(handles) => handles.iter().all(|handle| handle.is_finished()),
            Err(error) => {
                tracing::warn!("failed to inspect runtime task handles: {error}");
                true
            }
        });

        let Ok(mut handles) = self.inner.task_handles.lock() else {
            return (0, 0);
        };
        let mut completed = 0;
        let mut aborted = 0;
        for mut handle in handles.drain(..) {
            if handle.is_finished() {
                handle.join_or_abort(Duration::ZERO);
                completed += 1;
            } else {
                handle.abort();
                aborted += 1;
            }
        }
        (completed, aborted)
    }

    pub fn join_finished_fallback_tasks(&self) {
        let Ok(mut handles) = self.inner.fallback_threads.lock() else {
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

    fn join_fallback_threads(&self, deadline: Instant) -> (usize, usize) {
        wait_until_deadline(deadline, || match self.inner.fallback_threads.lock() {
            Ok(handles) => handles.iter().all(std::thread::JoinHandle::is_finished),
            Err(error) => {
                tracing::warn!("failed to inspect runtime fallback threads: {error}");
                true
            }
        });

        let Ok(mut handles) = self.inner.fallback_threads.lock() else {
            return (0, 0);
        };
        let mut completed = 0;
        let mut pending = Vec::new();
        for handle in handles.drain(..) {
            if handle.is_finished() {
                if let Err(error) = handle.join() {
                    tracing::warn!("runtime fallback thread panicked: {error:?}");
                }
                completed += 1;
            } else {
                tracing::warn!("runtime fallback thread did not stop before timeout");
                pending.push(handle);
            }
        }
        let pending_count = pending.len();
        *handles = pending;
        (completed, pending_count)
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

        assert_eq!(supervisor.spawn(async {}), TaskSpawnOutcome::Scheduled);
        let report = supervisor.stop_all();

        assert!(!joined.load(Ordering::Acquire));
        assert!(aborted.load(Ordering::Acquire));
        assert_eq!(report.completed_async_tasks, 0);
        assert_eq!(report.aborted_async_tasks, 1);
        assert_eq!(report.completed_threads, 0);
        assert_eq!(report.pending_threads, 0);
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
        let report = supervisor.stop_all();

        assert!(stopped.load(Ordering::Acquire));
        assert!(supervisor.inner.fallback_threads.lock().unwrap().is_empty());
        assert_eq!(report.completed_threads, 1);
        assert_eq!(report.pending_threads, 0);
    }

    #[test]
    fn stop_all_rejects_tasks_registered_after_shutdown_started() {
        let supervisor = TaskSupervisor::new();
        let cancellable_factory_called = Arc::new(AtomicBool::new(false));

        let report = supervisor.stop_all();

        assert_eq!(report, TaskStopReport::default());
        assert_eq!(
            supervisor.spawn(async { panic!("rejected task must not run") }),
            TaskSpawnOutcome::Rejected
        );
        assert_eq!(
            supervisor.spawn_thread("rejected-thread", || {
                panic!("rejected thread must not run");
            }),
            TaskSpawnOutcome::Rejected
        );
        let cancellable_factory_called_for_task = Arc::clone(&cancellable_factory_called);
        assert_eq!(
            supervisor.spawn_cancellable(move |_| {
                cancellable_factory_called_for_task.store(true, Ordering::Release);
                async { panic!("rejected cancellable task must not run") }
            }),
            TaskSpawnOutcome::Rejected
        );
        assert!(!cancellable_factory_called.load(Ordering::Acquire));
    }

    fn block_on_current_runtime(future: TaskJoinFuture<'_>) -> Option<bool> {
        let handle = tokio::runtime::Handle::try_current().ok()?;
        Some(tokio::task::block_in_place(|| handle.block_on(future)))
    }

    fn cannot_block(_future: TaskJoinFuture<'_>) -> Option<bool> {
        None
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn tokio_handle_waits_for_a_task_that_finishes_in_time() {
        let finished = Arc::new(AtomicBool::new(false));
        let finished_in_task = Arc::clone(&finished);
        let mut handle = TokioTaskHandle::new(
            tokio::spawn(async move {
                tokio::time::sleep(Duration::from_millis(20)).await;
                finished_in_task.store(true, Ordering::Release);
            }),
            block_on_current_runtime,
        );

        handle.join_or_abort(Duration::from_secs(5));

        assert!(finished.load(Ordering::Acquire));
        assert!(handle.is_finished());
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn tokio_handle_aborts_a_task_that_outlives_the_timeout() {
        let mut handle = TokioTaskHandle::new(
            tokio::spawn(tokio::time::sleep(Duration::from_secs(60))),
            block_on_current_runtime,
        );

        handle.join_or_abort(Duration::from_millis(20));

        assert!(handle.is_finished());
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn tokio_handle_aborts_when_the_host_cannot_block() {
        let mut handle = TokioTaskHandle::new(
            tokio::spawn(tokio::time::sleep(Duration::from_secs(60))),
            cannot_block,
        );

        handle.join_or_abort(Duration::from_secs(5));
        tokio::time::sleep(Duration::from_millis(20)).await;

        assert!(handle.is_finished());
    }
}
