use std::sync::Arc;

use vrcx_0_application::social::observe_profile_response;
use vrcx_0_application_core::RuntimeAuthScope;
use vrcx_0_application_realtime::RealtimeHostRuntime;
use vrcx_0_contracts::vrchat_api::VrchatResponse;
use vrcx_0_core::time::now_iso;
use vrcx_0_core::OwnerId;
use vrcx_0_outbound_adapters::LocalProfileBioStore;
use vrcx_0_persistence::DatabaseService;

#[derive(Clone)]
pub struct ProfileBioObserver {
    store: LocalProfileBioStore,
    realtime: Arc<RealtimeHostRuntime>,
    auth_scope: RuntimeAuthScope,
}

impl ProfileBioObserver {
    pub fn new(
        db: Arc<DatabaseService>,
        realtime: Arc<RealtimeHostRuntime>,
        auth_scope: RuntimeAuthScope,
    ) -> Self {
        Self {
            store: LocalProfileBioStore::new(db),
            realtime,
            auth_scope,
        }
    }

    pub fn observe(&self, response: &VrchatResponse) {
        let owner = OwnerId::new(self.auth_scope.snapshot().current_user_id);
        if let Err(error) =
            observe_profile_response(&self.store, &self.realtime, &owner, response, &now_iso())
        {
            tracing::warn!(error = %error, "failed to observe a profile bio");
        }
    }
}
