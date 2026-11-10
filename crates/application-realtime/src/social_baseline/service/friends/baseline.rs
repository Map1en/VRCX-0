use std::collections::{HashMap, HashSet};
use vrcx_0_core::derived_keys;

use serde_json::Value;
use vrcx_0_application_core::{ConfigStore, Error, Result};
use vrcx_0_contracts::feed_live::FeedLiveEntry;
use vrcx_0_contracts::friend_log::{FriendLogCurrentEntryInput, FriendLogReplaceOptionsInput};
use vrcx_0_contracts::realtime::{FriendLogDelete, FriendLogUpsert, RealtimePersistenceBatch};
use vrcx_0_core::friends::{FriendBaselineEntry, FriendRecord, StateBucket};
use vrcx_0_core::trust::{trust_level_changed, trust_level_differs};

use crate::realtime::friends::{display_name_feed_entry, trust_level_feed_entry};

use super::super::{
    auth_scope_matches, execute_vrchat_json_request, fetch_friend_statuses_concurrent,
    normalize_text, object_field_string, refetch_users_concurrent, stale_friend_output,
    value_as_string, FriendBaselineSyncOutcome, Ordering, SocialBaselineDeps,
    SocialFriendRosterBaselineInput, SocialFriendRosterBaselineOutput,
};
use super::current_user_snapshot::CurrentUserSnapshotView;
use super::entry::{build_fast_roster_records, infer_state_from_platform};
use super::profile::{fetch_all_friends, insert_fetched_friend, RemoteFriendProfile};
use vrcx_0_core::OwnerId;

#[derive(Clone, Debug, Default)]
pub struct FriendStatusVerdicts(HashMap<String, bool>);

impl FriendStatusVerdicts {
    fn confirms_friend(&self, user_id: &str) -> bool {
        self.0.get(user_id) == Some(&true)
    }

    fn confirms_unfriend(&self, user_id: &str) -> bool {
        self.0.get(user_id) == Some(&false)
    }
}

impl From<HashMap<String, bool>> for FriendStatusVerdicts {
    fn from(verdicts: HashMap<String, bool>) -> Self {
        Self(verdicts)
    }
}

pub(crate) async fn verify_friend_log_relationship_changes(
    deps: &SocialBaselineDeps,
    endpoint: &str,
    user_id: &str,
    friends_by_id: &HashMap<String, FriendBaselineEntry>,
) -> FriendStatusVerdicts {
    let candidates = friend_log_relationship_candidates(
        deps.friend_log.as_ref(),
        deps.config.as_ref(),
        user_id,
        friends_by_id,
    );
    if candidates.is_empty() {
        return FriendStatusVerdicts::default();
    }
    fetch_friend_statuses_concurrent(deps, endpoint, candidates)
        .await
        .into()
}

pub(crate) fn friend_log_relationship_candidates(
    friend_log: &dyn crate::FriendLogStore,
    config: &dyn ConfigStore,
    user_id: &str,
    friends_by_id: &HashMap<String, FriendBaselineEntry>,
) -> Vec<String> {
    if !config
        .get_bool(&format!("friendLogInit_{user_id}"), false)
        .unwrap_or(false)
    {
        return Vec::new();
    }
    let existing = match friend_log.friend_log_current_list(user_id) {
        Ok(rows) => rows,
        Err(error) => {
            tracing::warn!("friend-log relationship candidate read failed: {error}");
            return Vec::new();
        }
    };
    let existing_ids: HashSet<&str> = existing.iter().map(|row| row.user_id.as_str()).collect();
    let additions = friends_by_id
        .iter()
        .filter(|(friend_id, entry)| {
            friend_id.as_str() != user_id
                && !entry.record.is_placeholder()
                && !existing_ids.contains(friend_id.as_str())
        })
        .map(|(friend_id, _)| friend_id.clone());
    let removals = existing
        .iter()
        .filter(|row| row.user_id != user_id && !friends_by_id.contains_key(&row.user_id))
        .map(|row| row.user_id.clone());
    additions.chain(removals).collect()
}

pub(crate) fn persisted_friend_numbers(
    friend_log: &dyn crate::FriendLogStore,
    config: &dyn ConfigStore,
    user_id: &str,
) -> Option<HashMap<String, i64>> {
    if !config
        .get_bool(&format!("friendLogInit_{user_id}"), false)
        .unwrap_or(false)
    {
        return None;
    }
    match friend_log.friend_log_current_list(user_id) {
        Ok(rows) => Some(
            rows.into_iter()
                .map(|row| (row.user_id, row.friend_number))
                .collect(),
        ),
        Err(error) => {
            tracing::warn!("friend number read failed: {error}");
            None
        }
    }
}

pub(super) fn collect_suspicious_friend_ids(
    expected_ids: &[String],
    state_by_id: &HashMap<String, StateBucket>,
    fetched_friends_by_id: &HashMap<String, RemoteFriendProfile>,
) -> Vec<String> {
    let mut suspicious = Vec::new();
    for friend_id in expected_ids {
        let Some(profile) = fetched_friends_by_id.get(friend_id) else {
            continue;
        };
        let list_state = state_by_id
            .get(friend_id)
            .copied()
            .unwrap_or(StateBucket::Offline);
        let inferred = infer_state_from_platform(&object_field_string(&profile.raw, &["platform"]));
        let location = object_field_string(&profile.raw, &["location"]);
        if inferred != list_state || location == "traveling" {
            suspicious.push(friend_id.clone());
        }
    }
    suspicious
}

pub(crate) async fn build_friend_roster_baseline(
    deps: SocialBaselineDeps,
    input: SocialFriendRosterBaselineInput,
) -> Result<BuiltFriendRosterBaseline> {
    let cached_current_user =
        CurrentUserSnapshotView::from_raw(input.current_user_snapshot.as_value());
    let user_id = normalize_text(if input.user_id.is_empty() {
        cached_current_user.user_id.clone()
    } else {
        input.user_id.clone()
    });
    if user_id.is_empty() {
        return Err(Error::Custom(
            "SocialFriendRosterBaselineGet requires an authenticated user id.".into(),
        ));
    }
    if !auth_scope_matches(&deps, &user_id, &input.endpoint) {
        return Ok(BuiltFriendRosterBaseline {
            output: stale_friend_output(user_id, String::new()),
            friends_by_id: None,
        });
    }

    let current_user = execute_vrchat_json_request(
        &deps,
        deps.remote_requests.current_user(input.endpoint.clone())?,
    )
    .await
    .ok()
    .filter(|value| !object_field_string(value, &["id"]).is_empty())
    .map(|value| CurrentUserSnapshotView::from_raw(&value))
    .unwrap_or(cached_current_user);

    let CurrentUserSnapshotView {
        mut state_by_id,
        state_order_ids,
        has_friend_list,
        ..
    } = current_user;
    if !has_friend_list {
        return Ok(BuiltFriendRosterBaseline {
            output: stale_friend_output(user_id, "Current user friend list is incomplete.".into()),
            friends_by_id: None,
        });
    }
    let expected_ids = state_order_ids;

    let online_friends = fetch_all_friends(&deps, &input.endpoint, false).await?;
    let offline_friends = fetch_all_friends(&deps, &input.endpoint, true).await?;
    let mut fetched_friends_by_id = collect_fetched_friends(online_friends, offline_friends);

    if !auth_scope_matches(&deps, &user_id, &input.endpoint) {
        return Ok(BuiltFriendRosterBaseline {
            output: stale_friend_output(user_id, String::new()),
            friends_by_id: None,
        });
    }

    let mut refetch_ids =
        collect_suspicious_friend_ids(&expected_ids, &state_by_id, &fetched_friends_by_id);
    if input.is_first_load {
        for friend_id in &expected_ids {
            if !fetched_friends_by_id.contains_key(friend_id) {
                refetch_ids.push(friend_id.clone());
            }
        }
    }
    if !refetch_ids.is_empty() {
        let repaired = refetch_users_concurrent(&deps, &input.endpoint, refetch_ids).await;
        for (repaired_id, user) in repaired {
            let repaired_bucket = StateBucket::normalize(&object_field_string(&user, &["state"]));
            let Some(mut profile) = RemoteFriendProfile::from_raw(user, None) else {
                continue;
            };
            profile.source_state_bucket = fetched_friends_by_id
                .get(&repaired_id)
                .and_then(|existing| existing.source_state_bucket);
            fetched_friends_by_id.insert(repaired_id.clone(), profile);
            if let Some(bucket) = repaired_bucket {
                state_by_id.insert(repaired_id, bucket);
            }
        }
    }

    let friends_by_id =
        build_fast_roster_records(&expected_ids, &state_by_id, fetched_friends_by_id);
    let count = friends_by_id.len();
    let friends_by_id = serde_json::from_value(Value::Object(friends_by_id))?;

    let output = SocialFriendRosterBaselineOutput {
        user_id,
        stale: false,
        count: u32::try_from(count).unwrap_or(u32::MAX),
        detail: String::new(),
        snapshot: None,
        friend_log_changed: false,
    };
    Ok(BuiltFriendRosterBaseline {
        output,
        friends_by_id: Some(friends_by_id),
    })
}

fn collect_fetched_friends(
    online_friends: Vec<Value>,
    offline_friends: Vec<Value>,
) -> HashMap<String, RemoteFriendProfile> {
    let mut fetched_friends_by_id: HashMap<String, RemoteFriendProfile> = HashMap::new();
    let mut fetched_friend_ids_ordered = Vec::new();
    let mut fetched_friend_ids_seen = HashSet::new();
    // Fetched `state` is unreliable and must never overwrite the /auth/user list bucket.
    for (friends, bucket) in [
        (online_friends, StateBucket::Online),
        (offline_friends, StateBucket::Offline),
    ] {
        for friend in friends {
            insert_fetched_friend(
                &mut fetched_friends_by_id,
                &mut fetched_friend_ids_ordered,
                &mut fetched_friend_ids_seen,
                friend,
                Some(bucket),
            );
        }
    }
    fetched_friends_by_id
}

pub(crate) fn friend_baseline_from_raw(
    current_user: &Value,
    online_friends: Vec<Value>,
    offline_friends: Vec<Value>,
) -> Result<Option<HashMap<String, FriendBaselineEntry>>> {
    let CurrentUserSnapshotView {
        state_by_id,
        state_order_ids,
        has_friend_list,
        ..
    } = CurrentUserSnapshotView::from_raw(current_user);
    if !has_friend_list {
        return Ok(None);
    }
    let fetched_friends_by_id = collect_fetched_friends(online_friends, offline_friends);
    let friends_by_id =
        build_fast_roster_records(&state_order_ids, &state_by_id, fetched_friends_by_id);
    Ok(Some(serde_json::from_value(Value::Object(friends_by_id))?))
}

pub(crate) struct BuiltFriendRosterBaseline {
    pub(crate) output: SocialFriendRosterBaselineOutput,
    pub(crate) friends_by_id: Option<HashMap<String, FriendBaselineEntry>>,
}

pub(crate) fn apply_friend_roster_baseline_sync_outcome(
    output: &mut SocialFriendRosterBaselineOutput,
    outcome: FriendBaselineSyncOutcome,
) -> Option<HashMap<String, FriendRecord>> {
    let FriendBaselineSyncOutcome {
        result,
        snapshot,
        friend_log_changed,
    } = outcome;
    let Some(snapshot) = snapshot.filter(|_| result.accepted) else {
        output.stale = true;
        output.snapshot = None;
        output.friend_log_changed = false;
        output.detail = "Superseded friend roster baseline.".into();
        return None;
    };
    output.count = u32::try_from(snapshot.friends_by_id.len()).unwrap_or(u32::MAX);
    output.snapshot = Some(snapshot.to_roster_snapshot());
    output.friend_log_changed = friend_log_changed;
    Some(snapshot.friends_by_id)
}

#[derive(Default)]
pub(crate) struct FriendRosterReconcileOutcome {
    pub(crate) changed: bool,
    pub(crate) feed_entries: Vec<FeedLiveEntry>,
}

fn init_friend_roster_records(
    friend_log: &dyn crate::FriendLogStore,
    config: &dyn ConfigStore,
    user_id: &str,
    friends_by_id: &HashMap<String, FriendRecord>,
    roster_order: Option<&[String]>,
) -> FriendRosterReconcileOutcome {
    let mut ordered_friend_ids: Vec<&String> = friends_by_id
        .keys()
        .filter(|friend_id| friend_id.as_str() != user_id)
        .collect();
    match roster_order {
        Some(order) => {
            let position: HashMap<&str, usize> = order
                .iter()
                .enumerate()
                .map(|(index, friend_id)| (friend_id.as_str(), index))
                .collect();
            ordered_friend_ids.sort_by(|left, right| {
                match (position.get(left.as_str()), position.get(right.as_str())) {
                    (Some(left_position), Some(right_position)) => {
                        left_position.cmp(right_position)
                    }
                    (Some(_), None) => Ordering::Less,
                    (None, Some(_)) => Ordering::Greater,
                    (None, None) => left.cmp(right),
                }
            });
        }
        None => ordered_friend_ids.sort(),
    }

    let entries: Vec<FriendLogCurrentEntryInput> = ordered_friend_ids
        .into_iter()
        .enumerate()
        .map(|(index, friend_id)| {
            let entry = &friends_by_id[friend_id];
            let trust_level = if entry.is_placeholder() {
                String::new()
            } else {
                entry
                    .extra
                    .get(derived_keys::TRUST_LEVEL)
                    .or_else(|| entry.extra.get("trustLevel"))
                    .map(value_as_string)
                    .unwrap_or_default()
            };
            FriendLogCurrentEntryInput {
                user_id: friend_id.clone(),
                display_name: entry.display_name.to_string(),
                trust_level: Some(trust_level),
                friend_number: Value::from((index + 1) as i64),
            }
        })
        .collect();

    match friend_log.friend_log_replace_current(
        user_id,
        entries,
        FriendLogReplaceOptionsInput::default(),
    ) {
        Ok(_) => {
            if let Err(error) = config.set_bool(&format!("friendLogInit_{user_id}"), true) {
                tracing::warn!("friend-log first-time init flag write failed: {error}");
            }
            FriendRosterReconcileOutcome {
                changed: true,
                feed_entries: Vec::new(),
            }
        }
        Err(error) => {
            tracing::warn!("friend-log first-time initialization failed: {error}");
            FriendRosterReconcileOutcome::default()
        }
    }
}

pub(crate) fn reconcile_friend_roster_records(
    stores: &crate::RealtimeStores,
    config: &dyn ConfigStore,
    user_id: &str,
    friends_by_id: &HashMap<String, FriendRecord>,
    roster_order: Option<&[String]>,
    feed_persistence_disabled: bool,
    verdicts: &FriendStatusVerdicts,
) -> FriendRosterReconcileOutcome {
    let initialized = config
        .get_bool(&format!("friendLogInit_{user_id}"), false)
        .unwrap_or(false);
    if !initialized {
        return init_friend_roster_records(
            stores.friend_log.as_ref(),
            config,
            user_id,
            friends_by_id,
            roster_order,
        );
    }

    let existing = match stores.friend_log.friend_log_current_list(user_id) {
        Ok(rows) => rows,
        Err(error) => {
            tracing::warn!("friend-log reconciliation read failed: {error}");
            return FriendRosterReconcileOutcome::default();
        }
    };

    let existing_by_id = existing
        .iter()
        .map(|row| (row.user_id.as_str(), row))
        .collect::<HashMap<_, _>>();
    let expected_set: HashSet<&str> = friends_by_id.keys().map(String::as_str).collect();

    let created_at = chrono::Utc::now().to_rfc3339();
    let mut batch = RealtimePersistenceBatch::default();

    for (friend_id, entry) in friends_by_id {
        if friend_id == user_id {
            continue;
        }
        if entry.is_placeholder() {
            continue;
        }
        let trust_level = entry
            .extra
            .get(derived_keys::TRUST_LEVEL)
            .or_else(|| entry.extra.get("trustLevel"))
            .map(value_as_string)
            .unwrap_or_default();
        let existing_row = existing_by_id.get(friend_id.as_str()).copied();
        if existing_row.is_none() && !verdicts.confirms_friend(friend_id) {
            continue;
        }
        let next_name = entry.display_name.trim();
        let meaningful_name = !next_name.is_empty() && next_name != "Unknown";
        let name_changed =
            existing_row.is_some_and(|row| meaningful_name && next_name != row.display_name.trim());
        let trust_needs_update = existing_row.is_some_and(|row| {
            trust_level_differs(&row.trust_level, &trust_level)
                || (row.trust_level.trim().is_empty() && !trust_level.trim().is_empty())
        });
        if existing_row.is_some() && !name_changed && !trust_needs_update {
            continue;
        }
        let display_name = if meaningful_name {
            entry.display_name.to_string()
        } else {
            existing_row
                .map(|row| row.display_name.clone())
                .unwrap_or_default()
        };
        let friend_number = existing_row.map(|row| row.friend_number).unwrap_or(0);
        batch.friend_log_upserts.push(FriendLogUpsert {
            target_user_id: friend_id.clone(),
            display_name: display_name.clone(),
            trust_level: trust_level.clone(),
            friend_number,
            created_at: created_at.clone(),
            force_history: false,
        });
        if let Some(previous_display_name) = existing_row
            .map(|row| row.display_name.trim())
            .filter(|name| name_changed && !name.is_empty() && *name != "Unknown")
        {
            batch.feed_entries.push(display_name_feed_entry(
                &created_at,
                friend_id,
                &display_name,
                previous_display_name,
                friend_number,
            ));
        }
        if existing_row.is_some_and(|row| trust_level_changed(&row.trust_level, &trust_level)) {
            let previous_trust_level = existing_row
                .map(|row| row.trust_level.clone())
                .unwrap_or_default();
            batch.feed_entries.push(trust_level_feed_entry(
                &created_at,
                friend_id,
                &display_name,
                &trust_level,
                &previous_trust_level,
                friend_number,
            ));
        }
    }

    for row in &existing {
        if row.user_id == user_id
            || expected_set.contains(row.user_id.as_str())
            || !verdicts.confirms_unfriend(&row.user_id)
        {
            continue;
        }
        batch.friend_log_deletes.push(FriendLogDelete {
            target_user_id: row.user_id.clone(),
            created_at: created_at.clone(),
        });
    }

    if batch.friend_log_upserts.is_empty() && batch.friend_log_deletes.is_empty() {
        return FriendRosterReconcileOutcome::default();
    }

    if feed_persistence_disabled {
        let feed_entries = std::mem::take(&mut batch.feed_entries);
        return match stores
            .batch_writer
            .write_realtime_batch(&OwnerId::new(user_id), &batch)
        {
            Ok(counts) => FriendRosterReconcileOutcome {
                changed: counts.affected_count > 0,
                feed_entries,
            },
            Err(error) => {
                tracing::warn!("friend-log reconciliation write failed: {error}");
                FriendRosterReconcileOutcome {
                    feed_entries,
                    ..FriendRosterReconcileOutcome::default()
                }
            }
        };
    }
    match stores
        .batch_writer
        .write_realtime_batch(&OwnerId::new(user_id), &batch)
    {
        Ok(counts) => FriendRosterReconcileOutcome {
            changed: counts.affected_count > 0,
            feed_entries: batch.feed_entries,
        },
        Err(error) => {
            tracing::warn!("friend-log reconciliation write failed: {error}");
            FriendRosterReconcileOutcome::default()
        }
    }
}
