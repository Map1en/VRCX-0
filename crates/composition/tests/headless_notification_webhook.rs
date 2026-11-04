use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::mpsc;
use std::time::{Duration, Instant};

use serde_json::json;
use vrcx_0_application_realtime::{FavoriteBaselineSnapshot, RealtimeWsMessagePayload};
use vrcx_0_composition::{RuntimeHostOptions, RuntimeHostProfile, RuntimeHostState};
use vrcx_0_core::OwnerId;
use vrcx_0_platform::app_paths::{AppDataDirResolution, AppDataDirSource};

struct TestDir {
    path: PathBuf,
}

impl TestDir {
    fn new() -> std::io::Result<Self> {
        let path = std::env::temp_dir().join(format!(
            "vrcx-0-headless-webhook-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        std::fs::create_dir_all(&path)?;
        Ok(Self { path })
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

#[tokio::test]
async fn headless_recent_notification_sends_one_webhook_and_deduplicates() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let webhook_url = format!("http://{}/hook", listener.local_addr().unwrap());
    let (capture_tx, capture_rx) = mpsc::channel();
    let server = std::thread::spawn(move || serve_webhook_requests(listener, capture_tx));

    let dir = TestDir::new().unwrap();
    let app_data = dir.path.join("app-data");
    std::fs::create_dir_all(&app_data).unwrap();
    let state = RuntimeHostState::new(RuntimeHostOptions {
        realtime_origin: "http://localhost:9000".into(),
        launched_from_autostart: false,
        app_data_dir: AppDataDirResolution {
            current_dir: app_data.clone(),
            default_dir: app_data.clone(),
            persisted_dir: None,
            cli_dir: Some(app_data),
            source: AppDataDirSource::Cli,
        },
        app_version: "0.0.0-test".into(),
        profile: RuntimeHostProfile::HeadlessData,
        database_maintenance_cache_dir: None,
        task_executor: None,
    })
    .unwrap();
    state
        .desktop_assembly()
        .config_store()
        .set_bool("webhookEnabled", true)
        .unwrap();
    state
        .desktop_assembly()
        .config_store()
        .set_string("webhookUrl", &webhook_url)
        .unwrap();
    state
        .desktop_assembly()
        .config_store()
        .set_string("webhookFormat", "generic")
        .unwrap();
    state
        .desktop_assembly()
        .config_store()
        .set_json(
            "webhookActivityFilters",
            &json!({
                "types": {
                    "invite": {
                        "scope": "allFavorites",
                        "favoriteGroupKeys": "all"
                    }
                }
            }),
        )
        .unwrap();

    let activity = state.desktop_assembly().activity_router();
    state.desktop_assembly().reload_overlay_activity_filters();
    activity.arm_delivery();
    state
        .authenticated_runtime()
        .apply_favorites_snapshot(&FavoriteBaselineSnapshot {
            grouped_favorite_friend_ids_by_group_key: [(
                "group-a".to_string(),
                vec!["usr_sender".to_string()],
            )]
            .into(),
            ..Default::default()
        });
    let notification = RealtimeWsMessagePayload {
        json: json!({
            "type": "notification",
            "content": {
                "id": "headless-webhook-invite-1",
                "type": "invite",
                "senderUserId": "usr_sender",
                "senderUsername": "Sender",
                "details": {
                    "location": "",
                    "worldId": "",
                    "worldName": "",
                    "message": "Join?"
                }
            }
        }),
        raw: "{}".into(),
        received_at: chrono::Utc::now().to_rfc3339(),
    };

    for _ in 0..2 {
        assert!(state
            .realtime_runtime()
            .ingest_notification_ws_message_for_test(
                &OwnerId::new("usr_self"),
                "https://api.vrchat.cloud/api/1",
                1,
                &notification,
            ));
    }

    let (request_count, request) =
        tokio::task::spawn_blocking(move || capture_rx.recv_timeout(Duration::from_secs(10)))
            .await
            .unwrap()
            .unwrap();
    server.join().unwrap();

    assert_eq!(request_count, 1);
    let body = request
        .split_once("\r\n\r\n")
        .map(|(_, body)| body)
        .unwrap_or_default();
    let payload: serde_json::Value = serde_json::from_str(body).unwrap();
    assert_eq!(payload["event"], "invite");
    assert_eq!(payload["user"]["id"], "usr_sender");
    let delivery_status = state.desktop_assembly().webhook_delivery_snapshot();
    let last_success = delivery_status.notification.last_success.unwrap();
    assert_eq!(last_success.event, "invite");
    assert_eq!(last_success.status, Some(204));
    assert_eq!(last_success.attempts, 1);
}

fn serve_webhook_requests(listener: TcpListener, capture_tx: mpsc::Sender<(usize, String)>) {
    let (mut stream, _) = listener.accept().unwrap();
    let request = read_http_request(&mut stream);
    stream
        .write_all(b"HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
        .unwrap();

    listener.set_nonblocking(true).unwrap();
    let deadline = Instant::now() + Duration::from_millis(500);
    let mut request_count = 1;
    while Instant::now() < deadline {
        match listener.accept() {
            Ok((mut duplicate, _)) => {
                request_count += 1;
                let _ = read_http_request(&mut duplicate);
                let _ = duplicate.write_all(
                    b"HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                );
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(10));
            }
            Err(error) => panic!("webhook listener failed: {error}"),
        }
    }
    capture_tx.send((request_count, request)).unwrap();
}

fn read_http_request(stream: &mut TcpStream) -> String {
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    let mut bytes = Vec::new();
    let mut buffer = [0u8; 2048];
    loop {
        match stream.read(&mut buffer) {
            Ok(0) => break,
            Ok(read) => {
                bytes.extend_from_slice(&buffer[..read]);
                if request_is_complete(&bytes) {
                    break;
                }
            }
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) =>
            {
                break;
            }
            Err(error) => panic!("webhook request read failed: {error}"),
        }
    }
    String::from_utf8(bytes).unwrap()
}

fn request_is_complete(bytes: &[u8]) -> bool {
    let Some(header_end) = bytes.windows(4).position(|window| window == b"\r\n\r\n") else {
        return false;
    };
    let headers = String::from_utf8_lossy(&bytes[..header_end]);
    let content_length = headers
        .lines()
        .find_map(|line| {
            let (name, value) = line.split_once(':')?;
            name.eq_ignore_ascii_case("content-length")
                .then(|| value.trim().parse::<usize>().ok())
                .flatten()
        })
        .unwrap_or_default();
    bytes.len() >= header_end + 4 + content_length
}
