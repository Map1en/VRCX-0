use std::sync::{Arc, Mutex};

use chrono::{DateTime, Utc};
use vrcx_0_application_core::vrchat_api::{
    classify_api_response, ApiResponseClass, VrchatApiRequest, VrchatApiResponse, VrchatScope,
};
use vrcx_0_application_core::Result;
use vrcx_0_application_realtime::RealtimeHostRuntime;
use vrcx_0_contracts::feed_live::FeedLiveEntry;
pub use vrcx_0_contracts::profile_bio::{
    ProfileBioObservation, ProfileBioRecord, PROFILE_BIO_SCAN_INTERVAL, PROFILE_BIO_SCAN_MIN_AGE,
    PROFILE_BIO_SCAN_PAUSE,
};
use vrcx_0_contracts::vrchat_api::VrchatJsonResponse;
use vrcx_0_core::time::iso_millis;
use vrcx_0_core::OwnerId;

use crate::remote::VrchatRequestPort;

#[cfg(test)]
mod tests;

pub const PROFILE_BIO_SCAN_CONFIG_KEY: &str = "profileBioScanEnabled";

pub trait ProfileBioStore: Send + Sync {
    fn last_seen(&self, owner: &OwnerId, user_id: &str) -> Result<Option<ProfileBioRecord>>;
    fn record(&self, owner: &OwnerId, user_id: &str, record: &ProfileBioRecord) -> Result<()>;
    fn mark_checked(&self, owner: &OwnerId, user_id: &str, checked_at: &str) -> Result<()>;
    fn next_stale_friend(&self, owner: &OwnerId, checked_before: &str) -> Result<Option<String>>;
    fn observe_self_bio(&self, owner: &OwnerId, bio: &str, observed_at: &str) -> Result<()>;
}

pub trait ProfileBioRemoteRequests: Send + Sync {
    fn profile(&self, endpoint: String, user_id: String) -> Result<VrchatApiRequest>;
}

fn observation_from_response(response: &VrchatApiResponse) -> Option<ProfileBioObservation> {
    if classify_api_response(response.status).class != ApiResponseClass::Ok {
        return None;
    }
    ProfileBioObservation::from_profile(&VrchatJsonResponse::from(response).json)
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ProfileBioOutcome {
    Baseline,
    Unchanged,
    Changed,
    Deferred,
}

pub fn observe_profile_bio(
    store: &dyn ProfileBioStore,
    realtime: &Arc<RealtimeHostRuntime>,
    owner: &OwnerId,
    observation: &ProfileBioObservation,
    now: &str,
) -> Result<ProfileBioOutcome> {
    let record = ProfileBioRecord {
        bio: observation.bio.clone(),
        bio_links: observation.bio_links.clone(),
        checked_at: now.to_string(),
    };
    let Some(last) = store.last_seen(owner, &observation.user_id)? else {
        store.record(owner, &observation.user_id, &record)?;
        return Ok(ProfileBioOutcome::Baseline);
    };
    if last.bio == observation.bio {
        store.record(owner, &observation.user_id, &record)?;
        return Ok(ProfileBioOutcome::Unchanged);
    }
    let display_name = if observation.display_name.is_empty() {
        realtime
            .current_friend_record(&observation.user_id)
            .map(|friend| friend.record.display_name.to_string())
            .unwrap_or_default()
    } else {
        observation.display_name.clone()
    };
    let published = realtime.publish_friend_feed_entry(
        owner,
        FeedLiveEntry::Bio {
            created_at: now.to_string(),
            user_id: observation.user_id.clone(),
            display_name,
            bio: observation.bio.clone(),
            previous_bio: last.bio,
            owner_user_id: String::new(),
        },
    );
    if !published {
        return Ok(ProfileBioOutcome::Deferred);
    }
    store.record(owner, &observation.user_id, &record)?;
    Ok(ProfileBioOutcome::Changed)
}

pub fn observe_profile_response(
    store: &dyn ProfileBioStore,
    realtime: &Arc<RealtimeHostRuntime>,
    owner: &OwnerId,
    response: &VrchatApiResponse,
    now: &str,
) -> Result<Option<ProfileBioOutcome>> {
    let Some(observation) = observation_from_response(response) else {
        return Ok(None);
    };
    if observation.user_id == owner.as_str() {
        store.observe_self_bio(owner, &observation.bio, now)?;
        return Ok(None);
    }
    if !realtime.is_current_friend(&observation.user_id) {
        return Ok(None);
    }
    observe_profile_bio(store, realtime, owner, &observation, now).map(Some)
}

#[derive(Default)]
pub struct ProfileBioScanPacer {
    paused_until: Mutex<Option<DateTime<Utc>>>,
}

impl ProfileBioScanPacer {
    pub fn is_paused(&self, now: DateTime<Utc>) -> bool {
        self.paused_until
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .is_some_and(|until| now < until)
    }

    pub fn pause(&self, now: DateTime<Utc>) {
        *self
            .paused_until
            .lock()
            .unwrap_or_else(|error| error.into_inner()) = Some(now + PROFILE_BIO_SCAN_PAUSE);
    }
}

pub struct ProfileBioScanDeps<'a> {
    pub store: &'a dyn ProfileBioStore,
    pub remote_requests: &'a dyn ProfileBioRemoteRequests,
    pub remote: &'a dyn VrchatRequestPort,
    pub realtime: &'a Arc<RealtimeHostRuntime>,
    pub pacer: &'a ProfileBioScanPacer,
    pub owner: OwnerId,
    pub endpoint: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ProfileBioScanOutcome {
    Paused,
    Idle,
    Checked {
        user_id: String,
        outcome: ProfileBioOutcome,
    },
    Throttled {
        status: i32,
    },
    Unavailable {
        user_id: String,
        status: i32,
    },
}

pub async fn scan_next_profile_bio(
    deps: &ProfileBioScanDeps<'_>,
    now: DateTime<Utc>,
) -> Result<ProfileBioScanOutcome> {
    if deps.pacer.is_paused(now) {
        return Ok(ProfileBioScanOutcome::Paused);
    }
    let checked_before = iso_millis(now - PROFILE_BIO_SCAN_MIN_AGE);
    let Some(user_id) = deps.store.next_stale_friend(&deps.owner, &checked_before)? else {
        deps.pacer.pause(now);
        return Ok(ProfileBioScanOutcome::Idle);
    };
    let request = deps
        .remote_requests
        .profile(deps.endpoint.clone(), user_id.clone())?;
    let response = deps.remote.send(request, VrchatScope::Vrchat).await?;
    let now_iso = iso_millis(now);
    let observation = match classify_api_response(response.status).class {
        ApiResponseClass::Ok => observation_from_response(&response),
        ApiResponseClass::ClientError => None,
        ApiResponseClass::Auth
        | ApiResponseClass::RateLimited
        | ApiResponseClass::ServerError
        | ApiResponseClass::Unknown => {
            deps.pacer.pause(now);
            return Ok(ProfileBioScanOutcome::Throttled {
                status: response.status,
            });
        }
    };
    let Some(observation) = observation else {
        deps.store.mark_checked(&deps.owner, &user_id, &now_iso)?;
        return Ok(ProfileBioScanOutcome::Unavailable {
            user_id,
            status: response.status,
        });
    };
    let outcome = observe_profile_bio(
        deps.store,
        deps.realtime,
        &deps.owner,
        &observation,
        &now_iso,
    )?;
    Ok(ProfileBioScanOutcome::Checked { user_id, outcome })
}
