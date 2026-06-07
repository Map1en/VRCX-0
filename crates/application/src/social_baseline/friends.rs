use super::*;

fn get_friend_log_init_key(user_id: &str) -> String {
    format!("friendLogInit_{user_id}")
}

fn add_state_bucket_ids(
    snapshot: &Value,
    key: &str,
    deps: &str,
    state_by_id: &mut HashMap<String, String>,
    ordered_ids: &mut Vec<String>,
    seen: &mut HashSet<String>,
) {
    for user_id in string_array_field(snapshot, key) {
        if user_id.is_empty() {
            continue;
        }
        unique_push(ordered_ids, seen, user_id.clone());
        state_by_id.insert(user_id, deps.to_string());
    }
}

#[derive(Clone, Debug)]
struct RemoteFriendProfile {
    id: String,
    raw: Value,
    source_state_bucket: Option<String>,
}

#[derive(Clone, Debug)]
struct TrustLevelInfo {
    trust_level: String,
    trust_class: String,
    trust_sort_num: f64,
    is_moderator: bool,
    is_troll: bool,
    is_probable_troll: bool,
}

impl RemoteFriendProfile {
    fn from_raw(raw: Value, source_state_bucket: Option<&str>) -> Option<Self> {
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

pub(super) fn build_friend_state_map(snapshot: &Value) -> (HashMap<String, String>, Vec<String>) {
    let mut state_by_id = HashMap::new();
    let mut ordered_ids = Vec::new();
    let mut seen = HashSet::new();
    add_state_bucket_ids(
        snapshot,
        "friends",
        "offline",
        &mut state_by_id,
        &mut ordered_ids,
        &mut seen,
    );
    add_state_bucket_ids(
        snapshot,
        "offlineFriends",
        "offline",
        &mut state_by_id,
        &mut ordered_ids,
        &mut seen,
    );
    add_state_bucket_ids(
        snapshot,
        "activeFriends",
        "active",
        &mut state_by_id,
        &mut ordered_ids,
        &mut seen,
    );
    add_state_bucket_ids(
        snapshot,
        "onlineFriends",
        "online",
        &mut state_by_id,
        &mut ordered_ids,
        &mut seen,
    );
    (state_by_id, ordered_ids)
}

pub(super) fn build_snapshot_friend_ids(snapshot: &Value) -> (Vec<String>, HashSet<String>, bool) {
    let has_friend_list = object_field(snapshot, "friends").is_some_and(Value::is_array);
    let friend_ids = string_array_field(snapshot, "friends");
    let friend_set = friend_ids.iter().cloned().collect();
    (friend_ids, friend_set, has_friend_list)
}

fn is_valid_friend_user(value: &Value) -> bool {
    !object_field_normalized(value, &["id"]).is_empty()
}

async fn fetch_all_friends(
    deps: &SocialBaselineDeps,
    endpoint: &str,
    offline: bool,
) -> Result<Vec<Value>> {
    let rows = fetch_paged_array(
        deps,
        FRIEND_PAGE_SIZE,
        None,
        |n, offset| remote_friends::friends_get_input(endpoint.to_string(), offline, n, offset),
    )
    .await?;
    Ok(rows.into_iter().filter(is_valid_friend_user).collect())
}

fn insert_fetched_friend(
    fetched_friends_by_id: &mut HashMap<String, RemoteFriendProfile>,
    fetched_friend_ids_ordered: &mut Vec<String>,
    fetched_friend_ids_seen: &mut HashSet<String>,
    friend: Value,
    source_state_bucket: Option<&str>,
) -> Option<(String, String)> {
    let friend = RemoteFriendProfile::from_raw(friend, source_state_bucket)?;
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
        let state_bucket = fetched_friend_state_bucket(&friend);
        fetched_friends_by_id.insert(friend_id.clone(), friend);
        return state_bucket.map(|state_bucket| (friend_id, state_bucket));
    }
    None
}

fn fetched_friend_state_bucket(profile: &RemoteFriendProfile) -> Option<String> {
    for key in ["state", "stateBucket"] {
        let state_bucket = normalize_state_bucket(&object_field_string(&profile.raw, &[key]));
        if !state_bucket.is_empty() {
            return Some(state_bucket);
        }
    }
    None
}

fn apply_fetched_friend_state_bucket(
    state_by_id: &mut HashMap<String, String>,
    inserted_state_bucket: Option<(String, String)>,
) -> bool {
    let Some((friend_id, state_bucket)) = inserted_state_bucket else {
        return false;
    };
    state_by_id.insert(friend_id, state_bucket);
    true
}

fn bulk_friend_state_input(friend: &Value) -> String {
    let platform = object_field_string(friend, &["platform"]);
    if platform == "web" {
        return "active".into();
    }
    if !platform.is_empty() {
        return "online".into();
    }
    "offline".into()
}

fn fetched_profile_needs_user_refetch(
    profile: &RemoteFriendProfile,
    state_by_id: &HashMap<String, String>,
) -> bool {
    let current_state = state_by_id
        .get(&profile.id)
        .map(String::as_str)
        .unwrap_or("offline");
    if current_state != bulk_friend_state_input(&profile.raw) {
        return true;
    }
    object_field_string(&profile.raw, &["location"]) == "traveling"
}

async fn fetch_user_profile(
    deps: &SocialBaselineDeps,
    endpoint: &str,
    user_id: &str,
) -> Result<Value> {
    let (_, request) = remote_users::user_get_input(endpoint.to_string(), user_id.to_string())?;
    execute_vrchat_json_request(deps, request).await
}

async fn fetch_friend_status(
    deps: &SocialBaselineDeps,
    endpoint: &str,
    user_id: &str,
) -> Result<Value> {
    let (_, request) =
        remote_friends::friend_status_get_input(endpoint.to_string(), user_id.to_string())?;
    execute_vrchat_json_request(deps, request).await
}

async fn fetch_missing_friends(
    deps: &SocialBaselineDeps,
    endpoint: &str,
    user_ids: Vec<String>,
) -> Vec<Value> {
    let mut recovered = Vec::new();
    for user_id in user_ids {
        match fetch_user_profile(deps, endpoint, &user_id).await {
            Ok(profile) if !object_field_normalized(&profile, &["id"]).is_empty() => {
                recovered.push(profile);
            }
            _ => {}
        }
    }
    recovered
}

async fn fetch_missing_confirmed_friends(
    deps: &SocialBaselineDeps,
    endpoint: &str,
    user_ids: Vec<String>,
) -> Vec<Value> {
    let mut recovered = Vec::new();
    for user_id in user_ids {
        let Ok(status) = fetch_friend_status(deps, endpoint, &user_id).await else {
            continue;
        };
        if object_field(&status, "isFriend").and_then(Value::as_bool) != Some(true) {
            continue;
        }
        match fetch_user_profile(deps, endpoint, &user_id).await {
            Ok(profile) if !object_field_normalized(&profile, &["id"]).is_empty() => {
                recovered.push(profile);
            }
            _ => {}
        }
    }
    recovered
}

fn build_unfriend_history_entry(
    row: &Value,
    created_at: &str,
) -> Option<FriendLogHistoryEntryInput> {
    let user_id = object_field_normalized(row, &["userId", "user_id"]);
    if user_id.is_empty() {
        return None;
    }
    let display_name = object_field_string(row, &["displayName", "display_name"]);
    Some(FriendLogHistoryEntryInput {
        row_id: Value::Null,
        created_at: created_at.to_string(),
        r#type: "Unfriend".into(),
        user_id: user_id.clone(),
        display_name: if display_name.is_empty() {
            user_id.clone()
        } else {
            display_name
        },
        previous_display_name: String::new(),
        trust_level: String::new(),
        previous_trust_level: String::new(),
        friend_number: object_field(row, "friendNumber")
            .or_else(|| object_field(row, "$friendNumber"))
            .cloned()
            .unwrap_or(Value::Null),
    })
}

fn build_friend_history_entry(row: &Value, created_at: &str) -> Option<FriendLogHistoryEntryInput> {
    let user_id = object_field_normalized(row, &["userId", "id"]);
    if user_id.is_empty() {
        return None;
    }
    let display_name = object_field_string(row, &["displayName", "username"]);
    Some(FriendLogHistoryEntryInput {
        row_id: Value::Null,
        created_at: created_at.to_string(),
        r#type: "Friend".into(),
        user_id: user_id.clone(),
        display_name: if display_name.is_empty() {
            user_id
        } else {
            display_name
        },
        previous_display_name: String::new(),
        trust_level: object_field_string(row, &["trustLevel", "$trustLevel"]),
        previous_trust_level: String::new(),
        friend_number: object_field(row, "friendNumber")
            .or_else(|| object_field(row, "$friendNumber"))
            .cloned()
            .unwrap_or(Value::Null),
    })
}

fn build_friend_log_removal_candidates(
    current_user_id: &str,
    existing_rows: &[Value],
    fetched_friend_ids: &HashSet<String>,
    snapshot_friend_ids: &HashSet<String>,
    has_friend_list: bool,
) -> Vec<Value> {
    existing_rows
        .iter()
        .filter_map(|row| {
            let user_id = object_field_normalized(row, &["userId", "user_id"]);
            if user_id.is_empty()
                || user_id == current_user_id
                || (fetched_friend_ids.contains(&user_id)
                    && (!has_friend_list || snapshot_friend_ids.contains(&user_id)))
            {
                None
            } else {
                Some(row.clone())
            }
        })
        .collect()
}

async fn confirm_friend_log_removal_history_entries(
    deps: &SocialBaselineDeps,
    endpoint: &str,
    candidates: Vec<Value>,
    created_at: &str,
) -> (Vec<Value>, Vec<FriendLogHistoryEntryInput>) {
    if candidates.is_empty() || candidates.len() > FRIEND_REMOVAL_STATUS_CONFIRMATION_LIMIT {
        return (Vec::new(), Vec::new());
    }

    let mut removed_rows = Vec::new();
    let mut history_entries = Vec::new();
    for row in candidates {
        let target_user_id = object_field_normalized(&row, &["userId", "user_id"]);
        if target_user_id.is_empty() {
            continue;
        }
        let Ok(status) = fetch_friend_status(deps, endpoint, &target_user_id).await else {
            continue;
        };
        if object_field(&status, "isFriend").and_then(Value::as_bool) != Some(false) {
            continue;
        }
        if let Some(entry) = build_unfriend_history_entry(&row, created_at) {
            removed_rows.push(row);
            history_entries.push(entry);
        }
    }
    (removed_rows, history_entries)
}

fn build_removed_friend_ids(removed_rows: &[Value]) -> HashSet<String> {
    removed_rows
        .iter()
        .map(|row| object_field_normalized(row, &["userId", "user_id"]))
        .filter(|value| !value.is_empty())
        .collect()
}

fn build_reconciled_included_friend_ids(
    expected_ids: &[String],
    fetched_friend_ids: &HashSet<String>,
    existing_rows_by_id: &HashMap<String, Value>,
    removed_user_ids: &HashSet<String>,
) -> Vec<String> {
    expected_ids
        .iter()
        .filter(|friend_id| {
            !removed_user_ids.contains(*friend_id)
                && (fetched_friend_ids.contains(*friend_id)
                    || existing_rows_by_id.contains_key(*friend_id))
        })
        .cloned()
        .collect()
}

fn compute_trust_level(tags: &[String], developer_type: &str) -> TrustLevelInfo {
    let mut is_moderator = !developer_type.is_empty() && developer_type != "none";
    let mut is_troll = false;
    let mut is_probable_troll = false;
    let mut trust_level = "Visitor".to_string();
    let mut trust_class = "x-tag-untrusted".to_string();
    let mut trust_color_key = "untrusted".to_string();
    let mut trust_sort_num = 1.0;

    if tags.iter().any(|tag| tag == "admin_moderator") {
        is_moderator = true;
    }
    if tags.iter().any(|tag| tag == "system_troll") {
        is_troll = true;
    }
    if tags.iter().any(|tag| tag == "system_probable_troll") && !is_troll {
        is_probable_troll = true;
    }

    if tags.iter().any(|tag| tag == "system_trust_veteran") {
        trust_level = "Trusted User".into();
        trust_class = "x-tag-veteran".into();
        trust_color_key = "veteran".into();
        trust_sort_num = 5.0;
    } else if tags.iter().any(|tag| tag == "system_trust_trusted") {
        trust_level = "Known User".into();
        trust_class = "x-tag-trusted".into();
        trust_color_key = "trusted".into();
        trust_sort_num = 4.0;
    } else if tags.iter().any(|tag| tag == "system_trust_known") {
        trust_level = "User".into();
        trust_class = "x-tag-known".into();
        trust_color_key = "known".into();
        trust_sort_num = 3.0;
    } else if tags.iter().any(|tag| tag == "system_trust_basic") {
        trust_level = "New User".into();
        trust_class = "x-tag-basic".into();
        trust_color_key = "basic".into();
        trust_sort_num = 2.0;
    }

    if is_troll || is_probable_troll {
        trust_color_key = "troll".into();
        trust_sort_num += 0.1;
    }
    if is_moderator {
        trust_color_key = "vip".into();
        trust_sort_num += 0.3;
    }

    let _ = trust_color_key;
    TrustLevelInfo {
        trust_level,
        trust_class,
        trust_sort_num,
        is_moderator,
        is_troll,
        is_probable_troll,
    }
}

fn compute_user_platform(platform: &str, last_platform: &str) -> String {
    if !platform.is_empty() && platform != "offline" && platform != "web" {
        return platform.to_string();
    }
    last_platform.to_string()
}

fn number_value(value: i64) -> Value {
    Value::Number(Number::from(value))
}

fn float_value(value: f64) -> Value {
    Number::from_f64(value)
        .map(Value::Number)
        .unwrap_or(Value::Null)
}

fn fallback_friend_user(user_id: &str, existing_row: &Value) -> Value {
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

fn get_display_name(user: &Value) -> String {
    for key in ["displayName", "username", "id"] {
        let value = object_field_string(user, &[key]);
        if !value.is_empty() {
            return value;
        }
    }
    String::new()
}

fn get_meaningful_display_name(user: &Value, user_id: &str) -> String {
    let normalized_user_id = normalize_text(if user_id.is_empty() {
        object_field_string(user, &["id"])
    } else {
        user_id.to_string()
    });
    for key in ["displayName", "username"] {
        let display_name = object_field_normalized(user, &[key]);
        if !display_name.is_empty() && display_name != normalized_user_id {
            return display_name;
        }
    }
    String::new()
}

fn normalize_state_bucket(value: &str) -> String {
    match normalize_text(value).to_ascii_lowercase().as_str() {
        "online" => "online".into(),
        "active" => "active".into(),
        "offline" => "offline".into(),
        _ => String::new(),
    }
}

fn normalize_friend_entry(
    friend: Option<&Value>,
    state_bucket: &str,
    existing_row: &Value,
) -> Value {
    let user_id = object_field_normalized(existing_row, &["userId", "user_id"]);
    let source = friend
        .cloned()
        .unwrap_or_else(|| fallback_friend_user(&user_id, existing_row));
    let mut object = source.as_object().cloned().unwrap_or_default();
    let tags = object
        .get("tags")
        .and_then(Value::as_array)
        .map(|tags| tags.iter().map(value_as_string).collect::<Vec<_>>())
        .unwrap_or_default();
    let developer_type = object
        .get("developerType")
        .map(value_as_string)
        .unwrap_or_default();
    let trust = compute_trust_level(&tags, &developer_type);
    let explicit_trust_level = object
        .get("$trustLevel")
        .or_else(|| object.get("trustLevel"))
        .map(value_as_string)
        .unwrap_or_default();
    let has_trust_metadata = friend.is_some()
        && (!tags.is_empty() || !developer_type.is_empty() || !explicit_trust_level.is_empty());
    let existing_trust_level = object_field_string(existing_row, &["trustLevel", "$trustLevel"]);
    let trust_level = if !explicit_trust_level.is_empty() {
        explicit_trust_level
    } else if has_trust_metadata {
        trust.trust_level.clone()
    } else if !existing_trust_level.is_empty() {
        existing_trust_level
    } else {
        trust.trust_level.clone()
    };
    let friend_number = value_as_i64(
        object
            .get("friendNumber")
            .or_else(|| object.get("$friendNumber"))
            .or_else(|| object_field(existing_row, "friendNumber"))
            .or_else(|| object_field(existing_row, "$friendNumber")),
    );
    let source_user_id = object
        .get("id")
        .map(value_as_string)
        .unwrap_or_else(|| user_id.clone());
    let display_name = {
        let meaningful =
            get_meaningful_display_name(&Value::Object(object.clone()), &source_user_id);
        if !meaningful.is_empty() {
            meaningful
        } else {
            let existing_display_name =
                object_field_string(existing_row, &["displayName", "display_name"]);
            if !existing_display_name.is_empty() {
                existing_display_name
            } else {
                let source_display_name = get_display_name(&Value::Object(object.clone()));
                if source_display_name.is_empty() {
                    source_user_id.clone()
                } else {
                    source_display_name
                }
            }
        }
    };

    let platform = object
        .get("platform")
        .map(value_as_string)
        .unwrap_or_default();
    let last_platform = object
        .get("last_platform")
        .or_else(|| object.get("lastPlatform"))
        .map(value_as_string)
        .unwrap_or_default();
    object.insert("displayName".into(), Value::String(display_name));
    object.insert("state".into(), Value::String(state_bucket.to_string()));
    object.insert(
        "stateBucket".into(),
        Value::String(state_bucket.to_string()),
    );
    object.insert("friendNumber".into(), number_value(friend_number));
    object.insert("trustLevel".into(), Value::String(trust_level.clone()));
    object.insert("$friendNumber".into(), number_value(friend_number));
    object.insert("$trustLevel".into(), Value::String(trust_level));
    object.insert("$trustClass".into(), Value::String(trust.trust_class));
    object.insert("$trustSortNum".into(), float_value(trust.trust_sort_num));
    object.insert("$isModerator".into(), Value::Bool(trust.is_moderator));
    object.insert("$isTroll".into(), Value::Bool(trust.is_troll));
    object.insert(
        "$isProbableTroll".into(),
        Value::Bool(trust.is_probable_troll),
    );
    object.insert(
        "$platform".into(),
        Value::String(compute_user_platform(&platform, &last_platform)),
    );
    Value::Object(object)
}

fn compare_friend_entries(left: &Value, right: &Value) -> Ordering {
    let left_number = value_as_i64(
        object_field(left, "friendNumber").or_else(|| object_field(left, "$friendNumber")),
    );
    let right_number = value_as_i64(
        object_field(right, "friendNumber").or_else(|| object_field(right, "$friendNumber")),
    );
    let left_has_number = left_number > 0;
    let right_has_number = right_number > 0;

    if left_has_number != right_has_number {
        return if left_has_number {
            Ordering::Less
        } else {
            Ordering::Greater
        };
    }
    if left_has_number && right_has_number && left_number != right_number {
        return left_number.cmp(&right_number);
    }

    let left_name = object_field_string(left, &["displayName", "id"]);
    let right_name = object_field_string(right, &["displayName", "id"]);
    let name_comparison = compare_display_text(&left_name, &right_name);
    if name_comparison != Ordering::Equal {
        return name_comparison;
    }
    compare_display_text(
        &object_field_string(left, &["id"]),
        &object_field_string(right, &["id"]),
    )
}

fn compare_display_text(left: &str, right: &str) -> Ordering {
    let left_primary = display_text_primary_key(left);
    let right_primary = display_text_primary_key(right);
    let primary = left_primary.cmp(&right_primary);
    if primary != Ordering::Equal {
        return primary;
    }

    let left_lower = left.to_lowercase();
    let right_lower = right.to_lowercase();
    let secondary = left_lower.cmp(&right_lower);
    if secondary != Ordering::Equal {
        return secondary;
    }

    left.cmp(right)
}

fn display_text_primary_key(value: &str) -> String {
    let mut output = String::new();
    for character in value.to_lowercase().chars() {
        output.push_str(match character {
            'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' | 'ā' | 'ă' | 'ą' | 'ǎ' | 'ǟ' => "a",
            'æ' => "ae",
            'ç' | 'ć' | 'ĉ' | 'ċ' | 'č' => "c",
            'ð' | 'ď' | 'đ' => "d",
            'è' | 'é' | 'ê' | 'ë' | 'ē' | 'ĕ' | 'ė' | 'ę' | 'ě' => "e",
            'ƒ' => "f",
            'ĝ' | 'ğ' | 'ġ' | 'ģ' => "g",
            'ĥ' | 'ħ' => "h",
            'ì' | 'í' | 'î' | 'ï' | 'ĩ' | 'ī' | 'ĭ' | 'į' | 'ı' => "i",
            'ĵ' => "j",
            'ķ' | 'ĸ' => "k",
            'ĺ' | 'ļ' | 'ľ' | 'ŀ' | 'ł' => "l",
            'ñ' | 'ń' | 'ņ' | 'ň' | 'ŉ' => "n",
            'ò' | 'ó' | 'ô' | 'õ' | 'ö' | 'ø' | 'ō' | 'ŏ' | 'ő' => "o",
            'œ' => "oe",
            'ŕ' | 'ŗ' | 'ř' => "r",
            'ś' | 'ŝ' | 'ş' | 'š' | 'ſ' => "s",
            'ß' => "ss",
            'ţ' | 'ť' | 'ŧ' => "t",
            'ù' | 'ú' | 'û' | 'ü' | 'ũ' | 'ū' | 'ŭ' | 'ů' | 'ű' | 'ų' => "u",
            'ŵ' => "w",
            'ý' | 'ÿ' | 'ŷ' => "y",
            'ź' | 'ż' | 'ž' => "z",
            _ => {
                output.push(character);
                continue;
            }
        });
    }
    output
}

fn build_bucket_ids(
    included_ids: &[String],
    friends_by_id: &Map<String, Value>,
    state_bucket: &str,
) -> Vec<String> {
    let mut ids = included_ids
        .iter()
        .filter(|user_id| {
            friends_by_id
                .get(*user_id)
                .map(|friend| object_field_string(friend, &["stateBucket"]) == state_bucket)
                .unwrap_or(false)
        })
        .cloned()
        .collect::<Vec<_>>();
    ids.sort_by(|left_id, right_id| {
        let left = friends_by_id.get(left_id).unwrap_or(&Value::Null);
        let right = friends_by_id.get(right_id).unwrap_or(&Value::Null);
        compare_friend_entries(left, right)
    });
    ids
}

fn current_entry_value(
    user_id: &str,
    display_name: &str,
    trust_level: &str,
    friend_number: i64,
) -> Value {
    json!({
        "userId": user_id,
        "displayName": display_name,
        "trustLevel": trust_level,
        "friendNumber": friend_number
    })
}

pub async fn build_friend_roster_baseline(
    deps: SocialBaselineDeps,
    input: SocialFriendRosterBaselineInput,
) -> Result<SocialFriendRosterBaselineOutput> {
    let current_user = CurrentUserSnapshotView::from_raw(input.current_user_snapshot.as_value());
    let user_id = normalize_text(if input.user_id.is_empty() {
        current_user.user_id.clone()
    } else {
        input.user_id.clone()
    });
    if user_id.is_empty() {
        return Err(Error::Custom(
            "SocialFriendRosterBaselineGet requires an authenticated user id.".into(),
        ));
    }
    if !auth_scope_matches(&deps, &user_id, &input.endpoint) {
        return Ok(stale_friend_output(user_id, String::new()));
    }

    let CurrentUserSnapshotView {
        state_by_id,
        state_order_ids,
        friend_ids: snapshot_friend_ids,
        friend_id_set: snapshot_friend_id_set,
        has_friend_list,
        ..
    } = current_user;
    let mut state_by_id = state_by_id;
    if !has_friend_list {
        return Ok(stale_friend_output(
            user_id,
            "Current user friend list is incomplete.".into(),
        ));
    }
    let has_snapshot_state_map = !state_by_id.is_empty();
    let mut expected_ids = Vec::new();
    let mut expected_seen = HashSet::new();
    extend_unique(&mut expected_ids, &mut expected_seen, state_order_ids);
    extend_unique(
        &mut expected_ids,
        &mut expected_seen,
        snapshot_friend_ids.clone(),
    );

    let friend_log_initialized = get_config_bool(&deps, &get_friend_log_init_key(&user_id), false)?;
    let online_friends = fetch_all_friends(&deps, &input.endpoint, false).await?;
    let offline_friends = fetch_all_friends(&deps, &input.endpoint, true).await?;
    let mut fetched_friends_by_id: HashMap<String, RemoteFriendProfile> = HashMap::new();
    let mut fetched_friend_ids_ordered = Vec::new();
    let mut fetched_friend_ids_seen = HashSet::new();
    for friend in online_friends {
        apply_fetched_friend_state_bucket(
            &mut state_by_id,
            insert_fetched_friend(
                &mut fetched_friends_by_id,
                &mut fetched_friend_ids_ordered,
                &mut fetched_friend_ids_seen,
                friend,
                Some("online"),
            ),
        );
    }
    for friend in offline_friends {
        apply_fetched_friend_state_bucket(
            &mut state_by_id,
            insert_fetched_friend(
                &mut fetched_friends_by_id,
                &mut fetched_friend_ids_ordered,
                &mut fetched_friend_ids_seen,
                friend,
                Some("offline"),
            ),
        );
    }

    let refetch_ids = if has_snapshot_state_map {
        fetched_friends_by_id
            .values()
            .filter(|profile| fetched_profile_needs_user_refetch(profile, &state_by_id))
            .map(|profile| profile.id.clone())
            .collect::<Vec<_>>()
    } else {
        Vec::new()
    };
    for friend in fetch_missing_friends(&deps, &input.endpoint, refetch_ids).await {
        apply_fetched_friend_state_bucket(
            &mut state_by_id,
            insert_fetched_friend(
                &mut fetched_friends_by_id,
                &mut fetched_friend_ids_ordered,
                &mut fetched_friend_ids_seen,
                friend,
                None,
            ),
        );
    }

    let missing_ids = expected_ids
        .iter()
        .filter(|friend_id| !fetched_friends_by_id.contains_key(*friend_id))
        .cloned()
        .collect::<Vec<_>>();
    for friend in fetch_missing_confirmed_friends(&deps, &input.endpoint, missing_ids).await {
        apply_fetched_friend_state_bucket(
            &mut state_by_id,
            insert_fetched_friend(
                &mut fetched_friends_by_id,
                &mut fetched_friend_ids_ordered,
                &mut fetched_friend_ids_seen,
                friend,
                None,
            ),
        );
    }

    let existing_rows = serde_json::to_value(
        vrcx_0_persistence::friends::friend_log_current_list(deps.db.as_ref(), user_id.clone())?,
    )?
    .as_array()
    .cloned()
    .unwrap_or_default();
    let mut existing_rows_by_id = HashMap::new();
    for row in &existing_rows {
        let existing_user_id = object_field_normalized(row, &["userId", "user_id"]);
        if existing_user_id.is_empty() {
            continue;
        }
        existing_rows_by_id.insert(existing_user_id, row.clone());
    }

    let fetched_friend_ids = fetched_friends_by_id
        .keys()
        .cloned()
        .collect::<HashSet<_>>();
    let reconciliation_created_at = now_iso();
    let (removed_rows, history_entries) = if friend_log_initialized {
        confirm_friend_log_removal_history_entries(
            &deps,
            &input.endpoint,
            build_friend_log_removal_candidates(
                &user_id,
                &existing_rows,
                &fetched_friend_ids,
                &snapshot_friend_id_set,
                has_friend_list,
            ),
            &reconciliation_created_at,
        )
        .await
    } else {
        (Vec::new(), Vec::new())
    };
    let removed_user_ids = build_removed_friend_ids(&removed_rows);

    let mut included_ids = Vec::new();
    let mut included_seen = HashSet::new();
    let included_source_ids = build_reconciled_included_friend_ids(
        &expected_ids,
        &fetched_friend_ids,
        &existing_rows_by_id,
        &removed_user_ids,
    );
    extend_unique(&mut included_ids, &mut included_seen, included_source_ids);

    let friend_order_source_ids = if !snapshot_friend_ids.is_empty() {
        snapshot_friend_ids
    } else {
        included_ids.clone()
    };
    let friend_order_numbers = friend_order_source_ids
        .iter()
        .enumerate()
        .map(|(index, friend_id)| (friend_id.clone(), (index + 1) as i64))
        .collect::<HashMap<_, _>>();
    let explicit_add_intent_user_ids = input
        .explicit_add_intent_user_ids
        .into_iter()
        .map(normalize_text)
        .filter(|value| !value.is_empty())
        .collect::<HashSet<_>>();

    let mut friends_by_id = Map::new();
    let mut friend_log_rows = Vec::new();
    let mut added_history_entries = Vec::new();

    for friend_id in &included_ids {
        let fetched_profile = fetched_friends_by_id.get(friend_id);
        let friend = fetched_profile.map(|profile| &profile.raw);
        let mut existing_row = existing_rows_by_id
            .get(friend_id)
            .cloned()
            .unwrap_or_else(|| {
                json!({
                    "userId": friend_id,
                    "displayName": friend.map(get_display_name).filter(|name| !name.is_empty()).unwrap_or_else(|| friend_id.clone()),
                    "trustLevel": "Visitor",
                    "friendNumber": 0
                })
            });
        if value_as_i64(
            object_field(&existing_row, "friendNumber")
                .or_else(|| object_field(&existing_row, "$friendNumber")),
        ) <= 0
        {
            if let Some(number) = friend_order_numbers.get(friend_id) {
                if let Some(object) = existing_row.as_object_mut() {
                    object.insert("friendNumber".into(), number_value(*number));
                }
            }
        }

        let snapshot_state_bucket = state_by_id.get(friend_id).map(String::as_str);
        let snapshot_state = snapshot_state_bucket.map(|value| value.to_string());
        let state_bucket = snapshot_state.unwrap_or_else(|| "offline".into());
        let normalized_friend = normalize_friend_entry(friend, &state_bucket, &existing_row);
        friends_by_id.insert(friend_id.clone(), normalized_friend.clone());

        let display_name = object_field_string(&normalized_friend, &["displayName"]);
        let trust_level = object_field_string(&normalized_friend, &["$trustLevel"]);
        let friend_number = value_as_i64(
            object_field(&normalized_friend, "$friendNumber")
                .or_else(|| object_field(&normalized_friend, "friendNumber")),
        );
        let friend_log_row =
            current_entry_value(friend_id, &display_name, &trust_level, friend_number);
        friend_log_rows.push(FriendLogCurrentEntryInput {
            user_id: friend_id.clone(),
            display_name,
            trust_level: Some(trust_level),
            friend_number: number_value(friend_number),
        });

        if friend_log_initialized
            && friend_id != &user_id
            && !existing_rows_by_id.contains_key(friend_id)
            && !explicit_add_intent_user_ids.contains(friend_id)
        {
            if let Some(entry) =
                build_friend_history_entry(&friend_log_row, &reconciliation_created_at)
            {
                added_history_entries.push(entry);
            }
        }
    }

    if added_history_entries.len() > FRIEND_ADDITION_RECONCILIATION_LIMIT {
        added_history_entries.clear();
    }

    let online_ids = build_bucket_ids(&included_ids, &friends_by_id, "online");
    let active_ids = build_bucket_ids(&included_ids, &friends_by_id, "active");
    let offline_ids = build_bucket_ids(&included_ids, &friends_by_id, "offline");
    let mut ordered_friend_ids = Vec::new();
    ordered_friend_ids.extend(online_ids.clone());
    ordered_friend_ids.extend(active_ids.clone());
    ordered_friend_ids.extend(offline_ids.clone());

    if !auth_scope_matches(&deps, &user_id, &input.endpoint) {
        return Ok(stale_friend_output(user_id, String::new()));
    }

    vrcx_0_persistence::friends::friend_log_replace_current(
        deps.db.as_ref(),
        user_id.clone(),
        friend_log_rows,
        FriendLogReplaceOptionsInput {
            history_entries,
            added_history_entries,
        },
    )?;
    vrcx_0_persistence::config::config_set_values(
        deps.db.as_ref(),
        vec![ConfigWriteEntry {
            key: get_friend_log_init_key(&user_id),
            value: "true".into(),
        }],
    )?;

    let detail = String::new();
    let snapshot = json!({
        "currentUserId": user_id.clone(),
        "friendsById": friends_by_id,
        "orderedFriendIds": ordered_friend_ids,
        "onlineIds": online_ids,
        "activeIds": active_ids,
        "offlineIds": offline_ids,
        "detail": detail.clone()
    });
    let count = snapshot
        .get("orderedFriendIds")
        .and_then(Value::as_array)
        .map_or(0, Vec::len);

    Ok(SocialFriendRosterBaselineOutput {
        user_id,
        stale: false,
        count,
        detail,
        snapshot: Some(RawJson::from(snapshot)),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fetched_friend_state_updates_snapshot_bucket() {
        let mut state_by_id = HashMap::from([("usr_friend".to_string(), "offline".to_string())]);
        let mut fetched_friends_by_id = HashMap::new();
        let mut fetched_friend_ids_ordered = Vec::new();
        let mut fetched_friend_ids_seen = HashSet::new();

        let applied = apply_fetched_friend_state_bucket(
            &mut state_by_id,
            insert_fetched_friend(
                &mut fetched_friends_by_id,
                &mut fetched_friend_ids_ordered,
                &mut fetched_friend_ids_seen,
                json!({
                    "id": "usr_friend",
                    "state": "online",
                    "platform": "standalonewindows"
                }),
                Some("online"),
            ),
        );

        assert!(applied);
        assert_eq!(
            state_by_id.get("usr_friend").map(String::as_str),
            Some("online")
        );
        let profile = fetched_friends_by_id
            .get("usr_friend")
            .expect("inserted friend profile");
        assert!(!fetched_profile_needs_user_refetch(profile, &state_by_id));
    }

    #[test]
    fn confirmed_removed_friend_is_not_reinserted_from_stale_snapshot() {
        let expected_ids = vec![
            "usr_removed".to_string(),
            "usr_existing".to_string(),
            "usr_fetched".to_string(),
            "usr_stale_unknown".to_string(),
        ];
        let fetched_friend_ids = HashSet::from(["usr_fetched".to_string()]);
        let existing_rows_by_id = HashMap::from([
            (
                "usr_removed".to_string(),
                json!({
                    "userId": "usr_removed",
                    "displayName": "Removed Friend"
                }),
            ),
            (
                "usr_existing".to_string(),
                json!({
                    "userId": "usr_existing",
                    "displayName": "Existing Friend"
                }),
            ),
        ]);
        let removed_user_ids = build_removed_friend_ids(&[json!({
            "userId": "usr_removed"
        })]);

        let included_ids = build_reconciled_included_friend_ids(
            &expected_ids,
            &fetched_friend_ids,
            &existing_rows_by_id,
            &removed_user_ids,
        );

        assert_eq!(
            included_ids,
            vec!["usr_existing".to_string(), "usr_fetched".to_string()]
        );
    }
}
