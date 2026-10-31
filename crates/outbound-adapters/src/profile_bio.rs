use std::sync::Arc;

use vrcx_0_application::social::{ProfileBioRemoteRequests, ProfileBioStore};
use vrcx_0_application_core::vrchat_api::VrchatApiRequest;
use vrcx_0_application_core::Result;
use vrcx_0_contracts::profile_bio::ProfileBioRecord;
use vrcx_0_core::OwnerId;
use vrcx_0_persistence::profile_bio;
use vrcx_0_persistence::realtime::{
    self, RealtimePersistenceBatch, SelfProfileField, SelfProfileObservation,
};
use vrcx_0_persistence::DatabaseService;
use vrcx_0_vrchat_client::users::profile_get_input;

#[derive(Clone)]
pub struct LocalProfileBioStore {
    db: Arc<DatabaseService>,
}

impl LocalProfileBioStore {
    pub fn new(db: Arc<DatabaseService>) -> Self {
        Self { db }
    }
}

impl ProfileBioStore for LocalProfileBioStore {
    fn last_seen(&self, owner: &OwnerId, user_id: &str) -> Result<Option<ProfileBioRecord>> {
        profile_bio::profile_bio_get(&self.db, owner, user_id).map_err(crate::Error::from)
    }

    fn record(&self, owner: &OwnerId, user_id: &str, record: &ProfileBioRecord) -> Result<()> {
        profile_bio::profile_bio_upsert(&self.db, owner, user_id, record)
            .map_err(crate::Error::from)
    }

    fn mark_checked(&self, owner: &OwnerId, user_id: &str, checked_at: &str) -> Result<()> {
        profile_bio::profile_bio_mark_checked(&self.db, owner, user_id, checked_at)
            .map_err(crate::Error::from)
    }

    fn next_stale_friend(&self, owner: &OwnerId, checked_before: &str) -> Result<Option<String>> {
        profile_bio::profile_bio_next_stale_friend(&self.db, owner, checked_before)
            .map_err(crate::Error::from)
    }

    fn observe_self_bio(&self, owner: &OwnerId, bio: &str, observed_at: &str) -> Result<()> {
        realtime::write_realtime_batch(
            &self.db,
            owner,
            &RealtimePersistenceBatch {
                self_profile_observations: vec![SelfProfileObservation {
                    observed_at: observed_at.to_string(),
                    field: SelfProfileField::Bio,
                    value: bio.to_string(),
                }],
                ..RealtimePersistenceBatch::default()
            },
        )
        .map(|_| ())
        .map_err(crate::Error::from)
    }
}

pub struct VrchatProfileBioRemoteRequests;

impl ProfileBioRemoteRequests for VrchatProfileBioRemoteRequests {
    fn profile(&self, endpoint: String, user_id: String) -> Result<VrchatApiRequest> {
        Ok(profile_get_input(endpoint, user_id, false)?.1)
    }
}
