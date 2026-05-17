use std::sync::Arc;

pub use vrcx_0_core::log_watcher::{GameLogEvent, GameLogEventKind, ParsedLogEntry};

pub trait GameLogEventSink: Send + Sync {
    fn ingest_game_log_event(&self, event: &GameLogEvent) -> crate::Result<()>;

    fn ingest_game_log_events(&self, events: &[GameLogEvent]) -> crate::Result<()> {
        for event in events {
            self.ingest_game_log_event(event)?;
        }
        Ok(())
    }
}

pub trait LogWatcherCompatEventSink: Send + Sync {
    fn emit_compat_event(&self, event: &str, payload: &str);
}

pub type LogWatcherCompatEventSinkHandle = Arc<dyn LogWatcherCompatEventSink>;
