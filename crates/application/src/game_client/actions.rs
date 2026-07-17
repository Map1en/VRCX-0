use crate::Result;

pub trait GameClientActions: Send + Sync {
    fn is_game_running(&self) -> bool;
    fn is_steamvr_running(&self) -> bool;
    fn start_game(&self, arguments: &str) -> Result<bool>;
    fn start_game_from_path(&self, path: &str, arguments: &str) -> Result<bool>;
}

pub trait GameClientDebugLoggingActions: Send + Sync {
    fn read_debug_logging_enabled(&self) -> Result<Option<bool>>;
    fn enable_debug_logging(&self) -> Result<bool>;
}
