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

const MAX_UDP_PAYLOAD_BYTES: usize = 65_507;
const XSOVERLAY_UDP_ADDR: &str = "127.0.0.1:42069";
const OVRTOOLKIT_WS_URL: &str = "ws://127.0.0.1:11450/api";
const XS_BUILTIN_DEFAULT_ICON: &str = "default";

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
        let icon_b64 = ovr_toolkit_icon_base64(image);

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
    let payload = xs_notification_payload(title, content, timeout, opacity, image);
    let bytes = serde_json::to_vec(&payload).map_err(|error| format!("serialize: {error}"))?;
    if bytes.len() > MAX_UDP_PAYLOAD_BYTES {
        return Err(format!(
            "payload too large: {} bytes exceeds UDP datagram limit",
            bytes.len()
        ));
    }
    let socket = UdpSocket::bind("127.0.0.1:0").map_err(|error| format!("bind: {error}"))?;
    socket
        .send_to(&bytes, XSOVERLAY_UDP_ADDR)
        .map_err(|error| format!("send: {error}"))?;
    Ok(())
}

fn xs_notification_payload(
    title: &str,
    content: &str,
    timeout: i32,
    opacity: f64,
    image: Option<&str>,
) -> serde_json::Value {
    let icon = image
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(XS_BUILTIN_DEFAULT_ICON);
    let height = xs_notification_height(content);
    serde_json::json!({
        "messageType": 1,
        "title": title,
        "content": content,
        "height": height,
        "sourceApp": "VRCX-0",
        "timeout": timeout,
        "volume": 0.0,
        "audioPath": "",
        "useBase64Icon": false,
        "icon": icon,
        "opacity": opacity
    })
}

fn xs_notification_height(content: &str) -> f32 {
    match content.chars().count() {
        length if length > 300 => 250.0,
        length if length > 200 => 200.0,
        length if length > 100 => 150.0,
        _ => 110.0,
    }
}

fn ovr_toolkit_icon_base64(image: Option<&str>) -> String {
    image
        .map(str::trim)
        .filter(|path| !path.is_empty() && Path::new(path).exists())
        .and_then(|path| std::fs::read(path).ok())
        .map(|bytes| B64.encode(bytes))
        .unwrap_or_default()
}

async fn connect_ws() -> Result<WsSender, String> {
    let (ws_stream, _) = tokio_tungstenite::connect_async(OVRTOOLKIT_WS_URL)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn xs_payload_without_image_uses_builtin_default_icon() {
        let payload = xs_notification_payload("VRCX-0", "Friend joined a world", 3, 1.0, None);

        assert_eq!(payload["useBase64Icon"], false);
        assert_eq!(payload["icon"], "default");

        let bytes = serde_json::to_vec(&payload).expect("payload should serialize");
        assert!(
            bytes.len() <= MAX_UDP_PAYLOAD_BYTES,
            "payload is {} bytes",
            bytes.len()
        );
    }

    #[test]
    fn xs_image_path_payload_uses_path_icon() {
        let payload = xs_notification_payload(
            "VRCX-0",
            "Friend joined a world",
            3,
            1.0,
            Some("C:/avatar.png"),
        );

        assert_eq!(payload["useBase64Icon"], false);
        assert_eq!(payload["icon"], "C:/avatar.png");
    }

    #[test]
    fn ovr_toolkit_icon_is_empty_without_image() {
        assert_eq!(ovr_toolkit_icon_base64(None), "");
    }
}
