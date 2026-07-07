use super::*;

pub(super) struct RemoteFriendProfile {
    pub(super) id: String,
    pub(super) raw: Value,
    pub(super) source_state_bucket: Option<String>,
}

impl RemoteFriendProfile {
    pub(super) fn from_raw(raw: Value, source_state_bucket: Option<&str>) -> Option<Self> {
        let id = object_field_normalized(&raw, &["id"]);
        if id.is_empty() {
            return None;
        }
        let source_state_bucket = source_state_bucket
            .map(normalize_state_bucket)
            .filter(|value| !value.is_empty());
        Some(Self {
            id,
            raw,
            source_state_bucket,
        })
    }
}

fn is_valid_friend_user(value: &Value) -> bool {
    !object_field_normalized(value, &["id"]).is_empty()
}

pub(super) async fn fetch_all_friends(
    deps: &SocialBaselineDeps,
    endpoint: &str,
    offline: bool,
) -> Result<Vec<Value>> {
    let rows = fetch_paged_array(deps, FRIEND_PAGE_SIZE, None, |n, offset| {
        remote_friends::friends_get_input(endpoint.to_string(), offline, n, offset)
    })
    .await?;
    Ok(rows.into_iter().filter(is_valid_friend_user).collect())
}

pub(super) fn insert_fetched_friend(
    fetched_friends_by_id: &mut HashMap<String, RemoteFriendProfile>,
    fetched_friend_ids_ordered: &mut Vec<String>,
    fetched_friend_ids_seen: &mut HashSet<String>,
    friend: Value,
    source_state_bucket: Option<&str>,
) {
    let Some(friend) = RemoteFriendProfile::from_raw(friend, source_state_bucket) else {
        return;
    };
    let friend_id = friend.id.clone();
    unique_push(
        fetched_friend_ids_ordered,
        fetched_friend_ids_seen,
        friend_id.clone(),
    );
    let should_replace = fetched_friends_by_id
        .get(&friend_id)
        .map(|existing| {
            friend.source_state_bucket.is_none()
                || existing.source_state_bucket.as_deref() != Some("online")
                || friend.source_state_bucket.as_deref() == Some("online")
        })
        .unwrap_or(true);
    if should_replace {
        fetched_friends_by_id.insert(friend_id, friend);
    }
}

pub(super) fn number_value(value: i64) -> Value {
    Value::Number(Number::from(value))
}

pub(super) fn float_value(value: f64) -> Value {
    Number::from_f64(value)
        .map(Value::Number)
        .unwrap_or(Value::Null)
}

pub(super) fn fallback_friend_user(user_id: &str, existing_row: &Value) -> Value {
    let display_name = object_field_string(existing_row, &["displayName", "display_name"]);
    let display_name = if display_name.is_empty() {
        user_id.to_string()
    } else {
        display_name
    };
    json!({
        "id": user_id,
        "displayName": display_name,
        "username": "",
        "tags": [],
        "developerType": "",
        "platform": "offline",
        "last_platform": "",
        "location": "offline",
        "state": "offline"
    })
}

pub(super) fn get_display_name(user: &Value) -> String {
    for key in ["displayName", "username", "id"] {
        let value = object_field_string(user, &[key]);
        if !value.is_empty() {
            return value;
        }
    }
    String::new()
}

pub(super) fn get_meaningful_display_name(user: &Value, user_id: &str) -> String {
    let resolved_user_id = if user_id.is_empty() {
        object_field_string(user, &["id"])
    } else {
        user_id.to_string()
    };
    vrcx_0_core::friends::meaningful_display_name(
        &object_field_string(user, &["displayName"]),
        &object_field_string(user, &["username"]),
        &resolved_user_id,
    )
    .unwrap_or_default()
}

pub(super) fn normalize_state_bucket(value: &str) -> String {
    vrcx_0_core::friends::normalize_state_bucket(value).unwrap_or_default()
}
