use serde::Serialize;

use vrcx_0_application::auth::AuthenticatedRuntimePhaseSnapshot;
use vrcx_0_application_core::BackendRuntimeSnapshot;
use vrcx_0_application_realtime::FriendLocationTime;

use super::{AuthenticatedSessionProjection, RuntimeHostState};

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct BackendRuntimeCombinedSnapshot {
    pub backend_runtime: BackendRuntimeSnapshot,
    pub authenticated_runtime_phase: AuthenticatedRuntimePhaseSnapshot,
    pub authenticated_session: AuthenticatedSessionProjection,
    pub friend_location_times: Vec<FriendLocationTime>,
}

impl RuntimeHostState {
    pub fn backend_runtime_combined_snapshot(&self) -> BackendRuntimeCombinedSnapshot {
        BackendRuntimeCombinedSnapshot {
            backend_runtime: self.snapshot_backend_runtime(),
            authenticated_runtime_phase: self.authenticated_runtime.snapshot(),
            authenticated_session: self.authenticated_session_projection(),
            friend_location_times: self.runtime_context.instance_dwell.snapshot(),
        }
    }
}
