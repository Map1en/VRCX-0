#![allow(non_snake_case)]

use tauri::State;
use vrcx_0_application_game::PresenceAutomationRuleKind;
use vrcx_0_core::json::RawJson;

use crate::error::AppError;
use crate::state::AppState;

#[tauri::command(async)]
#[specta::specta]
pub fn app__presence_automation_rules_get(
    state: State<'_, AppState>,
    kind: PresenceAutomationRuleKind,
) -> Result<Vec<RawJson>, AppError> {
    Ok(state.runtime_host().presence_automation_rules(kind)?)
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__presence_automation_rules_set(
    state: State<'_, AppState>,
    kind: PresenceAutomationRuleKind,
    rules: Vec<RawJson>,
) -> Result<Vec<RawJson>, AppError> {
    Ok(state
        .runtime_host()
        .set_presence_automation_rules(kind, rules)?)
}
