use std::collections::HashMap;

use serde_json::Value;

use crate::http_api::{
    api_input as http_api_input, encode_path_segment, get_input as http_get_input, normalize_text,
    object_body, require_text, HttpApiError, HttpApiRequestInput,
};

pub fn group_path(group_id: &str, suffix: &str) -> String {
    if suffix.is_empty() {
        format!("groups/{}", encode_path_segment(group_id))
    } else {
        format!("groups/{}/{}", encode_path_segment(group_id), suffix)
    }
}

pub fn get_input(
    endpoint: String,
    path: impl Into<String>,
    query_params: HashMap<String, Value>,
) -> HttpApiRequestInput {
    http_get_input(endpoint, path, query_params)
}

pub fn api_input(
    endpoint: String,
    method: &str,
    path: impl Into<String>,
    body: Option<Value>,
) -> HttpApiRequestInput {
    http_api_input(
        endpoint,
        method,
        path,
        body.map(|value| object_body(Some(value))),
    )
}

pub fn profile_get_input(
    endpoint: String,
    group_id: String,
    include_roles: bool,
) -> Result<(String, HttpApiRequestInput), HttpApiError> {
    let group_id = require_text(group_id, "VrchatGroupGet requires groupId.")?;
    Ok((
        group_id.clone(),
        get_input(
            endpoint,
            group_path(&group_id, ""),
            HashMap::from([(
                "includeRoles".to_string(),
                Value::String(if include_roles { "true" } else { "false" }.into()),
            )]),
        ),
    ))
}

pub fn user_groups_get_input(
    endpoint: String,
    user_id: String,
) -> Result<(String, HttpApiRequestInput), HttpApiError> {
    let user_id = require_text(user_id, "VrchatGroupUserGroupsGet requires userId.")?;
    Ok((
        user_id.clone(),
        get_input(
            endpoint,
            format!("users/{}/groups", encode_path_segment(&user_id)),
            HashMap::new(),
        ),
    ))
}

pub fn user_group_permissions_get_input(
    endpoint: String,
    user_id: String,
) -> Result<(String, HttpApiRequestInput), HttpApiError> {
    let user_id = require_text(user_id, "VrchatGroupUserPermissionsGet requires userId.")?;
    Ok((
        user_id.clone(),
        get_input(
            endpoint,
            format!("users/{}/groups/permissions", encode_path_segment(&user_id)),
            HashMap::new(),
        ),
    ))
}

pub fn group_paged_get_input(
    endpoint: String,
    group_id: String,
    suffix: &str,
    n: i64,
    offset: i64,
    message: &str,
) -> Result<(String, HttpApiRequestInput), HttpApiError> {
    let group_id = require_text(group_id, message)?;
    Ok((
        group_id.clone(),
        get_input(
            endpoint,
            group_path(&group_id, suffix),
            HashMap::from([
                ("n".to_string(), serde_json::json!(n)),
                ("offset".to_string(), serde_json::json!(offset)),
            ]),
        ),
    ))
}

pub fn group_get_no_params_input(
    endpoint: String,
    group_id: String,
    suffix: &str,
    message: &str,
) -> Result<(String, HttpApiRequestInput), HttpApiError> {
    let group_id = require_text(group_id, message)?;
    Ok((
        group_id.clone(),
        get_input(endpoint, group_path(&group_id, suffix), HashMap::new()),
    ))
}

pub fn member_get_input(
    endpoint: String,
    group_id: String,
    user_id: String,
) -> Result<(String, String, HttpApiRequestInput), HttpApiError> {
    let group_id = require_text(group_id, "VrchatGroupMemberGet requires groupId.")?;
    let user_id = require_text(user_id, "VrchatGroupMemberGet requires userId.")?;
    Ok((
        group_id.clone(),
        user_id.clone(),
        get_input(
            endpoint,
            group_path(
                &group_id,
                &format!("members/{}", encode_path_segment(&user_id)),
            ),
            HashMap::new(),
        ),
    ))
}

pub fn members_get_input(
    endpoint: String,
    group_id: String,
    n: i64,
    offset: i64,
    sort: String,
    role_id: String,
) -> Result<(String, HttpApiRequestInput), HttpApiError> {
    let group_id = require_text(group_id, "VrchatGroupMembersGet requires groupId.")?;
    let role_id = normalize_text(role_id);
    let mut params = HashMap::from([
        ("n".to_string(), serde_json::json!(n)),
        ("offset".to_string(), serde_json::json!(offset)),
        ("sort".to_string(), Value::String(sort)),
    ]);
    if !role_id.is_empty() {
        params.insert("roleId".to_string(), Value::String(role_id));
    }
    Ok((
        group_id.clone(),
        get_input(endpoint, group_path(&group_id, "members"), params),
    ))
}

pub fn members_search_input(
    endpoint: String,
    group_id: String,
    n: i64,
    offset: i64,
    query: String,
) -> Result<(String, HttpApiRequestInput), HttpApiError> {
    let group_id = require_text(group_id, "VrchatGroupMembersSearch requires groupId.")?;
    Ok((
        group_id.clone(),
        get_input(
            endpoint,
            group_path(&group_id, "members/search"),
            HashMap::from([
                ("n".to_string(), serde_json::json!(n)),
                ("offset".to_string(), serde_json::json!(offset)),
                ("query".to_string(), Value::String(query)),
            ]),
        ),
    ))
}

pub fn gallery_get_input(
    endpoint: String,
    group_id: String,
    gallery_id: String,
    n: i64,
    offset: i64,
) -> Result<(String, String, HttpApiRequestInput), HttpApiError> {
    let group_id = require_text(group_id, "VrchatGroupGalleryGet requires groupId.")?;
    let gallery_id = require_text(gallery_id, "VrchatGroupGalleryGet requires galleryId.")?;
    Ok((
        group_id.clone(),
        gallery_id.clone(),
        get_input(
            endpoint,
            group_path(
                &group_id,
                &format!("galleries/{}", encode_path_segment(&gallery_id)),
            ),
            HashMap::from([
                ("n".to_string(), serde_json::json!(n)),
                ("offset".to_string(), serde_json::json!(offset)),
            ]),
        ),
    ))
}

pub fn user_group_instances_get_input(
    endpoint: String,
    group_id: String,
    user_id: String,
) -> Result<(String, String, HttpApiRequestInput), HttpApiError> {
    let group_id = require_text(group_id, "VrchatGroupInstancesGet requires groupId.")?;
    let user_id = require_text(user_id, "VrchatGroupInstancesGet requires userId.")?;
    Ok((
        group_id.clone(),
        user_id.clone(),
        get_input(
            endpoint,
            format!(
                "users/{}/instances/groups/{}",
                encode_path_segment(&user_id),
                encode_path_segment(&group_id)
            ),
            HashMap::new(),
        ),
    ))
}

pub fn join_requests_get_input(
    endpoint: String,
    group_id: String,
    n: i64,
    offset: i64,
    blocked: bool,
) -> Result<(String, HttpApiRequestInput), HttpApiError> {
    let group_id = require_text(group_id, "VrchatGroupJoinRequestsGet requires groupId.")?;
    Ok((
        group_id.clone(),
        get_input(
            endpoint,
            group_path(&group_id, "requests"),
            HashMap::from([
                ("n".to_string(), serde_json::json!(n)),
                ("offset".to_string(), serde_json::json!(offset)),
                ("blocked".to_string(), Value::Bool(blocked)),
            ]),
        ),
    ))
}

pub fn logs_get_input(
    endpoint: String,
    group_id: String,
    n: i64,
    offset: i64,
    event_types: String,
) -> Result<(String, HttpApiRequestInput), HttpApiError> {
    let group_id = require_text(group_id, "VrchatGroupLogsGet requires groupId.")?;
    let event_types = normalize_text(event_types);
    let mut params = HashMap::from([
        ("n".to_string(), serde_json::json!(n)),
        ("offset".to_string(), serde_json::json!(offset)),
    ]);
    if !event_types.is_empty() {
        params.insert("eventTypes".to_string(), Value::String(event_types));
    }
    Ok((
        group_id.clone(),
        get_input(endpoint, group_path(&group_id, "auditLogs"), params),
    ))
}

pub fn current_user_group_instances_get_input(
    endpoint: String,
    user_id: String,
) -> Result<(String, HttpApiRequestInput), HttpApiError> {
    let user_id = require_text(user_id, "VrchatGroupUserInstancesGet requires userId.")?;
    Ok((
        user_id.clone(),
        get_input(
            endpoint,
            format!("users/{}/instances/groups", encode_path_segment(&user_id)),
            HashMap::new(),
        ),
    ))
}

pub fn post_create_input(
    endpoint: String,
    group_id: String,
    params: Option<Value>,
) -> Result<(String, HttpApiRequestInput), HttpApiError> {
    let group_id = require_text(group_id, "VrchatGroupPostCreate requires groupId.")?;
    Ok((
        group_id.clone(),
        api_input(
            endpoint,
            "POST",
            group_path(&group_id, "posts"),
            Some(object_body(params)),
        ),
    ))
}

pub fn post_edit_input(
    endpoint: String,
    group_id: String,
    post_id: String,
    params: Option<Value>,
) -> Result<(String, String, HttpApiRequestInput), HttpApiError> {
    let group_id = require_text(group_id, "VrchatGroupPostEdit requires groupId.")?;
    let post_id = require_text(post_id, "VrchatGroupPostEdit requires postId.")?;
    Ok((
        group_id.clone(),
        post_id.clone(),
        api_input(
            endpoint,
            "PUT",
            group_path(
                &group_id,
                &format!("posts/{}", encode_path_segment(&post_id)),
            ),
            Some(object_body(params)),
        ),
    ))
}

pub fn post_delete_input(
    endpoint: String,
    group_id: String,
    post_id: String,
) -> Result<(String, String, HttpApiRequestInput), HttpApiError> {
    let group_id = require_text(group_id, "VrchatGroupPostDelete requires groupId.")?;
    let post_id = require_text(post_id, "VrchatGroupPostDelete requires postId.")?;
    Ok((
        group_id.clone(),
        post_id.clone(),
        api_input(
            endpoint,
            "DELETE",
            group_path(
                &group_id,
                &format!("posts/{}", encode_path_segment(&post_id)),
            ),
            None,
        ),
    ))
}

pub fn simple_group_action_input(
    endpoint: String,
    group_id: String,
    command_message: &str,
    method: &str,
    suffix: &str,
    body: Option<Value>,
) -> Result<(String, HttpApiRequestInput), HttpApiError> {
    let group_id = require_text(group_id, command_message)?;
    Ok((
        group_id.clone(),
        api_input(endpoint, method, group_path(&group_id, suffix), body),
    ))
}

pub fn join_input(
    endpoint: String,
    group_id: String,
) -> Result<(String, HttpApiRequestInput), HttpApiError> {
    simple_group_action_input(
        endpoint,
        group_id,
        "VrchatGroupJoin requires groupId.",
        "POST",
        "join",
        Some(serde_json::json!({})),
    )
}

pub fn leave_input(
    endpoint: String,
    group_id: String,
) -> Result<(String, HttpApiRequestInput), HttpApiError> {
    simple_group_action_input(
        endpoint,
        group_id,
        "VrchatGroupLeave requires groupId.",
        "POST",
        "leave",
        Some(serde_json::json!({})),
    )
}

pub fn request_cancel_input(
    endpoint: String,
    group_id: String,
) -> Result<(String, HttpApiRequestInput), HttpApiError> {
    simple_group_action_input(
        endpoint,
        group_id,
        "VrchatGroupRequestCancel requires groupId.",
        "DELETE",
        "requests",
        None,
    )
}

pub fn group_block_input(
    endpoint: String,
    group_id: String,
) -> Result<(String, HttpApiRequestInput), HttpApiError> {
    simple_group_action_input(
        endpoint,
        group_id,
        "VrchatGroupBlock requires groupId.",
        "POST",
        "block",
        Some(serde_json::json!({})),
    )
}

struct GroupUserActionInput<'a> {
    endpoint: String,
    group_id: String,
    user_id: String,
    group_message: &'a str,
    user_message: &'a str,
    method: &'a str,
    suffix: String,
    body: Option<Value>,
}

fn group_user_action_input(
    input: GroupUserActionInput<'_>,
) -> Result<(String, String, HttpApiRequestInput), HttpApiError> {
    let group_id = require_text(input.group_id, input.group_message)?;
    let user_id = require_text(input.user_id, input.user_message)?;
    Ok((
        group_id.clone(),
        user_id.clone(),
        api_input(
            input.endpoint,
            input.method,
            group_path(&group_id, &input.suffix),
            input.body,
        ),
    ))
}

pub fn invite_send_input(
    endpoint: String,
    group_id: String,
    user_id: String,
) -> Result<(String, String, HttpApiRequestInput), HttpApiError> {
    let body_user_id = user_id.clone();
    group_user_action_input(GroupUserActionInput {
        endpoint,
        group_id,
        user_id,
        group_message: "VrchatGroupInviteSend requires groupId.",
        user_message: "VrchatGroupInviteSend requires userId.",
        method: "POST",
        suffix: "invites".into(),
        body: Some(serde_json::json!({ "userId": body_user_id })),
    })
}

pub fn member_kick_input(
    endpoint: String,
    group_id: String,
    user_id: String,
) -> Result<(String, String, HttpApiRequestInput), HttpApiError> {
    let suffix_user_id = user_id.clone();
    group_user_action_input(GroupUserActionInput {
        endpoint,
        group_id,
        user_id,
        group_message: "VrchatGroupMemberKick requires groupId.",
        user_message: "VrchatGroupMemberKick requires userId.",
        method: "DELETE",
        suffix: format!("members/{}", encode_path_segment(&suffix_user_id)),
        body: None,
    })
}

pub fn member_ban_input(
    endpoint: String,
    group_id: String,
    user_id: String,
) -> Result<(String, String, HttpApiRequestInput), HttpApiError> {
    let body_user_id = user_id.clone();
    group_user_action_input(GroupUserActionInput {
        endpoint,
        group_id,
        user_id,
        group_message: "VrchatGroupMemberBan requires groupId.",
        user_message: "VrchatGroupMemberBan requires userId.",
        method: "POST",
        suffix: "bans".into(),
        body: Some(serde_json::json!({ "userId": body_user_id })),
    })
}

pub fn member_unban_input(
    endpoint: String,
    group_id: String,
    user_id: String,
) -> Result<(String, String, HttpApiRequestInput), HttpApiError> {
    let suffix_user_id = user_id.clone();
    group_user_action_input(GroupUserActionInput {
        endpoint,
        group_id,
        user_id,
        group_message: "VrchatGroupMemberUnban requires groupId.",
        user_message: "VrchatGroupMemberUnban requires userId.",
        method: "DELETE",
        suffix: format!("bans/{}", encode_path_segment(&suffix_user_id)),
        body: None,
    })
}

pub fn invite_delete_input(
    endpoint: String,
    group_id: String,
    user_id: String,
) -> Result<(String, String, HttpApiRequestInput), HttpApiError> {
    let suffix_user_id = user_id.clone();
    group_user_action_input(GroupUserActionInput {
        endpoint,
        group_id,
        user_id,
        group_message: "VrchatGroupInviteDelete requires groupId.",
        user_message: "VrchatGroupInviteDelete requires userId.",
        method: "DELETE",
        suffix: format!("invites/{}", encode_path_segment(&suffix_user_id)),
        body: None,
    })
}

pub fn unblock_input(
    endpoint: String,
    group_id: String,
    user_id: String,
) -> Result<(String, String, HttpApiRequestInput), HttpApiError> {
    let suffix_user_id = user_id.clone();
    group_user_action_input(GroupUserActionInput {
        endpoint,
        group_id,
        user_id,
        group_message: "VrchatGroupUnblock requires groupId.",
        user_message: "VrchatGroupUnblock requires userId.",
        method: "DELETE",
        suffix: format!("bans/{}", encode_path_segment(&suffix_user_id)),
        body: None,
    })
}

pub fn join_request_respond_input(
    endpoint: String,
    group_id: String,
    user_id: String,
    action: String,
    block: bool,
) -> Result<(String, String, HttpApiRequestInput), HttpApiError> {
    let group_id = require_text(group_id, "VrchatGroupJoinRequestRespond requires groupId.")?;
    let user_id = require_text(user_id, "VrchatGroupJoinRequestRespond requires userId.")?;
    let action = require_text(action, "VrchatGroupJoinRequestRespond requires action.")?;
    let mut body = serde_json::json!({ "action": action });
    if block {
        body["block"] = Value::Bool(true);
    }
    Ok((
        group_id.clone(),
        user_id.clone(),
        api_input(
            endpoint,
            "PUT",
            group_path(
                &group_id,
                &format!("requests/{}", encode_path_segment(&user_id)),
            ),
            Some(body),
        ),
    ))
}

pub fn representation_set_input(
    endpoint: String,
    group_id: String,
    is_representing: bool,
) -> Result<(String, HttpApiRequestInput), HttpApiError> {
    let group_id = require_text(group_id, "VrchatGroupRepresentationSet requires groupId.")?;
    Ok((
        group_id.clone(),
        api_input(
            endpoint,
            "PUT",
            group_path(&group_id, "representation"),
            Some(serde_json::json!({ "isRepresenting": is_representing })),
        ),
    ))
}

pub fn member_props_set_input(
    endpoint: String,
    group_id: String,
    user_id: String,
    params: Option<Value>,
) -> Result<(String, String, HttpApiRequestInput), HttpApiError> {
    let group_id = require_text(group_id, "VrchatGroupMemberPropsSet requires groupId.")?;
    let user_id = require_text(user_id, "VrchatGroupMemberPropsSet requires userId.")?;
    Ok((
        group_id.clone(),
        user_id.clone(),
        api_input(
            endpoint,
            "PUT",
            group_path(
                &group_id,
                &format!("members/{}", encode_path_segment(&user_id)),
            ),
            Some(object_body(params)),
        ),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn endpoint() -> String {
        "https://api.vrchat.cloud/api/1".to_string()
    }

    #[test]
    fn user_group_permissions_get_uses_permissions_endpoint() {
        let (user_id, request) =
            user_group_permissions_get_input(endpoint(), "usr me".into()).unwrap();

        assert_eq!(user_id, "usr me");
        assert_eq!(
            request.path.as_deref(),
            Some("users/usr%20me/groups/permissions")
        );
        assert_eq!(request.method.as_deref(), Some("GET"));
    }

    #[test]
    fn member_get_reads_one_group_member() {
        let (group_id, user_id, request) =
            member_get_input(endpoint(), "grp 1".into(), "usr 1".into()).unwrap();

        assert_eq!(group_id, "grp 1");
        assert_eq!(user_id, "usr 1");
        assert_eq!(
            request.path.as_deref(),
            Some("groups/grp%201/members/usr%201")
        );
        assert_eq!(request.method.as_deref(), Some("GET"));
    }

    #[test]
    fn member_unban_deletes_ban_row_not_member_row() {
        let (_, _, request) =
            member_unban_input(endpoint(), "grp 1".into(), "usr 1".into()).unwrap();

        assert_eq!(request.path.as_deref(), Some("groups/grp%201/bans/usr%201"));
        assert_eq!(request.method.as_deref(), Some("DELETE"));
    }
}
