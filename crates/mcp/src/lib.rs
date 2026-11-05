mod auth;
mod config;
mod controller;
mod disambiguation;
mod error;
mod in_process;
mod ports;
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
pub use disambiguation::{apply_user_choice, UserChoiceRequest};
pub use error::McpError;
pub use in_process::{spawn_in_process_tools, InProcessMcpTools, ToolCallOutcome, ToolDescriptor};
pub use ports::{
    McpActivityQueries, McpActivityQueryPort, McpChatbox, McpChatboxPort, McpFavoritesQueries,
    McpFavoritesQueryPort, McpFeedQueries, McpFeedQueryPort, McpFriendCurrent, McpFriendLocalData,
    McpFriendLocalDataPort, McpFriendMemo, McpFuture, McpInterruptCheck, McpLocalModeration,
    McpMemoSave, McpMutualGraph, McpMutualGraphMeta, McpMutualGraphPort, McpPlaySpan,
    McpScreenshotQueries, McpScreenshotQueryPort, McpSocialHistoryQueries,
    McpSocialHistoryQueryPort, McpWorldLookup, McpWorldLookupPort,
};
pub use runtime::{McpCaller, McpRuntime, McpRuntimeDeps};
pub use types::{ClientConfigSnippets, McpInstallClient, McpServerState, McpServerStatus};
