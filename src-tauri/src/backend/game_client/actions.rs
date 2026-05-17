use crate::error::AppError;
use vrcx_0_host::game_launch;
use vrcx_0_host::process_status;

pub trait GameClientActions: Send + Sync {
    fn is_game_running(&self) -> bool;
    fn is_steamvr_running(&self) -> bool;
    fn start_game(&self, arguments: &str) -> Result<bool, AppError>;
    fn start_game_from_path(&self, path: &str, arguments: &str) -> Result<bool, AppError>;
}

#[derive(Default)]
pub struct SystemGameClientActions;

impl GameClientActions for SystemGameClientActions {
    fn is_game_running(&self) -> bool {
        process_status::detect_game_running()
    }

    fn is_steamvr_running(&self) -> bool {
        process_status::detect_steamvr_running()
    }

    fn start_game(&self, arguments: &str) -> Result<bool, AppError> {
        Ok(game_launch::start_game(arguments)?)
    }

    fn start_game_from_path(&self, path: &str, arguments: &str) -> Result<bool, AppError> {
        Ok(game_launch::start_game_from_path(path, arguments)?)
    }
}
