use chrono::Utc;
use serde_json::Value;

use super::types::RealtimeWsMessagePayload;

#[derive(Default)]
pub struct RealtimeMessageParser {
    last_raw: Option<String>,
}

impl RealtimeMessageParser {
    pub fn parse_text(&mut self, raw: &str) -> Option<RealtimeWsMessagePayload> {
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
            received_at: Utc::now().to_rfc3339(),
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
            .parse_text(r#"{"type":"friend-online","content":"{\"userId\":\"usr_1\"}"}"#)
            .expect("message should parse");

        assert_eq!(payload.json["type"], "friend-online");
        assert_eq!(payload.json["content"]["userId"], "usr_1");
        assert_eq!(
            payload.raw,
            r#"{"type":"friend-online","content":"{\"userId\":\"usr_1\"}"}"#
        );
        assert!(!payload.received_at.is_empty());
    }

    #[test]
    fn keeps_non_json_content_string() {
        let mut parser = RealtimeMessageParser::default();
        let payload = parser
            .parse_text(r#"{"type":"notification","content":"hello"}"#)
            .expect("message should parse");

        assert_eq!(payload.json["content"], "hello");
    }

    #[test]
    fn ignores_invalid_json() {
        let mut parser = RealtimeMessageParser::default();

        assert!(parser.parse_text("not-json").is_none());
    }

    #[test]
    fn ignores_duplicate_raw_messages() {
        let mut parser = RealtimeMessageParser::default();
        let raw = r#"{"type":"friend-offline","content":{"userId":"usr_1"}}"#;

        assert!(parser.parse_text(raw).is_some());
        assert!(parser.parse_text(raw).is_none());
    }
}
