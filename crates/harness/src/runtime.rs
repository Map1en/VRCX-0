use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use specta::Type;
use tokio_util::sync::CancellationToken;
use vrcx_0_application_core::{RuntimeAuthScope, RuntimeEventBus, TaskSupervisor};
use vrcx_0_integrations::llm::{LlmEndpointDetectModelsResult, LlmRequestOptions, ToolDefinition};
use vrcx_0_mcp::{spawn_in_process_tools, InProcessMcpTools, McpRuntime};
use vrcx_0_runtime_host::RuntimeHostState;

use crate::agent::{run_turn, TurnContext};
use crate::config::{should_apply_playbook, PlaybookMode};
use crate::endpoints::{
    resolve_assistant_reasoning_effort, AssistantRuntimeSelection, AssistantRuntimeStatus,
    EndpointStore, LlmEndpointDetectModelsInput, LlmEndpointDto, LlmEndpointUpsertInput,
    LlmTranslateInput,
};

/// Tools that mutate state (local DB or the VRChat account). They are hidden
/// from the model unless the user has explicitly armed writes, so a prompt
/// injection in attacker-controlled data (e.g. a friend's bio) cannot drive an
/// autonomous write.
const WRITE_TOOLS: &[&str] = &["favorite_local", "favorite_vrchat", "set_friend_note"];
use crate::error::HarnessError;
use crate::events::AssistantEmitter;
use crate::session::{
    random_hex, ActiveTurn, Role, Session, SessionStore, SessionSummary, TurnStatus,
};

pub struct AssistantController {
    endpoints: EndpointStore,
    bus: RuntimeEventBus,
    tasks: TaskSupervisor,
    tools: Arc<InProcessMcpTools>,
    tool_defs: Arc<Vec<ToolDefinition>>,
    sessions: Arc<SessionStore>,
    auth_scope: RuntimeAuthScope,
    cancels: Arc<Mutex<HashMap<String, (String, CancellationToken)>>>,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SendResult {
    pub session_id: String,
    pub turn_id: String,
}

impl AssistantController {
    pub async fn from_host(state: &RuntimeHostState) -> Result<Self, HarnessError> {
        let config = state.runtime_context.config.clone();
        let endpoints =
            EndpointStore::new(config.clone(), state.web.proxy_url().map(str::to_string));
        let bus = state.runtime_context.event_bus.clone();
        let tasks = state.runtime_context.tasks.clone();
        let tools = Arc::new(spawn_in_process_tools(McpRuntime::from_host(state)).await?);
        let tool_defs = Arc::new(load_tool_defs(&tools).await?);
        Ok(Self {
            endpoints,
            bus,
            tasks,
            tools,
            tool_defs,
            sessions: Arc::new(SessionStore::with_db(state.runtime_context.db.clone())),
            auth_scope: state.runtime_context.auth_scope.clone(),
            cancels: Arc::new(Mutex::new(HashMap::new())),
        })
    }

    pub fn endpoint_list(&self) -> Result<Vec<LlmEndpointDto>, HarnessError> {
        self.endpoints.list()
    }

    pub fn endpoint_upsert(
        &self,
        input: LlmEndpointUpsertInput,
    ) -> Result<LlmEndpointDto, HarnessError> {
        self.endpoints.upsert(input)
    }

    pub fn endpoint_delete(&self, id: &str) -> Result<(), HarnessError> {
        self.endpoints.delete(id)
    }

    pub async fn endpoint_detect_models(
        &self,
        input: LlmEndpointDetectModelsInput,
    ) -> Result<LlmEndpointDetectModelsResult, HarnessError> {
        self.endpoints.detect_models(input).await
    }

    pub fn runtime_status(&self) -> Result<AssistantRuntimeStatus, HarnessError> {
        self.endpoints.runtime_status()
    }

    pub fn set_follow_custom_proxy(&self, enabled: bool) -> Result<bool, HarnessError> {
        self.endpoints.set_follow_custom_proxy(enabled)
    }

    pub fn follow_custom_proxy(&self) -> Result<bool, HarnessError> {
        self.endpoints.follow_custom_proxy()
    }

    pub fn assistant_reasoning_effort(&self) -> Result<String, HarnessError> {
        self.endpoints.assistant_reasoning_effort()
    }

    pub fn set_assistant_reasoning_effort(&self, effort: &str) -> Result<String, HarnessError> {
        self.endpoints.set_assistant_reasoning_effort(effort)
    }

    pub fn set_session_runtime(
        &self,
        session_id: &str,
        endpoint_id: Option<String>,
        model: Option<String>,
        allow_writes: bool,
        playbook_mode: PlaybookMode,
    ) -> Result<Session, HarnessError> {
        let selection =
            self.set_default_runtime(endpoint_id, model, allow_writes, playbook_mode)?;
        self.sessions
            .set_runtime(&self.owner_user_id(), session_id, selection)
            .ok_or(HarnessError::SessionNotFound)
    }

    pub fn set_default_runtime(
        &self,
        endpoint_id: Option<String>,
        model: Option<String>,
        allow_writes: bool,
        playbook_mode: PlaybookMode,
    ) -> Result<AssistantRuntimeSelection, HarnessError> {
        let selection = AssistantRuntimeSelection {
            endpoint_id,
            model,
            allow_writes,
            playbook_mode,
        };
        self.endpoints.set_last_selection(&selection)?;
        Ok(selection)
    }

    pub async fn translate(&self, input: LlmTranslateInput) -> Result<String, HarnessError> {
        self.endpoints.translate(input).await
    }

    pub fn list_sessions(&self) -> Vec<SessionSummary> {
        self.sessions.list(&self.owner_user_id())
    }

    pub fn get_session(&self, session_id: &str) -> Option<Session> {
        self.sessions.get(&self.owner_user_id(), session_id)
    }

    pub fn new_session(&self) -> Session {
        let runtime = self.endpoints.last_selection().unwrap_or_default();
        self.sessions
            .create_session_with_runtime(&self.owner_user_id(), runtime)
    }

    pub fn set_entity_panel_open(&self, session_id: &str, open: bool) {
        if self
            .sessions
            .is_visible_to(session_id, &self.owner_user_id())
        {
            self.sessions.set_entity_panel_open(session_id, open);
        }
    }

    pub fn delete_session(&self, session_id: &str) {
        let owner_user_id = self.owner_user_id();
        if self.sessions.is_visible_to(session_id, &owner_user_id) {
            self.cancel_visible(session_id);
            self.sessions.delete(&owner_user_id, session_id);
        }
    }

    pub fn cancel(&self, session_id: &str) {
        if self
            .sessions
            .is_visible_to(session_id, &self.owner_user_id())
        {
            self.cancel_visible(session_id);
        }
    }

    fn cancel_visible(&self, session_id: &str) {
        if let Some((_, token)) = self.cancels.lock().unwrap().remove(session_id) {
            token.cancel();
        }
    }

    pub async fn send_message(
        &self,
        session_id: Option<String>,
        text: String,
        locale: Option<String>,
    ) -> Result<SendResult, HarnessError> {
        let runtime = self.endpoints.last_selection()?;
        let owner_user_id = self.owner_user_id();
        let session = self
            .sessions
            .ensure_session_with_runtime(&owner_user_id, session_id, runtime)
            .ok_or(HarnessError::SessionNotFound)?;
        let endpoint_id = session
            .endpoint_id
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .ok_or(HarnessError::NotConfigured)?;
        let model = session
            .model
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .ok_or(HarnessError::NotConfigured)?;
        let endpoint = self.endpoints.resolve(endpoint_id)?;
        let client = self
            .endpoints
            .llm_client(&endpoint.base_url, &endpoint.api_key, model)?;

        let stored_effort = self
            .endpoints
            .assistant_reasoning_effort()
            .unwrap_or_default();
        let options = LlmRequestOptions {
            reasoning_effort: resolve_assistant_reasoning_effort(
                &endpoint.base_url,
                &endpoint.model_reasoning,
                model,
                &stored_effort,
            ),
        };

        let tool_defs = visible_tool_defs(&self.tool_defs, session.allow_writes);

        let session_id = session.id.clone();
        let turn_id = format!("turn_{}", random_hex());

        // Record the user message synchronously, before spawning the turn, so a
        // rapid second send can never let a superseded turn's task push it later
        // (which reordered or duplicated messages in history).
        self.sessions.push_message(&session_id, Role::User, text);

        let cancel = CancellationToken::new();
        // Install the new turn as active and swap in its cancel token before
        // tearing down any previous turn, so a superseded turn sees it is no
        // longer current and exits without clobbering this one.
        self.sessions.set_active_turn(
            &session_id,
            Some(ActiveTurn {
                turn_id: turn_id.clone(),
                status: TurnStatus::Running,
            }),
        );
        let previous = self
            .cancels
            .lock()
            .unwrap()
            .insert(session_id.clone(), (turn_id.clone(), cancel.clone()));
        if let Some((_, previous_token)) = previous {
            previous_token.cancel();
        }

        let context = TurnContext {
            tools: Arc::clone(&self.tools),
            sessions: Arc::clone(&self.sessions),
            emitter: AssistantEmitter::new(self.bus.clone(), session_id.clone(), turn_id.clone()),
            client,
            tool_defs,
            session_id: session_id.clone(),
            turn_id: turn_id.clone(),
            locale,
            cancel,
            apply_playbook: should_apply_playbook(session.playbook_mode, &endpoint.base_url),
            options,
        };

        let cleanup = CancelCleanup {
            cancels: Arc::clone(&self.cancels),
            session_id: session_id.clone(),
            turn_id: turn_id.clone(),
        };
        self.tasks.spawn(async move {
            run_turn(context).await;
            drop(cleanup);
        });

        Ok(SendResult {
            session_id,
            turn_id,
        })
    }

    fn owner_user_id(&self) -> String {
        self.auth_scope.snapshot().current_user_id
    }
}

fn visible_tool_defs(
    tool_defs: &Arc<Vec<ToolDefinition>>,
    allow_writes: bool,
) -> Arc<Vec<ToolDefinition>> {
    if allow_writes {
        return Arc::clone(tool_defs);
    }
    Arc::new(
        tool_defs
            .iter()
            .filter(|tool| !WRITE_TOOLS.contains(&tool.name.as_str()))
            .cloned()
            .collect(),
    )
}

async fn load_tool_defs(tools: &InProcessMcpTools) -> Result<Vec<ToolDefinition>, HarnessError> {
    Ok(tools
        .list_tools()
        .await?
        .into_iter()
        .map(|tool| ToolDefinition {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
        })
        .collect())
}

/// Removes the per-session cancel token when a turn task finishes, but only if
/// it still owns the slot — a turn superseded by a newer one must not evict the
/// newer turn's token (which would leave the new turn uncancellable).
struct CancelCleanup {
    cancels: Arc<Mutex<HashMap<String, (String, CancellationToken)>>>,
    session_id: String,
    turn_id: String,
}

impl Drop for CancelCleanup {
    fn drop(&mut self) {
        if let Ok(mut guard) = self.cancels.lock() {
            if guard
                .get(&self.session_id)
                .is_some_and(|(turn_id, _)| turn_id == &self.turn_id)
            {
                guard.remove(&self.session_id);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_tools_stay_hidden_unless_writes_are_armed() {
        let tool_defs = Arc::new(
            [
                "get_copresence_summary",
                "favorite_local",
                "favorite_vrchat",
                "set_friend_note",
            ]
            .map(|name| crate::test_support::tool_def(name, serde_json::Value::Null))
            .to_vec(),
        );

        let hidden = visible_tool_defs(&tool_defs, false);
        let names: Vec<&str> = hidden.iter().map(|tool| tool.name.as_str()).collect();
        assert_eq!(names, vec!["get_copresence_summary"]);

        let armed = visible_tool_defs(&tool_defs, true);
        assert_eq!(armed.len(), tool_defs.len());
    }

    #[test]
    fn superseded_turn_cleanup_keeps_newer_cancel_token() {
        let cancels: Arc<Mutex<HashMap<String, (String, CancellationToken)>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let first_token = CancellationToken::new();
        let second_token = CancellationToken::new();

        cancels
            .lock()
            .unwrap()
            .insert("session_1".into(), ("turn_a".into(), first_token.clone()));
        let cleanup = CancelCleanup {
            cancels: Arc::clone(&cancels),
            session_id: "session_1".into(),
            turn_id: "turn_a".into(),
        };

        let previous = cancels
            .lock()
            .unwrap()
            .insert("session_1".into(), ("turn_b".into(), second_token.clone()));
        previous.unwrap().1.cancel();
        drop(cleanup);

        let guard = cancels.lock().unwrap();
        let (turn_id, token) = guard.get("session_1").unwrap();
        assert_eq!(turn_id, "turn_b");
        assert!(!token.is_cancelled());
        assert!(first_token.is_cancelled());
    }

    #[test]
    fn cancel_after_turn_swap_cancels_only_the_active_turn() {
        let cancels: Arc<Mutex<HashMap<String, (String, CancellationToken)>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let first_token = CancellationToken::new();
        let second_token = CancellationToken::new();

        cancels
            .lock()
            .unwrap()
            .insert("session_1".into(), ("turn_a".into(), first_token.clone()));
        let previous = cancels
            .lock()
            .unwrap()
            .insert("session_1".into(), ("turn_b".into(), second_token.clone()));
        previous.unwrap().1.cancel();

        let active = cancels.lock().unwrap().remove("session_1").unwrap();
        active.1.cancel();

        assert!(first_token.is_cancelled());
        assert!(second_token.is_cancelled());
        assert!(cancels.lock().unwrap().is_empty());
    }
}
