mod queue;
mod sink;
mod watcher;

pub use sink::{GameLogEventOrigin, GameLogEventSink};
pub use vrcx_0_core::game_log_parser::LogLocationSnapshot;
pub use watcher::{LogLocationSnapshotScanner, LogWatcher, NoopLogLocationSnapshotScanner};

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct GameLogScanCursor {
    pub file_name: String,
    pub start_position: u64,
    pub file_created_at: Option<u64>,
    pub(crate) context: crate::game_log_parser::LogContext,
    pub cutoff: String,
    pub rebuild: bool,
}

impl GameLogScanCursor {
    pub fn authenticated_user(&self) -> Option<&crate::GameLogAuthenticatedUser> {
        self.context.authenticated_user.as_ref()
    }
}

#[cfg(test)]
mod tests;
