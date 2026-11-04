use std::collections::HashSet;

use chrono::{Datelike, Local, Timelike};
use serde_json::{json, Map, Value};
use vrcx_0_core::json::JsonExt;

use super::super::presence_facts::BackgroundPresenceFacts;
use super::super::shared::string_field;

#[derive(Clone, Debug, Default)]
pub(super) struct PresenceRuleEvaluation {
    pub(super) patch: Map<String, Value>,
    pub(super) matched_rules: Vec<MatchedPresenceRule>,
}

#[derive(Clone, Debug, Default)]
pub(super) struct MatchedPresenceRule {
    id: String,
    pub(super) domain: String,
    pub(super) restore_previous_state: bool,
    pub(super) owned_fields: Vec<String>,
}

pub(super) fn evaluate_presence_rules(
    facts: &BackgroundPresenceFacts,
    rules: &[Value],
) -> PresenceRuleEvaluation {
    let mut sorted_rules: Vec<&Value> = rules.iter().filter(|rule| rule_enabled(rule)).collect();
    sorted_rules.sort_by(|left, right| {
        let priority_delta = rule_priority(right).cmp(&rule_priority(left));
        if priority_delta == std::cmp::Ordering::Equal {
            rule_id(left).cmp(&rule_id(right))
        } else {
            priority_delta
        }
    });

    let mut patch = Map::new();
    let mut field_owners = HashSet::new();
    let mut stopped_domains = HashSet::new();
    let mut matched_rules = Vec::new();

    for rule in sorted_rules {
        let domain = string_field(rule, "domain").unwrap_or_else(|| "context".into());
        if stopped_domains.contains(&domain) || !rule_matches(rule, facts) {
            continue;
        }
        let action_patch = validate_action_patch(rule.get("actions").unwrap_or(&Value::Null));
        let mut owned_fields = Vec::new();
        for (field, value) in action_patch {
            if field_owners.insert(field.clone()) {
                patch.insert(field.clone(), value);
                owned_fields.push(field);
            }
        }
        matched_rules.push(MatchedPresenceRule {
            id: rule_id(rule),
            domain: domain.clone(),
            restore_previous_state: rule
                .get("restorePreviousState")
                .and_then(Value::as_bool)
                .unwrap_or(true),
            owned_fields,
        });
        if rule
            .get("stopProcessing")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            stopped_domains.insert(domain);
        }
    }

    PresenceRuleEvaluation {
        patch,
        matched_rules,
    }
}

fn rule_matches(rule: &Value, facts: &BackgroundPresenceFacts) -> bool {
    array_field(rule, "conditions")
        .into_iter()
        .all(|condition| condition_matches(condition, facts))
}

pub(super) fn condition_matches(condition: &Value, facts: &BackgroundPresenceFacts) -> bool {
    match string_field(condition, "type").as_deref() {
        Some("timeWindow") => matches_time_window(condition),
        Some("playerFactsKnown") => {
            facts.player_facts_known == condition_bool_value(condition, true)
        }
        Some("instanceTypeIn") => string_array_field(condition, "values")
            .iter()
            .any(|value| value == &facts.instance_type),
        Some("instanceGroupIn") => facts
            .parsed_location
            .group_id
            .as_ref()
            .is_some_and(|group_id| string_array_field(condition, "values").contains(group_id)),
        Some("playerCount") => {
            facts.player_facts_known
                && compare_numbers(
                    facts.player_count as i64,
                    string_field(condition, "op")
                        .unwrap_or_else(|| "==".into())
                        .as_str(),
                    condition_i64_value(condition, 0),
                )
        }
        Some("friendCount") => {
            facts.player_facts_known
                && compare_numbers(
                    facts.friend_count as i64,
                    string_field(condition, "op")
                        .unwrap_or_else(|| "==".into())
                        .as_str(),
                    condition_i64_value(condition, 0),
                )
        }
        Some("hasAnyFriend") => facts.player_facts_known && facts.friend_count > 0,
        Some("hasFriendInGroups") => {
            facts.player_facts_known
                && string_array_field(condition, "values").iter().any(|group| {
                    facts
                        .present_favorite_group_keys
                        .iter()
                        .any(|present| present == group)
                })
        }
        Some("hasSpecificFriend") => {
            facts.player_facts_known
                && string_array_field(condition, "values")
                    .iter()
                    .any(|user_id| {
                        facts
                            .present_friend_ids
                            .iter()
                            .any(|present| present == user_id)
                    })
        }
        Some("worldInFavoriteGroups") => {
            let group_keys = string_array_field(condition, "values");
            if group_keys.is_empty() {
                !facts.current_world_favorite_group_keys.is_empty()
            } else {
                group_keys.iter().any(|group| {
                    facts
                        .current_world_favorite_group_keys
                        .iter()
                        .any(|present| present == group)
                })
            }
        }
        Some("isAlone") => facts.player_facts_known && facts.player_count == 0,
        Some("withCompany") => facts.player_facts_known && facts.player_count > 0,
        Some("isTraveling") => {
            facts.parsed_location.is_traveling == condition_bool_value(condition, true)
        }
        Some("isGameRunning") => facts.is_game_running == condition_bool_value(condition, true),
        Some("canInviteFromCurrentLocation") => {
            facts.can_invite_from_current_location == condition_bool_value(condition, true)
        }
        _ => false,
    }
}

fn matches_time_window(condition: &Value) -> bool {
    let Some(start) = parse_clock_minutes(&string_field(condition, "start").unwrap_or_default())
    else {
        return false;
    };
    let Some(end) = parse_clock_minutes(&string_field(condition, "end").unwrap_or_default()) else {
        return false;
    };
    let days = int_array_field(condition, "days");
    let now = Local::now();
    let now_minutes = now.hour() as i64 * 60 + now.minute() as i64;
    if start == end {
        return matches_day_filter(&days, 0);
    }
    if end > start {
        return matches_day_filter(&days, 0) && now_minutes >= start && now_minutes < end;
    }
    if now_minutes >= start {
        return matches_day_filter(&days, 0);
    }
    now_minutes < end && matches_day_filter(&days, -1)
}

fn matches_day_filter(days: &[i64], offset_days: i64) -> bool {
    if days.is_empty() {
        return true;
    }
    let shifted = Local::now() + chrono::Duration::days(offset_days);
    let day = match shifted.weekday().number_from_monday() {
        1..=7 => shifted.weekday().number_from_monday() as i64,
        _ => 1,
    };
    days.contains(&day)
}

pub(super) fn force_game_running_condition(rule: Value) -> Value {
    let mut object = match rule {
        Value::Object(object) => object,
        _ => Map::new(),
    };
    let mut conditions = match object.remove("conditions") {
        Some(Value::Array(conditions)) => conditions,
        _ => Vec::new(),
    };
    conditions
        .retain(|condition| string_field(condition, "type").as_deref() != Some("isGameRunning"));
    conditions.insert(0, json!({ "type": "isGameRunning" }));
    object.insert("conditions".into(), Value::Array(conditions));
    Value::Object(object)
}

pub(super) fn has_presence_action(rule: &Value) -> bool {
    let Some(actions) = rule.get("actions").and_then(Value::as_object) else {
        return false;
    };
    actions.contains_key("status")
        || actions.contains_key("statusDescription")
        || actions.contains_key("clearStatusDescription")
}

pub(super) fn rule_enabled(rule: &Value) -> bool {
    rule.get("enabled").and_then(Value::as_bool) != Some(false)
}

fn rule_priority(rule: &Value) -> i64 {
    rule.i64_field("priority").unwrap_or(0)
}

fn rule_id(rule: &Value) -> String {
    string_field(rule, "id").unwrap_or_default()
}

fn condition_bool_value(condition: &Value, default_value: bool) -> bool {
    condition
        .get("value")
        .and_then(Value::as_bool)
        .unwrap_or(default_value)
}

fn condition_i64_value(condition: &Value, default_value: i64) -> i64 {
    condition
        .get("value")
        .and_then(|value| value.as_i64().or_else(|| value.as_str()?.parse().ok()))
        .unwrap_or(default_value)
}

fn compare_numbers(left: i64, op: &str, right: i64) -> bool {
    match op {
        ">" => left > right,
        ">=" => left >= right,
        "<" => left < right,
        "<=" => left <= right,
        "!=" => left != right,
        _ => left == right,
    }
}

fn parse_clock_minutes(value: &str) -> Option<i64> {
    let (hours, minutes) = value.split_once(':')?;
    let hours: i64 = hours.parse().ok()?;
    let minutes: i64 = minutes.parse().ok()?;
    if !(0..=23).contains(&hours) || !(0..=59).contains(&minutes) {
        return None;
    }
    Some(hours * 60 + minutes)
}

pub(super) fn matched_rule_ids(evaluation: &PresenceRuleEvaluation) -> Vec<String> {
    evaluation
        .matched_rules
        .iter()
        .map(|rule| rule.id.clone())
        .collect()
}

fn array_field<'a>(value: &'a Value, key: &str) -> Vec<&'a Value> {
    value
        .get(key)
        .and_then(Value::as_array)
        .map(|values| values.iter().collect())
        .unwrap_or_default()
}

fn string_array_field(value: &Value, key: &str) -> Vec<String> {
    value
        .get(key)
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(|value| value.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

fn int_array_field(value: &Value, key: &str) -> Vec<i64> {
    value
        .get(key)
        .and_then(Value::as_array)
        .map(|values| values.iter().filter_map(Value::as_i64).collect())
        .unwrap_or_default()
}

fn validate_action_patch(actions: &Value) -> Map<String, Value> {
    let mut patch = Map::new();
    if let Some(status) = string_field(actions, "status").filter(|value| valid_status(value)) {
        patch.insert("status".into(), Value::String(status));
    }
    if let Some(object) = actions.as_object() {
        if object.contains_key("statusDescription") {
            patch.insert(
                "statusDescription".into(),
                Value::String(
                    string_field(actions, "statusDescription")
                        .unwrap_or_default()
                        .chars()
                        .take(32)
                        .collect(),
                ),
            );
        } else if actions
            .get("clearStatusDescription")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            patch.insert("statusDescription".into(), Value::String(String::new()));
        }
    }
    patch
}

fn valid_status(value: &str) -> bool {
    matches!(value, "active" | "join me" | "ask me" | "busy" | "offline")
}
