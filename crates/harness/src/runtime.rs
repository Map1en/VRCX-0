use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use specta::Type;
use tokio_util::sync::CancellationToken;
use vrcx_0_application::{RuntimeEventBus, TaskSupervisor};
use vrcx_0_integrations::llm::ToolDefinition;
use vrcx_0_mcp::{spawn_in_process_tools, InProcessMcpTools, McpRuntime};
use vrcx_0_runtime_host::RuntimeHostState;

use crate::agent::{run_turn, TurnContext};
use crate::config::{should_apply_playbook, PlaybookMode};
use crate::endpoints::{
    AssistantRuntimeSelection, AssistantRuntimeStatus, EndpointStore, LlmEndpointDetectModelsInput,
    LlmEndpointDto, LlmEndpointUpsertInput, LlmTranslateInput,
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
        let endpoints = EndpointStore::new(config.clone());
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
    ) -> Result<Vec<String>, HarnessError> {
        self.endpoints.detect_models(input).await
    }

    pub fn runtime_status(&self) -> Result<AssistantRuntimeStatus, HarnessError> {
        self.endpoints.runtime_status()
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
            .set_runtime(session_id, selection)
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
        self.sessions.list()
    }

    pub fn get_session(&self, session_id: &str) -> Option<Session> {
        self.sessions.get(session_id)
    }

    pub fn new_session(&self) -> Session {
        let runtime = self.endpoints.last_selection().unwrap_or_default();
        self.sessions.create_session_with_runtime(runtime)
    }

    pub fn set_entity_panel_open(&self, session_id: &str, open: bool) {
        self.sessions.set_entity_panel_open(session_id, open);
    }

    pub fn delete_session(&self, session_id: &str) {
        self.cancel(session_id);
        self.sessions.delete(session_id);
    }

    pub fn cancel(&self, session_id: &str) {
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
        let session = self
            .sessions
            .ensure_session_with_runtime(session_id, runtime);
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
        let client =
            vrcx_0_integrations::llm::LlmClient::new(&endpoint.base_url, &endpoint.api_key, model);
        let tool_defs = if session.allow_writes {
            Arc::clone(&self.tool_defs)
        } else {
            Arc::new(
                self.tool_defs
                    .iter()
                    .filter(|tool| !WRITE_TOOLS.contains(&tool.name.as_str()))
                    .cloned()
                    .collect(),
            )
        };

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
