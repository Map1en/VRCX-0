use std::collections::HashMap;

use serde_json::{json, Value};

use crate::http_api::{
    api_input, encode_path_segment, get_input, require_text, HttpApiError, HttpApiRequestInput,
};

mod request;

pub use request::{
    ContentFilter, CurrentUserProfileUpdateRequest, CurrentUserUpdateRequest,
    ProfileBackgroundType, ProfileBannerType,
};

pub fn user_get_input(
    endpoint: String,
    user_id: String,
) -> Result<(String, HttpApiRequestInput), HttpApiError> {
    let user_id = require_text(user_id, "VrchatUserGet requires userId.")?;
    Ok((
        user_id.clone(),
        get_input(
            endpoint,
            format!("users/{}", encode_path_segment(&user_id)),
            HashMap::new(),
        ),
    ))
}

pub fn profile_get_input(
    endpoint: String,
    user_id: String,
    as_self: bool,
) -> Result<(String, HttpApiRequestInput), HttpApiError> {
    let user_id = require_text(user_id, "VrchatProfileGet requires userId.")?;
    let params = HashMap::from([
        ("asSelf".to_string(), json!(as_self)),
        ("withGroupsAndWorlds".to_string(), json!(true)),
    ]);
    Ok((
        user_id.clone(),
        get_input(
            endpoint,
            format!("profile/{}", encode_path_segment(&user_id)),
            params,
        ),
    ))
}

pub fn profile_update_input(
    endpoint: String,
    user_id: String,
    params: CurrentUserProfileUpdateRequest,
) -> Result<(String, HttpApiRequestInput), HttpApiError> {
    let user_id = require_text(user_id, "VrchatProfileUpdate requires userId.")?;
    Ok((
        user_id.clone(),
        api_input(
            endpoint,
            "PUT",
            format!("profile/{}", encode_path_segment(&user_id)),
            Some(json!(params)),
        ),
    ))
}

pub fn user_mutual_counts_get_input(
    endpoint: String,
    user_id: String,
) -> Result<(String, HttpApiRequestInput), HttpApiError> {
    let user_id = require_text(user_id, "VrchatUserMutualCountsGet requires userId.")?;
    Ok((
        user_id.clone(),
        get_input(
            endpoint,
            format!("users/{}/mutuals", encode_path_segment(&user_id)),
            HashMap::new(),
        ),
    ))
}

pub fn user_groups_get_input(
    endpoint: String,
    user_id: String,
) -> Result<(String, HttpApiRequestInput), HttpApiError> {
    let user_id = require_text(user_id, "VrchatUserGroupsGet requires userId.")?;
    Ok((
        user_id.clone(),
        get_input(
            endpoint,
            format!("users/{}/groups", encode_path_segment(&user_id)),
            HashMap::new(),
        ),
    ))
}

pub fn user_represented_group_get_input(
    endpoint: String,
    user_id: String,
) -> Result<(String, HttpApiRequestInput), HttpApiError> {
    let user_id = require_text(user_id, "VrchatUserRepresentedGroupGet requires userId.")?;
    Ok((
        user_id.clone(),
        get_input(
            endpoint,
            format!("users/{}/groups/represented", encode_path_segment(&user_id)),
            HashMap::new(),
        ),
    ))
}

pub fn user_mutual_friends_get_input(
    endpoint: String,
    user_id: String,
    n: i32,
    offset: i32,
) -> Result<(String, HttpApiRequestInput), HttpApiError> {
    let user_id = require_text(user_id, "VrchatUserMutualFriendsGet requires userId.")?;
    let params = HashMap::from([
        ("n".to_string(), json!(n)),
        ("offset".to_string(), json!(offset)),
        ("userId".to_string(), Value::String(user_id.clone())),
    ]);
    Ok((
        user_id.clone(),
        get_input(
            endpoint,
            format!("users/{}/mutuals/friends", encode_path_segment(&user_id)),
            params,
        ),
    ))
}

pub fn current_user_update_input(
    endpoint: String,
    user_id: String,
    params: CurrentUserUpdateRequest,
) -> Result<(String, HttpApiRequestInput), HttpApiError> {
    let user_id = require_text(user_id, "VrchatCurrentUserUpdate requires userId.")?;
    Ok((
        user_id.clone(),
        api_input(
            endpoint,
            "PUT",
            format!("users/{}", encode_path_segment(&user_id)),
            Some(json!(params)),
        ),
    ))
}

pub fn current_user_badge_update_input(
    endpoint: String,
    user_id: String,
    badge_id: String,
    hidden: bool,
    showcased: bool,
) -> Result<(String, String, HttpApiRequestInput), HttpApiError> {
    let user_id = require_text(user_id, "VrchatCurrentUserBadgeUpdate requires userId.")?;
    let badge_id = require_text(badge_id, "VrchatCurrentUserBadgeUpdate requires badgeId.")?;
    Ok((
        user_id.clone(),
        badge_id.clone(),
        api_input(
            endpoint,
            "PUT",
            format!(
                "users/{}/badges/{}",
                encode_path_segment(&user_id),
                encode_path_segment(&badge_id)
            ),
            Some(json!({
                "userId": user_id,
                "badgeId": badge_id,
                "hidden": hidden,
                "showcased": showcased,
            })),
        ),
    ))
}

pub fn current_user_tags_add_input(
    endpoint: String,
    user_id: String,
    tags: Vec<String>,
) -> Result<(String, HttpApiRequestInput), HttpApiError> {
    let user_id = require_text(user_id, "VrchatCurrentUserTagsAdd requires userId.")?;
    Ok((
        user_id.clone(),
        api_input(
            endpoint,
            "POST",
            format!("users/{}/addTags", encode_path_segment(&user_id)),
            Some(json!({ "tags": tags })),
        ),
    ))
}

pub fn current_user_tags_remove_input(
    endpoint: String,
    user_id: String,
    tags: Vec<String>,
) -> Result<(String, HttpApiRequestInput), HttpApiError> {
    let user_id = require_text(user_id, "VrchatCurrentUserTagsRemove requires userId.")?;
    Ok((
        user_id.clone(),
        api_input(
            endpoint,
            "POST",
            format!("users/{}/removeTags", encode_path_segment(&user_id)),
            Some(json!({ "tags": tags })),
        ),
    ))
}

#[cfg(test)]
mod tests;
