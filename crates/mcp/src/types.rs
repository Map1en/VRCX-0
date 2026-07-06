use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ClientConfigSnippets {
    pub claude_code_command: String,
    pub mcp_remote_json: String,
    pub generic_json: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum McpServerState {
    Disabled,
    Running,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct McpServerStatus {
    pub enabled: bool,
    pub allow_lan_connections: bool,
    pub allow_vrchat_writes: bool,
    pub state: McpServerState,
    pub port: Option<u16>,
    pub active_connections: u32,
    pub last_error: Option<String>,
    pub client_config: Option<ClientConfigSnippets>,
}
