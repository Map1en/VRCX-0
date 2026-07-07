use super::*;

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
    // location never participates in bucketing; the /auth/user list bucket is the only authority.
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
    vrcx_0_core::friends::strip_default_avatar_image(&mut object);
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

pub(super) fn build_fast_roster_snapshot(
    user_id: &str,
    expected_ids: &[String],
    state_by_id: &HashMap<String, String>,
    fetched_friends_by_id: &HashMap<String, RemoteFriendProfile>,
) -> Value {
    let friend_order_numbers = expected_ids
        .iter()
        .enumerate()
        .map(|(index, friend_id)| (friend_id.clone(), (index + 1) as i64))
        .collect::<HashMap<_, _>>();

    let mut friends_by_id = Map::new();
    for friend_id in expected_ids {
        let fetched_profile = fetched_friends_by_id.get(friend_id);
        let friend = fetched_profile.map(|profile| &profile.raw);
        let existing_row = json!({
            "userId": friend_id,
            "displayName": friend.map(get_display_name).filter(|name| !name.is_empty()).unwrap_or_else(|| friend_id.clone()),
            "trustLevel": "Visitor",
            "friendNumber": friend_order_numbers.get(friend_id).copied().unwrap_or_default()
        });
        let state_bucket = state_by_id
            .get(friend_id)
            .map(String::as_str)
            .unwrap_or("offline");
        let mut normalized_friend = normalize_friend_entry(friend, state_bucket, &existing_row);
        if let Some(object) = normalized_friend.as_object_mut() {
            object.insert(
                "$profileSource".into(),
                Value::String(if friend.is_some() {
                    "remote".into()
                } else {
                    "placeholder".into()
                }),
            );
        }
        friends_by_id.insert(friend_id.clone(), normalized_friend);
    }

    let online_ids = build_bucket_ids(expected_ids, &friends_by_id, "online");
    let active_ids = build_bucket_ids(expected_ids, &friends_by_id, "active");
    let offline_ids = build_bucket_ids(expected_ids, &friends_by_id, "offline");
    let mut ordered_friend_ids = Vec::new();
    ordered_friend_ids.extend(online_ids.clone());
    ordered_friend_ids.extend(active_ids.clone());
    ordered_friend_ids.extend(offline_ids.clone());

    let detail = String::new();
    json!({
        "currentUserId": user_id,
        "friendsById": friends_by_id,
        "orderedFriendIds": ordered_friend_ids,
        "onlineIds": online_ids,
        "activeIds": active_ids,
        "offlineIds": offline_ids,
        "detail": detail
    })
}

pub(super) fn infer_state_from_platform(platform: &str) -> &'static str {
    match platform {
        "" | "offline" => "offline",
        "web" => "active",
        _ => "online",
    }
}
