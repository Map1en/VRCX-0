//! Runtime-to-shell interfaces.

use serde_json::Value;

/// Emits frontend projection events or host telemetry without exposing Tauri.
pub trait EventSink: Send + Sync {
    fn emit(&self, event: &str, payload: Value);
}

/// Host actions that runtime services may request from the shell.
pub trait HostActions: Send + Sync {
    fn focus_main_window(&self);
}

/// Time source for deterministic runtime state machines and tests.
pub trait Clock: Send + Sync {
    fn now_unix_millis(&self) -> i64;
}

/// Host task execution boundary for runtime code that must delegate work.
pub trait TaskSpawner: Send + Sync {
    fn spawn(&self, task: Box<dyn FnOnce() + Send + 'static>);
}
