#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct GameProcessEvent {
    pub is_game_running: bool,
    pub is_steamvr_running: bool,
    pub game_changed: bool,
}
