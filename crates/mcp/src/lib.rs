mod auth;
mod config;
mod controller;
mod error;
mod in_process;
mod runtime;
mod server;
mod tools;
mod transport;
mod types;

#[cfg(test)]
mod test_support;

pub use auth::{
    authorize_mcp_request, client_config_snippets, generate_mcp_token, McpAuthError, McpAuthPolicy,
};
pub use config::{
    DEFAULT_MCP_PORT, MCP_ENABLED_CONFIG_KEY, MCP_PORT_CONFIG_KEY, MCP_TOKEN_CONFIG_KEY,
};
pub use controller::McpServerController;
pub use error::McpError;
pub use in_process::{spawn_in_process_tools, InProcessMcpTools, ToolCallOutcome, ToolDescriptor};
pub use runtime::McpRuntime;
pub use types::{ClientConfigSnippets, McpServerState, McpServerStatus};
