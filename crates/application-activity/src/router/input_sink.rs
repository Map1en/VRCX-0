use vrcx_0_application_core::ActivityIngress;
use vrcx_0_contracts::activity::ActivityEvent;
use vrcx_0_contracts::GameLogSoundKind;

use super::ActivityRouter;

impl ActivityIngress for ActivityRouter {
    fn ingest_activity(&self, events: Vec<ActivityEvent>) {
        ActivityRouter::ingest_activity(self, events);
    }

    fn ingest_game_log_sound(&self, kind: GameLogSoundKind, created_at: &str) {
        self.ingest_game_log_sound_event(kind, created_at);
    }

    fn replace_friend_ids(&self, user_ids: Vec<String>) {
        self.set_friend_user_ids(user_ids);
    }

    fn update_friend_ids(&self, added: Vec<String>, removed: Vec<String>) {
        self.update_friend_user_ids(added, removed);
    }

    fn set_current_instance(&self, location: &str, user_ids: Vec<String>) {
        self.set_current_instance_presence(location, user_ids);
    }

    fn arm_delivery(&self) {
        ActivityRouter::arm_delivery(self);
    }
}
