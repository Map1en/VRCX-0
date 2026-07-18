use std::sync::Arc;
use std::time::Duration;

use serde_json::Value;
use vrcx_0_application_core::LocalGameContextSource;

use crate::{GroupOrderSource, RuntimeHostState};

pub type RuntimeHostCallback = Arc<dyn Fn() + Send + Sync>;
pub type RuntimeHostSnapshotCallback = Arc<dyn Fn(&Value) + Send + Sync>;

pub trait RuntimeHostProfileExtension: Send + Sync {
    fn observe_runtime_event(&self, _event: &str, _payload: &Value) {}

    fn start_profile_services(&self, _state: &RuntimeHostState) {}

    fn stop_profile_services(&self) {}

    fn start_profile_maintenance(&self, _state: &RuntimeHostState) {}

    fn clear_profile_session(&self) {}

    fn profile_session_scope_changed(&self) {
        self.clear_profile_session();
    }

    fn wait_for_profile_maintenance_stopped(&self, _timeout: Duration) -> bool {
        true
    }
}

pub struct RuntimeHostComposition {
    pub local_game_context: Arc<dyn LocalGameContextSource>,
    pub group_order_source: Arc<dyn GroupOrderSource>,
    pub friend_note_change_sink: Option<RuntimeHostCallback>,
    pub favorites_sink: Option<RuntimeHostSnapshotCallback>,
    pub profile_extension: Option<Arc<dyn RuntimeHostProfileExtension>>,
}
