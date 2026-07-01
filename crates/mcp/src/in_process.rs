use std::borrow::Cow;

use rmcp::model::CallToolRequestParams;
use rmcp::service::{RoleClient, RunningService};
use rmcp::{serve_client, serve_server};
use serde_json::Value;

use crate::error::McpError;
use crate::runtime::McpRuntime;
use crate::server::VrcxMcpServer;

const DUPLEX_BUFFER_BYTES: usize = 1024 * 1024;

/// Plain tool description handed to the harness (no rmcp types leak out).
#[derive(Debug, Clone)]
pub struct ToolDescriptor {
    pub name: String,
    pub description: String,
    pub parameters: Value,
}

/// Plain tool-call outcome handed to the harness.
#[derive(Debug, Clone)]
pub struct ToolCallOutcome {
    pub is_error: bool,
    pub text: String,
    pub structured: Option<Value>,
}

/// In-process handle to the VRCX-0 MCP tool surface.
///
/// Wraps an rmcp client connected to a [`VrcxMcpServer`] over an in-memory
/// duplex stream: no HTTP, no port, no auth token. Tool definitions and
/// dispatch reuse the exact same router the localhost server exposes, so a new
/// `#[tool]` is picked up here automatically.
pub struct InProcessMcpTools {
    client: RunningService<RoleClient, ()>,
}

impl InProcessMcpTools {
    pub async fn list_tools(&self) -> Result<Vec<ToolDescriptor>, McpError> {
        let tools = self
            .client
            .list_all_tools()
            .await
            .map_err(|error| McpError::Custom(format!("list_tools failed: {error}")))?;
        Ok(tools
            .into_iter()
            .map(|tool| ToolDescriptor {
                name: tool.name.to_string(),
                description: tool
                    .description
                    .map(|value| value.to_string())
                    .unwrap_or_default(),
                parameters: Value::Object((*tool.input_schema).clone()),
            })
            .collect())
    }

    pub async fn call_tool(
        &self,
        name: impl Into<Cow<'static, str>>,
        arguments: Option<serde_json::Map<String, Value>>,
    ) -> Result<ToolCallOutcome, McpError> {
        let mut params = CallToolRequestParams::new(name);
        let tool_name = params.name.to_string();
        if let Some(arguments) = arguments {
            params = params.with_arguments(arguments);
        }
        let result = self.client.call_tool(params).await.map_err(|error| {
            tracing::debug!(tool = %tool_name, error = %error, "assistant: tool dispatch failed");
            McpError::Custom(format!("call_tool failed: {error}"))
        })?;
        let text = result
            .content
            .iter()
            .filter_map(|item| item.as_text().map(|text| text.text.clone()))
            .collect::<Vec<_>>()
            .join("\n");
        let is_error = result.is_error.unwrap_or(false);
        if is_error {
            tracing::debug!(tool = %tool_name, body = %text, "assistant: tool returned error");
        }
        Ok(ToolCallOutcome {
            is_error,
            text,
            structured: result.structured_content,
        })
    }
}

pub async fn spawn_in_process_tools(runtime: McpRuntime) -> Result<InProcessMcpTools, McpError> {
    let tasks = runtime.tasks.clone();
    let (server_io, client_io) = tokio::io::duplex(DUPLEX_BUFFER_BYTES);

    tasks.spawn(async move {
        match serve_server(VrcxMcpServer::new(runtime), server_io).await {
            Ok(server) => {
                if let Err(error) = server.waiting().await {
                    tracing::warn!("in-process MCP server stopped: {error}");
                }
            }
            Err(error) => {
                tracing::warn!("in-process MCP server failed to start: {error}");
            }
        }
    });

    let client = serve_client((), client_io)
        .await
        .map_err(|error| McpError::Custom(format!("in-process MCP client init failed: {error}")))?;

    Ok(InProcessMcpTools { client })
}
