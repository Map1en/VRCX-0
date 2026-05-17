use serde_json::Value;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ParsedIpcEvent {
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

pub fn parse_ipc_event(packet: &str) -> Result<ParsedIpcEvent, serde_json::Error> {
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
    use super::{parse_ipc_event, ParsedIpcEvent};

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
}
