use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex};

pub type BackendTask = Pin<Box<dyn Future<Output = ()> + Send + 'static>>;

pub trait BackendTaskExecutor: Send + Sync {
    fn spawn(&self, task: BackendTask);
}

#[derive(Clone, Default)]
pub struct BackendTasks {
    executor: Arc<Mutex<Option<Arc<dyn BackendTaskExecutor>>>>,
}

impl BackendTasks {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set_executor<E>(&self, executor: E)
    where
        E: BackendTaskExecutor + 'static,
    {
        match self.executor.lock() {
            Ok(mut current) => {
                *current = Some(Arc::new(executor));
            }
            Err(error) => tracing::warn!("failed to lock backend task executor: {error}"),
        }
    }

    pub fn spawn<F>(&self, task: F)
    where
        F: Future<Output = ()> + Send + 'static,
    {
        let executor = match self.executor.lock() {
            Ok(executor) => executor.clone(),
            Err(error) => {
                tracing::warn!("failed to lock backend task executor: {error}");
                None
            }
        };
        if let Some(executor) = executor {
            executor.spawn(Box::pin(task));
            return;
        }

        if let Err(error) = std::thread::Builder::new()
            .name("backend-task-fallback".into())
            .spawn(move || {
                match tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                {
                    Ok(runtime) => runtime.block_on(task),
                    Err(error) => tracing::warn!("failed to start backend task runtime: {error}"),
                }
            })
        {
            tracing::warn!("failed to spawn backend task fallback thread: {error}");
        }
    }
}
