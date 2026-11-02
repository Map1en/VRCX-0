use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde_json::Value;
use vrcx_0_contracts::llm::ToolDefinition;
use vrcx_0_core::OwnerId;

use crate::ports::{
    AssistantConfig, AssistantConfigPort, AssistantLlmClientFactory, AssistantLlmClientFactoryPort,
    AssistantLlmClientInput, AssistantLlmClientPort, AssistantLlmError, AssistantMessageInsert,
    AssistantPortError, AssistantPortResult, AssistantSessionPersistencePort,
    AssistantSessionRuntimeUpdate, AssistantSessionUpsert, PersistedAssistantMessage,
    PersistedAssistantSession,
};

pub(crate) fn tool_def(name: &str, parameters: Value) -> ToolDefinition {
    ToolDefinition {
        name: name.into(),
        description: String::new(),
        parameters,
    }
}

pub(crate) fn test_config_port() -> AssistantConfig {
    Arc::new(TestAssistantConfigPort::default())
}

pub(crate) fn test_llm_factory() -> AssistantLlmClientFactory {
    Arc::new(TestAssistantLlmClientFactory)
}

#[derive(Default)]
struct TestAssistantConfigPort {
    values: Mutex<HashMap<String, Value>>,
}

impl AssistantConfigPort for TestAssistantConfigPort {
    fn get_bool(&self, key: &str, default: bool) -> AssistantPortResult<bool> {
        Ok(self
            .values
            .lock()
            .unwrap()
            .get(key)
            .and_then(Value::as_bool)
            .unwrap_or(default))
    }

    fn set_bool(&self, key: &str, value: bool) -> AssistantPortResult<()> {
        self.values
            .lock()
            .unwrap()
            .insert(key.to_string(), Value::Bool(value));
        Ok(())
    }

    fn get_string(&self, key: &str, default: &str) -> AssistantPortResult<String> {
        Ok(self
            .values
            .lock()
            .unwrap()
            .get(key)
            .and_then(Value::as_str)
            .unwrap_or(default)
            .to_string())
    }

    fn set_string(&self, key: &str, value: &str) -> AssistantPortResult<()> {
        self.values
            .lock()
            .unwrap()
            .insert(key.to_string(), Value::String(value.to_string()));
        Ok(())
    }

    fn get_json(&self, key: &str, default: Value) -> AssistantPortResult<Value> {
        Ok(self
            .values
            .lock()
            .unwrap()
            .get(key)
            .cloned()
            .unwrap_or(default))
    }

    fn set_json(&self, key: &str, value: &Value) -> AssistantPortResult<()> {
        self.values
            .lock()
            .unwrap()
            .insert(key.to_string(), value.clone());
        Ok(())
    }
}

struct TestAssistantLlmClientFactory;

impl AssistantLlmClientFactoryPort for TestAssistantLlmClientFactory {
    fn create(
        &self,
        _input: AssistantLlmClientInput,
    ) -> Result<Arc<dyn AssistantLlmClientPort>, AssistantLlmError> {
        Err(AssistantLlmError::NotConfigured)
    }
}

#[derive(Clone, Default)]
pub(crate) struct TestAssistantSessionPersistence {
    state: Arc<Mutex<TestAssistantSessionPersistenceState>>,
}

#[derive(Default)]
struct TestAssistantSessionPersistenceState {
    sessions: HashMap<String, PersistedAssistantSession>,
    messages: HashMap<String, Vec<PersistedAssistantMessage>>,
    fail_load_messages: bool,
    fail_writes: bool,
}

impl TestAssistantSessionPersistence {
    pub(crate) fn set_load_messages_failure(&self, fail: bool) {
        self.state.lock().unwrap().fail_load_messages = fail;
    }

    pub(crate) fn set_write_failure(&self, fail: bool) {
        self.state.lock().unwrap().fail_writes = fail;
    }

    pub(crate) fn seed_session(
        &self,
        owner_user_id: &OwnerId,
        id: &str,
        title: &str,
        created_at: &str,
        updated_at: &str,
    ) {
        self.upsert_session(AssistantSessionUpsert {
            owner_user_id,
            id,
            title,
            created_at,
            updated_at,
        })
        .unwrap();
    }
}

impl AssistantSessionPersistencePort for TestAssistantSessionPersistence {
    fn load_sessions(
        &self,
        owner_user_id: &OwnerId,
    ) -> AssistantPortResult<Vec<PersistedAssistantSession>> {
        let owner_user_id = owner_user_id.as_str().trim();
        let mut sessions = self
            .state
            .lock()
            .unwrap()
            .sessions
            .values()
            .filter(|session| session_visible_to(session, owner_user_id))
            .cloned()
            .collect::<Vec<_>>();
        sessions.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        Ok(sessions)
    }

    fn load_messages(
        &self,
        owner_user_id: &OwnerId,
        session_id: &str,
    ) -> AssistantPortResult<Vec<PersistedAssistantMessage>> {
        let state = self.state.lock().unwrap();
        if state.fail_load_messages {
            return Err(test_failure("message load failed"));
        }
        let visible = state
            .sessions
            .get(session_id)
            .is_some_and(|session| session_visible_to(session, owner_user_id.as_str().trim()));
        if !visible {
            return Ok(Vec::new());
        }
        let mut messages = state.messages.get(session_id).cloned().unwrap_or_default();
        messages.sort_by_key(|message| message.seq);
        Ok(messages)
    }

    fn upsert_session(&self, input: AssistantSessionUpsert<'_>) -> AssistantPortResult<()> {
        let mut state = self.state.lock().unwrap();
        if state.fail_writes {
            return Err(test_failure("session write failed"));
        }
        if let Some(session) = state.sessions.get_mut(input.id) {
            session.title = input.title.to_string();
            session.updated_at = input.updated_at.to_string();
        } else {
            state.sessions.insert(
                input.id.to_string(),
                PersistedAssistantSession {
                    owner_user_id: input.owner_user_id.clone(),
                    id: input.id.to_string(),
                    title: input.title.to_string(),
                    created_at: input.created_at.to_string(),
                    updated_at: input.updated_at.to_string(),
                    entity_panel_open: false,
                    surfaced_entities: "[]".into(),
                    endpoint_id: String::new(),
                    model: String::new(),
                    allow_writes: false,
                    playbook_mode: "open".into(),
                    pinned: false,
                },
            );
        }
        Ok(())
    }

    fn set_ui_state(
        &self,
        session_id: &str,
        entity_panel_open: bool,
        surfaced_entities: &str,
    ) -> AssistantPortResult<()> {
        let mut state = self.state.lock().unwrap();
        if state.fail_writes {
            return Err(test_failure("session UI state write failed"));
        }
        if let Some(session) = state.sessions.get_mut(session_id) {
            session.entity_panel_open = entity_panel_open;
            session.surfaced_entities = surfaced_entities.to_string();
        }
        Ok(())
    }

    fn set_pinned(&self, session_id: &str, pinned: bool) -> AssistantPortResult<()> {
        let mut state = self.state.lock().unwrap();
        if state.fail_writes {
            return Err(test_failure("session pin write failed"));
        }
        if let Some(session) = state.sessions.get_mut(session_id) {
            session.pinned = pinned;
        }
        Ok(())
    }

    fn set_runtime(&self, input: AssistantSessionRuntimeUpdate<'_>) -> AssistantPortResult<()> {
        let mut state = self.state.lock().unwrap();
        if state.fail_writes {
            return Err(test_failure("session runtime write failed"));
        }
        if let Some(session) = state.sessions.get_mut(input.id) {
            session.endpoint_id = input.endpoint_id.unwrap_or_default().to_string();
            session.model = input.model.unwrap_or_default().to_string();
            session.allow_writes = input.allow_writes;
            session.playbook_mode = input.playbook_mode.to_string();
        }
        Ok(())
    }

    fn delete_session(&self, owner_user_id: &OwnerId, session_id: &str) -> AssistantPortResult<()> {
        let mut state = self.state.lock().unwrap();
        if state.fail_writes {
            return Err(test_failure("session delete failed"));
        }
        let visible = state
            .sessions
            .get(session_id)
            .is_some_and(|session| session_visible_to(session, owner_user_id.as_str().trim()));
        if visible {
            state.sessions.remove(session_id);
            state.messages.remove(session_id);
        }
        Ok(())
    }

    fn insert_message(&self, input: AssistantMessageInsert<'_>) -> AssistantPortResult<()> {
        let mut state = self.state.lock().unwrap();
        if state.fail_writes {
            return Err(test_failure("message write failed"));
        }
        let messages = state
            .messages
            .entry(input.session_id.to_string())
            .or_default();
        messages.retain(|message| message.id != input.id);
        messages.push(PersistedAssistantMessage {
            id: input.id.to_string(),
            seq: input.seq,
            role: input.role.to_string(),
            content: input.content.to_string(),
            created_at: input.created_at.to_string(),
        });
        Ok(())
    }
}

fn session_visible_to(session: &PersistedAssistantSession, owner_user_id: &str) -> bool {
    session.owner_user_id.as_str().is_empty() || session.owner_user_id.as_str() == owner_user_id
}

fn test_failure(message: &str) -> AssistantPortError {
    AssistantPortError::Custom(message.to_string())
}
