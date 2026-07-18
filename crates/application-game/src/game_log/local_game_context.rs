use std::sync::{Arc, Mutex};

use crate::{
    HostSessionRuntime, LocalGameContextSnapshot, LocalGameContextSource, RuntimeSnapshot,
};

pub struct GameLogLocalGameContextSource {
    session: HostSessionRuntime,
    snapshot: Arc<Mutex<RuntimeSnapshot>>,
}

impl GameLogLocalGameContextSource {
    pub fn new(session: HostSessionRuntime, snapshot: Arc<Mutex<RuntimeSnapshot>>) -> Self {
        Self { session, snapshot }
    }
}

impl LocalGameContextSource for GameLogLocalGameContextSource {
    fn snapshot(&self) -> LocalGameContextSnapshot {
        let game_log = self
            .snapshot
            .lock()
            .map(|snapshot| snapshot.clone())
            .unwrap_or_default();
        LocalGameContextSnapshot::Available {
            is_game_running: self.session.snapshot().is_game_running,
            location: game_log.location,
            destination: game_log.destination,
            world_name: game_log.world_name,
            player_user_ids: game_log
                .players
                .into_iter()
                .map(|player| player.user_id.trim().to_string())
                .filter(|user_id| !user_id.is_empty())
                .collect(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::PlayerState;
    use vrcx_0_application_core::HostSessionGameProcessStatus;

    #[test]
    fn maps_session_and_game_log_state_to_local_game_context() {
        let session = HostSessionRuntime::new();
        session.apply_game_process_status(HostSessionGameProcessStatus {
            is_game_running: true,
            is_steamvr_running: false,
            changed_at: "2026-07-17T00:00:00.000Z".into(),
        });
        let snapshot = Arc::new(Mutex::new(RuntimeSnapshot {
            location: "wrld_test:123".into(),
            destination: "wrld_next:456".into(),
            world_name: "Test World".into(),
            players: vec![
                PlayerState {
                    user_id: " usr_friend ".into(),
                    display_name: "Friend".into(),
                    join_time_ms: Some(1),
                },
                PlayerState {
                    user_id: " ".into(),
                    display_name: "Unknown".into(),
                    join_time_ms: None,
                },
            ],
            ..RuntimeSnapshot::default()
        }));
        let source = GameLogLocalGameContextSource::new(session, snapshot);

        assert_eq!(
            source.snapshot(),
            LocalGameContextSnapshot::Available {
                is_game_running: true,
                location: "wrld_test:123".into(),
                destination: "wrld_next:456".into(),
                world_name: "Test World".into(),
                player_user_ids: vec!["usr_friend".into()],
            }
        );
    }
}
