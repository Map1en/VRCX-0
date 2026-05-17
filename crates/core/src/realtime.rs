use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RealtimeSessionContext {
    pub user_id: String,
    pub endpoint: String,
    pub websocket: String,
}

impl RealtimeSessionContext {
    pub fn new(user_id: String, endpoint: String, websocket: String) -> Self {
        Self {
            user_id: user_id.trim().to_string(),
            endpoint: endpoint.trim().to_string(),
            websocket: websocket.trim().to_string(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RealtimeWsMessagePayload {
    pub json: Value,
    pub raw: String,
    pub received_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RealtimeWsStatusPayload {
    pub status: String,
    pub websocket_domain: String,
    pub at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_run_id: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub generation: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_generation: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status_code: Option<i32>,
}

#[derive(Default)]
pub struct RealtimeMessageParser {
    last_raw: Option<String>,
}

impl RealtimeMessageParser {
    pub fn parse_text(
        &mut self,
        raw: &str,
        received_at: impl Into<String>,
    ) -> Option<RealtimeWsMessagePayload> {
        if self.last_raw.as_deref() == Some(raw) {
            return None;
        }

        let mut json: Value = match serde_json::from_str(raw) {
            Ok(json) => json,
            Err(error) => {
                tracing::warn!(
                    raw_len = raw.len(),
                    error = %error,
                    "[Realtime] websocket message json parse failed"
                );
                return None;
            }
        };
        if let Some(content) = json
            .get("content")
            .and_then(Value::as_str)
            .map(ToString::to_string)
        {
            if let Ok(parsed_content) = serde_json::from_str::<Value>(&content) {
                if let Some(object) = json.as_object_mut() {
                    object.insert("content".to_string(), parsed_content);
                }
            }
        }

        self.last_raw = Some(raw.to_string());
        Some(RealtimeWsMessagePayload {
            json,
            raw: raw.to_string(),
            received_at: received_at.into(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::RealtimeMessageParser;

    #[test]
    fn parses_nested_content_json_string() {
        let mut parser = RealtimeMessageParser::default();
        let payload = parser
            .parse_text(
                r#"{"type":"friend-online","content":"{\"userId\":\"usr_1\"}"}"#,
                "2026-05-14T00:00:00Z",
            )
            .expect("message should parse");

        assert_eq!(payload.json["type"], "friend-online");
        assert_eq!(payload.json["content"]["userId"], "usr_1");
        assert_eq!(
            payload.raw,
            r#"{"type":"friend-online","content":"{\"userId\":\"usr_1\"}"}"#
        );
        assert_eq!(payload.received_at, "2026-05-14T00:00:00Z");
    }

    #[test]
    fn keeps_non_json_content_string() {
        let mut parser = RealtimeMessageParser::default();
        let payload = parser
            .parse_text(
                r#"{"type":"notification","content":"hello"}"#,
                "2026-05-14T00:00:00Z",
            )
            .expect("message should parse");

        assert_eq!(payload.json["content"], "hello");
    }

    #[test]
    fn ignores_invalid_json() {
        let mut parser = RealtimeMessageParser::default();

        assert!(parser
            .parse_text("not-json", "2026-05-14T00:00:00Z")
            .is_none());
    }

    #[test]
    fn ignores_duplicate_raw_messages() {
        let mut parser = RealtimeMessageParser::default();
        let raw = r#"{"type":"friend-offline","content":{"userId":"usr_1"}}"#;

        assert!(parser.parse_text(raw, "2026-05-14T00:00:00Z").is_some());
        assert!(parser.parse_text(raw, "2026-05-14T00:00:01Z").is_none());
    }
}
