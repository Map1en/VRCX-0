use std::path::Path;

use crate::error::Error;

pub fn open_calendar_file(ics_content: &str) -> Result<(), Error> {
    validate_calendar_content(ics_content)?;

    let temp_dir = std::env::temp_dir().join("VRCX-0");
    std::fs::create_dir_all(&temp_dir)?;
    let ics_path = temp_dir.join("event.ics");
    std::fs::write(&ics_path, ics_content)?;
    open::that(ics_path.to_string_lossy().as_ref())
        .map_err(|e| Error::Custom(format!("open ics: {e}")))?;
    Ok(())
}

pub fn write_calendar_file(path: &Path, ics_content: &str) -> Result<(), Error> {
    validate_calendar_content(ics_content)?;

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    std::fs::write(path, ics_content)?;
    Ok(())
}

pub fn validate_calendar_content(ics_content: &str) -> Result<(), Error> {
    if !ics_content.starts_with("BEGIN:VCALENDAR") {
        return Err(Error::Custom("invalid iCalendar content".into()));
    }
    Ok(())
}
