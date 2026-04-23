#![allow(non_snake_case)]

use std::path::PathBuf;

use tauri::AppHandle;

use crate::error::AppError;

#[tauri::command]
pub fn app__open_calendar_file(ics_content: String) -> Result<(), AppError> {
    if !ics_content.starts_with("BEGIN:VCALENDAR") {
        return Err(AppError::Custom("invalid iCalendar content".into()));
    }

    let temp_dir = std::env::temp_dir().join("VRCX-0");
    std::fs::create_dir_all(&temp_dir)?;
    let ics_path = temp_dir.join("event.ics");
    std::fs::write(&ics_path, &ics_content)?;
    open::that(ics_path.to_string_lossy().as_ref())
        .map_err(|e| AppError::Custom(format!("open ics: {e}")))?;
    Ok(())
}

#[tauri::command]
pub async fn app__save_calendar_file(
    app_handle: AppHandle,
    default_name: String,
    ics_content: String,
) -> Result<String, AppError> {
    use tauri_plugin_dialog::DialogExt;

    if !ics_content.starts_with("BEGIN:VCALENDAR") {
        return Err(AppError::Custom("invalid iCalendar content".into()));
    }

    let file_name = if default_name.trim().is_empty() {
        "group-event.ics"
    } else {
        default_name.trim()
    };
    let result = app_handle
        .dialog()
        .file()
        .set_file_name(file_name)
        .add_filter("iCalendar Files", &["ics"])
        .blocking_save_file();

    match result {
        Some(file_path) => {
            let path = match file_path {
                tauri_plugin_dialog::FilePath::Path(p) => p,
                other => PathBuf::from(other.to_string()),
            };

            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent)?;
            }

            std::fs::write(&path, ics_content)?;
            Ok(path.to_string_lossy().to_string())
        }
        None => Ok(String::new()),
    }
}
