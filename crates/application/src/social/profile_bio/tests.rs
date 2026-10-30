use std::collections::HashMap;
use std::sync::Mutex;

use chrono::{DateTime, Utc};
use serde_json::json;
use vrcx_0_application_core::vrchat_api::{VrchatApiRequest, VrchatApiResponse, VrchatScope};
use vrcx_0_application_core::{CallRecorder, Result, ScriptedResults};
use vrcx_0_application_realtime::test_support::{
    feed_lookup_input, runtime_with_active_session, seed_friend_baseline, TestDir,
    TestRealtimeHostRuntime,
};
use vrcx_0_contracts::feed::{FeedFilter, FeedRowOutput, FeedRowsQueryInput};
use vrcx_0_core::OwnerId;

use crate::remote::{VrchatRequestFuture, VrchatRequestPort};

use super::*;

#[derive(Default)]
struct MemoryProfileBioStore {
    records: Mutex<HashMap<(String, String), ProfileBioRecord>>,
    candidates: Mutex<Vec<String>>,
    self_bios: Mutex<Vec<(String, String, String)>>,
}

impl ProfileBioStore for MemoryProfileBioStore {
    fn last_seen(&self, owner: &OwnerId, user_id: &str) -> Result<Option<ProfileBioRecord>> {
        Ok(self
            .records
            .lock()
            .unwrap()
            .get(&(owner.as_str().to_string(), user_id.to_string()))
            .cloned())
    }

    fn record(&self, owner: &OwnerId, user_id: &str, record: &ProfileBioRecord) -> Result<()> {
        self.records.lock().unwrap().insert(
            (owner.as_str().to_string(), user_id.to_string()),
            record.clone(),
        );
        Ok(())
    }

    fn mark_checked(&self, owner: &OwnerId, user_id: &str, checked_at: &str) -> Result<()> {
        self.records
            .lock()
            .unwrap()
            .entry((owner.as_str().to_string(), user_id.to_string()))
            .or_default()
            .checked_at = checked_at.to_string();
        Ok(())
    }

    fn next_stale_friend(&self, _owner: &OwnerId, _checked_before: &str) -> Result<Option<String>> {
        Ok(self.candidates.lock().unwrap().first().cloned())
    }

    fn observe_self_bio(&self, owner: &OwnerId, bio: &str, observed_at: &str) -> Result<()> {
        self.self_bios.lock().unwrap().push((
            owner.as_str().to_string(),
            bio.to_string(),
            observed_at.to_string(),
        ));
        Ok(())
    }
}

struct ProfileRequests;

impl ProfileBioRemoteRequests for ProfileRequests {
    fn profile(&self, endpoint: String, user_id: String) -> Result<VrchatApiRequest> {
        Ok(VrchatApiRequest {
            path: Some(format!("{endpoint} profile/{user_id}")),
            ..VrchatApiRequest::default()
        })
    }
}

struct ScriptedRequestPort {
    responses: ScriptedResults<VrchatApiResponse>,
    requests: CallRecorder<String>,
}

impl VrchatRequestPort for ScriptedRequestPort {
    fn send(&self, input: VrchatApiRequest, _scope: VrchatScope) -> VrchatRequestFuture<'_> {
        self.requests.record(input.path.unwrap_or_default());
        let response = self.responses.next();
        Box::pin(async move { Ok(response) })
    }
}

fn response(status: i32, body: serde_json::Value) -> VrchatApiResponse {
    VrchatApiResponse {
        status,
        data: body.to_string(),
    }
}

fn profile_response(user_id: &str, bio: &str) -> VrchatApiResponse {
    response(
        200,
        json!({ "id": user_id, "displayName": "Friend", "bio": bio }),
    )
}

fn observation(bio: &str) -> ProfileBioObservation {
    ProfileBioObservation {
        user_id: "usr_friend".into(),
        display_name: "Friend".into(),
        bio: bio.into(),
        bio_links: Vec::new(),
    }
}

fn runtime_with_friend(name: &str) -> Result<(TestDir, TestRealtimeHostRuntime, OwnerId)> {
    let (dir, runtime, session) = runtime_with_active_session(name)?;
    seed_friend_baseline(&runtime, &session);
    Ok((dir, runtime, OwnerId::new(session.user_id)))
}

fn bio_rows(runtime: &TestRealtimeHostRuntime, owner: &OwnerId) -> Vec<FeedRowOutput> {
    runtime
        .store()
        .feed_rows(FeedRowsQueryInput {
            filters: vec![FeedFilter::Bio],
            ..feed_lookup_input(owner.as_str().into())
        })
        .unwrap()
}

#[test]
fn observation_parses_profiles_and_rejects_payloads_without_a_bio() {
    assert_eq!(
        ProfileBioObservation::from_profile(
            &json!({ "id": " usr_friend ", "displayName": "Friend", "bio": " hello " })
        ),
        Some(observation("hello"))
    );
    assert_eq!(
        ProfileBioObservation::from_profile(&json!({ "id": "usr_friend", "bio": "" })),
        Some(ProfileBioObservation {
            user_id: "usr_friend".into(),
            display_name: String::new(),
            bio: String::new(),
            bio_links: Vec::new(),
        })
    );
    assert_eq!(
        ProfileBioObservation::from_profile(&json!({
            "id": "usr_friend",
            "bio": "hello",
            "bioLinks": [" https://a.example ", "", 3, "https://b.example"]
        }))
        .map(|observation| observation.bio_links),
        Some(vec![
            "https://a.example".to_string(),
            "https://b.example".to_string()
        ])
    );
    assert!(ProfileBioObservation::from_profile(&json!({ "id": "usr_friend" })).is_none());
    assert!(ProfileBioObservation::from_profile(&json!({ "id": "grp_x", "bio": "b" })).is_none());
}

#[test]
fn first_observation_only_records_a_baseline() -> Result<()> {
    let (_dir, runtime, owner) = runtime_with_friend("profile-bio-baseline")?;
    let store = MemoryProfileBioStore::default();

    let outcome = observe_profile_bio(
        &store,
        runtime.runtime(),
        &owner,
        &observation("hello"),
        "2026-09-18T00:00:00.000Z",
    )?;

    assert_eq!(outcome, ProfileBioOutcome::Baseline);
    assert_eq!(
        store.last_seen(&owner, "usr_friend")?,
        Some(ProfileBioRecord {
            bio: "hello".into(),
            bio_links: Vec::new(),
            checked_at: "2026-09-18T00:00:00.000Z".into(),
        })
    );
    assert!(bio_rows(&runtime, &owner).is_empty());
    Ok(())
}

#[test]
fn changed_bio_writes_a_feed_row_and_moves_the_baseline() -> Result<()> {
    let (_dir, runtime, owner) = runtime_with_friend("profile-bio-changed")?;
    let store = MemoryProfileBioStore::default();
    store.record(
        &owner,
        "usr_friend",
        &ProfileBioRecord {
            bio: "old".into(),
            bio_links: Vec::new(),
            checked_at: "2026-09-17T00:00:00.000Z".into(),
        },
    )?;

    let unchanged = observe_profile_bio(
        &store,
        runtime.runtime(),
        &owner,
        &ProfileBioObservation {
            bio_links: vec!["https://a.example".into()],
            ..observation("old")
        },
        "2026-09-18T00:00:00.000Z",
    )?;
    assert_eq!(unchanged, ProfileBioOutcome::Unchanged);
    assert_eq!(
        store.last_seen(&owner, "usr_friend")?,
        Some(ProfileBioRecord {
            bio: "old".into(),
            bio_links: vec!["https://a.example".into()],
            checked_at: "2026-09-18T00:00:00.000Z".into(),
        })
    );
    assert!(bio_rows(&runtime, &owner).is_empty());

    let changed = observe_profile_bio(
        &store,
        runtime.runtime(),
        &owner,
        &ProfileBioObservation {
            display_name: String::new(),
            ..observation("new")
        },
        "2026-09-18T01:00:00.000Z",
    )?;
    assert_eq!(changed, ProfileBioOutcome::Changed);
    let rows = bio_rows(&runtime, &owner);
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].display_name.as_deref(), Some("Friend"));
    assert_eq!(rows[0].bio.as_deref(), Some("new"));
    assert_eq!(rows[0].previous_bio.as_deref(), Some("old"));
    assert_eq!(
        rows[0].created_at.as_deref(),
        Some("2026-09-18T01:00:00.000Z")
    );
    assert_eq!(
        store.last_seen(&owner, "usr_friend")?,
        Some(ProfileBioRecord {
            bio: "new".into(),
            bio_links: Vec::new(),
            checked_at: "2026-09-18T01:00:00.000Z".into(),
        })
    );
    Ok(())
}

#[test]
fn changed_bio_keeps_the_old_baseline_when_the_feed_cannot_be_published() -> Result<()> {
    let (_dir, runtime, _session) = runtime_with_active_session("profile-bio-deferred")?;
    let owner = OwnerId::new("usr_other");
    let store = MemoryProfileBioStore::default();
    let old = ProfileBioRecord {
        bio: "old".into(),
        bio_links: Vec::new(),
        checked_at: "2026-09-17T00:00:00.000Z".into(),
    };
    store.record(&owner, "usr_friend", &old)?;

    let outcome = observe_profile_bio(
        &store,
        runtime.runtime(),
        &owner,
        &observation("new"),
        "2026-09-18T00:00:00.000Z",
    )?;

    assert_eq!(outcome, ProfileBioOutcome::Deferred);
    assert_eq!(store.last_seen(&owner, "usr_friend")?, Some(old));
    Ok(())
}

#[test]
fn profile_responses_are_observed_only_for_current_friends() -> Result<()> {
    let (_dir, runtime, owner) = runtime_with_friend("profile-bio-response")?;
    let store = MemoryProfileBioStore::default();
    let now = "2026-09-18T00:00:00.000Z";
    let observe = |response: &VrchatApiResponse| {
        observe_profile_response(&store, runtime.runtime(), &owner, response, now)
    };

    assert_eq!(
        observe(&profile_response("usr_friend", "hello"))?,
        Some(ProfileBioOutcome::Baseline)
    );
    assert_eq!(observe(&profile_response("usr_stranger", "hello"))?, None);
    assert_eq!(
        observe(&response(401, json!({ "id": "usr_friend", "bio": "x" })))?,
        None
    );
    assert_eq!(store.last_seen(&owner, "usr_stranger")?, None);
    assert_eq!(store.last_seen(&owner, "usr_friend")?.unwrap().bio, "hello");
    Ok(())
}

#[test]
fn own_profile_response_is_observed_against_the_self_bio_baseline() -> Result<()> {
    let (_dir, runtime, owner) = runtime_with_friend("profile-bio-self")?;
    let store = MemoryProfileBioStore::default();
    let now = "2026-09-18T00:00:00.000Z";

    let outcome = observe_profile_response(
        &store,
        runtime.runtime(),
        &owner,
        &profile_response(owner.as_str(), "my bio"),
        now,
    )?;

    assert_eq!(outcome, None);
    assert_eq!(
        store.self_bios.lock().unwrap().clone(),
        vec![(
            owner.as_str().to_string(),
            "my bio".to_string(),
            now.to_string()
        )]
    );
    assert_eq!(store.last_seen(&owner, owner.as_str())?, None);
    assert!(bio_rows(&runtime, &owner).is_empty());
    Ok(())
}

fn at(value: &str) -> DateTime<Utc> {
    value.parse().unwrap()
}

#[tokio::test]
async fn scan_checks_the_next_stale_friend_and_pauses_when_vrchat_pushes_back() -> Result<()> {
    let (_dir, runtime, owner) = runtime_with_friend("profile-bio-scan")?;
    let store = MemoryProfileBioStore::default();
    let remote = ScriptedRequestPort {
        responses: ScriptedResults::new([
            profile_response("usr_friend", "hello"),
            response(429, json!({})),
            response(404, json!({})),
        ]),
        requests: CallRecorder::default(),
    };
    let pacer = ProfileBioScanPacer::default();
    let deps = ProfileBioScanDeps {
        store: &store,
        remote_requests: &ProfileRequests,
        remote: &remote,
        realtime: runtime.runtime(),
        pacer: &pacer,
        owner: owner.clone(),
        endpoint: "https://api.vrchat.cloud/api/1".into(),
    };
    let now = at("2026-09-18T12:00:00Z");

    assert_eq!(
        scan_next_profile_bio(&deps, now).await?,
        ProfileBioScanOutcome::Idle
    );
    assert!(remote.requests.is_empty());
    assert_eq!(
        scan_next_profile_bio(&deps, now + PROFILE_BIO_SCAN_INTERVAL).await?,
        ProfileBioScanOutcome::Paused
    );

    store.candidates.lock().unwrap().push("usr_friend".into());
    let resumed = now + PROFILE_BIO_SCAN_PAUSE;
    assert_eq!(
        scan_next_profile_bio(&deps, resumed).await?,
        ProfileBioScanOutcome::Checked {
            user_id: "usr_friend".into(),
            outcome: ProfileBioOutcome::Baseline,
        }
    );
    assert_eq!(
        remote.requests.snapshot(),
        ["https://api.vrchat.cloud/api/1 profile/usr_friend".to_string()]
    );
    assert_eq!(
        store.last_seen(&owner, "usr_friend")?,
        Some(ProfileBioRecord {
            bio: "hello".into(),
            bio_links: Vec::new(),
            checked_at: iso_millis(resumed),
        })
    );

    assert_eq!(
        scan_next_profile_bio(&deps, resumed).await?,
        ProfileBioScanOutcome::Throttled { status: 429 }
    );
    assert_eq!(
        store.last_seen(&owner, "usr_friend")?.unwrap().checked_at,
        iso_millis(resumed)
    );
    assert!(pacer.is_paused(resumed + PROFILE_BIO_SCAN_INTERVAL));

    let later = resumed + PROFILE_BIO_SCAN_PAUSE;
    assert_eq!(
        scan_next_profile_bio(&deps, later).await?,
        ProfileBioScanOutcome::Unavailable {
            user_id: "usr_friend".into(),
            status: 404,
        }
    );
    assert_eq!(
        store.last_seen(&owner, "usr_friend")?,
        Some(ProfileBioRecord {
            bio: "hello".into(),
            bio_links: Vec::new(),
            checked_at: iso_millis(later),
        })
    );
    assert!(!pacer.is_paused(later + PROFILE_BIO_SCAN_INTERVAL));
    Ok(())
}
