use crate::error::AppError;

pub use vrcx_0_core::log_watcher::{GameLogEvent, GameLogEventKind, ParsedLogEntry};

pub trait GameLogEventSink: Send + Sync {
    fn ingest_game_log_event(&self, event: &GameLogEvent) -> Result<(), AppError>;

    fn ingest_game_log_events(&self, events: &[GameLogEvent]) -> Result<(), AppError> {
        for event in events {
            self.ingest_game_log_event(event)?;
        }
        Ok(())
    }
}
