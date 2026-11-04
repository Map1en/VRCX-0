use std::collections::{HashMap, HashSet};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use vrcx_0_core::json::{text_of, JsonExt};

use super::super::presence_facts::BackgroundPresenceFacts;
use super::evaluation::PresenceRuleEvaluation;
use super::BackgroundPresenceAutomationState;

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default)]
pub(super) struct TimeRestoreSnapshot {
    pub(super) previous_value: String,
    pub(super) automated_value: String,
}

#[derive(Clone, Debug, Default)]
pub(super) struct PatchWithTimeRestore {
    pub(super) patch: Map<String, Value>,
    pub(super) pending_snapshot_completions: Vec<String>,
}

#[derive(Clone, Copy, Debug)]
pub(super) struct PresenceAutomationThrottle {
    pub(super) min_status_write_interval_ms: i64,
    pub(super) min_description_write_interval_ms: i64,
    pub(super) stable_location_ms: i64,
}

pub(super) fn build_patch_with_time_restore(
    facts: &BackgroundPresenceFacts,
    evaluation: &PresenceRuleEvaluation,
    state: &mut BackgroundPresenceAutomationState,
) -> PatchWithTimeRestore {
    let mut patch = evaluation.patch.clone();
    let mut pending_snapshot_completions = Vec::new();
    let time_owned_fields: HashMap<String, bool> = evaluation
        .matched_rules
        .iter()
        .filter(|rule| rule.domain == "time")
        .flat_map(|rule| {
            rule.owned_fields
                .iter()
                .map(|field| (field.clone(), rule.restore_previous_state))
                .collect::<Vec<_>>()
        })
        .collect();

    for (field, restore_previous_state) in &time_owned_fields {
        if !restore_previous_state {
            pending_snapshot_completions.push(field.clone());
            continue;
        }
        let automated_value = patch.text_field(field);
        state
            .time_restore_snapshots
            .entry(field.clone())
            .and_modify(|snapshot| snapshot.automated_value = automated_value.clone())
            .or_insert_with(|| TimeRestoreSnapshot {
                previous_value: facts.current_user.as_value().text_field(field),
                automated_value,
            });
    }

    for (field, snapshot) in state.time_restore_snapshots.clone() {
        if time_owned_fields.contains_key(&field) {
            continue;
        }
        if !patch.contains_key(&field)
            && facts.current_user.as_value().text_field(&field) == snapshot.automated_value
        {
            patch.insert(field.clone(), Value::String(snapshot.previous_value));
        }
        pending_snapshot_completions.push(field);
    }

    PatchWithTimeRestore {
        patch,
        pending_snapshot_completions,
    }
}

pub(super) fn changed_patch(
    current_user: &Value,
    patch: &Map<String, Value>,
) -> Map<String, Value> {
    let mut changed = Map::new();
    for field in ["status", "statusDescription"] {
        if let Some(value) = patch.get(field) {
            if current_user.text_field(field) != text_of(Some(value)) {
                changed.insert(field.into(), value.clone());
            }
        }
    }
    changed
}

pub(super) fn has_location_scoped_changes(
    evaluation: &PresenceRuleEvaluation,
    changed_patch: &Map<String, Value>,
) -> bool {
    let location_fields: HashSet<&str> = evaluation
        .matched_rules
        .iter()
        .filter(|rule| rule.domain != "time")
        .flat_map(|rule| rule.owned_fields.iter().map(String::as_str))
        .collect();
    changed_patch
        .keys()
        .any(|field| location_fields.contains(field.as_str()))
}

pub(super) fn stable_location_skip_reason(
    facts: &BackgroundPresenceFacts,
    stable_location_ms: i64,
) -> Option<&'static str> {
    if facts.parsed_location.is_traveling {
        return Some("traveling");
    }
    let started_at_ms = parse_date_ms(&facts.current_location_started_at);
    if started_at_ms > 0 && Utc::now().timestamp_millis() - started_at_ms < stable_location_ms {
        return Some("location-stabilizing");
    }
    None
}

pub(super) fn throttle_skip_reason(
    changed_patch: &Map<String, Value>,
    throttle: PresenceAutomationThrottle,
    now_ms: i64,
    state: &BackgroundPresenceAutomationState,
) -> Option<&'static str> {
    if let Some(value) = changed_patch
        .get("status")
        .map(|value| text_of(Some(value)))
    {
        if value == state.last_status_value
            && now_ms - state.last_status_write_at_ms < throttle.min_status_write_interval_ms
        {
            return Some("status-throttled");
        }
    }
    if let Some(value) = changed_patch
        .get("statusDescription")
        .map(|value| text_of(Some(value)))
    {
        if value == state.last_description_value
            && now_ms - state.last_description_write_at_ms
                < throttle.min_description_write_interval_ms
        {
            return Some("description-throttled");
        }
    }
    None
}

pub(super) fn update_presence_write_timestamps(
    state: &mut BackgroundPresenceAutomationState,
    changed_patch: &Map<String, Value>,
    now_ms: i64,
) {
    if let Some(value) = changed_patch
        .get("status")
        .map(|value| text_of(Some(value)))
    {
        state.last_status_write_at_ms = now_ms;
        state.last_status_value = value;
    }
    if let Some(value) = changed_patch
        .get("statusDescription")
        .map(|value| text_of(Some(value)))
    {
        state.last_description_write_at_ms = now_ms;
        state.last_description_value = value;
    }
}

pub(super) fn complete_time_restores(
    state: &mut BackgroundPresenceAutomationState,
    fields: &[String],
) {
    for field in fields {
        state.time_restore_snapshots.remove(field);
    }
}

fn parse_date_ms(value: &str) -> i64 {
    chrono::DateTime::parse_from_rfc3339(value)
        .map(|date| date.timestamp_millis())
        .unwrap_or(0)
}

pub(super) fn merge_object_patch(mut current_user: Value, patch: Value) -> Value {
    if let (Some(user), Some(patch)) = (current_user.as_object_mut(), patch.as_object()) {
        for (key, value) in patch {
            user.insert(key.clone(), value.clone());
        }
    }
    current_user
}
