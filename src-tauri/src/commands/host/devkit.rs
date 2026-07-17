#![allow(non_snake_case)]

use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

#[tauri::command]
#[specta::specta]
pub fn app__devkit_read_file(
    state: State<'_, AppState>,
    file_path: String,
) -> Result<String, AppError> {
    #[cfg(not(feature = "devkit"))]
    {
        let _ = state;
        let _ = file_path;
        Err(AppError::Custom(
            "Dev kit tools are unavailable in this build.".into(),
        ))
    }

    #[cfg(feature = "devkit")]
    {
        state
            .host_file_access
            .ensure_read_allowed(&file_path, &state.paths)?;
        Ok(std::fs::read_to_string(&file_path)?)
    }
}

#[tauri::command]
#[specta::specta]
pub fn app__devkit_panic(message: Option<String>) -> Result<(), AppError> {
    #[cfg(not(feature = "devkit"))]
    {
        let _ = message;
        Err(AppError::Custom(
            "Dev kit tools are unavailable in this build.".into(),
        ))
    }

    #[cfg(feature = "devkit")]
    {
        panic!(
            "{}",
            message.as_deref().unwrap_or("manually triggered panic")
        )
    }
}
