use std::net::TcpListener;

use super::*;
use crate::test_support::test_runtime;

fn unused_loopback_port() -> u16 {
    TcpListener::bind(("127.0.0.1", 0))
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

fn set_configured_port(runtime: &McpRuntime, port: u16) {
    runtime
        .config
        .set_string(MCP_PORT_CONFIG_KEY, &port.to_string())
        .unwrap();
}

#[tokio::test]
async fn starting_resets_vrchat_writes_and_stopping_is_idempotent() {
    let (_dir, runtime) = test_runtime("controller-start-stop", "usr_owner").unwrap();
    set_configured_port(&runtime, unused_loopback_port());
    runtime
        .config
        .set_bool(MCP_ALLOW_VRCHAT_WRITES_CONFIG_KEY, true)
        .unwrap();
    let controller = McpServerController::new(runtime.clone());

    let running = controller.set_enabled(true).await.unwrap();
    assert_eq!(running.state, McpServerState::Running);
    assert!(running.enabled);
    assert!(!running.allow_vrchat_writes);

    let stopped = controller.set_enabled(false).await.unwrap();
    assert_eq!(stopped.state, McpServerState::Disabled);
    assert!(!stopped.enabled);
    let stopped_again = controller.set_enabled(false).await.unwrap();
    assert_eq!(stopped_again.state, McpServerState::Disabled);
}

#[tokio::test]
async fn enabling_rolls_back_config_when_the_port_is_occupied() {
    let occupied = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let occupied_port = occupied.local_addr().unwrap().port();
    let (_dir, runtime) = test_runtime("controller-enable-rollback", "usr_owner").unwrap();
    set_configured_port(&runtime, occupied_port);
    let controller = McpServerController::new(runtime.clone());

    assert!(controller.set_enabled(true).await.is_err());

    let status = controller.status().await.unwrap();
    assert_eq!(status.state, McpServerState::Disabled);
    assert!(!status.enabled);
    assert!(status.last_error.is_some());
    assert!(!runtime
        .config
        .get_bool(MCP_ENABLED_CONFIG_KEY, true)
        .unwrap());
}

#[tokio::test]
async fn failed_port_restart_restores_the_previous_listener_and_config() {
    let (_dir, runtime) = test_runtime("controller-port-rollback", "usr_owner").unwrap();
    set_configured_port(&runtime, unused_loopback_port());
    let controller = McpServerController::new(runtime.clone());
    let running = controller.set_enabled(true).await.unwrap();
    let previous_port = running.port.unwrap();
    let occupied = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let occupied_port = occupied.local_addr().unwrap().port();

    assert!(controller.set_port(occupied_port).await.is_err());

    let restored = controller.status().await.unwrap();
    assert_eq!(restored.state, McpServerState::Running);
    assert_eq!(restored.port, Some(previous_port));
    assert!(restored.enabled);
    assert!(restored.last_error.is_some());
    assert_eq!(
        runtime.config.get_string(MCP_PORT_CONFIG_KEY, "").unwrap(),
        previous_port.to_string()
    );
    controller.set_enabled(false).await.unwrap();
}

#[tokio::test]
async fn token_rotation_restarts_the_server_with_a_new_persisted_token() {
    let (_dir, runtime) = test_runtime("controller-token-rotation", "usr_owner").unwrap();
    set_configured_port(&runtime, unused_loopback_port());
    let controller = McpServerController::new(runtime.clone());
    let running = controller.set_enabled(true).await.unwrap();
    let port = running.port;
    let previous_token = runtime.config.get_string(MCP_TOKEN_CONFIG_KEY, "").unwrap();

    let rotated = controller.rotate_token().await.unwrap();
    let current_token = runtime.config.get_string(MCP_TOKEN_CONFIG_KEY, "").unwrap();

    assert_eq!(rotated.state, McpServerState::Running);
    assert_eq!(rotated.port, port);
    assert!(!previous_token.is_empty());
    assert_ne!(current_token, previous_token);
    controller.set_enabled(false).await.unwrap();
}
