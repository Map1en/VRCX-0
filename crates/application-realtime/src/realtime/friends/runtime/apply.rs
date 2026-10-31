use serde_json::{json, Value};
use vrcx_0_application_core::FriendProjectionPatch;
use vrcx_0_contracts::realtime::FriendLogDelete;
use vrcx_0_core::derived_keys;
use vrcx_0_core::files::extract_file_id;
use vrcx_0_core::friends::FriendRecord;
use vrcx_0_core::presence::PresenceEntry;
use vrcx_0_core::trust::{trust_level_changed, trust_level_differs};
use vrcx_0_core::OwnerId;

use crate::realtime::friends::presence::{
    dwell_place, joining_feed, presence_feed, presence_view, reduce, wake, Claim, Evidence,
    FriendEventKind, Phase, Source,
};
use crate::realtime::{FriendIconChange, FriendWake, RealtimeFriendOutput};

use super::social_feed::{
    add_profile_diff_feed_entries, display_name, display_name_feed_entry, friend_log_upsert,
    friend_relationship_feed_entry, meaningful_name, meaningful_record_name,
    trust_level_feed_entry, FriendRelationshipFeedKind,
};
use super::state::{FriendEntry, RealtimeFriendState};
use crate::realtime::event_time::EventTime;
use vrcx_0_core::json::JsonExt;
use vrcx_0_core::text::first_owned;

mod event_user;
mod profile_merge;

use event_user::{event_user_id, event_user_patch, normalize_patch_trust, strip_presence_keys};
pub(super) use profile_merge::{merge_profile, record_string};

pub(super) fn apply_wake(
    state: &mut RealtimeFriendState,
    user_id: &str,
    now: &EventTime,
) -> Option<RealtimeFriendOutput> {
    let mut output = new_output(state)?;
    let previous = state.entry(user_id)?.clone();
    let step = wake(&previous.presence, now.timestamp_ms);
    if step.next == previous.presence && step.wake_at_ms.is_none() {
        return None;
    }
    output.persistence.feed_entries.extend(presence_feed(
        user_id,
        &previous.record,
        &previous.presence,
        &step.next,
        now.timestamp_ms,
        &now.iso,
    ));
    output.joining.extend(joining_feed(
        user_id,
        &previous.record,
        &previous.presence,
        &step.next,
        &now.iso,
    ));
    if let Some(wake_at_ms) = step.wake_at_ms {
        output.wake = Some(FriendWake::at(user_id, wake_at_ms));
    }
    commit(
        state,
        &mut output,
        user_id,
        FriendEntry {
            record: previous.record,
            presence: step.next,
        },
    );
    Some(output)
}

pub(super) fn apply_friend_event(
    state: &mut RealtimeFriendState,
    event_kind: FriendEventKind,
    content: &Value,
    now: &EventTime,
    source: Source,
) -> Option<RealtimeFriendOutput> {
    let mut output = new_output(state)?;
    match event_kind {
        FriendEventKind::Delete => apply_delete(state, &mut output, content, now)?,
        _ => apply_change(state, &mut output, event_kind, content, now, source)?,
    }
    Some(output)
}

fn new_output(state: &RealtimeFriendState) -> Option<RealtimeFriendOutput> {
    let roster = state.roster.as_ref()?;
    Some(RealtimeFriendOutput::new(
        OwnerId::new(roster.session.user_id.clone()),
        roster.generation,
        roster.baseline_revision,
    ))
}

fn evidence_for(event_kind: FriendEventKind, content: &Value, source: Source) -> Evidence {
    let user = content.get("user").unwrap_or(&Value::Null);
    match source {
        Source::Api | Source::TrustedAdd => Evidence::from_profile(source, user),
        _ => Evidence::from_ws(event_kind, content),
    }
}

fn apply_change(
    state: &mut RealtimeFriendState,
    output: &mut RealtimeFriendOutput,
    event_kind: FriendEventKind,
    content: &Value,
    now: &EventTime,
    source: Source,
) -> Option<()> {
    let user_id = event_user_id(content)?;
    let mut patch = event_user_patch(content, &user_id);
    strip_presence_keys(&mut patch);
    let evidence = evidence_for(event_kind, content, source);
    let previous = state.entry(&user_id).cloned();
    if event_kind == FriendEventKind::Update
        && source == Source::Ws
        && evidence.claim == Claim::Nothing
        && patch.as_object().map_or(0, |object| object.len()) <= 1
    {
        return None;
    }
    normalize_patch_trust(&mut patch, previous.as_ref().map(|entry| &entry.record));
    let Some(previous) = previous else {
        return create_entry(state, output, event_kind, &user_id, &patch, &evidence, now);
    };
    let record = merge_profile(Some(&previous.record), &user_id, &patch);
    let step = reduce(&previous.presence, &evidence, now.timestamp_ms);
    let feeds = presence_feed(
        &user_id,
        &record,
        &previous.presence,
        &step.next,
        now.timestamp_ms,
        &now.iso,
    );
    let joining = joining_feed(&user_id, &record, &previous.presence, &step.next, &now.iso);
    if event_kind != FriendEventKind::Add
        && record == previous.record
        && presence_view(&step.next) == presence_view(&previous.presence)
        && step.wake_at_ms.is_none()
        && !step.refetch
        && feeds.is_empty()
        && joining.is_none()
    {
        if let Some(entry) = state
            .roster
            .as_mut()
            .and_then(|roster| roster.entries.get_mut(&user_id))
        {
            entry.presence = step.next;
        }
        return None;
    }
    record_profile_identity_change(output, &user_id, &patch, &previous.record, now);
    output.persistence.feed_entries.extend(feeds);
    output.joining.extend(joining);
    if event_kind == FriendEventKind::Update && source == Source::Ws {
        add_profile_diff_feed_entries(
            output,
            &user_id,
            &patch,
            &previous.record,
            previous.presence.is_online_section(),
            &now.iso,
        );
        if let Some(change) = friend_icon_change(&user_id, &patch, &previous.record, &now.iso) {
            output.icon_changes.push(change);
        }
    }
    if let Some(wake_at_ms) = step.wake_at_ms {
        output.wake = Some(FriendWake::at(&user_id, wake_at_ms));
    }
    if step.refetch {
        push_profile_refetch_user_id(output, &user_id);
    }
    commit(
        state,
        output,
        &user_id,
        FriendEntry {
            record,
            presence: step.next,
        },
    );
    Some(())
}

fn create_entry(
    state: &mut RealtimeFriendState,
    output: &mut RealtimeFriendOutput,
    event_kind: FriendEventKind,
    user_id: &str,
    patch: &Value,
    evidence: &Evidence,
    now: &EventTime,
) -> Option<()> {
    if event_kind == FriendEventKind::Location && !matches!(evidence.claim, Claim::Online { .. }) {
        return None;
    }
    let presence = Phase::initial(&evidence.claim, now.timestamp_ms, true);
    if event_kind == FriendEventKind::Add {
        output
            .persistence
            .friend_log_upserts
            .push(friend_log_upsert(user_id, patch, None, &now.iso));
        output
            .persistence
            .feed_entries
            .push(friend_relationship_feed_entry(
                FriendRelationshipFeedKind::Friend,
                user_id,
                patch,
                None,
                &now.iso,
            ));
        output.projection.friend_log_changed = true;
    }
    let record = merge_profile(None, user_id, patch);
    output.joining.extend(joining_feed(
        user_id,
        &record,
        &Phase::offline(),
        &presence,
        &now.iso,
    ));
    commit(state, output, user_id, FriendEntry { record, presence });
    Some(())
}

fn apply_delete(
    state: &mut RealtimeFriendState,
    output: &mut RealtimeFriendOutput,
    content: &Value,
    now: &EventTime,
) -> Option<()> {
    let user_id = event_user_id(content)?;
    let removed = state
        .roster
        .as_mut()
        .and_then(|roster| roster.entries.remove(&user_id));
    if removed.is_some() {
        state.invalidate_friend_user_ids_snapshot();
    }
    output.projection.removals.push(user_id.clone());
    output.persistence.friend_log_deletes.push(FriendLogDelete {
        target_user_id: user_id.clone(),
        created_at: now.iso.clone(),
    });
    if let Some(previous) = removed.as_ref() {
        output
            .persistence
            .feed_entries
            .push(friend_relationship_feed_entry(
                FriendRelationshipFeedKind::Unfriend,
                &user_id,
                &json!({ "id": user_id.clone() }),
                Some(&previous.record),
                &now.iso,
            ));
    }
    output.projection.friend_log_changed = true;
    output.projection.location_time_snapshot = state.instance_dwell.forget_friend(&user_id);
    Some(())
}

fn commit(
    state: &mut RealtimeFriendState,
    output: &mut RealtimeFriendOutput,
    user_id: &str,
    entry: FriendEntry,
) {
    if let Some(snapshot) = state
        .instance_dwell
        .observe_friend(user_id, &dwell_place(&entry.presence))
    {
        output.projection.location_time_snapshot = Some(snapshot);
    }
    output.projection.patches.push(FriendProjectionPatch {
        user_id: user_id.to_string(),
        record: entry.record.clone(),
        presence: PresenceEntry {
            rev: 0,
            view: presence_view(&entry.presence),
        },
    });
    let added = state
        .roster
        .as_mut()
        .is_some_and(|roster| roster.entries.insert(user_id.to_string(), entry).is_none());
    if added {
        state.invalidate_friend_user_ids_snapshot();
    }
}

fn friend_icon_change(
    user_id: &str,
    patch: &Value,
    previous: &FriendRecord,
    created_at: &str,
) -> Option<FriendIconChange> {
    let next_icon_url = patch.trimmed_field("iconUrl")?;
    if next_icon_url == previous.icon_url
        || extract_file_id(next_icon_url)? == extract_file_id(&previous.icon_url)?
    {
        return None;
    }
    Some(FriendIconChange {
        user_id: user_id.to_string(),
        display_name: display_name(user_id, patch, Some(previous)),
        previous_icon_url: previous.icon_url.clone(),
        next_icon_url: next_icon_url.to_string(),
        created_at: created_at.to_string(),
    })
}

fn push_profile_refetch_user_id(output: &mut RealtimeFriendOutput, user_id: &str) {
    if output
        .profile_refetch_user_ids
        .iter()
        .any(|existing_id| existing_id == user_id)
    {
        return;
    }
    output.profile_refetch_user_ids.push(user_id.to_string());
}

fn record_profile_identity_change(
    output: &mut RealtimeFriendOutput,
    user_id: &str,
    patch: &Value,
    previous: &FriendRecord,
    now: &EventTime,
) {
    let next_name = meaningful_name(patch, user_id);
    let previous_name = meaningful_record_name(previous, user_id);
    let name_changed = !next_name.is_empty() && next_name != previous_name;
    let previous_trust_level = record_string(previous, derived_keys::TRUST_LEVEL);
    let trust_level = first_owned([
        patch.text_field(derived_keys::TRUST_LEVEL),
        previous_trust_level.clone(),
    ]);
    let trust_differs = trust_level_differs(&previous_trust_level, &trust_level);
    let trust_changed = trust_level_changed(&previous_trust_level, &trust_level);
    if !name_changed && !trust_differs {
        return;
    }
    let upsert = friend_log_upsert(user_id, patch, Some(previous), &now.iso);
    if name_changed && !previous_name.is_empty() {
        output
            .persistence
            .feed_entries
            .push(display_name_feed_entry(
                &now.iso,
                user_id,
                &upsert.display_name,
                &previous_name,
                upsert.friend_number,
            ));
    }
    if trust_changed {
        output.persistence.feed_entries.push(trust_level_feed_entry(
            &now.iso,
            user_id,
            &upsert.display_name,
            &trust_level,
            &previous_trust_level,
            upsert.friend_number,
        ));
    }
    output.persistence.friend_log_upserts.push(upsert);
    output.projection.friend_log_changed = true;
}
