use std::sync::Arc;

use serde_json::Value;
use vrcx_0_assistant::{
    AssistantConfigPort, AssistantLlmClientFactoryPort, AssistantLlmClientInput,
    AssistantLlmClientPort, AssistantLlmError, AssistantLlmFuture, AssistantMessageInsert,
    AssistantPortError, AssistantPortResult, AssistantSessionPersistencePort,
    AssistantSessionRuntimeUpdate, AssistantSessionUpsert, AssistantSqliteErrorCategory,
    PersistedAssistantMessage, PersistedAssistantSession,
};
use vrcx_0_contracts::llm::{
    AssistantTurn, ChatMessage, LlmEndpointDetectModelsResult, LlmRequestOptions, ToolDefinition,
};
use vrcx_0_core::OwnerId;
use vrcx_0_persistence::{assistant, config::ConfigRepository, DatabaseService};

pub(crate) struct DesktopAssistantLlmClientFactory;

impl AssistantLlmClientFactoryPort for DesktopAssistantLlmClientFactory {
    fn create(
        &self,
        input: AssistantLlmClientInput,
    ) -> Result<Arc<dyn AssistantLlmClientPort>, AssistantLlmError> {
        vrcx_0_integrations::llm::LlmClient::new(
            input.base_url,
            input.api_key,
            input.model,
            input.proxy_url.as_deref(),
        )
        .map(|inner| {
            Arc::new(DesktopAssistantLlmClient { inner }) as Arc<dyn AssistantLlmClientPort>
        })
        .map_err(llm_error)
    }
}

struct DesktopAssistantLlmClient {
    inner: vrcx_0_integrations::llm::LlmClient,
}

impl AssistantLlmClientPort for DesktopAssistantLlmClient {
    fn list_models(&self) -> AssistantLlmFuture<'_, LlmEndpointDetectModelsResult> {
        Box::pin(async { self.inner.list_models().await.map_err(llm_error) })
    }

    fn complete_chat<'a>(
        &'a self,
        messages: &'a [ChatMessage],
        options: &'a LlmRequestOptions,
    ) -> AssistantLlmFuture<'a, String> {
        Box::pin(async {
            self.inner
                .complete_chat(messages, options)
                .await
                .map_err(llm_error)
        })
    }

    fn stream_chat<'a>(
        &'a self,
        messages: &'a [ChatMessage],
        tools: &'a [ToolDefinition],
        options: &'a LlmRequestOptions,
        mut on_text: Box<dyn FnMut(&str) + Send + 'a>,
    ) -> AssistantLlmFuture<'a, AssistantTurn> {
        Box::pin(async move {
            self.inner
                .stream_chat(messages, tools, options, |delta| on_text(delta))
                .await
                .map_err(llm_error)
        })
    }
}

pub(crate) struct DesktopAssistantConfigAdapter {
    config: ConfigRepository,
}

impl DesktopAssistantConfigAdapter {
    pub(crate) fn new(config: ConfigRepository) -> Self {
        Self { config }
    }
}

impl AssistantConfigPort for DesktopAssistantConfigAdapter {
    fn get_bool(&self, key: &str, default: bool) -> AssistantPortResult<bool> {
        self.config.get_bool(key, default).map_err(port_error)
    }

    fn set_bool(&self, key: &str, value: bool) -> AssistantPortResult<()> {
        self.config.set_bool(key, value).map_err(port_error)
    }

    fn get_string(&self, key: &str, default: &str) -> AssistantPortResult<String> {
        self.config.get_string(key, default).map_err(port_error)
    }

    fn set_string(&self, key: &str, value: &str) -> AssistantPortResult<()> {
        self.config.set_string(key, value).map_err(port_error)
    }

    fn get_json(&self, key: &str, default: Value) -> AssistantPortResult<Value> {
        self.config.get_json(key, default).map_err(port_error)
    }

    fn set_json(&self, key: &str, value: &Value) -> AssistantPortResult<()> {
        self.config.set_json(key, value).map_err(port_error)
    }
}

pub(crate) struct DesktopAssistantSessionPersistenceAdapter {
    db: Arc<DatabaseService>,
}

impl DesktopAssistantSessionPersistenceAdapter {
    pub(crate) fn new(db: Arc<DatabaseService>) -> Self {
        Self { db }
    }
}

impl AssistantSessionPersistencePort for DesktopAssistantSessionPersistenceAdapter {
    fn load_sessions(
        &self,
        owner_user_id: &OwnerId,
    ) -> AssistantPortResult<Vec<PersistedAssistantSession>> {
        assistant::assistant_sessions_load(self.db.as_ref(), owner_user_id)
            .map(|sessions| {
                sessions
                    .into_iter()
                    .map(|session| PersistedAssistantSession {
                        owner_user_id: session.owner_user_id,
                        id: session.id,
                        title: session.title,
                        created_at: session.created_at,
                        updated_at: session.updated_at,
                        entity_panel_open: session.entity_panel_open,
                        surfaced_entities: session.surfaced_entities,
                        endpoint_id: session.endpoint_id,
                        model: session.model,
                        allow_writes: session.allow_writes,
                        playbook_mode: session.playbook_mode,
                    })
                    .collect()
            })
            .map_err(port_error)
    }

    fn load_messages(
        &self,
        owner_user_id: &OwnerId,
        session_id: &str,
    ) -> AssistantPortResult<Vec<PersistedAssistantMessage>> {
        assistant::assistant_session_messages_load(self.db.as_ref(), owner_user_id, session_id)
            .map(|messages| {
                messages
                    .into_iter()
                    .map(|message| PersistedAssistantMessage {
                        id: message.id,
                        seq: message.seq,
                        role: message.role,
                        content: message.content,
                        created_at: message.created_at,
                    })
                    .collect()
            })
            .map_err(port_error)
    }

    fn upsert_session(&self, input: AssistantSessionUpsert<'_>) -> AssistantPortResult<()> {
        assistant::assistant_session_upsert(
            self.db.as_ref(),
            input.owner_user_id,
            input.id,
            input.title,
            input.created_at,
            input.updated_at,
        )
        .map_err(port_error)
    }

    fn set_ui_state(
        &self,
        session_id: &str,
        entity_panel_open: bool,
        surfaced_entities: &str,
    ) -> AssistantPortResult<()> {
        assistant::assistant_session_set_ui_state(
            self.db.as_ref(),
            session_id,
            entity_panel_open,
            surfaced_entities,
        )
        .map_err(port_error)
    }

    fn set_runtime(&self, input: AssistantSessionRuntimeUpdate<'_>) -> AssistantPortResult<()> {
        assistant::assistant_session_set_runtime(
            self.db.as_ref(),
            input.id,
            input.endpoint_id,
            input.model,
            input.allow_writes,
            input.playbook_mode,
        )
        .map_err(port_error)
    }

    fn delete_session(&self, owner_user_id: &OwnerId, session_id: &str) -> AssistantPortResult<()> {
        assistant::assistant_session_delete(self.db.as_ref(), owner_user_id, session_id)
            .map_err(port_error)
    }

    fn insert_message(&self, input: AssistantMessageInsert<'_>) -> AssistantPortResult<()> {
        assistant::assistant_message_insert(
            self.db.as_ref(),
            input.id,
            input.session_id,
            input.seq,
            input.role,
            input.content,
            input.created_at,
        )
        .map_err(port_error)
    }
}

fn port_error(error: vrcx_0_persistence::Error) -> AssistantPortError {
    match error {
        vrcx_0_persistence::Error::Database(message) => AssistantPortError::Database {
            message,
            sqlite_category: None,
        },
        vrcx_0_persistence::Error::Sqlite { message, category } => AssistantPortError::Database {
            message,
            sqlite_category: category.map(|category| match category {
                vrcx_0_persistence::SqliteErrorCategory::Malformed => {
                    AssistantSqliteErrorCategory::Malformed
                }
                vrcx_0_persistence::SqliteErrorCategory::DiskFull => {
                    AssistantSqliteErrorCategory::DiskFull
                }
                vrcx_0_persistence::SqliteErrorCategory::Locked => {
                    AssistantSqliteErrorCategory::Locked
                }
                vrcx_0_persistence::SqliteErrorCategory::IoError => {
                    AssistantSqliteErrorCategory::IoError
                }
            }),
        },
        vrcx_0_persistence::Error::Io(error) => AssistantPortError::Io(error.to_string()),
        vrcx_0_persistence::Error::Json(error) => AssistantPortError::Json(error.to_string()),
        vrcx_0_persistence::Error::InvalidData(message) => AssistantPortError::InvalidData(message),
        vrcx_0_persistence::Error::Custom(message) => AssistantPortError::Custom(message),
    }
}

fn llm_error(error: vrcx_0_integrations::llm::LlmError) -> AssistantLlmError {
    match error {
        vrcx_0_integrations::llm::LlmError::Http(error) => {
            AssistantLlmError::Http(vrcx_0_integrations::llm::transport_error_detail(&error))
        }
        vrcx_0_integrations::llm::LlmError::Api { status, message } => {
            AssistantLlmError::Api { status, message }
        }
        vrcx_0_integrations::llm::LlmError::NotConfigured => AssistantLlmError::NotConfigured,
    }
}
