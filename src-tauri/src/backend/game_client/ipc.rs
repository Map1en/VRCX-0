use serde_json::Value;

use crate::domain::ipc::{IpcEventDisposition, IpcEventSink};
use crate::error::AppError;
use vrcx_0_persistence::game_log::{
    write_batch, GameLogEventEntry, GameLogExternalEntry, GameLogWriteBatch,
};

use super::service::{GameClientBackend, GameClientDeps, GameClientJob};

#[derive(Clone, Debug, PartialEq, Eq)]
enum ParsedIpcEvent {
    MsgPing {
        version: i64,
    },
    VrcxNoty {
        message: String,
    },
    VrcxExternal {
        message: String,
        display_name: String,
        user_id: String,
        notify: bool,
    },
    Forward,
}

impl IpcEventSink for GameClientBackend {
    fn on_ipc_event(&self, packet: &str) -> Result<IpcEventDisposition, AppError> {
        match parse_ipc_event(packet) {
            Ok(ParsedIpcEvent::MsgPing { version }) => {
                self.state
                    .lock()
                    .map_err(|error| AppError::Custom(format!("GameClient state lock: {error}")))?
                    .external_notifier_version = version;
                Ok(IpcEventDisposition::Forward)
            }
            Ok(ParsedIpcEvent::VrcxNoty { message }) => {
                if !self.is_session_active()? {
                    return Ok(IpcEventDisposition::Forward);
                }
                match self.enqueue_job(GameClientJob::VrcxNoty {
                    message,
                    fallback_packet: packet.to_string(),
                }) {
                    Ok(()) => Ok(IpcEventDisposition::Handled),
                    Err(error) => {
                        tracing::warn!("failed to enqueue VRCX notifier IPC event: {error}");
                        Ok(IpcEventDisposition::Forward)
                    }
                }
            }
            Ok(ParsedIpcEvent::VrcxExternal {
                message,
                display_name,
                user_id,
                notify,
            }) => {
                if !self.is_session_active()? {
                    return Ok(IpcEventDisposition::Forward);
                }
                match self.enqueue_job(GameClientJob::VrcxExternal {
                    message,
                    display_name,
                    user_id,
                    notify,
                    fallback_packet: packet.to_string(),
                }) {
                    Ok(()) => Ok(IpcEventDisposition::Handled),
                    Err(error) => {
                        tracing::warn!("failed to enqueue VRCX external IPC event: {error}");
                        Ok(IpcEventDisposition::Forward)
                    }
                }
            }
            Ok(ParsedIpcEvent::Forward) | Err(_) => Ok(IpcEventDisposition::Forward),
        }
    }
}

impl GameClientBackend {
    fn is_session_active(&self) -> Result<bool, AppError> {
        Ok(self
            .state
            .lock()
            .map_err(|error| AppError::Custom(format!("GameClient state lock: {error}")))?
            .session_active)
    }
}

pub(super) fn handle_ipc_job(deps: &GameClientDeps, job: GameClientJob) -> Result<(), AppError> {
    match job {
        GameClientJob::VrcxNoty { message, .. } => handle_vrcx_noty(deps, &message),
        GameClientJob::VrcxExternal {
            message,
            display_name,
            user_id,
            notify,
            ..
        } => handle_vrcx_external(deps, &message, &display_name, &user_id, notify),
        GameClientJob::GameStopped => Ok(()),
    }
}

fn current_location(deps: &GameClientDeps) -> String {
    if let Ok(state) = deps.state.lock() {
        let current_location = state.current_location.trim();
        if !current_location.is_empty() {
            return current_location.to_string();
        }
    }

    deps.log_watcher
        .current_location_snapshot()
        .map(|snapshot| snapshot.location)
        .unwrap_or_default()
}

fn handle_vrcx_noty(deps: &GameClientDeps, message: &str) -> Result<(), AppError> {
    let version = deps
        .state
        .lock()
        .map_err(|error| AppError::Custom(format!("GameClient state lock: {error}")))?
        .external_notifier_version;
    if version > 21 {
        return Ok(());
    }

    let created_at = now_iso();
    write_batch(
        &deps.context.db,
        &GameLogWriteBatch {
            events: vec![GameLogEventEntry {
                created_at: created_at.clone(),
                data: message.to_string(),
            }],
            ..Default::default()
        },
    )?;
    deps.context.event_bus.emit_backend_game_log_event(vec![
        "backend-ipc".into(),
        created_at,
        "event".into(),
        message.to_string(),
    ]);
    deps.context.event_bus.emit_game_client_event(
        "notification",
        serde_json::json!({
            "level": "info",
            "title": "External notifier",
            "message": message,
        }),
    );
    Ok(())
}

fn handle_vrcx_external(
    deps: &GameClientDeps,
    message: &str,
    display_name: &str,
    user_id: &str,
    notify: bool,
) -> Result<(), AppError> {
    let created_at = now_iso();
    let location = current_location(deps);
    write_batch(
        &deps.context.db,
        &GameLogWriteBatch {
            externals: vec![GameLogExternalEntry {
                created_at: created_at.clone(),
                message: message.to_string(),
                display_name: display_name.to_string(),
                user_id: user_id.to_string(),
                location: location.clone(),
            }],
            ..Default::default()
        },
    )?;
    deps.context.event_bus.emit_backend_game_log_event(vec![
        "backend-ipc".into(),
        created_at,
        "external".into(),
        message.to_string(),
        display_name.to_string(),
        user_id.to_string(),
        location,
    ]);
    if notify {
        deps.context.event_bus.emit_game_client_event(
            "notification",
            serde_json::json!({
                "level": "info",
                "title": if display_name.is_empty() { "External" } else { display_name },
                "message": message,
            }),
        );
    }
    Ok(())
}

fn parse_ipc_event(packet: &str) -> Result<ParsedIpcEvent, serde_json::Error> {
    let value = serde_json::from_str::<Value>(packet)?;
    let event_type = text(value.get("type")).or_else(|| text(value.get("Type")));
    match event_type.as_str() {
        "MsgPing" => Ok(ParsedIpcEvent::MsgPing {
            version: number(value.get("version")),
        }),
        "VrcxMessage" => match text(value.get("MsgType")).as_str() {
            "Noty" => Ok(ParsedIpcEvent::VrcxNoty {
                message: text(value.get("Data")),
            }),
            "External" => Ok(ParsedIpcEvent::VrcxExternal {
                message: text(value.get("Data")),
                display_name: text(value.get("DisplayName")),
                user_id: text(value.get("UserId")),
                notify: value.get("notify").and_then(Value::as_bool).unwrap_or(true),
            }),
            _ => Ok(ParsedIpcEvent::Forward),
        },
        _ => Ok(ParsedIpcEvent::Forward),
    }
}

fn now_iso() -> String {
    chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string()
}

fn text(value: Option<&Value>) -> String {
    value
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn number(value: Option<&Value>) -> i64 {
    value
        .and_then(Value::as_i64)
        .or_else(|| text(value).parse::<i64>().ok())
        .unwrap_or_default()
}

trait StringFallback {
    fn or_else<F: FnOnce() -> String>(self, fallback: F) -> String;
}

impl StringFallback for String {
    fn or_else<F: FnOnce() -> String>(self, fallback: F) -> String {
        if self.is_empty() {
            fallback()
        } else {
            self
        }
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::sync::Arc;

    use crate::backend::context::BackendContext;
    use crate::backend::game_client::actions::GameClientActions;
    use crate::domain::image_cache::ImageCache;
    use crate::domain::ipc::{IpcEventDisposition, IpcEventSink};
    use crate::domain::log_watcher::LogWatcher;
    use crate::domain::storage::StorageService;
    use crate::domain::web_client::WebClient;
    use crate::error::AppError;
    use vrcx_0_persistence::database::DatabaseService;
    use vrcx_0_persistence::game_log::ensure_game_log_tables;

    use super::{parse_ipc_event, ParsedIpcEvent};
    use crate::backend::game_client::GameClientBackend;

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn new(name: &str) -> Self {
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path =
                std::env::temp_dir().join(format!("vrcx-0-{name}-{}-{nonce}", std::process::id()));
            std::fs::create_dir_all(&path).unwrap();
            Self { path }
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    struct NoopActions;

    impl GameClientActions for NoopActions {
        fn is_game_running(&self) -> bool {
            false
        }

        fn is_steamvr_running(&self) -> bool {
            true
        }

        fn start_game(&self, _arguments: &str) -> Result<bool, AppError> {
            Ok(true)
        }

        fn start_game_from_path(&self, _path: &str, _arguments: &str) -> Result<bool, AppError> {
            Ok(true)
        }
    }

    fn test_backend(
        name: &str,
    ) -> Result<(TestDir, Arc<DatabaseService>, GameClientBackend), AppError> {
        let dir = TestDir::new(name);
        let db = Arc::new(DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?);
        let storage = StorageService::new(&dir.path.join("VRCX-0.json"))?;
        let web = Arc::new(WebClient::new(&storage, &db)?);
        let image_cache = Arc::new(ImageCache::new(
            dir.path.join("ImageCache"),
            web.cookie_jar(),
            web.proxy_url(),
        )?);
        let context = Arc::new(BackendContext::new(Arc::clone(&db), web, image_cache));
        let backend = GameClientBackend::test_with_actions(
            context,
            LogWatcher::new(None),
            Arc::new(NoopActions),
        );
        Ok((dir, db, backend))
    }

    #[test]
    fn parses_msg_ping_version() {
        assert_eq!(
            parse_ipc_event(r#"{"type":"MsgPing","version":"24"}"#).unwrap(),
            ParsedIpcEvent::MsgPing { version: 24 }
        );
    }

    #[test]
    fn parses_vrcx_noty_and_external_messages() {
        assert_eq!(
            parse_ipc_event(r#"{"type":"VrcxMessage","MsgType":"Noty","Data":" hello "}"#).unwrap(),
            ParsedIpcEvent::VrcxNoty {
                message: "hello".into()
            }
        );
        assert_eq!(
            parse_ipc_event(
                r#"{"type":"VrcxMessage","MsgType":"External","Data":"msg","DisplayName":"User","UserId":"usr_1","notify":false}"#
            )
            .unwrap(),
            ParsedIpcEvent::VrcxExternal {
                message: "msg".into(),
                display_name: "User".into(),
                user_id: "usr_1".into(),
                notify: false,
            }
        );
    }

    #[test]
    fn forwards_invalid_or_unhandled_ipc_payloads() {
        assert!(parse_ipc_event("not-json").is_err());
        assert_eq!(
            parse_ipc_event(r#"{"type":"LaunchCommand","command":"world/wrld_1"}"#).unwrap(),
            ParsedIpcEvent::Forward
        );
    }

    #[test]
    fn writes_vrcx_messages_to_game_log_tables() -> Result<(), AppError> {
        let (_dir, db, backend) = test_backend("game-client-ipc-write")?;
        backend.set_runtime_state(true, "wrld_runtime:1");

        assert_eq!(
            backend.on_ipc_event(r#"{"type":"VrcxMessage","MsgType":"Noty","Data":"notice"}"#)?,
            IpcEventDisposition::Handled
        );
        assert_eq!(
            backend.on_ipc_event(
                r#"{"type":"VrcxMessage","MsgType":"External","Data":"msg","DisplayName":"User","UserId":"usr_1"}"#
            )?,
            IpcEventDisposition::Handled
        );
        assert!(backend.wait_until_idle_for_test());

        let empty = std::collections::HashMap::new();
        let events = db.execute("SELECT data FROM gamelog_event", &empty)?;
        let externals = db.execute(
            "SELECT message, display_name, user_id, location FROM gamelog_external",
            &empty,
        )?;
        assert_eq!(events[0][0].as_str(), Some("notice"));
        assert_eq!(externals[0][0].as_str(), Some("msg"));
        assert_eq!(externals[0][1].as_str(), Some("User"));
        assert_eq!(externals[0][2].as_str(), Some("usr_1"));
        assert_eq!(externals[0][3].as_str(), Some("wrld_runtime:1"));
        Ok(())
    }

    #[test]
    fn forwards_vrcx_messages_when_session_is_inactive() -> Result<(), AppError> {
        let (_dir, db, backend) = test_backend("game-client-ipc-inactive")?;

        assert_eq!(
            backend.on_ipc_event(r#"{"type":"VrcxMessage","MsgType":"Noty","Data":"notice"}"#)?,
            IpcEventDisposition::Forward
        );

        ensure_game_log_tables(&db)?;
        let empty = std::collections::HashMap::new();
        let events = db.execute("SELECT data FROM gamelog_event", &empty)?;
        assert!(events.is_empty());
        Ok(())
    }
}
