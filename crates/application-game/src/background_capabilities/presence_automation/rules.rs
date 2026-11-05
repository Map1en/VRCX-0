use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use vrcx_0_application_core::{ConfigStore, FavoriteEntityKind};
use vrcx_0_core::json::RawJson;

use crate::Result;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum PresenceAutomationRuleKind {
    Time,
    Context,
}

pub fn presence_automation_rules_get(
    config: &dyn ConfigStore,
    kind: PresenceAutomationRuleKind,
) -> Result<Vec<RawJson>> {
    Ok(
        safe_value_array(&config.get_string(presence_rules_key(kind), "[]")?)
            .into_iter()
            .map(RawJson::from)
            .collect(),
    )
}

static PRESENCE_RULES_WRITE: Mutex<()> = Mutex::new(());

pub fn presence_automation_rules_set(
    config: &dyn ConfigStore,
    kind: PresenceAutomationRuleKind,
    rules: Vec<RawJson>,
) -> Result<Vec<RawJson>> {
    let _write = PRESENCE_RULES_WRITE.lock().unwrap();
    config.set_json(
        presence_rules_key(kind),
        &Value::Array(rules.iter().map(|rule| rule.as_value().clone()).collect()),
    )?;
    Ok(rules)
}

pub fn presence_automation_rule_enabled_set(
    config: &dyn ConfigStore,
    kind: PresenceAutomationRuleKind,
    rule_id: &str,
    enabled: bool,
) -> Result<Vec<RawJson>> {
    let _write = PRESENCE_RULES_WRITE.lock().unwrap();
    let mut rules = safe_value_array(&config.get_string(presence_rules_key(kind), "[]")?);
    for rule in rules
        .iter_mut()
        .filter(|rule| rule.get("id").and_then(Value::as_str) == Some(rule_id))
    {
        if let Some(fields) = rule.as_object_mut() {
            fields.insert("enabled".to_string(), Value::Bool(enabled));
        }
    }
    config.set_json(presence_rules_key(kind), &Value::Array(rules.clone()))?;
    Ok(rules.into_iter().map(RawJson::from).collect())
}

pub fn presence_automation_local_group_renamed(
    config: &dyn ConfigStore,
    kind: FavoriteEntityKind,
    group_name: &str,
    new_group_name: &str,
) -> Result<()> {
    let (selected_field, condition_type) = match kind {
        FavoriteEntityKind::Friend => ("selectedGroups", "hasFriendInGroups"),
        FavoriteEntityKind::World => ("selectedWorldGroups", "worldInFavoriteGroups"),
        FavoriteEntityKind::Avatar => return Ok(()),
    };
    let old_key = format!("local:{group_name}");
    let new_key = format!("local:{new_group_name}");
    let rename = |values: Option<&mut Value>| {
        let mut changed = false;
        for value in values
            .and_then(Value::as_array_mut)
            .into_iter()
            .flatten()
            .filter(|value| value.as_str() == Some(old_key.as_str()))
        {
            *value = Value::String(new_key.clone());
            changed = true;
        }
        changed
    };
    let _write = PRESENCE_RULES_WRITE.lock().unwrap();
    for rule_kind in [
        PresenceAutomationRuleKind::Time,
        PresenceAutomationRuleKind::Context,
    ] {
        let mut rules = safe_value_array(&config.get_string(presence_rules_key(rule_kind), "[]")?);
        let mut changed = false;
        for rule in &mut rules {
            changed |= rename(rule.get_mut(selected_field));
            for condition in rule
                .get_mut("conditions")
                .and_then(Value::as_array_mut)
                .into_iter()
                .flatten()
                .filter(|condition| {
                    condition.get("type").and_then(Value::as_str) == Some(condition_type)
                })
            {
                changed |= rename(condition.get_mut("values"));
            }
        }
        if changed {
            config.set_json(presence_rules_key(rule_kind), &Value::Array(rules))?;
        }
    }
    Ok(())
}

fn presence_rules_key(kind: PresenceAutomationRuleKind) -> &'static str {
    match kind {
        PresenceAutomationRuleKind::Time => "presenceAutomationTimeRules",
        PresenceAutomationRuleKind::Context => "presenceAutomationContextRules",
    }
}

pub(super) fn load_stored_rules(config: &dyn ConfigStore, key: &str) -> Result<Vec<Value>> {
    Ok(safe_value_array(
        &config.get_string(key, "[]").unwrap_or_else(|_| "[]".into()),
    ))
}

fn safe_value_array(value: &str) -> Vec<Value> {
    serde_json::from_str::<Vec<Value>>(value).unwrap_or_default()
}
