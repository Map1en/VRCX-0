use std::sync::{Arc, Mutex};

use chrono::{DateTime, Utc};
use serde_json::{json, Map, Value};
use vrcx_0_core::location::parse_location;
use vrcx_0_core::realtime::RealtimeWsMessagePayload;
use vrcx_0_persistence::game_log::GameLogLocationEntry;
use vrcx_0_persistence::realtime::{
    AvatarHistoryUpsert, AvatarTimeSpentUpsert, RealtimePersistenceBatch,
};

use super::{
    RealtimeCurrentUserAuthority, RealtimeCurrentUserOutput, RealtimeCurrentUserProjection,
};

#[derive(Clone, Debug, Default)]
struct RealtimeCurrentUserState {
    generation: u64,
    current_user_id: String,
    snapshot: RealtimeCurrentUserStateSnapshot,
}

#[derive(Clone, Debug, Default)]
struct RealtimeCurrentUserStateSnapshot {
    raw: Map<String, Value>,
    user_id: String,
    display_name: String,
    location: String,
    traveling_to_location: String,
    world_id: String,
    instance_id: String,
    status: String,
    status_description: String,
    bio: String,
    current_avatar: String,
    current_avatar_image_url: String,
    state_bucket: String,
    world_name: String,
    previous_avatar_swap_time: i64,
}

impl RealtimeCurrentUserStateSnapshot {
    fn from_value(snapshot: serde_json::Value, current_user_id: &str) -> Self {
        Self::from_map(
            snapshot.as_object().cloned().unwrap_or_default(),
            current_user_id,
        )
    }

    fn from_map(mut raw: Map<String, Value>, current_user_id: &str) -> Self {
        if !current_user_id.is_empty() {
            raw.insert("id".into(), Value::String(current_user_id.to_string()));
        }
        let mut snapshot = Self {
            raw,
            ..Self::default()
        };
        snapshot.refresh_typed_fields();
        snapshot
    }

    fn to_map(&self) -> Map<String, Value> {
        let mut raw = self.raw.clone();
        if !self.user_id.is_empty() {
            raw.insert("id".into(), Value::String(self.user_id.clone()));
        }
        raw
    }

    fn set_previous_avatar_swap_time(&mut self, value: Option<i64>) {
        self.previous_avatar_swap_time = value.unwrap_or_default();
        self.raw.insert(
            "$previousAvatarSwapTime".into(),
            value.map(Value::from).unwrap_or(Value::Null),
        );
    }

    fn refresh_typed_fields(&mut self) {
        self.user_id = normalize_id(&string_field(self.raw.get("id")));
        self.display_name = string_field(self.raw.get("displayName"));
        self.location = string_field(self.raw.get("location"));
        self.traveling_to_location = string_field(self.raw.get("travelingToLocation"));
        self.world_id = string_field(self.raw.get("worldId"));
        self.instance_id = string_field(self.raw.get("instanceId"));
        self.status = string_field(self.raw.get("status"));
        self.status_description = string_field(self.raw.get("statusDescription"));
        self.bio = string_field(self.raw.get("bio"));
        self.current_avatar = normalize_id(&string_field(self.raw.get("currentAvatar")));
        self.current_avatar_image_url = string_field(self.raw.get("currentAvatarImageUrl"));
        self.state_bucket = string_field(self.raw.get("stateBucket"));
        self.world_name = string_field(self.raw.get("worldName"));
        self.previous_avatar_swap_time =
            int_field(self.raw.get("$previousAvatarSwapTime")).unwrap_or_default();
    }
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

    pub fn set_snapshot(
        &self,
        current_user_id: String,
        generation: u64,
        snapshot: serde_json::Value,
    ) {
        let mut state = self.lock_state();
        state.current_user_id = normalize_id(&current_user_id);
        state.generation = generation;
        state.snapshot =
            RealtimeCurrentUserStateSnapshot::from_value(snapshot, &state.current_user_id);
    }

    pub fn clear(&self) {
        let mut state = self.lock_state();
        state.generation = state.generation.saturating_add(1);
        state.current_user_id.clear();
        state.snapshot = RealtimeCurrentUserStateSnapshot::default();
    }

    pub fn snapshot_value(&self) -> Option<serde_json::Value> {
        let state = self.lock_state();
        if state.current_user_id.is_empty() {
            return None;
        }
        Some(serde_json::Value::Object(state.snapshot.to_map()))
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
        snapshot: serde_json::Value,
        overlay_patch: serde_json::Value,
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
            patch,
            &EventTime::now(),
            &authority,
            true,
            false,
            false,
        )
    }

    pub fn apply_game_running_state(
        &self,
        generation: u64,
        is_game_running: bool,
    ) -> Option<RealtimeCurrentUserOutput> {
        let mut state = self.lock_state();
        if state.generation != generation || state.current_user_id.is_empty() {
            return None;
        }
        apply_current_user_patch(
            &mut state,
            Map::new(),
            &EventTime::now(),
            &RealtimeCurrentUserAuthority {
                is_game_running,
                ..RealtimeCurrentUserAuthority::default()
            },
            false,
            false,
            is_game_running,
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
    patch.remove("state");
    let event_user_id = first_owned([
        string_field(patch.get("id")),
        string_field(content.get("userId")),
    ]);
    if event_user_id != state.current_user_id {
        return None;
    }
    let previous_snapshot = state.snapshot.to_map();
    if let Some(state_bucket) = resolve_state_bucket(content, &patch, Some(&previous_snapshot)) {
        patch.insert("stateBucket".into(), Value::String(state_bucket));
    }
    if patch.is_empty() {
        return None;
    }
    apply_current_user_patch(state, patch, now, authority, true, false, false)
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
    apply_current_user_patch(state, patch, now, authority, true, true, false)
}

fn apply_current_user_patch(
    state: &mut RealtimeCurrentUserState,
    patch: Map<String, Value>,
    now: &EventTime,
    authority: &RealtimeCurrentUserAuthority,
    applies_game_log_authority: bool,
    writes_location_fallback: bool,
    records_current_avatar_history: bool,
) -> Option<RealtimeCurrentUserOutput> {
    let previous = state.snapshot.clone();
    let mut projection_patch = patch.clone();
    let mut merged = previous.to_map();
    for (key, value) in &patch {
        merged.insert(key.clone(), value.clone());
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
        RealtimeCurrentUserStateSnapshot::from_map(merged, &state.current_user_id),
        &previous,
        authority.is_game_running,
        now,
        records_current_avatar_history,
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

    let snapshot_map = snapshot.to_map();
    state.snapshot = snapshot;
    Some(RealtimeCurrentUserOutput {
        owner_user_id: state.current_user_id.clone(),
        projection: RealtimeCurrentUserProjection {
            generation: state.generation,
            patch: projection_patch,
            snapshot: snapshot_map,
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
    patch.insert("$location".into(), parsed.to_frontend_value(location));
    patch.insert(
        "$travelingToLocation".into(),
        parsed_traveling.to_frontend_value(traveling_to_location),
    );
    let world_name = authority.game_log_world_name.trim();
    if !world_name.is_empty() {
        patch.insert("worldName".into(), Value::String(world_name.to_string()));
    }
    Some(patch)
}

fn apply_avatar_wear_transition(
    mut next: RealtimeCurrentUserStateSnapshot,
    previous: &RealtimeCurrentUserStateSnapshot,
    is_game_running: bool,
    now: &EventTime,
    records_current_avatar_history: bool,
) -> (RealtimeCurrentUserStateSnapshot, RealtimePersistenceBatch) {
    let previous_avatar_id = previous.current_avatar.clone();
    let next_avatar_id = next.current_avatar.clone();
    let previous_swap_time = previous.previous_avatar_swap_time;
    let mut persistence = RealtimePersistenceBatch::default();

    if !is_game_running {
        if !previous_avatar_id.is_empty() && previous_swap_time > 0 {
            persistence
                .avatar_time_spent_upserts
                .push(AvatarTimeSpentUpsert {
                    avatar_id: previous_avatar_id,
                    created_at: now.iso.clone(),
                    time_spent: now.timestamp_ms.saturating_sub(previous_swap_time),
                });
        }
        next.set_previous_avatar_swap_time(None);
        return (next, persistence);
    }
    if next_avatar_id.is_empty() {
        next.set_previous_avatar_swap_time((previous_swap_time > 0).then_some(previous_swap_time));
        return (next, persistence);
    }
    if previous_avatar_id.is_empty() {
        let swap_time = first_positive([next.previous_avatar_swap_time, now.timestamp_ms]);
        next.set_previous_avatar_swap_time(Some(swap_time));
        persistence
            .avatar_history_upserts
            .push(AvatarHistoryUpsert {
                avatar_id: next_avatar_id,
                created_at: now.iso.clone(),
            });
        return (next, persistence);
    }
    if previous_avatar_id != next_avatar_id {
        next.set_previous_avatar_swap_time(Some(now.timestamp_ms));
        persistence
            .avatar_history_upserts
            .push(AvatarHistoryUpsert {
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
        return (next, persistence);
    }
    let next_swap_time = next.previous_avatar_swap_time;
    if records_current_avatar_history || (previous_swap_time <= 0 && next_swap_time <= 0) {
        persistence
            .avatar_history_upserts
            .push(AvatarHistoryUpsert {
                avatar_id: next_avatar_id,
                created_at: now.iso.clone(),
            });
    }
    next.set_previous_avatar_swap_time(Some(first_positive([
        previous_swap_time,
        next_swap_time,
        now.timestamp_ms,
    ])));
    (next, persistence)
}

fn build_location_patch(
    location: Option<&Value>,
    traveling_to_location: Option<&Value>,
    world_id: Option<&Value>,
) -> Map<String, Value> {
    let location = string_field(location);
    let traveling = string_field(traveling_to_location);
    let parsed_location = parse_location(&location);
    let parsed_traveling = parse_location(&traveling);
    let mut patch = Map::new();
    patch.insert("location".into(), Value::String(location.clone()));
    patch.insert(
        "worldId".into(),
        Value::String(first_owned([
            string_field(world_id),
            parsed_location.world_id.clone(),
        ])),
    );
    patch.insert(
        "instanceId".into(),
        Value::String(parsed_location.instance_id.clone()),
    );
    patch.insert(
        "travelingToLocation".into(),
        Value::String(traveling.clone()),
    );
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
        parsed_traveling.to_frontend_value(&traveling),
    );
    patch
}

fn location_game_log_entry(
    snapshot: &RealtimeCurrentUserStateSnapshot,
    now: &EventTime,
) -> Option<GameLogLocationEntry> {
    let location = snapshot.location.clone();
    if !is_real_instance(&location) {
        return None;
    }
    let parsed = parse_location(&location);
    let world_name = snapshot.world_name.trim().to_string();
    Some(GameLogLocationEntry {
        created_at: now.iso.clone(),
        location,
        world_id: parsed.world_id,
        world_name,
        time: 0,
        group_name: parsed.group_id.unwrap_or_default(),
    })
}

fn location_game_state_patch(
    snapshot: &RealtimeCurrentUserStateSnapshot,
    now: &EventTime,
) -> Map<String, Value> {
    let location = snapshot.location.clone();
    if !is_real_instance(&location) {
        return map_from_json(json!({
            "currentLocation": "",
            "currentWorldId": "",
            "currentWorldName": "",
            "currentDestination": "",
            "currentLocationStartedAt": null,
            "currentLocationPlayerIds": [],
            "currentLocationPlayers": [],
        }));
    }
    let parsed = parse_location(&location);
    let world_name = snapshot.world_name.trim().to_string();
    map_from_json(json!({
        "currentLocation": location,
        "currentWorldId": parsed.world_id,
        "currentWorldName": world_name,
        "currentDestination": "",
        "currentLocationStartedAt": now.iso,
        "currentLocationPlayerIds": [],
        "currentLocationPlayers": [],
        "lastGameLogAt": now.iso,
        "lastGameLogType": "location",
    }))
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

fn map_from_json(value: Value) -> Map<String, Value> {
    value.as_object().cloned().unwrap_or_default()
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
        .or_else(|| {
            value
                .and_then(Value::as_u64)
                .and_then(|value| i64::try_from(value).ok())
        })
        .or_else(|| {
            value
                .and_then(Value::as_str)
                .and_then(|value| value.parse().ok())
        })
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
        ":" | "offline"
            | "offline:offline"
            | "traveling"
            | "traveling:traveling"
            | "private"
            | "private:private"
    )
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn current_user_projection_serializes_object_shape() {
        let runtime = RealtimeCurrentUserRuntime::new();
        runtime.set_snapshot(
            "usr_self".into(),
            7,
            json!({
                "id": "usr_self",
                "displayName": "Self",
                "location": "offline"
            }),
        );

        let output = runtime
            .apply_ws_message(
                7,
                &RealtimeWsMessagePayload {
                    json: json!({
                        "type": "user-location",
                        "content": {
                            "userId": "usr_self",
                            "location": "wrld_1:123~group(grp_1)",
                            "travelingToLocation": "",
                            "worldId": "wrld_1"
                        }
                    }),
                    raw: String::new(),
                    received_at: "2026-05-15T00:00:00Z".into(),
                },
                RealtimeCurrentUserAuthority::default(),
            )
            .expect("current user location output");

        let serialized = serde_json::to_value(&output.projection).unwrap();
        assert_eq!(serialized["patch"]["id"], json!("usr_self"));
        assert_eq!(
            serialized["snapshot"]["location"],
            json!("wrld_1:123~group(grp_1)")
        );
        assert_eq!(
            serialized["gameStatePatch"]["currentLocation"],
            json!("wrld_1:123~group(grp_1)")
        );
        assert_eq!(
            serialized["patch"]["$location"]["tag"],
            json!("wrld_1:123~group(grp_1)")
        );
        assert_eq!(serialized["patch"]["$location"]["worldId"], json!("wrld_1"));
        assert_eq!(
            serialized["patch"]["$location"]["accessType"],
            json!("group")
        );
        assert_eq!(serialized["patch"]["$location"]["groupId"], json!("grp_1"));
        assert_eq!(
            serialized["patch"]["$travelingToLocation"]["isRealInstance"],
            json!(false)
        );
    }
}
