#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub enum LocalGameContextSnapshot {
    #[default]
    Unavailable,
    Available {
        is_game_running: bool,
        location: String,
        destination: String,
        world_name: String,
        player_user_ids: Vec<String>,
    },
}

pub trait LocalGameContextSource: Send + Sync {
    fn snapshot(&self) -> LocalGameContextSnapshot;
}

#[derive(Default)]
pub struct UnavailableLocalGameContextSource;

impl LocalGameContextSource for UnavailableLocalGameContextSource {
    fn snapshot(&self) -> LocalGameContextSnapshot {
        LocalGameContextSnapshot::Unavailable
    }
}
