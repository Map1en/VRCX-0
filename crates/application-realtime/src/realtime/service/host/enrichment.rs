use super::Value;

mod images;
mod notification_output;
mod sender_names;
mod world_names;

fn object_string(object: &serde_json::Map<String, Value>, key: &str) -> String {
    object
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .map(ToString::to_string)
        .unwrap_or_default()
}

fn nested_object_string(object: &serde_json::Map<String, Value>, path: &[&str]) -> String {
    let Some((first, rest)) = path.split_first() else {
        return String::new();
    };
    let Some(mut current) = object.get(*first) else {
        return String::new();
    };
    for key in rest {
        let Some(next) = current.get(*key) else {
            return String::new();
        };
        current = next;
    }
    current
        .as_str()
        .map(str::trim)
        .map(ToString::to_string)
        .unwrap_or_default()
}

fn is_person_notification_type(notification_type: &str) -> bool {
    matches!(
        notification_type,
        "friendRequest"
            | "ignoredFriendRequest"
            | "invite"
            | "requestInvite"
            | "inviteResponse"
            | "requestInviteResponse"
            | "boop"
            | "message"
    )
}

fn meaningful_sender_name(value: &Value) -> Option<String> {
    let object = value.as_object()?;
    [
        object_string(object, "senderDisplayName"),
        object_string(object, "displayName"),
        object_string(object, "senderUsername"),
        nested_object_string(object, &["details", "senderDisplayName"]),
        nested_object_string(object, &["details", "displayName"]),
        nested_object_string(object, &["data", "senderDisplayName"]),
        nested_object_string(object, &["data", "displayName"]),
    ]
    .into_iter()
    .find(|name| is_meaningful_actor_name(name))
}

fn sender_user_id(value: &Value) -> String {
    let Some(object) = value.as_object() else {
        return String::new();
    };
    let sender_user_id = object_string(object, "senderUserId");
    if sender_user_id.is_empty() {
        object_string(object, "userId")
    } else {
        sender_user_id
    }
}

fn is_meaningful_actor_name(value: &str) -> bool {
    let trimmed = value.trim();
    !trimmed.is_empty() && !trimmed.starts_with("usr_") && !trimmed.starts_with("grp_")
}
