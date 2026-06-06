use std::net::UdpSocket;
use std::path::Path;
use std::sync::Arc;

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use futures_util::{SinkExt, StreamExt};
use tokio::net::TcpStream;
use tokio::sync::Mutex;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};

pub struct OvrToolkit {
    sender: Arc<Mutex<Option<WsSender>>>,
}

type WsSender =
    futures_util::stream::SplitSink<WebSocketStream<MaybeTlsStream<TcpStream>>, Message>;

const VRCX_ICON_BYTES: &[u8] = include_bytes!("../../../src-tauri/icons/icon.png");

impl OvrToolkit {
    pub fn new() -> Self {
        Self {
            sender: Arc::new(Mutex::new(None)),
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub fn send_notification(
        &self,
        hud_notification: bool,
        wrist_notification: bool,
        title: &str,
        body: &str,
        _timeout: i32,
        _opacity: f64,
        image: Option<&str>,
    ) {
        let mut messages: Vec<serde_json::Value> = Vec::new();
        let icon_b64 = notification_icon_base64(image);

        if wrist_notification {
            messages.push(serde_json::json!({
                "messageType": "SendWristNotification",
                "json": serde_json::to_string(&serde_json::json!({
                    "body": format!("{title} - {body}")
                })).unwrap_or_default()
            }));
        }

        if hud_notification {
            messages.push(serde_json::json!({
                "messageType": "SendNotification",
                "json": serde_json::to_string(&serde_json::json!({
                    "title": title,
                    "body": body,
                    "icon": icon_b64
                })).unwrap_or_default()
            }));
        }

        if messages.is_empty() {
            return;
        }

        let sender = Arc::clone(&self.sender);
        tokio::spawn(async move {
            if let Err(error) = send_with_persistent_conn(sender, messages).await {
                tracing::warn!("[OVR Toolkit] notification send failed: {error}");
            }
        });
    }
}

impl Default for OvrToolkit {
    fn default() -> Self {
        Self::new()
    }
}

pub fn send_xs_notification(
    title: &str,
    content: &str,
    timeout: i32,
    opacity: f64,
    image: Option<&str>,
) -> Result<(), String> {
    let icon = image.map(str::trim).filter(|value| !value.is_empty());
    let use_base64_icon = icon.is_none();
    let icon = icon
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| B64.encode(VRCX_ICON_BYTES));
    let height = xs_notification_height(content);
    let payload = serde_json::json!({
        "messageType": 1,
        "title": title,
        "content": content,
        "height": height,
        "sourceApp": "VRCX-0",
        "timeout": timeout,
        "volume": 0.0,
        "audioPath": "",
        "useBase64Icon": use_base64_icon,
        "icon": icon,
        "opacity": opacity
    });
    let socket = UdpSocket::bind("0.0.0.0:0").map_err(|error| format!("bind: {error}"))?;
    socket
        .send_to(payload.to_string().as_bytes(), "127.0.0.1:42069")
        .map_err(|error| format!("send: {error}"))?;
    Ok(())
}

fn xs_notification_height(content: &str) -> f32 {
    match content.chars().count() {
        length if length > 300 => 250.0,
        length if length > 200 => 200.0,
        length if length > 100 => 150.0,
        _ => 110.0,
    }
}

fn notification_icon_base64(image: Option<&str>) -> String {
    image
        .map(str::trim)
        .filter(|path| !path.is_empty() && Path::new(path).exists())
        .and_then(|path| std::fs::read(path).ok())
        .map(|bytes| B64.encode(bytes))
        .unwrap_or_else(|| B64.encode(VRCX_ICON_BYTES))
}

async fn connect_ws() -> Result<WsSender, String> {
    let (ws_stream, _) = tokio_tungstenite::connect_async("ws://127.0.0.1:11450/api")
        .await
        .map_err(|error| format!("connect: {error}"))?;
    let (write, read) = ws_stream.split();

    tokio::spawn(async move {
        let mut read = read;
        while read.next().await.is_some() {}
    });

    Ok(write)
}

async fn send_all(ws: &mut WsSender, messages: &[serde_json::Value]) -> Result<(), String> {
    for message in messages {
        let text = serde_json::to_string(message).unwrap_or_default();
        ws.send(Message::Text(text.into()))
            .await
            .map_err(|error| format!("send: {error}"))?;
    }
    Ok(())
}

async fn send_with_persistent_conn(
    sender: Arc<Mutex<Option<WsSender>>>,
    messages: Vec<serde_json::Value>,
) -> Result<(), String> {
    let mut guard = sender.lock().await;

    if let Some(ws) = guard.as_mut() {
        if send_all(ws, &messages).await.is_ok() {
            return Ok(());
        }
        *guard = None;
    }

    let mut ws = connect_ws().await?;
    send_all(&mut ws, &messages).await?;
    *guard = Some(ws);
    Ok(())
}
