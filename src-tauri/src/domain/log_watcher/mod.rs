use std::sync::Arc;

use tauri::{AppHandle, Emitter};

pub use vrcx_0_runtime::log_watcher::{
    GameLogEvent, GameLogEventSink, LogLocationSnapshot, LogWatcher, LogWatcherCompatEventSink,
    LogWatcherCompatEventSinkHandle,
};

struct TauriLogWatcherCompatEventSink {
    app_handle: AppHandle,
}

impl LogWatcherCompatEventSink for TauriLogWatcherCompatEventSink {
    fn emit_compat_event(&self, event: &str, payload: &str) {
        let _ = self.app_handle.emit(event, payload);
    }
}

pub fn tauri_compat_event_sink(app_handle: AppHandle) -> LogWatcherCompatEventSinkHandle {
    Arc::new(TauriLogWatcherCompatEventSink { app_handle })
}
