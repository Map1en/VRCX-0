use vrcx_0_core::log_watcher::convert_log_time_to_iso8601;

use super::event::{GameLogEventKind, ParsedLogEntry};
use super::watcher::Inner;

const MAX_COMPAT_LOG_ROWS: usize = 5000;
pub(super) fn append_event(
    inner: &Inner,
    file_name: &str,
    line: &str,
    kind: GameLogEventKind,
    first_run: bool,
) {
    append_entry(
        inner,
        ParsedLogEntry::new(file_name, convert_log_time_to_iso8601(line), kind),
        first_run,
    );
}

fn append_entry(inner: &Inner, entry: ParsedLogEntry, first_run: bool) {
    if inner.event_sink.is_some() {
        inner.event_buffer.lock().unwrap().push(entry.event);
    }

    if !first_run {
        if let Ok(json) = serde_json::to_string(&entry.compat_row) {
            inner.compat_event_buffer.lock().unwrap().push(json);
        }
    }
    let mut log_list = inner.log_list.write().unwrap();
    log_list.push(entry.compat_row);
    if log_list.len() > MAX_COMPAT_LOG_ROWS {
        let overflow = log_list.len() - MAX_COMPAT_LOG_ROWS;
        log_list.drain(..overflow);
    }
}

pub(super) fn flush_game_log_events(inner: &Inner) {
    let Some(event_sink) = &inner.event_sink else {
        return;
    };

    let events = {
        let mut buffer = inner.event_buffer.lock().unwrap();
        if buffer.is_empty() {
            return;
        }
        std::mem::take(&mut *buffer)
    };

    if let Err(error) = event_sink.ingest_game_log_events(&events) {
        tracing::warn!("failed to ingest GameLog event batch in runtime: {error}");
    }
}
