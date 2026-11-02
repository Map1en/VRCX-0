use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use serde_json::Value;
use vrcx_0_contracts::llm::{
    AssistantTurn, ChatMessage, LlmEndpointDetectModelsResult, LlmRequestOptions, ToolDefinition,
};
use vrcx_0_core::OwnerId;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AssistantSqliteErrorCategory {
    Malformed,
    DiskFull,
    Locked,
    IoError,
}

#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum AssistantPortError {
    #[error("Database error: {message}")]
    Database {
        message: String,
        sqlite_category: Option<AssistantSqliteErrorCategory>,
    },
    #[error("IO error: {0}")]
    Io(String),
    #[error("JSON error: {0}")]
    Json(String),
    #[error("Invalid data: {0}")]
    InvalidData(String),
    #[error("{0}")]
    Custom(String),
}

pub type AssistantPortResult<T> = Result<T, AssistantPortError>;

#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum AssistantLlmError {
    #[error("LLM transport error: {0}")]
    Http(String),
    #[error("LLM API error ({status}): {message}")]
    Api { status: u16, message: String },
    #[error("LLM not configured")]
    NotConfigured,
}

pub struct AssistantLlmClientInput {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub proxy_url: Option<String>,
}

pub type AssistantLlmFuture<'a, T> =
    Pin<Box<dyn Future<Output = Result<T, AssistantLlmError>> + Send + 'a>>;

pub trait AssistantLlmClientPort: Send + Sync {
    fn list_models(&self) -> AssistantLlmFuture<'_, LlmEndpointDetectModelsResult>;

    fn complete_chat<'a>(
        &'a self,
        messages: &'a [ChatMessage],
        options: &'a LlmRequestOptions,
    ) -> AssistantLlmFuture<'a, String>;

    fn stream_chat<'a>(
        &'a self,
        messages: &'a [ChatMessage],
        tools: &'a [ToolDefinition],
        options: &'a LlmRequestOptions,
        on_text: Box<dyn FnMut(&str) + Send + 'a>,
    ) -> AssistantLlmFuture<'a, AssistantTurn>;
}

pub trait AssistantLlmClientFactoryPort: Send + Sync {
    fn create(
        &self,
        input: AssistantLlmClientInput,
    ) -> Result<Arc<dyn AssistantLlmClientPort>, AssistantLlmError>;
}

pub type AssistantLlmClient = Arc<dyn AssistantLlmClientPort>;
pub type AssistantLlmClientFactory = Arc<dyn AssistantLlmClientFactoryPort>;

pub trait AssistantConfigPort: Send + Sync {
    fn get_bool(&self, key: &str, default: bool) -> AssistantPortResult<bool>;
    fn set_bool(&self, key: &str, value: bool) -> AssistantPortResult<()>;
    fn get_string(&self, key: &str, default: &str) -> AssistantPortResult<String>;
    fn set_string(&self, key: &str, value: &str) -> AssistantPortResult<()>;
    fn get_json(&self, key: &str, default: Value) -> AssistantPortResult<Value>;
    fn set_json(&self, key: &str, value: &Value) -> AssistantPortResult<()>;
}

#[derive(Debug, Clone)]
pub struct PersistedAssistantMessage {
    pub id: String,
    pub seq: i64,
    pub role: String,
    pub content: String,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct PersistedAssistantSession {
    pub owner_user_id: OwnerId,
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    pub entity_panel_open: bool,
    pub surfaced_entities: String,
    pub endpoint_id: String,
    pub model: String,
    pub allow_writes: bool,
    pub playbook_mode: String,
    pub pinned: bool,
}

pub struct AssistantSessionUpsert<'a> {
    pub owner_user_id: &'a OwnerId,
    pub id: &'a str,
    pub title: &'a str,
    pub created_at: &'a str,
    pub updated_at: &'a str,
}

pub struct AssistantSessionRuntimeUpdate<'a> {
    pub id: &'a str,
    pub endpoint_id: Option<&'a str>,
    pub model: Option<&'a str>,
    pub allow_writes: bool,
    pub playbook_mode: &'a str,
}

pub struct AssistantMessageInsert<'a> {
    pub id: &'a str,
    pub session_id: &'a str,
    pub seq: i64,
    pub role: &'a str,
    pub content: &'a str,
    pub created_at: &'a str,
}

pub trait AssistantSessionPersistencePort: Send + Sync {
    fn load_sessions(
        &self,
        owner_user_id: &OwnerId,
    ) -> AssistantPortResult<Vec<PersistedAssistantSession>>;

    fn load_messages(
        &self,
        owner_user_id: &OwnerId,
        session_id: &str,
    ) -> AssistantPortResult<Vec<PersistedAssistantMessage>>;

    fn upsert_session(&self, input: AssistantSessionUpsert<'_>) -> AssistantPortResult<()>;

    fn set_ui_state(
        &self,
        session_id: &str,
        entity_panel_open: bool,
        surfaced_entities: &str,
    ) -> AssistantPortResult<()>;

    fn set_runtime(&self, input: AssistantSessionRuntimeUpdate<'_>) -> AssistantPortResult<()>;

    fn set_pinned(&self, session_id: &str, pinned: bool) -> AssistantPortResult<()>;

    fn delete_session(&self, owner_user_id: &OwnerId, session_id: &str) -> AssistantPortResult<()>;

    fn insert_message(&self, input: AssistantMessageInsert<'_>) -> AssistantPortResult<()>;
}

pub type AssistantConfig = Arc<dyn AssistantConfigPort>;
pub type AssistantSessionPersistence = Arc<dyn AssistantSessionPersistencePort>;
