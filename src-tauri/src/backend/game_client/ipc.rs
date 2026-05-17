use crate::domain::ipc::{IpcEventDisposition, IpcEventSink};
use crate::error::AppError;
use vrcx_0_runtime::game_client::ipc::{parse_ipc_event, ParsedIpcEvent};

use super::service::GameClientBackend;
use vrcx_0_runtime::game_client::processor::GameClientJob;

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

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::sync::Arc;

    use crate::backend::context::BackendContext;
    use crate::domain::ipc::{IpcEventDisposition, IpcEventSink};
    use crate::domain::log_watcher::LogWatcher;
    use crate::error::AppError;
    use vrcx_0_runtime::game_client::actions::GameClientActions;
    use vrcx_0_runtime::image_cache::ImageCache;
    use vrcx_0_runtime::web_client::WebClient;
    use vrcx_0_runtime::Result as RuntimeResult;
    use vrcx_0_store::database::DatabaseService;
    use vrcx_0_store::game_log::{
        ensure_game_log_tables, get_game_log_events, get_game_log_externals,
    };
    use vrcx_0_store::storage::StorageService;

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

        fn start_game(&self, _arguments: &str) -> RuntimeResult<bool> {
            Ok(true)
        }

        fn start_game_from_path(&self, _path: &str, _arguments: &str) -> RuntimeResult<bool> {
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

        let events = get_game_log_events(&db)?;
        let externals = get_game_log_externals(&db)?;
        assert_eq!(events[0].data, "notice");
        assert_eq!(externals[0].message, "msg");
        assert_eq!(externals[0].display_name, "User");
        assert_eq!(externals[0].user_id, "usr_1");
        assert_eq!(externals[0].location, "wrld_runtime:1");
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
        let events = get_game_log_events(&db)?;
        assert!(events.is_empty());
        Ok(())
    }
}
