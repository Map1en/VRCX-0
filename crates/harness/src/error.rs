use vrcx_0_integrations::llm::LlmError;

#[derive(Debug, thiserror::Error)]
pub enum HarnessError {
    #[error("assistant is not configured")]
    NotConfigured,
    #[error("assistant endpoint was removed: {0}")]
    EndpointRemoved(String),
    #[error("invalid LLM endpoint: {0}")]
    InvalidEndpoint(String),
    #[error("assistant session not found")]
    SessionNotFound,
    #[error("assistant LLM error: {0}")]
    Llm(#[from] LlmError),
    #[error("assistant MCP error: {0}")]
    Mcp(#[from] vrcx_0_mcp::McpError),
    #[error("assistant persistence error: {0}")]
    Persistence(#[from] vrcx_0_persistence::Error),
    #[error("{0}")]
    Custom(String),
}
