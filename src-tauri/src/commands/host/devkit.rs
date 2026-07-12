#![allow(non_snake_case)]
#![cfg_attr(not(feature = "devkit"), allow(unused_variables, dead_code))]

use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

#[cfg(not(feature = "devkit"))]
macro_rules! devkit_feature {
    ($_:expr) => {
        Err(AppError::Custom(
            "Devkit tools are unavailable in this build.".into(),
        ))
    };
}

#[cfg(feature = "devkit")]
macro_rules! devkit_feature {
    ($code:expr) => {
        $code
    };
}

#[tauri::command]
#[specta::specta]
pub fn app__devkit_read_file(
    state: State<'_, AppState>,
    file_path: String,
) -> Result<String, AppError> {
    devkit_feature!({
        state
            .host_file_access
            .ensure_read_allowed(&file_path, &state.paths)?;
        Ok(std::fs::read_to_string(&file_path)?)
    })
}

#[tauri::command]
#[specta::specta]
pub fn app__devkit_panic(
    state: State<'_, AppState>,
    message: Option<String>,
) -> Result<(), AppError> {
    devkit_feature!({
        panic!(
            "{}",
            message.as_deref().unwrap_or("manually triggered panic")
        )
    })
}
