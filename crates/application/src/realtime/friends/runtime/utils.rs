use super::*;

pub(super) fn string_or_previous(patch: &Value, previous: &Value, key: &str) -> String {
    let value = string_field(patch.get(key));
    if value.is_empty() {
        string_field(previous.get(key))
    } else {
        value
    }
}

pub(super) fn object_with_pending_offline(value: Value, pending_offline: bool) -> Value {
    let mut object = value.as_object().cloned().unwrap_or_default();
    object.insert("pendingOffline".into(), Value::Bool(pending_offline));
    Value::Object(object)
}

pub(super) fn string_field(value: Option<&Value>) -> String {
    value
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .unwrap_or_else(|| {
            value
                .filter(|value| !value.is_null())
                .map(ToString::to_string)
                .unwrap_or_default()
        })
}

pub(super) fn int_field(value: Option<&Value>) -> Option<i64> {
    value
        .and_then(Value::as_i64)
        .or_else(|| {
            value
                .and_then(Value::as_u64)
                .and_then(|value| i64::try_from(value).ok())
        })
        .or_else(|| {
            value
                .and_then(Value::as_str)
                .and_then(|value| value.parse().ok())
        })
}

pub(super) fn bool_field(value: Option<&Value>) -> bool {
    value.and_then(Value::as_bool).unwrap_or(false)
}

pub(super) fn first_string<'a>(values: impl IntoIterator<Item = Option<&'a str>>) -> String {
    values
        .into_iter()
        .flatten()
        .find(|value| !value.trim().is_empty())
        .unwrap_or("")
        .trim()
        .to_string()
}

pub(super) use vrcx_0_core::friends::first_non_empty;

pub(super) fn first_owned(values: impl IntoIterator<Item = String>) -> String {
    values
        .into_iter()
        .find(|value| !value.trim().is_empty())
        .unwrap_or_default()
        .trim()
        .to_string()
}

pub(super) use vrcx_0_core::location::parse_location;

pub(super) struct EventTime {
    pub(super) iso: String,
    pub(super) timestamp_ms: i64,
}

impl EventTime {
    pub(super) fn from_received_at(received_at: &str) -> Self {
        let timestamp_ms = DateTime::parse_from_rfc3339(received_at)
            .map(|value| value.timestamp_millis())
            .unwrap_or_else(|_| Utc::now().timestamp_millis());
        Self {
            iso: received_at.to_string(),
            timestamp_ms,
        }
    }
}
