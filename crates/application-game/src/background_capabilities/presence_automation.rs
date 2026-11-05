use std::collections::HashMap;
use std::path::Path;
use std::time::Duration;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use vrcx_0_application_core::{AuthenticatedMutationContext, RemoteMutationGate, RuntimeAuthScope};
use vrcx_0_core::vrchat_endpoints::normalize_vrchat_api_endpoint;

use crate::{BackgroundRemoteApi, Result};
use vrcx_0_application_core::ConfigStore;

use super::presence_facts::BackgroundPresenceFacts;
use super::shared::parse_response_json;
use vrcx_0_core::json::RawJson;

mod evaluation;
mod rules;
#[cfg(test)]
mod tests;
mod write_back;

use evaluation::{
    evaluate_presence_rules, force_game_running_condition, has_presence_action, matched_rule_ids,
    rule_enabled,
};
use rules::load_stored_rules;
pub use rules::{
    presence_automation_local_group_renamed, presence_automation_rule_enabled_set,
    presence_automation_rules_get, presence_automation_rules_set, PresenceAutomationRuleKind,
};
use write_back::{
    build_patch_with_time_restore, changed_patch, complete_time_restores,
    has_location_scoped_changes, merge_object_patch, stable_location_skip_reason,
    throttle_skip_reason, update_presence_write_timestamps, PresenceAutomationThrottle,
    TimeRestoreSnapshot,
};

const DEFAULT_MIN_STATUS_WRITE_INTERVAL_MS: i64 = 60_000;
const DEFAULT_MIN_DESCRIPTION_WRITE_INTERVAL_MS: i64 = 60_000;
const DEFAULT_STABLE_LOCATION_MS: i64 = 30_000;
const PRESENCE_REMOTE_MUTATION_INTERVAL: Duration = Duration::from_millis(250);
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default)]
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

impl BackgroundPresenceAutomationState {
    pub fn load_cached(path: &Path) -> Self {
        std::fs::read_to_string(path)
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default()
    }

    pub fn persist_cached(&self, path: &Path, last_serialized: &mut String) {
        let Ok(serialized) = serde_json::to_string(self) else {
            return;
        };
        if serialized == *last_serialized {
            return;
        }
        if std::fs::write(path, &serialized).is_ok() {
            *last_serialized = serialized;
        }
    }
}

#[derive(Clone, Debug, Default, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundPresenceAutomationResult {
    pub applied: bool,
    pub reason: String,
    pub patch: RawJson,
    pub updated_user: Option<RawJson>,
    pub matched_rule_ids: Vec<String>,
}

#[derive(Clone, Debug)]
struct PresenceAutomationConfig {
    enabled: bool,
    rules: Vec<Value>,
    throttle: PresenceAutomationThrottle,
}

pub async fn run_background_presence_automation(
    config: &dyn ConfigStore,
    remote: &dyn BackgroundRemoteApi,
    auth_scope: &RuntimeAuthScope,
    remote_mutations: &RemoteMutationGate,
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
    let changed_patch = changed_patch(facts.current_user.as_value(), &effective.patch);
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

    let mutation =
        AuthenticatedMutationContext::capture(auth_scope, remote_mutations, "Presence automation")?;
    if mutation.scope().current_user_id != facts.current_user_id
        || mutation.scope().endpoint != normalize_vrchat_api_endpoint(Some(&facts.endpoint))
    {
        return Err(crate::Error::Custom(
            "Presence automation authentication scope changed.".into(),
        ));
    }
    let request = remote.prepare_current_user_update(
        &mutation.scope().endpoint,
        &mutation.scope().current_user_id,
        Value::Object(changed_patch.clone()),
    )?;
    let response = match mutation
        .run_after_wait(PRESENCE_REMOTE_MUTATION_INTERVAL, || async move {
            remote.send_current_user_update(request).await
        })
        .await
    {
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
            facts.current_user.as_value().clone(),
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

fn load_presence_automation_config(config: &dyn ConfigStore) -> Result<PresenceAutomationConfig> {
    let time_rules = load_stored_rules(config, "presenceAutomationTimeRules")?;
    let context_rules: Vec<Value> = load_stored_rules(config, "presenceAutomationContextRules")?
        .into_iter()
        .map(force_game_running_condition)
        .collect();
    let mut rules = Vec::new();
    rules.extend(time_rules);
    rules.extend(context_rules);
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
        patch: patch.into(),
        updated_user: updated_user.map(RawJson::from),
        matched_rule_ids,
    }
}

fn config_int(config: &dyn ConfigStore, key: &str, default_value: i64) -> Result<i64> {
    Ok(config
        .get_string(key, "")?
        .trim()
        .parse::<i64>()
        .ok()
        .unwrap_or(default_value))
}
