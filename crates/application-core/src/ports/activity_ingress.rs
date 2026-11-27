use vrcx_0_contracts::activity::ActivityEvent;
use vrcx_0_contracts::GameLogSoundKind;

pub trait ActivityIngress: Send + Sync {
    fn ingest_activity(&self, events: Vec<ActivityEvent>);
    fn ingest_game_log_sound(&self, _kind: GameLogSoundKind, _created_at: &str) {}
    fn replace_friend_ids(&self, user_ids: Vec<String>);
    fn update_friend_ids(&self, added: Vec<String>, removed: Vec<String>);
    fn set_current_instance(&self, location: &str, user_ids: Vec<String>);
    fn arm_delivery(&self);
}
