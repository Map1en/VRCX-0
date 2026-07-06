use std::sync::{
    atomic::{AtomicU32, Ordering},
    Arc, Mutex,
};
use std::time::Duration;

use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

use crate::auth::{client_config_snippets, generate_mcp_token, McpAuthPolicy};
use crate::config::{
    DEFAULT_MCP_PORT, MCP_ALLOW_LAN_CONNECTIONS_CONFIG_KEY, MCP_ALLOW_VRCHAT_WRITES_CONFIG_KEY,
    MCP_ENABLED_CONFIG_KEY, MCP_PORT_CONFIG_KEY, MCP_TOKEN_CONFIG_KEY,
};
use crate::error::McpError;
use crate::runtime::McpRuntime;
use crate::transport::{bind_mcp_listener, build_mcp_router};
use crate::types::{McpServerState, McpServerStatus};

pub struct McpServerController {
    runtime: McpRuntime,
    handle: tokio::sync::Mutex<Option<McpServerHandle>>,
    active_connections: Arc<AtomicU32>,
    last_error: Arc<Mutex<Option<String>>>,
}

struct McpServerHandle {
    port: u16,
    token: String,
    cancel: CancellationToken,
    join: JoinHandle<()>,
}

impl McpServerController {
    pub fn new(runtime: McpRuntime) -> Self {
        Self {
            runtime,
            handle: tokio::sync::Mutex::new(None),
            active_connections: Arc::new(AtomicU32::new(0)),
            last_error: Arc::new(Mutex::new(None)),
        }
    }

    pub async fn start_from_config(&self) -> Result<McpServerStatus, McpError> {
        if !self
            .runtime
            .config
            .get_bool(MCP_ENABLED_CONFIG_KEY, false)?
        {
            return self.status().await;
        }
        match self.start_locked().await {
            Ok(()) => self.status().await,
            Err(error) => {
                self.set_last_error(error.to_string());
                Err(error)
            }
        }
    }

    pub async fn set_enabled(&self, enabled: bool) -> Result<McpServerStatus, McpError> {
        if enabled {
            self.runtime.config.set_bool(MCP_ENABLED_CONFIG_KEY, true)?;
            if let Err(error) = self.start_locked().await {
                let _ = self.runtime.config.set_bool(MCP_ENABLED_CONFIG_KEY, false);
                self.set_last_error(error.to_string());
                return Err(error);
            }
        } else {
            self.runtime
                .config
                .set_bool(MCP_ENABLED_CONFIG_KEY, false)?;
            self.stop_locked().await?;
        }
        self.status().await
    }

    pub async fn set_allow_vrchat_writes(
        &self,
        enabled: bool,
    ) -> Result<McpServerStatus, McpError> {
        self.runtime
            .config
            .set_bool(MCP_ALLOW_VRCHAT_WRITES_CONFIG_KEY, enabled)?;
        self.status().await
    }

    pub async fn set_allow_lan_connections(
        &self,
        enabled: bool,
    ) -> Result<McpServerStatus, McpError> {
        let previous = self.configured_allow_lan_connections()?;
        self.runtime
            .config
            .set_bool(MCP_ALLOW_LAN_CONNECTIONS_CONFIG_KEY, enabled)?;
        if let Err(error) = self.restart_if_enabled().await {
            let _ = self
                .runtime
                .config
                .set_bool(MCP_ALLOW_LAN_CONNECTIONS_CONFIG_KEY, previous);
            let _ = self.start_locked().await;
            self.set_last_error(error.to_string());
            return Err(error);
        }
        self.status().await
    }

    pub async fn set_port(&self, port: u16) -> Result<McpServerStatus, McpError> {
        if port < 1024 {
            return Err(McpError::Custom(
                "MCP port must be between 1024 and 65535".into(),
            ));
        }
        let previous_port = self.configured_port()?;
        self.runtime
            .config
            .set_string(MCP_PORT_CONFIG_KEY, &port.to_string())?;
        if let Err(error) = self.restart_if_enabled().await {
            self.runtime
                .config
                .set_string(MCP_PORT_CONFIG_KEY, &previous_port.to_string())?;
            let _ = self.start_locked().await;
            self.set_last_error(error.to_string());
            return Err(error);
        }
        self.status().await
    }

    pub async fn rotate_token(&self) -> Result<McpServerStatus, McpError> {
        let token = generate_mcp_token()?;
        self.runtime
            .config
            .set_string(MCP_TOKEN_CONFIG_KEY, token.as_str())?;
        if let Err(error) = self.restart_if_enabled().await {
            self.set_last_error(error.to_string());
            return Err(error);
        }
        self.status().await
    }

    pub async fn status(&self) -> Result<McpServerStatus, McpError> {
        let enabled = self
            .runtime
            .config
            .get_bool(MCP_ENABLED_CONFIG_KEY, false)?;
        let allow_vrchat_writes = self
            .runtime
            .config
            .get_bool(MCP_ALLOW_VRCHAT_WRITES_CONFIG_KEY, false)?;
        let allow_lan_connections = self.configured_allow_lan_connections()?;
        let handle = self.handle.lock().await;
        let active_connections = self.active_connections.load(Ordering::Relaxed);
        let last_error = self.last_error.lock().ok().and_then(|slot| slot.clone());
        let status = if let Some(handle) = handle.as_ref() {
            McpServerStatus {
                enabled,
                allow_lan_connections,
                allow_vrchat_writes,
                state: McpServerState::Running,
                port: Some(handle.port),
                active_connections,
                last_error,
                client_config: Some(client_config_snippets(
                    handle.port,
                    &handle.token,
                    allow_lan_connections,
                )),
            }
        } else {
            McpServerStatus {
                enabled,
                allow_lan_connections,
                allow_vrchat_writes,
                state: McpServerState::Disabled,
                port: Some(self.configured_port()?),
                active_connections,
                last_error,
                client_config: None,
            }
        };
        Ok(status)
    }

    async fn restart_if_enabled(&self) -> Result<(), McpError> {
        if !self
            .runtime
            .config
            .get_bool(MCP_ENABLED_CONFIG_KEY, false)?
        {
            return Ok(());
        }
        self.stop_locked().await?;
        self.start_locked().await
    }

    async fn start_locked(&self) -> Result<(), McpError> {
        let mut handle_slot = self.handle.lock().await;
        if handle_slot.is_some() {
            self.clear_last_error();
            return Ok(());
        }

        self.runtime
            .config
            .set_bool(MCP_ALLOW_VRCHAT_WRITES_CONFIG_KEY, false)?;
        let port = self.configured_port()?;
        let token = self.ensure_token()?;
        let allow_lan_connections = self.configured_allow_lan_connections()?;
        let listener = bind_mcp_listener(port, allow_lan_connections)?;
        let bound_port = listener.local_addr()?.port();
        self.runtime
            .config
            .set_string(MCP_PORT_CONFIG_KEY, &bound_port.to_string())?;

        let cancel = CancellationToken::new();
        let router = build_mcp_router(
            self.runtime.clone(),
            McpAuthPolicy {
                port: bound_port,
                token: token.clone(),
                allow_lan_connections,
            },
            Arc::clone(&self.active_connections),
            cancel.child_token(),
        );
        let shutdown = cancel.clone();
        let join = tokio::spawn(async move {
            if let Err(error) = axum::serve(listener, router)
                .with_graceful_shutdown(async move { shutdown.cancelled_owned().await })
                .await
            {
                tracing::warn!("MCP server stopped with error: {error}");
            }
        });

        *handle_slot = Some(McpServerHandle {
            port: bound_port,
            token,
            cancel,
            join,
        });
        self.clear_last_error();
        Ok(())
    }

    async fn stop_locked(&self) -> Result<(), McpError> {
        let mut handle_slot = self.handle.lock().await;
        let Some(handle) = handle_slot.take() else {
            self.active_connections.store(0, Ordering::Relaxed);
            return Ok(());
        };
        handle.cancel.cancel();
        let mut join = handle.join;
        match tokio::time::timeout(Duration::from_secs(5), &mut join).await {
            Ok(Ok(())) => {}
            Ok(Err(error)) => {
                self.set_last_error(format!("MCP server task failed: {error}"));
            }
            Err(_) => {
                join.abort();
                self.set_last_error("MCP server shutdown timed out; task was aborted.".into());
            }
        }
        self.active_connections.store(0, Ordering::Relaxed);
        Ok(())
    }

    fn configured_port(&self) -> Result<u16, McpError> {
        let raw = self
            .runtime
            .config
            .get_string(MCP_PORT_CONFIG_KEY, &DEFAULT_MCP_PORT.to_string())?;
        Ok(raw.trim().parse::<u16>().unwrap_or(DEFAULT_MCP_PORT))
    }

    fn configured_allow_lan_connections(&self) -> Result<bool, McpError> {
        Ok(self
            .runtime
            .config
            .get_bool(MCP_ALLOW_LAN_CONNECTIONS_CONFIG_KEY, false)?)
    }

    fn ensure_token(&self) -> Result<String, McpError> {
        let existing = self.runtime.config.get_string(MCP_TOKEN_CONFIG_KEY, "")?;
        if !existing.trim().is_empty() {
            return Ok(existing);
        }
        let token = generate_mcp_token()?;
        self.runtime
            .config
            .set_string(MCP_TOKEN_CONFIG_KEY, token.as_str())?;
        Ok(token)
    }

    fn set_last_error(&self, message: String) {
        if let Ok(mut slot) = self.last_error.lock() {
            *slot = Some(message);
        }
    }

    fn clear_last_error(&self) {
        if let Ok(mut slot) = self.last_error.lock() {
            *slot = None;
        }
    }
}
