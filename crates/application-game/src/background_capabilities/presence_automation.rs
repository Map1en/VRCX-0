use std::collections::{HashMap, HashSet};

use chrono::{Datelike, Local, Timelike, Utc};
use serde::Serialize;
use serde_json::{json, Map, Value};
use vrcx_0_persistence::config::ConfigRepository;
use vrcx_0_persistence::DatabaseService;
use vrcx_0_vrchat_client::http_api::{normalize_vrchat_api_endpoint, ApiScope};
use vrcx_0_vrchat_client::users::current_user_update_input;

use crate::{Result, WebClient};

use super::presence_facts::BackgroundPresenceFacts;
use super::shared::{int_field, non_empty, parse_response_json, string_field};

const DEFAULT_MIN_STATUS_WRITE_INTERVAL_MS: i64 = 60_000;
const DEFAULT_MIN_DESCRIPTION_WRITE_INTERVAL_MS: i64 = 60_000;
const DEFAULT_STABLE_LOCATION_MS: i64 = 30_000;
#[derive(Clone, Debug, Default)]
pub struct BackgroundPresenceAutomationState {
    scope_key: String,
    last_status_write_at_ms: i64,
    last_description_write_at_ms: i64,
    last_status_value: String,
    last_description_value: String,
    next_allowed_at_ms: i64,
    last_error: String,
    time_restore_snapshots: HashMap<String, TimeRestoreSnapshot>,
}

#[derive(Clone, Debug, Default, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundPresenceAutomationResult {
    pub applied: bool,
    pub reason: String,
    pub patch: Value,
    pub updated_user: Option<Value>,
    pub matched_rule_ids: Vec<String>,
}
#[derive(Clone, Debug, Default)]
struct TimeRestoreSnapshot {
    previous_value: String,
    automated_value: String,
}

#[derive(Clone, Debug, Default)]
struct PatchWithTimeRestore {
    patch: Map<String, Value>,
    pending_snapshot_completions: Vec<String>,
}

#[derive(Clone, Debug)]
struct PresenceAutomationConfig {
    enabled: bool,
    rules: Vec<Value>,
    throttle: PresenceAutomationThrottle,
}

#[derive(Clone, Copy, Debug)]
struct PresenceAutomationThrottle {
    min_status_write_interval_ms: i64,
    min_description_write_interval_ms: i64,
    stable_location_ms: i64,
}

#[derive(Clone, Debug, Default)]
struct PresenceRuleEvaluation {
    patch: Map<String, Value>,
    matched_rules: Vec<MatchedPresenceRule>,
}

#[derive(Clone, Debug, Default)]
struct MatchedPresenceRule {
    id: String,
    domain: String,
    restore_previous_state: bool,
    owned_fields: Vec<String>,
}
pub async fn run_background_presence_automation(
    config: &ConfigRepository,
    web: &WebClient,
    db: &DatabaseService,
    facts: &BackgroundPresenceFacts,
    state: &mut BackgroundPresenceAutomationState,
) -> Result<BackgroundPresenceAutomationResult> {
    ensure_presence_state_scope(state, facts);
    let automation_config = load_presence_automation_config(config)?;
    if !automation_config.enabled {
        return Ok(presence_result(
            false,
            "disabled",
            Value::Null,
            None,
            Vec::new(),
        ));
    }

    let evaluation = evaluate_presence_rules(facts, &automation_config.rules);
    let effective = build_patch_with_time_restore(facts, &evaluation, state);
    let changed_patch = changed_patch(&facts.current_user, &effective.patch);
    if changed_patch.is_empty() {
        complete_time_restores(state, &effective.pending_snapshot_completions);
        return Ok(presence_result(
            false,
            if evaluation.patch.is_empty() {
                "no-match"
            } else {
                "no-change"
            },
            Value::Object(effective.patch),
            None,
            matched_rule_ids(&evaluation),
        ));
    }

    if has_location_scoped_changes(&evaluation, &changed_patch) {
        if let Some(reason) =
            stable_location_skip_reason(facts, automation_config.throttle.stable_location_ms)
        {
            return Ok(presence_result(
                false,
                reason,
                Value::Object(changed_patch),
                None,
                matched_rule_ids(&evaluation),
            ));
        }
    }

    let now_ms = Utc::now().timestamp_millis();
    if now_ms < state.next_allowed_at_ms {
        return Ok(presence_result(
            false,
            "backoff",
            Value::Object(changed_patch),
            None,
            matched_rule_ids(&evaluation),
        ));
    }

    if let Some(reason) =
        throttle_skip_reason(&changed_patch, automation_config.throttle, now_ms, state)
    {
        return Ok(presence_result(
            false,
            reason,
            Value::Object(changed_patch),
            None,
            matched_rule_ids(&evaluation),
        ));
    }

    let (_, request) = current_user_update_input(
        normalize_vrchat_api_endpoint(Some(&facts.endpoint)),
        facts.current_user_id.clone(),
        Some(Value::Object(changed_patch.clone())),
    )?;
    let response = match web.execute_api(request, ApiScope::Vrchat, db).await {
        Ok(response) if (200..=299).contains(&response.status) => response,
        Ok(response) => {
            state.last_error = format!("VRChat API returned HTTP {}", response.status);
            state.next_allowed_at_ms = now_ms + DEFAULT_MIN_STATUS_WRITE_INTERVAL_MS;
            return Ok(presence_result(
                false,
                "error",
                Value::Object(changed_patch),
                None,
                matched_rule_ids(&evaluation),
            ));
        }
        Err(error) => {
            state.last_error = error.to_string();
            state.next_allowed_at_ms = now_ms + DEFAULT_MIN_STATUS_WRITE_INTERVAL_MS;
            return Ok(presence_result(
                false,
                "error",
                Value::Object(changed_patch),
                None,
                matched_rule_ids(&evaluation),
            ));
        }
    };

    update_presence_write_timestamps(state, &changed_patch, now_ms);
    state.last_error.clear();
    state.next_allowed_at_ms = 0;
    complete_time_restores(state, &effective.pending_snapshot_completions);
    let updated_user = parse_response_json(&response.data).unwrap_or_else(|| {
        merge_object_patch(
            facts.current_user.clone(),
            Value::Object(changed_patch.clone()),
        )
    });

    Ok(presence_result(
        true,
        "applied",
        Value::Object(changed_patch),
        Some(updated_user),
        matched_rule_ids(&evaluation),
    ))
}

fn load_presence_automation_config(config: &ConfigRepository) -> Result<PresenceAutomationConfig> {
    let time_rules = load_stored_rules(config, "presenceAutomationTimeRules")?;
    let context_rules: Vec<Value> = load_stored_rules(config, "presenceAutomationContextRules")?
        .into_iter()
        .map(force_game_running_condition)
        .collect();
    let legacy_rules = load_legacy_presence_rules(config)?;
    let mut rules = Vec::new();
    rules.extend(time_rules);
    rules.extend(context_rules);
    rules.extend(legacy_rules);
    rules.retain(|rule| rule_enabled(rule) && has_presence_action(rule));

    Ok(PresenceAutomationConfig {
        enabled: !rules.is_empty(),
        rules,
        throttle: PresenceAutomationThrottle {
            min_status_write_interval_ms: config_int(
                config,
                "presenceAutomationMinStatusWriteIntervalMs",
                DEFAULT_MIN_STATUS_WRITE_INTERVAL_MS,
            )?,
            min_description_write_interval_ms: config_int(
                config,
                "presenceAutomationMinDescriptionWriteIntervalMs",
                DEFAULT_MIN_DESCRIPTION_WRITE_INTERVAL_MS,
            )?,
            stable_location_ms: config_int(
                config,
                "presenceAutomationStableLocationMs",
                DEFAULT_STABLE_LOCATION_MS,
            )?,
        },
    })
}

fn load_legacy_presence_rules(config: &ConfigRepository) -> Result<Vec<Value>> {
    if !config.get_bool("autoStateChangeEnabled", false)? {
        return Ok(Vec::new());
    }
    let no_friends = config.get_bool("autoStateChangeNoFriends", false)?;
    let selected_groups = safe_string_array(&config.get_string("autoStateChangeGroups", "[]")?);
    let selected_instance_types =
        safe_string_array(&config.get_string("autoStateChangeInstanceTypes", "[]")?);
    let alone_status = non_empty(
        &config.get_string("autoStateChangeAloneStatus", "join me")?,
        "join me",
    );
    let company_status = non_empty(
        &config.get_string("autoStateChangeCompanyStatus", "busy")?,
        "busy",
    );
    let alone_desc_enabled = config.get_bool("autoStateChangeAloneDescEnabled", false)?;
    let alone_desc = config.get_string("autoStateChangeAloneDesc", "")?;
    let company_desc_enabled = config.get_bool("autoStateChangeCompanyDescEnabled", false)?;
    let company_desc = config.get_string("autoStateChangeCompanyDesc", "")?;

    let mut instance_conditions = Vec::new();
    if !selected_instance_types.is_empty() {
        instance_conditions.push(json!({
            "type": "instanceTypeIn",
            "values": selected_instance_types,
        }));
    }
    let company_conditions = if !no_friends {
        vec![json!({ "type": "withCompany" })]
    } else if !selected_groups.is_empty() {
        vec![json!({
            "type": "hasFriendInGroups",
            "values": selected_groups,
        })]
    } else {
        vec![json!({ "type": "hasAnyFriend" })]
    };

    let mut company_actions = Map::new();
    company_actions.insert("status".into(), Value::String(company_status));
    if company_desc_enabled {
        company_actions.insert("statusDescription".into(), Value::String(company_desc));
    }
    let mut alone_actions = Map::new();
    alone_actions.insert("status".into(), Value::String(alone_status));
    if alone_desc_enabled {
        alone_actions.insert("statusDescription".into(), Value::String(alone_desc));
    }

    let mut company_rule_conditions = vec![json!({ "type": "isGameRunning" })];
    company_rule_conditions.extend(instance_conditions.clone());
    company_rule_conditions.extend(company_conditions);
    let mut alone_rule_conditions = vec![
        json!({ "type": "isGameRunning" }),
        json!({ "type": "playerFactsKnown" }),
    ];
    alone_rule_conditions.extend(instance_conditions);

    Ok(vec![
        json!({
            "id": "legacy-company",
            "label": "Legacy company rule",
            "enabled": true,
            "generated": true,
            "domain": "context",
            "priority": 200,
            "conditions": company_rule_conditions,
            "actions": company_actions,
            "stopProcessing": true,
        }),
        json!({
            "id": "legacy-alone",
            "label": "Legacy alone rule",
            "enabled": true,
            "generated": true,
            "domain": "context",
            "priority": 100,
            "conditions": alone_rule_conditions,
            "actions": alone_actions,
            "stopProcessing": true,
        }),
    ])
}

fn evaluate_presence_rules(
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

fn condition_matches(condition: &Value, facts: &BackgroundPresenceFacts) -> bool {
    match string_field(condition, "type").as_deref() {
        Some("timeWindow") => matches_time_window(condition),
        Some("playerFactsKnown") => {
            facts.player_facts_known == condition_bool_value(condition, true)
        }
        Some("instanceTypeIn") => string_array_field(condition, "values")
            .iter()
            .any(|value| value == &facts.instance_type),
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

fn ensure_presence_state_scope(
    state: &mut BackgroundPresenceAutomationState,
    facts: &BackgroundPresenceFacts,
) {
    let scope_key = format!("{}:{}", facts.endpoint.trim(), facts.current_user_id.trim());
    if state.scope_key == scope_key {
        return;
    }
    *state = BackgroundPresenceAutomationState {
        scope_key,
        ..Default::default()
    };
}

fn build_patch_with_time_restore(
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
        let automated_value = patch.get(field).map(value_to_string).unwrap_or_default();
        state
            .time_restore_snapshots
            .entry(field.clone())
            .and_modify(|snapshot| snapshot.automated_value = automated_value.clone())
            .or_insert_with(|| TimeRestoreSnapshot {
                previous_value: value_to_string(
                    facts.current_user.get(field).unwrap_or(&Value::Null),
                ),
                automated_value,
            });
    }

    for (field, snapshot) in state.time_restore_snapshots.clone() {
        if time_owned_fields.contains_key(&field) {
            continue;
        }
        if !patch.contains_key(&field)
            && value_to_string(facts.current_user.get(&field).unwrap_or(&Value::Null))
                == snapshot.automated_value
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

fn changed_patch(current_user: &Value, patch: &Map<String, Value>) -> Map<String, Value> {
    let mut changed = Map::new();
    for field in ["status", "statusDescription"] {
        if let Some(value) = patch.get(field) {
            if current_user
                .get(field)
                .map(value_to_string)
                .unwrap_or_default()
                != value_to_string(value)
            {
                changed.insert(field.into(), value.clone());
            }
        }
    }
    changed
}

fn has_location_scoped_changes(
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

fn stable_location_skip_reason(
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

fn throttle_skip_reason(
    changed_patch: &Map<String, Value>,
    throttle: PresenceAutomationThrottle,
    now_ms: i64,
    state: &BackgroundPresenceAutomationState,
) -> Option<&'static str> {
    if let Some(value) = changed_patch.get("status").map(value_to_string) {
        if value == state.last_status_value
            && now_ms - state.last_status_write_at_ms < throttle.min_status_write_interval_ms
        {
            return Some("status-throttled");
        }
    }
    if let Some(value) = changed_patch.get("statusDescription").map(value_to_string) {
        if value == state.last_description_value
            && now_ms - state.last_description_write_at_ms
                < throttle.min_description_write_interval_ms
        {
            return Some("description-throttled");
        }
    }
    None
}

fn update_presence_write_timestamps(
    state: &mut BackgroundPresenceAutomationState,
    changed_patch: &Map<String, Value>,
    now_ms: i64,
) {
    if let Some(value) = changed_patch.get("status").map(value_to_string) {
        state.last_status_write_at_ms = now_ms;
        state.last_status_value = value;
    }
    if let Some(value) = changed_patch.get("statusDescription").map(value_to_string) {
        state.last_description_write_at_ms = now_ms;
        state.last_description_value = value;
    }
}

fn complete_time_restores(state: &mut BackgroundPresenceAutomationState, fields: &[String]) {
    for field in fields {
        state.time_restore_snapshots.remove(field);
    }
}

fn load_stored_rules(config: &ConfigRepository, key: &str) -> Result<Vec<Value>> {
    Ok(safe_value_array(
        &config.get_string(key, "[]").unwrap_or_else(|_| "[]".into()),
    ))
}

fn force_game_running_condition(rule: Value) -> Value {
    let mut object = rule.as_object().cloned().unwrap_or_default();
    let conditions: Vec<Value> = object
        .get("conditions")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter(|condition| string_field(condition, "type").as_deref() != Some("isGameRunning"))
        .collect();
    let mut next_conditions = vec![json!({ "type": "isGameRunning" })];
    next_conditions.extend(conditions);
    object.insert("conditions".into(), Value::Array(next_conditions));
    Value::Object(object)
}

fn has_presence_action(rule: &Value) -> bool {
    let Some(actions) = rule.get("actions").and_then(Value::as_object) else {
        return false;
    };
    actions.contains_key("status")
        || actions.contains_key("statusDescription")
        || actions.contains_key("clearStatusDescription")
}

fn rule_enabled(rule: &Value) -> bool {
    rule.get("enabled").and_then(Value::as_bool) != Some(false)
}

fn rule_priority(rule: &Value) -> i64 {
    int_field(rule, "priority").unwrap_or(0)
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

fn valid_status(value: &str) -> bool {
    matches!(value, "active" | "join me" | "ask me" | "busy" | "offline")
}

fn parse_date_ms(value: &str) -> i64 {
    chrono::DateTime::parse_from_rfc3339(value)
        .map(|date| date.timestamp_millis())
        .unwrap_or(0)
}

fn value_to_string(value: &Value) -> String {
    match value {
        Value::String(value) => value.clone(),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

fn matched_rule_ids(evaluation: &PresenceRuleEvaluation) -> Vec<String> {
    evaluation
        .matched_rules
        .iter()
        .map(|rule| rule.id.clone())
        .collect()
}

fn presence_result(
    applied: bool,
    reason: impl Into<String>,
    patch: Value,
    updated_user: Option<Value>,
    matched_rule_ids: Vec<String>,
) -> BackgroundPresenceAutomationResult {
    BackgroundPresenceAutomationResult {
        applied,
        reason: reason.into(),
        patch,
        updated_user,
        matched_rule_ids,
    }
}

fn config_int(config: &ConfigRepository, key: &str, default_value: i64) -> Result<i64> {
    Ok(config
        .get_raw(key)?
        .as_deref()
        .and_then(|value| value.trim().parse::<i64>().ok())
        .unwrap_or(default_value))
}

fn safe_value_array(value: &str) -> Vec<Value> {
    serde_json::from_str::<Value>(value)
        .ok()
        .and_then(|value| value.as_array().cloned())
        .unwrap_or_default()
}

fn safe_string_array(value: &str) -> Vec<String> {
    safe_value_array(value)
        .into_iter()
        .filter_map(|value| value.as_str().map(str::trim).map(str::to_string))
        .filter(|value| !value.is_empty())
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

fn merge_object_patch(mut current_user: Value, patch: Value) -> Value {
    if let (Some(user), Some(patch)) = (current_user.as_object_mut(), patch.as_object()) {
        for (key, value) in patch {
            user.insert(key.clone(), value.clone());
        }
    }
    current_user
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_company_rule_beats_alone_rule_by_priority() {
        let facts = BackgroundPresenceFacts {
            is_game_running: true,
            player_facts_known: true,
            player_count: 1,
            instance_type: "public".into(),
            ..Default::default()
        };
        let rules = vec![
            json!({
                "id": "legacy-alone",
                "enabled": true,
                "priority": 100,
                "conditions": [{"type": "playerFactsKnown"}],
                "actions": {"status": "join me"},
            }),
            json!({
                "id": "legacy-company",
                "enabled": true,
                "priority": 200,
                "conditions": [{"type": "withCompany"}],
                "actions": {"status": "busy"},
                "stopProcessing": true,
            }),
        ];

        let result = evaluate_presence_rules(&facts, &rules);

        assert_eq!(
            result.patch.get("status"),
            Some(&Value::String("busy".into()))
        );
    }
}
