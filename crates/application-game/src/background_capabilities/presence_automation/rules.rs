use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use vrcx_0_application_core::ConfigStore;
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
