use std::sync::{Arc, Mutex};

use chrono::{DateTime, Utc};
use serde_json::{json, Map, Value};
use vrcx_0_domain::realtime::RealtimeWsMessagePayload;
use vrcx_0_persistence::game_log::GameLogLocationEntry;
use vrcx_0_persistence::realtime::{
    AvatarHistoryUpsert, AvatarTimeSpentUpsert, RealtimePersistenceBatch,
};

use super::types::{
    RealtimeCurrentUserAuthority, RealtimeCurrentUserOutput, RealtimeCurrentUserProjection,
};

#[derive(Clone, Debug, Default)]
struct RealtimeCurrentUserState {
    generation: u64,
    current_user_id: String,
    snapshot: Value,
}

const CURRENT_USER_REFRESH_LOCAL_AUTHORITY_FIELDS: &[&str] = &[
    "friends",
    "onlineFriends",
    "activeFriends",
    "offlineFriends",
    "status",
    "statusDescription",
    "state",
    "stateBucket",
    "pendingOffline",
    "location",
    "$location",
    "$location_at",
    "locationUpdatedAt",
    "worldId",
    "instanceId",
    "travelingToLocation",
    "travelingToWorld",
    "travelingToInstance",
    "$travelingToLocation",
    "$travelingToTime",
    "travelingToTime",
    "$previousLocation",
    "$previousLocation_at",
];

#[derive(Clone, Debug, Default)]
pub struct RealtimeCurrentUserRuntime {
    state: Arc<Mutex<RealtimeCurrentUserState>>,
}

impl RealtimeCurrentUserRuntime {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set_snapshot(&self, current_user_id: String, generation: u64, snapshot: Value) {
        let mut state = self.lock_state();
        state.current_user_id = normalize_id(&current_user_id);
        state.generation = generation;
        state.snapshot = normalize_snapshot(snapshot, &state.current_user_id);
    }

    pub fn clear(&self) {
        let mut state = self.lock_state();
        state.generation = state.generation.saturating_add(1);
        state.current_user_id.clear();
        state.snapshot = Value::Null;
    }

    pub fn apply_ws_message(
        &self,
        generation: u64,
        payload: &RealtimeWsMessagePayload,
        authority: RealtimeCurrentUserAuthority,
    ) -> Option<RealtimeCurrentUserOutput> {
        let message_type = payload.json.get("type").and_then(Value::as_str)?;
        if !matches!(message_type, "user-update" | "user-location") {
            return None;
        }
        let content = payload.json.get("content").unwrap_or(&Value::Null);
        let now = EventTime::from_received_at(&payload.received_at);
        let mut state = self.lock_state();
        if state.generation != generation || state.current_user_id.is_empty() {
            return None;
        }

        match message_type {
            "user-update" => apply_user_update(&mut state, content, &now, &authority),
            "user-location" => apply_user_location(&mut state, content, &now, &authority),
            _ => None,
        }
    }

    pub fn apply_refreshed_snapshot(
        &self,
        generation: u64,
        snapshot: Value,
        overlay_patch: Value,
        authority: RealtimeCurrentUserAuthority,
    ) -> Option<RealtimeCurrentUserOutput> {
        let mut state = self.lock_state();
        if state.generation != generation || state.current_user_id.is_empty() {
            return None;
        }
        let event_user_id = snapshot
            .get("id")
            .map(|value| normalize_id(&string_field(Some(value))))
            .unwrap_or_default();
        if event_user_id != state.current_user_id {
            return None;
        }
        let mut patch = snapshot.as_object().cloned().unwrap_or_default();
        remove_current_user_refresh_local_authority_fields(&mut patch);
        if let Some(overlay) = overlay_patch.as_object() {
            for (key, value) in overlay {
                patch.insert(key.clone(), value.clone());
            }
        }
        apply_current_user_patch(
            &mut state,
            Value::Object(patch),
            &EventTime::now(),
            &authority,
            true,
            false,
        )
    }

    fn lock_state(&self) -> std::sync::MutexGuard<'_, RealtimeCurrentUserState> {
        self.state.lock().unwrap_or_else(|error| error.into_inner())
    }
}

fn remove_current_user_refresh_local_authority_fields(patch: &mut Map<String, Value>) {
    for field in CURRENT_USER_REFRESH_LOCAL_AUTHORITY_FIELDS {
        patch.remove(*field);
    }
}

fn apply_user_update(
    state: &mut RealtimeCurrentUserState,
    content: &Value,
    now: &EventTime,
    authority: &RealtimeCurrentUserAuthority,
) -> Option<RealtimeCurrentUserOutput> {
    let mut patch = content
        .get("user")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let event_user_id = first_owned([
        string_field(patch.get("id")),
        string_field(content.get("userId")),
    ]);
    if event_user_id != state.current_user_id {
        return None;
    }
    if let Some(state_bucket) = resolve_state_bucket(content, &patch, state.snapshot.as_object()) {
        patch.insert("stateBucket".into(), Value::String(state_bucket));
    }
    if patch.is_empty() {
        return None;
    }
    apply_current_user_patch(state, Value::Object(patch), now, authority, true, false)
}

fn apply_user_location(
    state: &mut RealtimeCurrentUserState,
    content: &Value,
    now: &EventTime,
    authority: &RealtimeCurrentUserAuthority,
) -> Option<RealtimeCurrentUserOutput> {
    let event_user_id = normalize_id(&string_field(content.get("userId")));
    if event_user_id != state.current_user_id {
        return None;
    }
    let patch = build_location_patch(
        content.get("location"),
        content.get("travelingToLocation"),
        content.get("worldId"),
    );
    apply_current_user_patch(state, patch, now, authority, true, true)
}

fn apply_current_user_patch(
    state: &mut RealtimeCurrentUserState,
    patch: Value,
    now: &EventTime,
    authority: &RealtimeCurrentUserAuthority,
    applies_game_log_authority: bool,
    writes_location_fallback: bool,
) -> Option<RealtimeCurrentUserOutput> {
    let previous = state.snapshot.clone();
    let mut projection_patch = patch.as_object().cloned().unwrap_or_default();
    let mut merged = previous.as_object().cloned().unwrap_or_default();
    if let Some(patch_object) = patch.as_object() {
        for (key, value) in patch_object {
            merged.insert(key.clone(), value.clone());
        }
    }
    if applies_game_log_authority {
        if let Some(authority_patch) = game_log_authority_patch(authority) {
            for (key, value) in &authority_patch {
                merged.insert(key.clone(), value.clone());
                projection_patch.insert(key.clone(), value.clone());
            }
        }
    }
    merged.insert("id".into(), Value::String(state.current_user_id.clone()));
    projection_patch.insert("id".into(), Value::String(state.current_user_id.clone()));
    let (snapshot, mut persistence) = apply_avatar_wear_transition(
        Value::Object(merged.clone()),
        &previous,
        authority.is_game_running,
        now,
    );
    if writes_location_fallback && !authority.is_game_running {
        if let Some(location_entry) = location_game_log_entry(&snapshot, now) {
            persistence.game_log_locations.push(location_entry);
        }
    }
    let game_state_patch = if writes_location_fallback && !authority.is_game_running {
        Some(location_game_state_patch(&snapshot, now))
    } else {
        None
    };

    state.snapshot = snapshot.clone();
    Some(RealtimeCurrentUserOutput {
        owner_user_id: state.current_user_id.clone(),
        projection: RealtimeCurrentUserProjection {
            generation: state.generation,
            patch: Value::Object(projection_patch),
            snapshot,
            game_state_patch,
        },
        persistence,
    })
}

fn game_log_authority_patch(
    authority: &RealtimeCurrentUserAuthority,
) -> Option<Map<String, Value>> {
    if !authority.is_game_running || !authority.game_log_enabled {
        return None;
    }
    let game_log_location = authority.game_log_location.trim();
    let game_log_destination = authority.game_log_destination.trim();
    let (location, traveling_to_location) = if game_log_location.eq_ignore_ascii_case("traveling")
        && is_real_instance(game_log_destination)
    {
        ("traveling", game_log_destination)
    } else if is_real_instance(game_log_location) {
        (game_log_location, "")
    } else {
        return None;
    };
    let parsed = parse_location(location);
    let parsed_traveling = parse_location(traveling_to_location);
    let world_id = first_owned([parsed.world_id.clone(), parsed_traveling.world_id.clone()]);
    let mut patch = Map::new();
    patch.insert("location".into(), Value::String(location.to_string()));
    patch.insert("worldId".into(), Value::String(world_id));
    patch.insert(
        "instanceId".into(),
        Value::String(parsed.instance_id.clone()),
    );
    patch.insert(
        "travelingToLocation".into(),
        Value::String(traveling_to_location.to_string()),
    );
    patch.insert(
        "travelingToWorld".into(),
        Value::String(parsed_traveling.world_id.clone()),
    );
    patch.insert(
        "travelingToInstance".into(),
        Value::String(parsed_traveling.instance_id.clone()),
    );
    patch.insert("$location".into(), parsed.to_value(location));
    patch.insert(
        "$travelingToLocation".into(),
        parsed_traveling.to_value(traveling_to_location),
    );
    let world_name = authority.game_log_world_name.trim();
    if !world_name.is_empty() {
        patch.insert("worldName".into(), Value::String(world_name.to_string()));
    }
    Some(patch)
}

fn apply_avatar_wear_transition(
    next_snapshot: Value,
    previous_snapshot: &Value,
    is_game_running: bool,
    now: &EventTime,
) -> (Value, RealtimePersistenceBatch) {
    let mut next = next_snapshot.as_object().cloned().unwrap_or_default();
    let previous = previous_snapshot.as_object();
    let previous_avatar_id = previous
        .and_then(|previous| previous.get("currentAvatar"))
        .map(|value| normalize_id(&string_field(Some(value))))
        .unwrap_or_default();
    let next_avatar_id = normalize_id(&string_field(next.get("currentAvatar")));
    let previous_swap_time = previous
        .and_then(|previous| previous.get("$previousAvatarSwapTime"))
        .and_then(|value| int_field(Some(value)))
        .unwrap_or(0);
    let mut persistence = RealtimePersistenceBatch::default();

    if !is_game_running {
        next.insert("$previousAvatarSwapTime".into(), Value::Null);
        return (Value::Object(next), persistence);
    }
    if next_avatar_id.is_empty() {
        next.insert(
            "$previousAvatarSwapTime".into(),
            if previous_swap_time > 0 {
                Value::from(previous_swap_time)
            } else {
                Value::Null
            },
        );
        return (Value::Object(next), persistence);
    }
    if previous_avatar_id.is_empty() {
        let swap_time = int_field(next.get("$previousAvatarSwapTime")).unwrap_or(now.timestamp_ms);
        next.insert("$previousAvatarSwapTime".into(), Value::from(swap_time));
        persistence.avatar_history_upserts.push(AvatarHistoryUpsert {
            avatar_id: next_avatar_id,
            created_at: now.iso.clone(),
        });
        return (Value::Object(next), persistence);
    }
    if previous_avatar_id != next_avatar_id {
        next.insert("$previousAvatarSwapTime".into(), Value::from(now.timestamp_ms));
        persistence.avatar_history_upserts.push(AvatarHistoryUpsert {
            avatar_id: next_avatar_id,
            created_at: now.iso.clone(),
        });
        if previous_swap_time > 0 {
            persistence
                .avatar_time_spent_upserts
                .push(AvatarTimeSpentUpsert {
                    avatar_id: previous_avatar_id,
                    created_at: now.iso.clone(),
                    time_spent: now.timestamp_ms.saturating_sub(previous_swap_time),
                });
        }
        return (Value::Object(next), persistence);
    }
    let next_swap_time = int_field(next.get("$previousAvatarSwapTime")).unwrap_or(0);
    next.insert(
        "$previousAvatarSwapTime".into(),
        Value::from(first_positive([previous_swap_time, next_swap_time, now.timestamp_ms])),
    );
    (Value::Object(next), persistence)
}

fn build_location_patch(
    location: Option<&Value>,
    traveling_to_location: Option<&Value>,
    world_id: Option<&Value>,
) -> Value {
    let location = string_field(location);
    let traveling = string_field(traveling_to_location);
    let parsed_location = parse_location(&location);
    let parsed_traveling = parse_location(&traveling);
    json!({
        "location": location,
        "worldId": first_owned([
            string_field(world_id),
            parsed_location.world_id.clone(),
        ]),
        "instanceId": parsed_location.instance_id,
        "travelingToLocation": traveling,
        "travelingToWorld": parsed_traveling.world_id,
        "travelingToInstance": parsed_traveling.instance_id,
        "$location": parsed_location.to_value(&location),
        "$travelingToLocation": parsed_traveling.to_value(&traveling),
    })
}

fn location_game_log_entry(snapshot: &Value, now: &EventTime) -> Option<GameLogLocationEntry> {
    let location = string_field(snapshot.get("location"));
    if !is_real_instance(&location) {
        return None;
    }
    let parsed = parse_location(&location);
    let world_name = string_field(snapshot.get("worldName")).trim().to_string();
    Some(GameLogLocationEntry {
        created_at: now.iso.clone(),
        location,
        world_id: parsed.world_id,
        world_name,
        time: 0,
        group_name: parsed.group_id,
    })
}

fn location_game_state_patch(snapshot: &Value, now: &EventTime) -> Value {
    let location = string_field(snapshot.get("location"));
    if !is_real_instance(&location) {
        return json!({
            "currentLocation": "",
            "currentWorldId": "",
            "currentWorldName": "",
            "currentDestination": "",
            "currentLocationStartedAt": null,
            "currentLocationPlayerIds": [],
            "currentLocationPlayers": [],
        });
    }
    let parsed = parse_location(&location);
    let world_name = string_field(snapshot.get("worldName")).trim().to_string();
    json!({
        "currentLocation": location,
        "currentWorldId": parsed.world_id,
        "currentWorldName": world_name,
        "currentDestination": "",
        "currentLocationStartedAt": now.iso,
        "currentLocationPlayerIds": [],
        "currentLocationPlayers": [],
        "lastGameLogAt": now.iso,
        "lastGameLogType": "location",
    })
}

fn normalize_snapshot(snapshot: Value, current_user_id: &str) -> Value {
    let mut object = snapshot.as_object().cloned().unwrap_or_default();
    if !current_user_id.is_empty() {
        object.insert("id".into(), Value::String(current_user_id.to_string()));
    }
    Value::Object(object)
}

fn resolve_state_bucket(
    content: &Value,
    patch: &Map<String, Value>,
    previous: Option<&Map<String, Value>>,
) -> Option<String> {
    for value in [
        string_field(content.get("state")),
        string_field(content.get("stateBucket")),
        string_field(patch.get("state")),
        string_field(patch.get("stateBucket")),
        previous
            .map(|previous| string_field(previous.get("stateBucket")))
            .unwrap_or_default(),
        previous
            .map(|previous| string_field(previous.get("state")))
            .unwrap_or_default(),
    ] {
        match value.trim().to_ascii_lowercase().as_str() {
            "online" => return Some("online".into()),
            "active" => return Some("active".into()),
            "offline" => return Some("offline".into()),
            _ => {}
        }
    }
    None
}

fn normalize_id(value: &str) -> String {
    value.trim().to_string()
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

fn first_owned(values: impl IntoIterator<Item = String>) -> String {
    values
        .into_iter()
        .find(|value| !value.trim().is_empty())
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn first_positive(values: impl IntoIterator<Item = i64>) -> i64 {
    values.into_iter().find(|value| *value > 0).unwrap_or(0)
}

fn is_real_instance(location: &str) -> bool {
    let location = location.trim().to_ascii_lowercase();
    if location.is_empty() || location.starts_with("local") {
        return false;
    }
    !matches!(
        location.as_str(),
        ":"
            | "offline"
            | "offline:offline"
            | "traveling"
            | "traveling:traveling"
            | "private"
            | "private:private"
    )
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
    fn now() -> Self {
        let now = Utc::now();
        Self {
            iso: now.to_rfc3339(),
            timestamp_ms: now.timestamp_millis(),
        }
    }

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
