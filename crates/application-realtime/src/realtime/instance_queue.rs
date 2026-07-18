use serde_json::Value;
use vrcx_0_core::realtime::RealtimeWsMessagePayload;

use crate::world_enrich::world_id_from_location_or_id;

use super::RealtimeInstanceQueueProjection;

pub fn apply_instance_queue_ws_message(
    generation: u64,
    payload: &RealtimeWsMessagePayload,
) -> Option<RealtimeInstanceQueueProjection> {
    let message_type = payload.json.get("type").and_then(Value::as_str)?;
    let kind = match message_type {
        "instance-queue-joined" | "instance-queue-position" => "update",
        "instance-queue-ready" => "ready",
        "instance-queue-left" => "left",
        _ => return None,
    };
    let content = payload.json.get("content").unwrap_or(&Value::Null);
    let instance_location = first_owned([
        string_field(content.get("instanceLocation")),
        string_field(content.get("location")),
    ]);
    if instance_location.is_empty() {
        return None;
    }

    Some(RealtimeInstanceQueueProjection {
        generation,
        kind: kind.to_string(),
        world_id: world_id_from_location_or_id(&instance_location),
        instance_location,
        world_name: String::new(),
        position: number_field(content.get("position")),
        queue_size: number_field(content.get("queueSize")),
        received_at: payload.received_at.clone(),
    })
}

fn string_field(value: Option<&Value>) -> String {
    value
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .unwrap_or_else(|| {
            value
                .filter(|value| !value.is_null())
                .map(ToString::to_string)
                .unwrap_or_default()
        })
        .trim()
        .to_string()
}

fn number_field(value: Option<&Value>) -> i64 {
    let Some(value) = value else {
        return 0;
    };
    if let Some(number) = value.as_i64() {
        return number.max(0);
    }
    if let Some(number) = value.as_u64() {
        return number.min(i64::MAX as u64) as i64;
    }
    if let Some(number) = value.as_f64() {
        if number.is_finite() {
            return number.max(0.0).round() as i64;
        }
    }
    string_field(Some(value))
        .parse::<i64>()
        .map(|number| number.max(0))
        .unwrap_or_default()
}

fn first_owned<const N: usize>(values: [String; N]) -> String {
    values
        .into_iter()
        .find(|value| !value.trim().is_empty())
        .unwrap_or_default()
}
