use crate::error::AppError;

pub(crate) async fn run_blocking<T, E>(
    label: &'static str,
    task: impl FnOnce() -> Result<T, E> + Send + 'static,
) -> Result<T, AppError>
where
    T: Send + 'static,
    E: Into<AppError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| AppError::Custom(format!("{label} task: {error}")))?
        .map_err(Into::into)
}
