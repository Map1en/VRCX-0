use super::persistence::{
    add_location_metadata, add_profile_diff_feed_entries, friend_log_upsert,
    friend_relationship_feed_entry, gps_feed_entry, is_online_state, online_offline_feed_entry,
    FriendChangedProps,
};
use super::projection::resolve_state_bucket;
use super::state::{PendingOffline, RealtimeFriendState, PENDING_OFFLINE_DELAY_MS};
use super::utils::*;
use super::*;

const GPS_REPEAT_WINDOW_MS: i64 = 5 * 60 * 1000;

pub fn is_friend_event_type(message_type: &str) -> bool {
    matches!(
        message_type,
        "friend-add"
            | "friend-delete"
            | "friend-update"
            | "friend-online"
            | "friend-active"
            | "friend-offline"
            | "friend-location"
    )
}

pub(super) fn apply_friend_event(
    state: &mut RealtimeFriendState,
    message_type: &str,
    content: &Value,
    now: &EventTime,
) -> Option<RealtimeFriendOutput> {
    apply_friend_event_with_options(
        state,
        message_type,
        content,
        now,
        FriendEventOptions {
            emit_profile_diff_feed: true,
            trust_event_state: false,
        },
    )
}

pub(super) fn apply_refetched_friend_profile_event(
    state: &mut RealtimeFriendState,
    content: &Value,
    now: &EventTime,
) -> Option<RealtimeFriendOutput> {
    apply_friend_event_with_options(
        state,
        "friend-update",
        content,
        now,
        FriendEventOptions {
            emit_profile_diff_feed: false,
            trust_event_state: true,
        },
    )
}

#[derive(Clone, Copy)]
struct FriendEventOptions {
    emit_profile_diff_feed: bool,
    trust_event_state: bool,
}

fn apply_friend_event_with_options(
    state: &mut RealtimeFriendState,
    message_type: &str,
    content: &Value,
    now: &EventTime,
    options: FriendEventOptions,
) -> Option<RealtimeFriendOutput> {
    let baseline = state.baseline.as_ref()?;
    let owner_user_id = baseline.current_user_id.clone();
    let generation = baseline.generation;
    let baseline_revision = baseline.baseline_revision;
    let mut output = RealtimeFriendOutput {
        owner_user_id,
        projection: FriendProjection {
            generation,
            baseline_revision,
            ..FriendProjection::default()
        },
        ..RealtimeFriendOutput::default()
    };

    match message_type {
        "friend-add" => {
            let user_id = event_user_id(content)?;
            let patch =
                event_user_patch(content, &user_id).unwrap_or_else(|| json!({ "id": user_id }));
            let previous = get_friend_value(state, &user_id);
            let state_bucket =
                resolve_state_bucket(content, &patch, previous.as_ref(), false, "offline");
            let already_friend = previous.is_some();
            apply_patch_to_state(state, &mut output, &user_id, patch.clone(), &state_bucket);
            if !already_friend {
                output
                    .persistence
                    .friend_log_upserts
                    .push(friend_log_upsert(
                        &user_id,
                        &patch,
                        previous.as_ref(),
                        &state_bucket,
                        &now.iso,
                    ));
                output
                    .persistence
                    .feed_entries
                    .push(friend_relationship_feed_entry(
                        "Friend",
                        &user_id,
                        &patch,
                        previous.as_ref(),
                        &now.iso,
                    ));
                output.projection.friend_log_changed = true;
            }
        }
        "friend-delete" => {
            let user_id = event_user_id(content)?;
            let previous = get_friend_value(state, &user_id);
            state.pending_offline.remove(&user_id);
            state.recent_gps.remove(&user_id);
            if let Some(baseline) = state.baseline.as_mut() {
                baseline.friends_by_id.remove(&user_id);
            }
            output.projection.removals.push(user_id.clone());
            output.persistence.friend_log_deletes.push(FriendLogDelete {
                target_user_id: user_id.clone(),
                created_at: now.iso.clone(),
            });
            let patch = json!({ "id": user_id.clone() });
            output
                .persistence
                .feed_entries
                .push(friend_relationship_feed_entry(
                    "Unfriend",
                    &user_id,
                    &patch,
                    previous.as_ref(),
                    &now.iso,
                ));
            output.projection.friend_log_changed = true;
        }
        "friend-update" => {
            let user_id = event_user_id(content)?;
            let mut patch =
                event_user_patch(content, &user_id).unwrap_or_else(|| json!({ "id": user_id }));
            if !options.trust_event_state
                && patch.as_object().map(|object| object.len()).unwrap_or(0) <= 1
            {
                return None;
            }
            let previous = get_friend_value(state, &user_id);
            let changes = FriendChangedProps::from_patch(&patch, previous.as_ref());
            let state_bucket = if options.trust_event_state {
                resolve_state_bucket(
                    content,
                    &patch,
                    previous.as_ref(),
                    options.trust_event_state,
                    "offline",
                )
            } else {
                previous
                    .as_ref()
                    .and_then(|previous| {
                        previous
                            .get("stateBucket")
                            .or_else(|| previous.get("state"))
                    })
                    .and_then(Value::as_str)
                    .filter(|value| !value.is_empty())
                    .unwrap_or("offline")
                    .to_string()
            };
            if options.trust_event_state && state.pending_offline.remove(&user_id).is_some() {
                if let Some(patch_object) = patch.as_object_mut() {
                    patch_object.insert("pendingOffline".into(), Value::Bool(false));
                }
            }
            if options.emit_profile_diff_feed {
                add_profile_diff_feed_entries(
                    &mut output,
                    &user_id,
                    &patch,
                    previous.as_ref(),
                    &changes,
                    &now.iso,
                );
            }
            request_profile_refetch_for_impossible_location(
                &mut output,
                &user_id,
                &patch,
                &state_bucket,
            );
            apply_patch_to_state(state, &mut output, &user_id, patch, &state_bucket);
        }
        "friend-online" => {
            let user_id = event_user_id(content)?;
            let canceled_pending = state.pending_offline.remove(&user_id).is_some();
            let previous_record = state
                .baseline
                .as_ref()?
                .friends_by_id
                .get(&user_id)
                .cloned();
            let previous = previous_record.as_ref().map(record_to_value);
            let user_patch =
                event_user_patch(content, &user_id).unwrap_or_else(|| json!({ "id": user_id }));
            let patch = online_patch(content, user_patch, previous.as_ref(), now, "online");
            if !canceled_pending
                && !previous_record
                    .as_ref()
                    .map(is_online_state)
                    .unwrap_or(false)
            {
                output
                    .persistence
                    .feed_entries
                    .push(online_offline_feed_entry(
                        "Online",
                        &user_id,
                        &patch,
                        previous.as_ref().unwrap_or(&Value::Null),
                        &string_field(patch.get("location")),
                        0,
                        &now.iso,
                    ));
            } else if let Some(previous) = previous.as_ref() {
                add_gps_feed_entry_if_not_repeated(
                    state,
                    &mut output,
                    &user_id,
                    &patch,
                    previous,
                    now,
                    state_bucket_changed(previous, "online"),
                );
            }
            apply_patch_to_state(state, &mut output, &user_id, patch, "online");
        }
        "friend-active" | "friend-offline" => {
            let user_id = event_user_id(content)?;
            let next_state = if message_type == "friend-active" {
                "active"
            } else {
                "offline"
            };
            let previous_record = state
                .baseline
                .as_ref()?
                .friends_by_id
                .get(&user_id)
                .cloned();
            let patch = offline_like_patch(content, &user_id, next_state);
            if let Some(previous) = previous_record
                .as_ref()
                .filter(|previous| is_online_state(previous))
            {
                if state.pending_offline.contains_key(&user_id) {
                    return None;
                }
                state.timer_token = state.timer_token.saturating_add(1);
                let token = state.timer_token;
                state.pending_offline.insert(
                    user_id.clone(),
                    PendingOffline {
                        token,
                        patch: patch.clone(),
                        previous: previous.clone(),
                    },
                );
                let pending_patch = json!({
                    "id": user_id,
                    "pendingOffline": true,
                });
                apply_patch_to_state(state, &mut output, &user_id, pending_patch, "online");
                output.timer_action = PendingOfflineTimerAction::Schedule {
                    user_id,
                    token,
                    delay_ms: PENDING_OFFLINE_DELAY_MS,
                };
            } else {
                state.recent_gps.remove(&user_id);
                apply_patch_to_state(state, &mut output, &user_id, patch, next_state);
            }
        }
        "friend-location" => {
            let user_id = event_user_id(content)?;
            let has_embedded_user = has_embedded_location_user(content);
            let user_patch =
                event_user_patch(content, &user_id).unwrap_or_else(|| json!({ "id": user_id }));
            let has_online_location = location_event_has_online_proof(content, &user_patch);
            let has_offline_location = location_event_has_offline_proof(content, &user_patch);
            let preserve_pending_offline =
                !has_online_location && state.pending_offline.contains_key(&user_id);
            if has_embedded_user && has_online_location {
                state.pending_offline.remove(&user_id);
            }
            let previous_record = state
                .baseline
                .as_ref()?
                .friends_by_id
                .get(&user_id)
                .cloned();
            let previous = previous_record.as_ref().map(record_to_value);
            let state_bucket = resolve_location_event_state_bucket(
                content,
                previous.as_ref(),
                has_online_location,
            )?;
            let state_bucket_authority = if has_embedded_user && has_online_location {
                "explicit"
            } else {
                "preserve"
            };
            let mut patch =
                online_patch(content, user_patch, previous.as_ref(), now, &state_bucket);
            let start_pending_offline = !preserve_pending_offline
                && !has_online_location
                && has_offline_location
                && previous_record
                    .as_ref()
                    .map(is_online_state)
                    .unwrap_or(false);
            if start_pending_offline {
                state.timer_token = state.timer_token.saturating_add(1);
                let token = state.timer_token;
                state.pending_offline.insert(
                    user_id.clone(),
                    PendingOffline {
                        token,
                        patch: offline_like_patch(content, &user_id, "offline"),
                        previous: previous_record.expect("checked previous record"),
                    },
                );
                if let Some(patch_object) = patch.as_object_mut() {
                    patch_object.insert("pendingOffline".into(), Value::Bool(true));
                }
                output.timer_action = PendingOfflineTimerAction::Schedule {
                    user_id: user_id.clone(),
                    token,
                    delay_ms: PENDING_OFFLINE_DELAY_MS,
                };
            } else if preserve_pending_offline {
                if let Some(patch_object) = patch.as_object_mut() {
                    patch_object.insert("pendingOffline".into(), Value::Bool(true));
                }
            } else if !has_embedded_user {
                if let Some(patch_object) = patch.as_object_mut() {
                    patch_object.remove("pendingOffline");
                }
            }
            if let Some(previous) = previous.as_ref() {
                add_gps_feed_entry_if_not_repeated(
                    state,
                    &mut output,
                    &user_id,
                    &patch,
                    previous,
                    now,
                    state_bucket_changed(previous, &state_bucket),
                );
            }
            if state_bucket != "online" {
                state.recent_gps.remove(&user_id);
            }
            request_profile_refetch_for_location_event(
                &mut output,
                &user_id,
                &patch,
                &state_bucket,
                has_embedded_user,
                has_online_location,
            );
            apply_patch_to_state_with_authority(
                state,
                &mut output,
                &user_id,
                patch,
                &state_bucket,
                state_bucket_authority,
            );
        }
        _ => return None,
    }

    output.projection.feed_entries = output.persistence.feed_entries.clone();
    if output.projection.patches.is_empty()
        && output.projection.removals.is_empty()
        && output.persistence.is_empty()
    {
        return None;
    }
    Some(output)
}

fn request_profile_refetch_for_impossible_location(
    output: &mut RealtimeFriendOutput,
    user_id: &str,
    patch: &Value,
    state_bucket: &str,
) {
    if state_bucket != "online" && is_real_instance_patch(patch) {
        push_profile_refetch_user_id(output, user_id);
    }
}

fn request_profile_refetch_for_location_event(
    output: &mut RealtimeFriendOutput,
    user_id: &str,
    patch: &Value,
    state_bucket: &str,
    has_embedded_user: bool,
    has_online_location: bool,
) {
    let embedded_user_without_online_proof = has_embedded_user && !has_online_location;
    let online_with_missing_or_offline_location =
        state_bucket == "online" && !patch_has_online_location(patch);
    let non_online_with_real_instance_location =
        state_bucket != "online" && is_real_instance_patch(patch);

    if embedded_user_without_online_proof
        || online_with_missing_or_offline_location
        || non_online_with_real_instance_location
    {
        push_profile_refetch_user_id(output, user_id);
    }
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

fn patch_has_online_location(patch: &Value) -> bool {
    [
        patch.get("location").and_then(Value::as_str),
        patch.get("travelingToLocation").and_then(Value::as_str),
    ]
    .iter()
    .flatten()
    .any(|value| is_online_location_proof(value))
}

fn is_real_instance_patch(patch: &Value) -> bool {
    let location = string_field(patch.get("location"));
    let parsed = parse_location(&location);
    parsed.world_id.starts_with("wrld_") && !parsed.instance_id.is_empty()
}

fn recent_enough(previous_ms: i64, now_ms: i64) -> bool {
    previous_ms > 0 && now_ms.saturating_sub(previous_ms) <= GPS_REPEAT_WINDOW_MS
}

fn should_suppress_repeated_gps(
    state: &mut RealtimeFriendState,
    user_id: &str,
    location: &str,
    now_ms: i64,
) -> bool {
    let Some(recent) = state.recent_gps.get_mut(user_id) else {
        return false;
    };
    recent
        .locations_by_tag
        .retain(|_, observed_at_ms| recent_enough(*observed_at_ms, now_ms));
    if recent.locations_by_tag.contains_key(location) {
        recent.locations_by_tag.insert(location.to_string(), now_ms);
        return true;
    }
    false
}

fn remember_gps_event(state: &mut RealtimeFriendState, user_id: &str, location: &str, now_ms: i64) {
    state
        .recent_gps
        .entry(user_id.to_string())
        .or_default()
        .locations_by_tag
        .insert(location.to_string(), now_ms);
}

fn add_gps_feed_entry_if_not_repeated(
    state: &mut RealtimeFriendState,
    output: &mut RealtimeFriendOutput,
    user_id: &str,
    patch: &Value,
    previous: &Value,
    now: &EventTime,
    state_bucket_changed: bool,
) {
    if state_bucket_changed {
        return;
    }
    let Some(entry) = gps_feed_entry(user_id, patch, previous, &now.iso) else {
        return;
    };
    let location = string_field(entry.get("location"));
    if should_suppress_repeated_gps(state, user_id, &location, now.timestamp_ms) {
        return;
    }
    remember_gps_event(state, user_id, &location, now.timestamp_ms);
    output.persistence.feed_entries.push(entry);
}

pub(super) fn apply_patch_to_state(
    state: &mut RealtimeFriendState,
    output: &mut RealtimeFriendOutput,
    user_id: &str,
    patch: serde_json::Value,
    state_bucket: &str,
) {
    apply_patch_to_state_with_authority(state, output, user_id, patch, state_bucket, "explicit");
}

pub(super) fn apply_patch_to_state_with_authority(
    state: &mut RealtimeFriendState,
    output: &mut RealtimeFriendOutput,
    user_id: &str,
    patch: serde_json::Value,
    state_bucket: &str,
    state_bucket_authority: &str,
) {
    let mut record = state
        .baseline
        .as_ref()
        .and_then(|baseline| baseline.friends_by_id.get(user_id))
        .cloned()
        .unwrap_or_default();
    if let Some(patch_object) = patch.as_object() {
        apply_value_patch_to_record(&mut record, patch_object);
    }
    record.id = user_id.to_string();
    record.state = state_bucket.to_string();
    record.state_bucket = state_bucket.to_string();
    sanitize_record_extra(&mut record);

    let projection_patch = record_to_value(&record);
    if let Some(baseline) = state.baseline.as_mut() {
        baseline.friends_by_id.insert(user_id.to_string(), record);
    }
    output.projection.patches.push(FriendProjectionPatch {
        user_id: user_id.to_string(),
        patch: projection_patch,
        state_bucket: state_bucket.to_string(),
        state_bucket_authority: Some(state_bucket_authority.to_string()),
    });
}

pub(super) fn event_user_id(content: &Value) -> Option<String> {
    let user_id = content
        .get("userId")
        .and_then(Value::as_str)
        .or_else(|| {
            content
                .get("user")
                .and_then(|user| user.get("id"))
                .and_then(Value::as_str)
        })
        .unwrap_or("")
        .trim()
        .to_string();
    (!user_id.is_empty()).then_some(user_id)
}

pub(super) fn event_user_patch(content: &Value, user_id: &str) -> Option<Value> {
    let user = content.get("user")?.as_object()?;
    let mut patch = user.clone();
    patch.insert("id".into(), Value::String(user_id.to_string()));
    patch.remove("state");
    vrcx_0_core::friends::strip_default_avatar_image(&mut patch);
    Some(Value::Object(patch))
}

fn has_embedded_location_user(content: &Value) -> bool {
    content
        .get("user")
        .and_then(|user| user.get("id"))
        .and_then(Value::as_str)
        .map(|id| !id.trim().is_empty())
        .unwrap_or(false)
}

fn resolve_location_event_state_bucket(
    content: &Value,
    previous: Option<&Value>,
    has_online_location: bool,
) -> Option<String> {
    if has_embedded_location_user(content) && has_online_location {
        return Some("online".into());
    }
    for candidate in [
        previous.and_then(|previous| previous.get("stateBucket")),
        previous.and_then(|previous| previous.get("state")),
    ] {
        if let Some(normalized) = candidate
            .and_then(Value::as_str)
            .and_then(normalize_state_bucket)
        {
            return Some(normalized);
        }
    }
    None
}

fn state_bucket_changed(previous: &Value, next_state_bucket: &str) -> bool {
    [
        previous.get("stateBucket").and_then(Value::as_str),
        previous.get("state").and_then(Value::as_str),
    ]
    .iter()
    .flatten()
    .find_map(|state| normalize_state_bucket(state))
    .map(|previous_state_bucket| previous_state_bucket != next_state_bucket)
    .unwrap_or(false)
}

fn location_event_has_online_proof(content: &Value, user_patch: &Value) -> bool {
    let content_locations = [
        content.get("location").and_then(Value::as_str),
        content.get("travelingToLocation").and_then(Value::as_str),
    ];
    if content_locations
        .iter()
        .flatten()
        .any(|value| !value.trim().is_empty())
    {
        return content_locations
            .iter()
            .flatten()
            .any(|value| is_online_location_proof(value));
    }

    let user_locations = [
        user_patch.get("location").and_then(Value::as_str),
        user_patch
            .get("travelingToLocation")
            .and_then(Value::as_str),
    ];
    user_locations
        .iter()
        .flatten()
        .any(|value| is_online_location_proof(value))
}

fn location_event_has_offline_proof(content: &Value, user_patch: &Value) -> bool {
    let content_locations = [
        content.get("location").and_then(Value::as_str),
        content.get("travelingToLocation").and_then(Value::as_str),
    ];
    if content_locations
        .iter()
        .flatten()
        .any(|value| !value.trim().is_empty())
    {
        return content_locations
            .iter()
            .flatten()
            .any(|value| is_offline_location_proof(value));
    }

    let user_locations = [
        user_patch.get("location").and_then(Value::as_str),
        user_patch
            .get("travelingToLocation")
            .and_then(Value::as_str),
    ];
    user_locations
        .iter()
        .flatten()
        .any(|value| is_offline_location_proof(value))
}

fn is_online_location_proof(value: &str) -> bool {
    let normalized = value.trim().to_ascii_lowercase();
    !normalized.is_empty() && normalized != "offline" && normalized != "offline:offline"
}

fn is_offline_location_proof(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "offline" | "offline:offline"
    )
}

pub(super) fn online_patch(
    content: &Value,
    user_patch: serde_json::Value,
    previous: Option<&Value>,
    now: &EventTime,
    state_bucket: &str,
) -> serde_json::Value {
    let mut patch = user_patch.as_object().cloned().unwrap_or_default();
    if let Some(platform) = content.get("platform").and_then(Value::as_str) {
        patch.insert("platform".into(), Value::String(platform.to_string()));
    }
    patch.insert("state".into(), Value::String(state_bucket.to_string()));
    patch.insert("pendingOffline".into(), Value::Bool(false));

    let event_location = first_string([
        patch.get("location").and_then(Value::as_str),
        content.get("location").and_then(Value::as_str),
    ]);
    let event_traveling = first_string([
        patch.get("travelingToLocation").and_then(Value::as_str),
        content.get("travelingToLocation").and_then(Value::as_str),
    ]);
    let event_world = first_string([
        patch.get("worldId").and_then(Value::as_str),
        content.get("worldId").and_then(Value::as_str),
    ]);
    let fallback = previous.filter(|previous| {
        let location = string_field(previous.get("location")).to_ascii_lowercase();
        !location.is_empty() && location != "offline" && location != "offline:offline"
    });
    let location = first_string([
        Some(event_location.as_str()),
        fallback.and_then(|value| value.get("location").and_then(Value::as_str)),
    ]);
    let traveling = first_string([
        Some(event_traveling.as_str()),
        fallback.and_then(|value| value.get("travelingToLocation").and_then(Value::as_str)),
    ]);
    let parsed_location = parse_location(&location);
    let parsed_traveling = parse_location(&traveling);
    patch.insert("location".into(), Value::String(location.clone()));
    patch.insert(
        "worldId".into(),
        Value::String(
            first_non_empty([event_world.as_str(), parsed_location.world_id.as_str()]).to_string(),
        ),
    );
    patch.insert(
        "instanceId".into(),
        Value::String(parsed_location.instance_id.clone()),
    );
    patch.insert("travelingToLocation".into(), Value::String(traveling));
    patch.insert(
        "travelingToWorld".into(),
        Value::String(parsed_traveling.world_id.clone()),
    );
    patch.insert(
        "travelingToInstance".into(),
        Value::String(parsed_traveling.instance_id.clone()),
    );
    patch.insert(
        "$location".into(),
        parsed_location.to_frontend_value(&location),
    );
    patch.insert(
        "$travelingToLocation".into(),
        parsed_traveling.to_frontend_value(&string_field(patch.get("travelingToLocation"))),
    );
    add_location_metadata(&mut patch, previous, now.timestamp_ms);
    Value::Object(patch)
}

pub(super) fn offline_like_patch(content: &Value, user_id: &str, state_bucket: &str) -> Value {
    let mut patch = content
        .get("user")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    patch.remove("state");
    patch.insert("id".into(), Value::String(user_id.to_string()));
    if let Some(platform) = content.get("platform").and_then(Value::as_str) {
        patch.insert("platform".into(), Value::String(platform.to_string()));
    }
    patch.insert("state".into(), Value::String(state_bucket.to_string()));
    patch.insert("pendingOffline".into(), Value::Bool(false));
    patch.insert("location".into(), Value::String("offline".into()));
    patch.insert("worldId".into(), Value::String("offline".into()));
    patch.insert("instanceId".into(), Value::String("".into()));
    patch.insert(
        "travelingToLocation".into(),
        Value::String("offline".into()),
    );
    patch.insert("travelingToWorld".into(), Value::String("offline".into()));
    patch.insert("travelingToInstance".into(), Value::String("".into()));
    let parsed_offline = parse_location("offline");
    patch.insert(
        "$location".into(),
        parsed_offline.to_frontend_value("offline"),
    );
    patch.insert(
        "$travelingToLocation".into(),
        parsed_offline.to_frontend_value("offline"),
    );
    Value::Object(patch)
}

pub(super) fn get_friend_value(state: &RealtimeFriendState, user_id: &str) -> Option<Value> {
    state
        .baseline
        .as_ref()
        .and_then(|baseline| baseline.friends_by_id.get(user_id))
        .map(record_to_value)
}

const FRIEND_NAMED_FIELD_KEYS: &[&str] = &[
    "id",
    "displayName",
    "username",
    "state",
    "stateBucket",
    "location",
    "travelingToLocation",
    "worldId",
    "platform",
    "lastPlatform",
    "last_platform",
    "status",
    "statusDescription",
    "bio",
    "currentAvatarImageUrl",
    "currentAvatarThumbnailImageUrl",
    "currentAvatarAuthorId",
    "currentAvatarName",
];

fn is_named_field_key(key: &str) -> bool {
    FRIEND_NAMED_FIELD_KEYS.contains(&key)
}

fn patch_str(patch: &Map<String, Value>, keys: &[&str]) -> Option<String> {
    for key in keys {
        match patch.get(*key) {
            Some(Value::String(value)) => return Some(value.clone()),
            Some(Value::Null) | None => {}
            Some(other) => {
                tracing::warn!(
                    "friend patch field `{}` has non-string value: {}",
                    *key,
                    other
                );
            }
        }
    }
    None
}

fn apply_value_patch_to_record(record: &mut FriendRecord, patch: &Map<String, Value>) {
    if let Some(value) = patch_str(patch, &["displayName"]) {
        record.display_name = value;
    }
    if let Some(value) = patch_str(patch, &["username"]) {
        record.username = value;
    }
    if let Some(value) = patch_str(patch, &["location"]) {
        record.location = value;
    }
    if let Some(value) = patch_str(patch, &["travelingToLocation"]) {
        record.traveling_to_location = value;
    }
    if let Some(value) = patch_str(patch, &["worldId"]) {
        record.world_id = value;
    }
    if let Some(value) = patch_str(patch, &["platform"]) {
        record.platform = value;
    }
    if let Some(value) = patch_str(patch, &["lastPlatform", "last_platform"]) {
        record.last_platform = value;
    }
    if let Some(value) = patch_str(patch, &["status"]) {
        record.status = value;
    }
    if let Some(value) = patch_str(patch, &["statusDescription"]) {
        record.status_description = value;
    }
    if let Some(value) = patch_str(patch, &["bio"]) {
        record.bio = value;
    }
    if let Some(value) = patch_str(patch, &["currentAvatarImageUrl"]) {
        record.current_avatar_image_url = value;
    }
    if let Some(value) = patch_str(patch, &["currentAvatarThumbnailImageUrl"]) {
        record.current_avatar_thumbnail_image_url = value;
    }
    if let Some(value) = patch_str(patch, &["currentAvatarAuthorId"]) {
        record.current_avatar_author_id = value;
    }
    if let Some(value) = patch_str(patch, &["currentAvatarName"]) {
        record.current_avatar_name = value;
    }
    for (key, value) in patch {
        if is_named_field_key(key) {
            continue;
        }
        record.extra.insert(key.clone(), value.clone());
    }
}

fn sanitize_record_extra(record: &mut FriendRecord) {
    for key in FRIEND_NAMED_FIELD_KEYS {
        record.extra.remove(*key);
    }
}

pub(super) fn record_to_value(record: &FriendRecord) -> Value {
    serde_json::to_value(record).unwrap_or(Value::Null)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn merge_normalizes_snake_case_alias_and_round_trips() {
        let mut record = FriendRecord {
            id: "usr_x".into(),
            state: "active".into(),
            state_bucket: "active".into(),
            location: "offline".into(),
            last_platform: "windows".into(),
            ..FriendRecord::default()
        };
        let patch = json!({
            "last_platform": "standalonewindows",
            "location": "traveling",
            "$location": { "tag": "traveling" }
        });
        apply_value_patch_to_record(&mut record, patch.as_object().unwrap());
        record.state = "online".into();
        record.state_bucket = "online".into();
        sanitize_record_extra(&mut record);

        assert_eq!(record.last_platform, "standalonewindows");
        assert_eq!(record.location, "traveling");

        let value = record_to_value(&record);
        let object = value.as_object().unwrap();
        assert!(object.contains_key("lastPlatform"));
        assert!(!object.contains_key("last_platform"));
        assert!(serde_json::from_value::<FriendRecord>(value).is_ok());
    }

    #[test]
    fn merge_keeps_previous_on_null_or_non_string() {
        let mut record = FriendRecord {
            status_description: "hi".into(),
            location: "wrld_a:1".into(),
            ..FriendRecord::default()
        };
        let patch = json!({ "statusDescription": Value::Null, "location": 42 });
        apply_value_patch_to_record(&mut record, patch.as_object().unwrap());

        assert_eq!(record.status_description, "hi");
        assert_eq!(record.location, "wrld_a:1");
    }

    #[test]
    fn online_patch_emits_full_location_projection() {
        let now = EventTime {
            iso: "2026-06-25T00:00:00Z".into(),
            timestamp_ms: 1_772_000_000_000,
        };
        let tag = "wrld_a:1~hidden(usr_owner)~region(jp)";
        let patch = online_patch(
            &json!({ "location": tag }),
            json!({ "id": "usr_friend" }),
            None,
            &now,
            "online",
        );

        assert_eq!(patch["location"], json!(tag));
        assert_eq!(patch["$location"]["tag"], json!(tag));
        assert_eq!(patch["$location"]["worldId"], json!("wrld_a"));
        assert_eq!(
            patch["$location"]["instanceId"],
            json!("1~hidden(usr_owner)~region(jp)")
        );
        assert_eq!(patch["$location"]["accessType"], json!("friends+"));
        assert_eq!(patch["$location"]["userId"], json!("usr_owner"));
        assert_eq!(patch["$location"]["region"], json!("jp"));
    }

    #[test]
    fn offline_like_patch_emits_structured_offline_locations() {
        let patch = offline_like_patch(&json!({}), "usr_friend", "offline");

        assert_eq!(patch["location"], json!("offline"));
        assert_eq!(patch["travelingToLocation"], json!("offline"));
        assert_eq!(patch["$location"]["tag"], json!("offline"));
        assert_eq!(patch["$location"]["isOffline"], json!(true));
        assert_eq!(patch["$travelingToLocation"]["tag"], json!("offline"));
        assert_eq!(patch["$travelingToLocation"]["isOffline"], json!(true));
    }
}
