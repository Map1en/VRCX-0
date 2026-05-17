#![allow(non_snake_case)]

use std::path::PathBuf;

use tauri::AppHandle;

use crate::error::AppError;
use vrcx_0_host::calendar;

#[tauri::command]
pub fn app__open_calendar_file(ics_content: String) -> Result<(), AppError> {
    Ok(calendar::open_calendar_file(&ics_content)?)
}

#[tauri::command]
pub async fn app__save_calendar_file(
    app_handle: AppHandle,
    default_name: String,
    ics_content: String,
) -> Result<String, AppError> {
    use tauri_plugin_dialog::DialogExt;

    calendar::validate_calendar_content(&ics_content)?;

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

            calendar::write_calendar_file(&path, &ics_content)?;
            Ok(path.to_string_lossy().to_string())
        }
        None => Ok(String::new()),
    }
}
