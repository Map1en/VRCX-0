//! Friend roster state owned by the host realtime runtime.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use vrcx_0_domain::friends::{normalize_state_bucket, FriendRecord, FriendRosterBaseline};
use vrcx_0_domain::realtime::RealtimeWsMessagePayload;
use vrcx_0_persistence::realtime::{
    FriendLogDelete, FriendLogUpsert, RealtimePersistenceBatch,
};

const PENDING_OFFLINE_DELAY_MS: u64 = 170_000;

#[derive(Clone, Debug, Default, PartialEq)]
pub struct RealtimeFriendSnapshot {
    pub current_user_id: String,
    pub endpoint: String,
    pub websocket: String,
    pub generation: u64,
    pub baseline_revision: u64,
    pub friends_by_id: HashMap<String, FriendRecord>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FriendBaselineResult {
    pub accepted: bool,
    pub generation: u64,
    pub baseline_revision: u64,
    pub friend_count: usize,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FriendProjectionPatch {
    pub user_id: String,
    pub patch: Value,
    pub state_bucket: String,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FriendProjection {
    pub generation: u64,
    pub baseline_revision: u64,
    #[serde(default)]
    pub patches: Vec<FriendProjectionPatch>,
    #[serde(default)]
    pub removals: Vec<String>,
    #[serde(default)]
    pub feed_entries: Vec<Value>,
    pub friend_log_changed: bool,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct RealtimeFriendOutput {
    pub owner_user_id: String,
    pub projection: FriendProjection,
    pub persistence: RealtimePersistenceBatch,
    pub timer_action: PendingOfflineTimerAction,
}

pub enum RealtimeFriendApplyResult {
    Output(RealtimeFriendOutput),
    MissingBaseline,
    Ignored,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub enum PendingOfflineTimerAction {
    #[default]
    None,
    Schedule {
        user_id: String,
        token: u64,
        delay_ms: u64,
    },
}

#[derive(Clone, Debug)]
struct PendingOffline {
    token: u64,
    patch: Value,
    previous: FriendRecord,
}

#[derive(Clone, Debug, Default)]
struct RealtimeFriendState {
    generation: u64,
    timer_token: u64,
    baseline: Option<RealtimeFriendSnapshot>,
    pending_offline: HashMap<String, PendingOffline>,
}

#[derive(Clone, Debug, Default)]
pub struct RealtimeFriendsRuntime {
    state: Arc<Mutex<RealtimeFriendState>>,
}

impl RealtimeFriendsRuntime {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set_baseline(
        &self,
        baseline: FriendRosterBaseline,
        realtime_generation: u64,
        baseline_revision: u64,
    ) -> FriendBaselineResult {
        let baseline = baseline.normalized();
        let mut state = self.lock_state();
        let generation = realtime_generation;
        state.generation = state.generation.max(generation);
        state.pending_offline.clear();
        let friend_count = baseline.friends_by_id.len();
        state.baseline = Some(RealtimeFriendSnapshot {
            current_user_id: baseline.current_user_id,
            endpoint: baseline.endpoint,
            websocket: baseline.websocket,
            generation,
            baseline_revision,
            friends_by_id: baseline.friends_by_id,
        });

        FriendBaselineResult {
            accepted: true,
            generation,
            baseline_revision,
            friend_count,
        }
    }

    pub fn clear(&self) -> u64 {
        let mut state = self.lock_state();
        state.generation = state.generation.saturating_add(1);
        state.baseline = None;
        state.pending_offline.clear();
        state.generation
    }

    pub fn clear_baseline_if_revision(&self, generation: u64, baseline_revision: u64) -> bool {
        let mut state = self.lock_state();
        let should_clear = state
            .baseline
            .as_ref()
            .map(|baseline| {
                baseline.generation == generation && baseline.baseline_revision == baseline_revision
            })
            .unwrap_or(false);
        if should_clear {
            state.generation = state.generation.saturating_add(1);
            state.baseline = None;
            state.pending_offline.clear();
        }
        should_clear
    }

    pub fn snapshot(&self) -> Option<RealtimeFriendSnapshot> {
        self.lock_state().baseline.clone()
    }

    pub fn apply_ws_message(
        &self,
        payload: &RealtimeWsMessagePayload,
    ) -> RealtimeFriendApplyResult {
        let Some(message_type) = payload.json.get("type").and_then(Value::as_str) else {
            return RealtimeFriendApplyResult::Ignored;
        };
        if !is_friend_event_type(message_type) {
            return RealtimeFriendApplyResult::Ignored;
        }
        let content = payload.json.get("content").unwrap_or(&Value::Null);
        let now = EventTime::from_received_at(&payload.received_at);
        let mut state = self.lock_state();
        if state.baseline.is_none() {
            return RealtimeFriendApplyResult::MissingBaseline;
        }
        apply_friend_event(&mut state, message_type, content, &now)
            .map(RealtimeFriendApplyResult::Output)
            .unwrap_or(RealtimeFriendApplyResult::Ignored)
    }

    pub fn fire_pending_offline(
        &self,
        user_id: &str,
        token: u64,
        now_iso: String,
    ) -> Option<RealtimeFriendOutput> {
        let mut state = self.lock_state();
        let owner_user_id = state.baseline.as_ref()?.current_user_id.clone();
        let generation = state.baseline.as_ref()?.generation;
        let baseline_revision = state.baseline.as_ref()?.baseline_revision;
        let pending = state.pending_offline.get(user_id)?;
        if pending.token != token {
            return None;
        }
        let pending = state.pending_offline.remove(user_id)?;
        let current = state.baseline.as_ref()?.friends_by_id.get(user_id)?;
        if is_online_state(current) && !bool_field(record_to_value(current).get("pendingOffline")) {
            return None;
        }

        let patch = object_with_pending_offline(pending.patch, false);
        let state_bucket = state_bucket_from_patch(&patch, "offline");
        let previous = pending.previous;
        let mut output = RealtimeFriendOutput {
            owner_user_id,
            projection: FriendProjection {
                generation,
                baseline_revision,
                ..FriendProjection::default()
            },
            ..RealtimeFriendOutput::default()
        };
        apply_patch_to_state(&mut state, &mut output, user_id, patch, &state_bucket);
        let location = string_field(record_to_value(&previous).get("location"));
        output.persistence.feed_entries.push(online_offline_feed_entry(
            "Offline",
            user_id,
            output
                .projection
                .patches
                .last()
                .map(|patch| &patch.patch)
                .unwrap_or(&Value::Null),
            &record_to_value(&previous),
            &location,
            duration_ms(&previous, Utc::now().timestamp_millis()),
            &now_iso,
        ));
        output.projection.feed_entries = output.persistence.feed_entries.clone();
        Some(output)
    }

    fn lock_state(&self) -> std::sync::MutexGuard<'_, RealtimeFriendState> {
        self.state.lock().unwrap_or_else(|error| error.into_inner())
    }
}

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

fn apply_friend_event(
    state: &mut RealtimeFriendState,
    message_type: &str,
    content: &Value,
    now: &EventTime,
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
            let patch = event_user_patch(content, &user_id).unwrap_or_else(|| json!({ "id": user_id }));
            let previous = get_friend_value(state, &user_id);
            let state_bucket = resolve_state_bucket(content, &patch, previous.as_ref(), "offline");
            apply_patch_to_state(state, &mut output, &user_id, patch.clone(), &state_bucket);
            output.persistence.friend_log_upserts.push(friend_log_upsert(
                &user_id,
                &patch,
                previous.as_ref(),
                &state_bucket,
                &now.iso,
            ));
            output.projection.friend_log_changed = true;
        }
        "friend-delete" => {
            let user_id = event_user_id(content)?;
            state.pending_offline.remove(&user_id);
            if let Some(baseline) = state.baseline.as_mut() {
                baseline.friends_by_id.remove(&user_id);
            }
            output.projection.removals.push(user_id.clone());
            output.persistence.friend_log_deletes.push(FriendLogDelete {
                target_user_id: user_id,
                created_at: now.iso.clone(),
            });
            output.projection.friend_log_changed = true;
        }
        "friend-update" => {
            let user_id = event_user_id(content)?;
            let patch = event_user_patch(content, &user_id).unwrap_or_else(|| json!({ "id": user_id }));
            if patch.as_object().map(|object| object.len()).unwrap_or(0) <= 1 && !has_event_state_bucket(content) {
                return None;
            }
            let previous = get_friend_value(state, &user_id);
            let state_bucket = resolve_state_bucket(content, &patch, previous.as_ref(), "offline");
            add_profile_diff_feed_entries(&mut output, &user_id, &patch, previous.as_ref(), &now.iso);
            apply_patch_to_state(state, &mut output, &user_id, patch, &state_bucket);
        }
        "friend-online" => {
            let user_id = event_user_id(content)?;
            let canceled_pending = state.pending_offline.remove(&user_id).is_some();
            let previous_record = state.baseline.as_ref()?.friends_by_id.get(&user_id).cloned();
            let previous = previous_record.as_ref().map(record_to_value);
            let user_patch = event_user_patch(content, &user_id).unwrap_or_else(|| json!({ "id": user_id }));
            let patch = online_patch(content, user_patch, previous.as_ref(), now, "online");
            if !canceled_pending && !previous_record.as_ref().map(is_online_state).unwrap_or(false) {
                output.persistence.feed_entries.push(online_offline_feed_entry(
                    "Online",
                    &user_id,
                    &patch,
                    previous.as_ref().unwrap_or(&Value::Null),
                    &string_field(patch.get("location")),
                    0,
                    &now.iso,
                ));
            } else if let Some(previous) = previous.as_ref() {
                add_gps_feed_entry(&mut output, &user_id, &patch, previous, &now.iso);
            }
            apply_patch_to_state(state, &mut output, &user_id, patch, "online");
        }
        "friend-active" | "friend-offline" => {
            let user_id = event_user_id(content)?;
            let next_state = if message_type == "friend-active" { "active" } else { "offline" };
            let previous_record = state.baseline.as_ref()?.friends_by_id.get(&user_id).cloned();
            let patch = offline_like_patch(content, &user_id, next_state);
            if let Some(previous) = previous_record.as_ref().filter(|previous| is_online_state(previous)) {
                state.pending_offline.remove(&user_id);
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
                apply_patch_to_state(state, &mut output, &user_id, patch, next_state);
            }
        }
        "friend-location" => {
            let user_id = event_user_id(content)?;
            state.pending_offline.remove(&user_id);
            let previous = get_friend_value(state, &user_id);
            let user_patch = event_user_patch(content, &user_id).unwrap_or_else(|| json!({ "id": user_id }));
            let patch = online_patch(content, user_patch, previous.as_ref(), now, "online");
            if let Some(previous) = previous.as_ref() {
                add_gps_feed_entry(&mut output, &user_id, &patch, previous, &now.iso);
            }
            apply_patch_to_state(state, &mut output, &user_id, patch, "online");
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

fn apply_patch_to_state(
    state: &mut RealtimeFriendState,
    output: &mut RealtimeFriendOutput,
    user_id: &str,
    patch: Value,
    state_bucket: &str,
) {
    let mut merged = state
        .baseline
        .as_ref()
        .and_then(|baseline| baseline.friends_by_id.get(user_id))
        .map(record_to_map)
        .unwrap_or_default();
    if let Some(patch_object) = patch.as_object() {
        for (key, value) in patch_object {
            merged.insert(key.clone(), value.clone());
        }
    }
    merged.insert("id".into(), Value::String(user_id.to_string()));
    merged.insert("state".into(), Value::String(state_bucket.to_string()));
    merged.insert("stateBucket".into(), Value::String(state_bucket.to_string()));

    if let Some(record) = FriendRecord::deserialize(Value::Object(merged.clone()))
        .ok()
        .and_then(|record| record.normalized(user_id))
    {
        if let Some(baseline) = state.baseline.as_mut() {
            baseline.friends_by_id.insert(user_id.to_string(), record);
        }
    }
    output.projection.patches.push(FriendProjectionPatch {
        user_id: user_id.to_string(),
        patch: Value::Object(merged),
        state_bucket: state_bucket.to_string(),
    });
}

fn event_user_id(content: &Value) -> Option<String> {
    let user_id = content
        .get("userId")
        .and_then(Value::as_str)
        .or_else(|| content.get("user").and_then(|user| user.get("id")).and_then(Value::as_str))
        .unwrap_or("")
        .trim()
        .to_string();
    (!user_id.is_empty()).then_some(user_id)
}

fn event_user_patch(content: &Value, user_id: &str) -> Option<Value> {
    let user = content.get("user")?.as_object()?;
    let mut patch = user.clone();
    patch.insert("id".into(), Value::String(user_id.to_string()));
    patch.remove("state");
    Some(Value::Object(patch))
}

fn online_patch(
    content: &Value,
    user_patch: Value,
    previous: Option<&Value>,
    now: &EventTime,
    state_bucket: &str,
) -> Value {
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
    patch.insert("instanceId".into(), Value::String(parsed_location.instance_id.clone()));
    patch.insert("travelingToLocation".into(), Value::String(traveling));
    patch.insert(
        "travelingToWorld".into(),
        Value::String(parsed_traveling.world_id.clone()),
    );
    patch.insert(
        "travelingToInstance".into(),
        Value::String(parsed_traveling.instance_id.clone()),
    );
    patch.insert("$location".into(), parsed_location.to_value(&location));
    patch.insert(
        "$travelingToLocation".into(),
        parsed_traveling.to_value(&string_field(patch.get("travelingToLocation"))),
    );
    add_location_metadata(&mut patch, previous, now.timestamp_ms);
    Value::Object(patch)
}

fn offline_like_patch(content: &Value, user_id: &str, state_bucket: &str) -> Value {
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
    patch.insert("location".into(), Value::String("offline".into()));
    patch.insert("worldId".into(), Value::String("offline".into()));
    patch.insert("instanceId".into(), Value::String("".into()));
    patch.insert("travelingToLocation".into(), Value::String("offline".into()));
    patch.insert("travelingToWorld".into(), Value::String("offline".into()));
    patch.insert("travelingToInstance".into(), Value::String("".into()));
    Value::Object(patch)
}

fn get_friend_value(state: &RealtimeFriendState, user_id: &str) -> Option<Value> {
    state
        .baseline
        .as_ref()
        .and_then(|baseline| baseline.friends_by_id.get(user_id))
        .map(record_to_value)
}

fn record_to_map(record: &FriendRecord) -> Map<String, Value> {
    record_to_value(record).as_object().cloned().unwrap_or_default()
}

fn record_to_value(record: &FriendRecord) -> Value {
    serde_json::to_value(record).unwrap_or(Value::Null)
}

fn resolve_state_bucket(
    content: &Value,
    patch: &Value,
    previous: Option<&Value>,
    fallback: &str,
) -> String {
    for candidate in [
        content.get("stateBucket"),
        content.get("state"),
        content.get("user").and_then(|user| user.get("stateBucket")),
        content.get("user").and_then(|user| user.get("state")),
        patch.get("stateBucket"),
        patch.get("state"),
        previous.and_then(|previous| previous.get("stateBucket")),
        previous.and_then(|previous| previous.get("state")),
    ] {
        let normalized = candidate
            .and_then(Value::as_str)
            .and_then(normalize_state_bucket);
        if let Some(normalized) = normalized {
            return normalized;
        }
    }
    fallback.to_string()
}

fn has_event_state_bucket(content: &Value) -> bool {
    [
        content.get("stateBucket"),
        content.get("state"),
        content.get("user").and_then(|user| user.get("stateBucket")),
        content.get("user").and_then(|user| user.get("state")),
    ]
    .into_iter()
    .any(|value| value.and_then(Value::as_str).and_then(normalize_state_bucket).is_some())
}

fn state_bucket_from_patch(patch: &Value, fallback: &str) -> String {
    patch.get("state")
        .and_then(Value::as_str)
        .and_then(normalize_state_bucket)
        .unwrap_or_else(|| fallback.to_string())
}

fn friend_log_upsert(
    user_id: &str,
    patch: &Value,
    previous: Option<&Value>,
    _state_bucket: &str,
    created_at: &str,
) -> FriendLogUpsert {
    FriendLogUpsert {
        target_user_id: user_id.to_string(),
        display_name: display_name(user_id, patch, previous),
        trust_level: first_owned([
            string_field(patch.get("$trustLevel")),
            string_field(patch.get("trustLevel")),
            previous
                .map(|previous| string_field(previous.get("$trustLevel")))
                .unwrap_or_default(),
            previous
                .map(|previous| string_field(previous.get("trustLevel")))
                .unwrap_or_default(),
            "Visitor".to_string(),
        ]),
        friend_number: int_field(patch.get("$friendNumber"))
            .or_else(|| int_field(patch.get("friendNumber")))
            .or_else(|| previous.and_then(|previous| int_field(previous.get("$friendNumber"))))
            .or_else(|| previous.and_then(|previous| int_field(previous.get("friendNumber"))))
            .unwrap_or(0),
        created_at: created_at.to_string(),
    }
}

fn add_profile_diff_feed_entries(
    output: &mut RealtimeFriendOutput,
    user_id: &str,
    patch: &Value,
    previous: Option<&Value>,
    created_at: &str,
) {
    let Some(previous) = previous.filter(|previous| is_online_value(previous)) else {
        return;
    };
    let status_changed = patch.has("status")
        && string_field(patch.get("status")) != string_field(previous.get("status"))
        && string_field(patch.get("status")) != "offline"
        && string_field(previous.get("status")) != "offline";
    let status_description_changed = patch.has("statusDescription")
        && string_field(patch.get("statusDescription"))
            != string_field(previous.get("statusDescription"));
    if status_changed || status_description_changed {
        output.persistence.feed_entries.push(json!({
            "created_at": created_at,
            "type": "Status",
            "userId": user_id,
            "displayName": display_name(user_id, patch, Some(previous)),
            "status": string_or_previous(patch, previous, "status"),
            "statusDescription": string_or_previous(patch, previous, "statusDescription"),
            "previousStatus": string_field(previous.get("status")),
            "previousStatusDescription": string_field(previous.get("statusDescription")),
        }));
    }
    if patch.has("bio")
        && !string_field(patch.get("bio")).is_empty()
        && !string_field(previous.get("bio")).is_empty()
        && string_field(patch.get("bio")) != string_field(previous.get("bio"))
    {
        output.persistence.feed_entries.push(json!({
            "created_at": created_at,
            "type": "Bio",
            "userId": user_id,
            "displayName": display_name(user_id, patch, Some(previous)),
            "bio": string_field(patch.get("bio")),
            "previousBio": string_field(previous.get("bio")),
        }));
    }
    let current_avatar = first_owned([
        string_field(patch.get("currentAvatarImageUrl")),
        string_field(patch.get("currentAvatarThumbnailImageUrl")),
    ]);
    let previous_avatar = first_owned([
        string_field(previous.get("currentAvatarImageUrl")),
        string_field(previous.get("currentAvatarThumbnailImageUrl")),
    ]);
    if current_avatar != previous_avatar && !previous_avatar.is_empty() {
        output.persistence.feed_entries.push(json!({
            "created_at": created_at,
            "type": "Avatar",
            "userId": user_id,
            "displayName": display_name(user_id, patch, Some(previous)),
            "ownerId": first_owned([
                string_field(patch.get("currentAvatarAuthorId")),
                string_field(patch.get("authorId")),
            ]),
            "previousOwnerId": first_owned([
                string_field(previous.get("currentAvatarAuthorId")),
                string_field(previous.get("authorId")),
            ]),
            "avatarName": first_owned([
                string_field(patch.get("currentAvatarName")),
                string_field(patch.get("avatarName")),
            ]),
            "previousAvatarName": first_owned([
                string_field(previous.get("currentAvatarName")),
                string_field(previous.get("avatarName")),
            ]),
            "currentAvatarImageUrl": string_field(patch.get("currentAvatarImageUrl")),
            "currentAvatarThumbnailImageUrl": string_field(patch.get("currentAvatarThumbnailImageUrl")),
            "previousCurrentAvatarImageUrl": string_field(previous.get("currentAvatarImageUrl")),
            "previousCurrentAvatarThumbnailImageUrl": string_field(previous.get("currentAvatarThumbnailImageUrl")),
        }));
    }
}

fn add_gps_feed_entry(
    output: &mut RealtimeFriendOutput,
    user_id: &str,
    patch: &Value,
    previous: &Value,
    created_at: &str,
) {
    let previous_location = resolve_gps_previous_location(previous);
    let location = string_field(patch.get("location"));
    if !is_real_location(&previous_location)
        || !is_real_location(&location)
        || previous_location == location
    {
        return;
    }
    let (world_name, group_name) = resolve_location_name(&location, patch, Some(previous));
    output.persistence.feed_entries.push(json!({
        "created_at": created_at,
        "type": "GPS",
        "userId": user_id,
        "displayName": display_name(user_id, patch, Some(previous)),
        "location": location,
        "worldName": world_name,
        "previousLocation": previous_location,
        "time": resolve_gps_duration(previous),
        "groupName": group_name,
    }));
}

fn online_offline_feed_entry(
    entry_type: &str,
    user_id: &str,
    patch: &Value,
    previous: &Value,
    location: &str,
    time: i64,
    created_at: &str,
) -> Value {
    let (world_name, group_name) = if is_real_location(location) {
        resolve_location_name(location, patch, Some(previous))
    } else {
        ("".to_string(), "".to_string())
    };
    json!({
        "created_at": created_at,
        "type": entry_type,
        "userId": user_id,
        "displayName": display_name(user_id, patch, Some(previous)),
        "location": location,
        "worldName": world_name,
        "groupName": group_name,
        "time": if time > 0 { json!(time) } else { json!("") },
    })
}

fn add_location_metadata(patch: &mut Map<String, Value>, previous: Option<&Value>, timestamp_ms: i64) {
    let location = string_field(patch.get("location"));
    if location.eq_ignore_ascii_case("traveling") {
        if previous
            .map(|previous| string_field(previous.get("location")).eq_ignore_ascii_case("traveling"))
            .unwrap_or(false)
        {
            return;
        }
        let previous_location = previous.map(resolve_previous_location).unwrap_or_default();
        let previous_timestamp = previous
            .and_then(|previous| int_field(previous.get("locationUpdatedAt")).or_else(|| int_field(previous.get("$location_at"))))
            .unwrap_or(0);
        patch.insert("locationUpdatedAt".into(), Value::from(timestamp_ms));
        patch.insert("$location_at".into(), Value::from(timestamp_ms));
        patch.insert("$travelingToTime".into(), Value::from(timestamp_ms));
        patch.insert("travelingToTime".into(), Value::from(timestamp_ms));
        if is_real_location(&previous_location) {
            patch.insert("$previousLocation".into(), Value::String(previous_location));
            patch.insert("$previousLocation_at".into(), Value::from(previous_timestamp));
        }
        return;
    }

    let previous_travel_location = previous
        .map(|previous| string_field(previous.get("$previousLocation")))
        .unwrap_or_default();
    let previous_location_timestamp = previous
        .and_then(|previous| int_field(previous.get("$previousLocation_at")))
        .unwrap_or(0);
    let returned_to_previous_location =
        !previous_travel_location.is_empty() && previous_travel_location == location;
    let location_timestamp = if returned_to_previous_location && previous_location_timestamp > 0 {
        previous_location_timestamp
    } else {
        timestamp_ms
    };
    patch.insert("locationUpdatedAt".into(), Value::from(location_timestamp));
    patch.insert("$location_at".into(), Value::from(location_timestamp));
    patch.insert("$previousLocation".into(), Value::String(String::new()));
    patch.insert("$previousLocation_at".into(), Value::String(String::new()));
    patch.insert("$travelingToTime".into(), Value::String(String::new()));
    patch.insert("travelingToTime".into(), Value::String(String::new()));
}

fn display_name(user_id: &str, patch: &Value, previous: Option<&Value>) -> String {
    first_owned([
        meaningful_name(patch, user_id),
        previous
            .map(|previous| meaningful_name(previous, user_id))
            .unwrap_or_default(),
        "Unknown".to_string(),
    ])
}

fn meaningful_name(value: &Value, user_id: &str) -> String {
    for key in ["displayName", "username", "id"] {
        let candidate = string_field(value.get(key));
        if !candidate.is_empty()
            && candidate != user_id
            && candidate != "Unknown"
            && !candidate.starts_with("usr_")
        {
            return candidate;
        }
    }
    String::new()
}

fn resolve_location_name(location: &str, patch: &Value, previous: Option<&Value>) -> (String, String) {
    let parsed = parse_location(location);
    (
        first_owned([
            string_field(patch.get("worldName")),
            patch
                .get("world")
                .and_then(|world| world.get("name"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            previous
                .map(|previous| string_field(previous.get("worldName")))
                .unwrap_or_default(),
            parsed.world_id.clone(),
            location.to_string(),
        ]),
        first_owned([
            string_field(patch.get("groupName")),
            previous
                .map(|previous| string_field(previous.get("groupName")))
                .unwrap_or_default(),
            parsed.group_id.clone(),
        ]),
    )
}

fn resolve_previous_location(previous: &Value) -> String {
    first_non_empty([
        string_field(previous.get("location")).as_str(),
        previous
            .get("$location")
            .and_then(|location| location.get("tag"))
            .and_then(Value::as_str)
            .unwrap_or(""),
    ])
    .to_string()
}

fn resolve_gps_previous_location(previous: &Value) -> String {
    let previous_location = string_field(previous.get("location"));
    if previous_location.eq_ignore_ascii_case("traveling") {
        return string_field(previous.get("$previousLocation"));
    }
    previous_location
}

fn resolve_gps_duration(previous: &Value) -> i64 {
    if string_field(previous.get("location")).eq_ignore_ascii_case("traveling") {
        let previous_timestamp = int_field(previous.get("$previousLocation_at")).unwrap_or(0);
        return if previous_timestamp > 0 {
            Utc::now().timestamp_millis() - previous_timestamp
        } else {
            0
        };
    }
    let record = FriendRecord::deserialize(previous.clone()).ok();
    record
        .as_ref()
        .map(|record| duration_ms(record, Utc::now().timestamp_millis()))
        .unwrap_or(0)
}

fn duration_ms(previous: &FriendRecord, now_ms: i64) -> i64 {
    let previous_value = record_to_value(previous);
    let timestamp = int_field(previous_value.get("locationUpdatedAt"))
        .or_else(|| int_field(previous_value.get("$location_at")))
        .unwrap_or(0);
    if timestamp > 0 {
        now_ms.saturating_sub(timestamp)
    } else {
        0
    }
}

fn is_online_state(record: &FriendRecord) -> bool {
    record.state_bucket == "online" || record.state == "online"
}

fn is_online_value(value: &Value) -> bool {
    string_field(value.get("stateBucket")) == "online" || string_field(value.get("state")) == "online"
}

fn is_real_location(location: &str) -> bool {
    let location = location.trim();
    !location.is_empty()
        && location != "offline"
        && location != "offline:offline"
        && location != "traveling"
        && location != "private"
}

fn string_or_previous(patch: &Value, previous: &Value, key: &str) -> String {
    let value = string_field(patch.get(key));
    if value.is_empty() {
        string_field(previous.get(key))
    } else {
        value
    }
}

fn object_with_pending_offline(value: Value, pending_offline: bool) -> Value {
    let mut object = value.as_object().cloned().unwrap_or_default();
    object.insert("pendingOffline".into(), Value::Bool(pending_offline));
    Value::Object(object)
}

fn string_field(value: Option<&Value>) -> String {
    value
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .unwrap_or_else(|| {
            value
                .filter(|value| !value.is_null())
                .map(ToString::to_string)
                .unwrap_or_default()
        })
}

fn int_field(value: Option<&Value>) -> Option<i64> {
    value
        .and_then(Value::as_i64)
        .or_else(|| value.and_then(Value::as_u64).and_then(|value| i64::try_from(value).ok()))
        .or_else(|| value.and_then(Value::as_str).and_then(|value| value.parse().ok()))
}

fn bool_field(value: Option<&Value>) -> bool {
    value.and_then(Value::as_bool).unwrap_or(false)
}

trait JsonHas {
    fn has(&self, key: &str) -> bool;
}

impl JsonHas for Value {
    fn has(&self, key: &str) -> bool {
        self.as_object()
            .map(|object| object.contains_key(key))
            .unwrap_or(false)
    }
}

fn first_string<'a>(values: impl IntoIterator<Item = Option<&'a str>>) -> String {
    values
        .into_iter()
        .flatten()
        .find(|value| !value.trim().is_empty())
        .unwrap_or("")
        .trim()
        .to_string()
}

fn first_non_empty<'a>(values: impl IntoIterator<Item = &'a str>) -> &'a str {
    values
        .into_iter()
        .find(|value| !value.trim().is_empty())
        .unwrap_or("")
        .trim()
}

fn first_owned(values: impl IntoIterator<Item = String>) -> String {
    values
        .into_iter()
        .find(|value| !value.trim().is_empty())
        .unwrap_or_default()
        .trim()
        .to_string()
}

#[derive(Default)]
struct ParsedLocation {
    world_id: String,
    instance_id: String,
    group_id: String,
}

impl ParsedLocation {
    fn to_value(&self, tag: &str) -> Value {
        json!({
            "tag": tag,
            "worldId": self.world_id,
            "instanceId": self.instance_id,
            "groupId": self.group_id,
        })
    }
}

fn parse_location(location: &str) -> ParsedLocation {
    let mut parsed = ParsedLocation::default();
    let location = location.trim();
    if let Some((world_id, instance)) = location.split_once(':') {
        parsed.world_id = world_id.to_string();
        parsed.instance_id = instance.to_string();
    } else if location.starts_with("wrld_") {
        parsed.world_id = location.to_string();
    }
    if let Some(start) = location.find("group(") {
        let rest = &location[start + "group(".len()..];
        if let Some(end) = rest.find(')') {
            parsed.group_id = rest[..end].to_string();
        }
    }
    parsed
}

struct EventTime {
    iso: String,
    timestamp_ms: i64,
}

impl EventTime {
    fn from_received_at(received_at: &str) -> Self {
        let timestamp_ms = DateTime::parse_from_rfc3339(received_at)
            .map(|value| value.timestamp_millis())
            .unwrap_or_else(|_| Utc::now().timestamp_millis());
        Self {
            iso: received_at.to_string(),
            timestamp_ms,
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use vrcx_0_domain::friends::{FriendRecord, FriendRosterBaseline};
    use vrcx_0_domain::realtime::RealtimeWsMessagePayload;

    use super::{PendingOfflineTimerAction, RealtimeFriendApplyResult, RealtimeFriendsRuntime};

    #[test]
    fn stores_normalized_friend_baseline() {
        let runtime = RealtimeFriendsRuntime::new();
        let result = runtime.set_baseline(
            FriendRosterBaseline {
                current_user_id: " usr_self ".into(),
                endpoint: " https://api.example.test ".into(),
                websocket: " wss://ws.example.test ".into(),
                friends_by_id: [(
                    "usr_friend".to_string(),
                    FriendRecord {
                        display_name: "Friend".into(),
                        state: "active".into(),
                        ..FriendRecord::default()
                    },
                )]
                .into_iter()
                .collect(),
            },
            7,
            3,
        );

        assert!(result.accepted);
        assert_eq!(result.friend_count, 1);
        assert_eq!(result.generation, 7);
        assert_eq!(result.baseline_revision, 3);
        let snapshot = runtime.snapshot().unwrap();
        assert_eq!(snapshot.current_user_id, "usr_self");
        assert_eq!(snapshot.generation, 7);
        assert_eq!(snapshot.baseline_revision, 3);
        assert_eq!(
            snapshot
                .friends_by_id
                .get("usr_friend")
                .unwrap()
                .state_bucket,
            "active"
        );
    }

    #[test]
    fn baseline_generation_uses_realtime_transport_generation_after_clear() {
        let runtime = RealtimeFriendsRuntime::new();
        runtime.clear();

        let result = runtime.set_baseline(FriendRosterBaseline::default(), 1, 0);

        assert!(result.accepted);
        assert_eq!(result.generation, 1);
        assert_eq!(runtime.snapshot().unwrap().generation, 1);
    }

    #[test]
    fn friend_online_writes_online_feed_and_projection() {
        let runtime = RealtimeFriendsRuntime::new();
        runtime.set_baseline(
            FriendRosterBaseline {
                current_user_id: "usr_self".into(),
                friends_by_id: [(
                    "usr_friend".to_string(),
                    FriendRecord {
                        id: "usr_friend".into(),
                        display_name: "Friend".into(),
                        state: "offline".into(),
                        state_bucket: "offline".into(),
                        location: "offline".into(),
                        ..FriendRecord::default()
                    },
                )]
                .into_iter()
                .collect(),
                ..FriendRosterBaseline::default()
            },
            1,
            0,
        );

        let RealtimeFriendApplyResult::Output(output) =
            runtime.apply_ws_message(&RealtimeWsMessagePayload {
                json: json!({
                    "type": "friend-online",
                    "content": {
                        "userId": "usr_friend",
                        "user": {
                            "id": "usr_friend",
                            "displayName": "Friend",
                            "location": "wrld_1:123"
                        }
                    }
                }),
                raw: "{}".into(),
                received_at: "2026-05-15T00:00:00Z".into(),
            })
        else {
            panic!("friend-online should produce an output");
        };

        assert_eq!(output.projection.patches[0].state_bucket, "online");
        assert_eq!(output.persistence.feed_entries[0]["type"], "Online");
    }

    #[test]
    fn pending_offline_timer_writes_offline_feed_when_it_fires() {
        let runtime = RealtimeFriendsRuntime::new();
        runtime.set_baseline(
            FriendRosterBaseline {
                current_user_id: "usr_self".into(),
                friends_by_id: [(
                    "usr_friend".to_string(),
                    FriendRecord {
                        id: "usr_friend".into(),
                        display_name: "Friend".into(),
                        state: "online".into(),
                        state_bucket: "online".into(),
                        location: "wrld_1:123".into(),
                        extra: [("$location_at".into(), json!(1_700_000_000_000i64))]
                            .into_iter()
                            .collect(),
                        ..FriendRecord::default()
                    },
                )]
                .into_iter()
                .collect(),
                ..FriendRosterBaseline::default()
            },
            1,
            0,
        );
        let RealtimeFriendApplyResult::Output(output) =
            runtime.apply_ws_message(&RealtimeWsMessagePayload {
                json: json!({
                    "type": "friend-offline",
                    "content": { "userId": "usr_friend" }
                }),
                raw: "{}".into(),
                received_at: "2026-05-15T00:00:00Z".into(),
            })
        else {
            panic!("friend-offline should produce an output");
        };
        let PendingOfflineTimerAction::Schedule { token, .. } = output.timer_action else {
            panic!("offline should schedule pending timer");
        };

        let fired = runtime
            .fire_pending_offline("usr_friend", token, "2026-05-15T00:03:00Z".into())
            .unwrap();

        assert_eq!(fired.projection.patches[0].state_bucket, "offline");
        assert_eq!(fired.persistence.feed_entries[0]["type"], "Offline");
    }

    #[test]
    fn clear_drops_baseline() {
        let runtime = RealtimeFriendsRuntime::new();
        runtime.set_baseline(FriendRosterBaseline::default(), 7, 0);

        let generation = runtime.clear();

        assert!(generation > 7);
        assert!(runtime.snapshot().is_none());
    }
}
