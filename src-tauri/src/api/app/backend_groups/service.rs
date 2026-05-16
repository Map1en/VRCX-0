#![allow(non_snake_case)]

use std::collections::HashMap;

use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use serde_json::{json, Value};
use tauri::State;

use crate::api::app::vrchat_api_types::{HttpApiExecuteResponse, HttpApiRequestInput};
use crate::error::AppError;
use crate::state::AppState;

use super::types::{
    BackendGroupGalleryInput, BackendGroupIdInput, BackendGroupJoinRequestRespondInput,
    BackendGroupJoinRequestsInput, BackendGroupLogsInput, BackendGroupMemberPropsInput,
    BackendGroupMembersInput, BackendGroupMembersSearchInput, BackendGroupPagedInput,
    BackendGroupPostCreateInput, BackendGroupPostDeleteInput, BackendGroupPostEditInput,
    BackendGroupProfileInput, BackendGroupRepresentationInput, BackendGroupUserGroupsInput,
    BackendGroupUserInput,
};

fn normalize_text(value: impl AsRef<str>) -> String {
    value.as_ref().trim().to_string()
}

fn require_text(value: impl AsRef<str>, message: &str) -> Result<String, AppError> {
    let value = normalize_text(value);
    if value.is_empty() {
        return Err(AppError::Custom(message.into()));
    }
    Ok(value)
}

fn encode_path_segment(value: &str) -> String {
    utf8_percent_encode(value, NON_ALPHANUMERIC).to_string()
}

fn json_headers() -> HashMap<String, String> {
    HashMap::from([(
        "Content-Type".to_string(),
        "application/json;charset=utf-8".to_string(),
    )])
}

fn object_body(value: Option<Value>) -> Value {
    match value {
        Some(value @ Value::Object(_)) => value,
        _ => json!({}),
    }
}

fn api_input(
    endpoint: String,
    method: &str,
    path: String,
    body: Option<Value>,
) -> HttpApiRequestInput {
    let has_body = body.is_some();
    HttpApiRequestInput {
        endpoint: Some(endpoint),
        method: Some(method.into()),
        path: Some(path),
        headers: body.as_ref().map(|_| json_headers()),
        body,
        json_body: Some(has_body),
        ..Default::default()
    }
}

fn get_input(
    endpoint: String,
    path: String,
    query_params: HashMap<String, Value>,
) -> HttpApiRequestInput {
    HttpApiRequestInput {
        endpoint: Some(endpoint),
        method: Some("GET".into()),
        path: Some(path),
        params: Some(query_params.clone()),
        query_params: Some(query_params),
        ..Default::default()
    }
}

async fn execute_group_api(
    state: State<'_, AppState>,
    command: &str,
    detail: impl Into<String>,
    input: HttpApiRequestInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let diagnostics = state.backend_context.diagnostics.clone();
    diagnostics.record_command(command, "running", detail.into());
    let result = super::super::vrchat_api::app__vrchat_group_execute(state, input).await;
    match &result {
        Ok(response) => {
            diagnostics.record_command(command, "ok", format!("status={}", response.status));
        }
        Err(error) => diagnostics.record_command(command, "error", error.to_string()),
    }
    result
}

fn group_path(group_id: &str, suffix: &str) -> String {
    if suffix.is_empty() {
        format!("groups/{}", encode_path_segment(group_id))
    } else {
        format!("groups/{}/{}", encode_path_segment(group_id), suffix)
    }
}

#[tauri::command]
pub async fn app__backend_group_get(
    state: State<'_, AppState>,
    input: BackendGroupProfileInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let group_id = require_text(input.group_id, "BackendGroupGet requires groupId.")?;
    execute_group_api(
        state,
        "app__backend_group_get",
        format!("Getting group {group_id}."),
        get_input(
            input.endpoint,
            group_path(&group_id, ""),
            HashMap::from([(
                "includeRoles".to_string(),
                Value::String(if input.include_roles { "true" } else { "false" }.into()),
            )]),
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_group_user_groups_get(
    state: State<'_, AppState>,
    input: BackendGroupUserGroupsInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let user_id = require_text(input.user_id, "BackendGroupUserGroupsGet requires userId.")?;
    execute_group_api(
        state,
        "app__backend_group_user_groups_get",
        format!("Getting groups for user {user_id}."),
        get_input(
            input.endpoint,
            format!("users/{}/groups", encode_path_segment(&user_id)),
            HashMap::new(),
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_group_posts_get(
    state: State<'_, AppState>,
    input: BackendGroupPagedInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let group_id = require_text(input.group_id, "BackendGroupPostsGet requires groupId.")?;
    execute_group_api(
        state,
        "app__backend_group_posts_get",
        format!("Getting posts for group {group_id}."),
        get_input(
            input.endpoint,
            group_path(&group_id, "posts"),
            HashMap::from([
                ("n".to_string(), json!(input.n)),
                ("offset".to_string(), json!(input.offset)),
            ]),
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_group_members_get(
    state: State<'_, AppState>,
    input: BackendGroupMembersInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let group_id = require_text(input.group_id, "BackendGroupMembersGet requires groupId.")?;
    let role_id = normalize_text(input.role_id);
    let mut params = HashMap::from([
        ("n".to_string(), json!(input.n)),
        ("offset".to_string(), json!(input.offset)),
        ("sort".to_string(), Value::String(input.sort)),
    ]);
    if !role_id.is_empty() {
        params.insert("roleId".to_string(), Value::String(role_id));
    }
    execute_group_api(
        state,
        "app__backend_group_members_get",
        format!("Getting members for group {group_id}."),
        get_input(input.endpoint, group_path(&group_id, "members"), params),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_group_members_search(
    state: State<'_, AppState>,
    input: BackendGroupMembersSearchInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let group_id = require_text(
        input.group_id,
        "BackendGroupMembersSearch requires groupId.",
    )?;
    execute_group_api(
        state,
        "app__backend_group_members_search",
        format!("Searching members for group {group_id}."),
        get_input(
            input.endpoint,
            group_path(&group_id, "members/search"),
            HashMap::from([
                ("n".to_string(), json!(input.n)),
                ("offset".to_string(), json!(input.offset)),
                ("query".to_string(), Value::String(input.query)),
            ]),
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_group_gallery_get(
    state: State<'_, AppState>,
    input: BackendGroupGalleryInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let group_id = require_text(input.group_id, "BackendGroupGalleryGet requires groupId.")?;
    let gallery_id = require_text(
        input.gallery_id,
        "BackendGroupGalleryGet requires galleryId.",
    )?;
    execute_group_api(
        state,
        "app__backend_group_gallery_get",
        format!("Getting gallery {gallery_id} for group {group_id}."),
        get_input(
            input.endpoint,
            group_path(
                &group_id,
                &format!("galleries/{}", encode_path_segment(&gallery_id)),
            ),
            HashMap::from([
                ("n".to_string(), json!(input.n)),
                ("offset".to_string(), json!(input.offset)),
            ]),
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_group_instances_get(
    state: State<'_, AppState>,
    input: BackendGroupUserInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let group_id = require_text(input.group_id, "BackendGroupInstancesGet requires groupId.")?;
    let user_id = require_text(input.user_id, "BackendGroupInstancesGet requires userId.")?;
    execute_group_api(
        state,
        "app__backend_group_instances_get",
        format!("Getting group {group_id} instances for user {user_id}."),
        get_input(
            input.endpoint,
            format!(
                "users/{}/instances/groups/{}",
                encode_path_segment(&user_id),
                encode_path_segment(&group_id)
            ),
            HashMap::new(),
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_group_bans_get(
    state: State<'_, AppState>,
    input: BackendGroupPagedInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let group_id = require_text(input.group_id, "BackendGroupBansGet requires groupId.")?;
    execute_group_api(
        state,
        "app__backend_group_bans_get",
        format!("Getting bans for group {group_id}."),
        get_input(
            input.endpoint,
            group_path(&group_id, "bans"),
            HashMap::from([
                ("n".to_string(), json!(input.n)),
                ("offset".to_string(), json!(input.offset)),
            ]),
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_group_invites_get(
    state: State<'_, AppState>,
    input: BackendGroupPagedInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let group_id = require_text(input.group_id, "BackendGroupInvitesGet requires groupId.")?;
    execute_group_api(
        state,
        "app__backend_group_invites_get",
        format!("Getting invites for group {group_id}."),
        get_input(
            input.endpoint,
            group_path(&group_id, "invites"),
            HashMap::from([
                ("n".to_string(), json!(input.n)),
                ("offset".to_string(), json!(input.offset)),
            ]),
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_group_join_requests_get(
    state: State<'_, AppState>,
    input: BackendGroupJoinRequestsInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let group_id = require_text(
        input.group_id,
        "BackendGroupJoinRequestsGet requires groupId.",
    )?;
    execute_group_api(
        state,
        "app__backend_group_join_requests_get",
        format!("Getting join requests for group {group_id}."),
        get_input(
            input.endpoint,
            group_path(&group_id, "requests"),
            HashMap::from([
                ("n".to_string(), json!(input.n)),
                ("offset".to_string(), json!(input.offset)),
                ("blocked".to_string(), Value::Bool(input.blocked)),
            ]),
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_group_audit_log_types_get(
    state: State<'_, AppState>,
    input: BackendGroupIdInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let group_id = require_text(
        input.group_id,
        "BackendGroupAuditLogTypesGet requires groupId.",
    )?;
    execute_group_api(
        state,
        "app__backend_group_audit_log_types_get",
        format!("Getting audit log types for group {group_id}."),
        get_input(
            input.endpoint,
            group_path(&group_id, "auditLogTypes"),
            HashMap::new(),
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_group_logs_get(
    state: State<'_, AppState>,
    input: BackendGroupLogsInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let group_id = require_text(input.group_id, "BackendGroupLogsGet requires groupId.")?;
    let event_types = normalize_text(input.event_types);
    let mut params = HashMap::from([
        ("n".to_string(), json!(input.n)),
        ("offset".to_string(), json!(input.offset)),
    ]);
    if !event_types.is_empty() {
        params.insert("eventTypes".to_string(), Value::String(event_types));
    }
    execute_group_api(
        state,
        "app__backend_group_logs_get",
        format!("Getting logs for group {group_id}."),
        get_input(input.endpoint, group_path(&group_id, "auditLogs"), params),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_group_user_instances_get(
    state: State<'_, AppState>,
    input: BackendGroupUserGroupsInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let user_id = require_text(
        input.user_id,
        "BackendGroupUserInstancesGet requires userId.",
    )?;
    execute_group_api(
        state,
        "app__backend_group_user_instances_get",
        format!("Getting group instances for user {user_id}."),
        get_input(
            input.endpoint,
            format!("users/{}/instances/groups", encode_path_segment(&user_id)),
            HashMap::new(),
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_group_post_create(
    state: State<'_, AppState>,
    input: BackendGroupPostCreateInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let group_id = require_text(input.group_id, "BackendGroupPostCreate requires groupId.")?;
    execute_group_api(
        state,
        "app__backend_group_post_create",
        format!("Creating post in group {group_id}."),
        api_input(
            input.endpoint,
            "POST",
            group_path(&group_id, "posts"),
            Some(object_body(input.params)),
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_group_post_edit(
    state: State<'_, AppState>,
    input: BackendGroupPostEditInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let group_id = require_text(input.group_id, "BackendGroupPostEdit requires groupId.")?;
    let post_id = require_text(input.post_id, "BackendGroupPostEdit requires postId.")?;
    execute_group_api(
        state,
        "app__backend_group_post_edit",
        format!("Editing post {post_id} in group {group_id}."),
        api_input(
            input.endpoint,
            "PUT",
            group_path(
                &group_id,
                &format!("posts/{}", encode_path_segment(&post_id)),
            ),
            Some(object_body(input.params)),
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_group_post_delete(
    state: State<'_, AppState>,
    input: BackendGroupPostDeleteInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let group_id = require_text(input.group_id, "BackendGroupPostDelete requires groupId.")?;
    let post_id = require_text(input.post_id, "BackendGroupPostDelete requires postId.")?;
    execute_group_api(
        state,
        "app__backend_group_post_delete",
        format!("Deleting post {post_id} in group {group_id}."),
        api_input(
            input.endpoint,
            "DELETE",
            group_path(
                &group_id,
                &format!("posts/{}", encode_path_segment(&post_id)),
            ),
            None,
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_group_join(
    state: State<'_, AppState>,
    input: BackendGroupIdInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let group_id = require_text(input.group_id, "BackendGroupJoin requires groupId.")?;
    execute_group_api(
        state,
        "app__backend_group_join",
        format!("Joining group {group_id}."),
        api_input(
            input.endpoint,
            "POST",
            group_path(&group_id, "join"),
            Some(json!({})),
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_group_leave(
    state: State<'_, AppState>,
    input: BackendGroupIdInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let group_id = require_text(input.group_id, "BackendGroupLeave requires groupId.")?;
    execute_group_api(
        state,
        "app__backend_group_leave",
        format!("Leaving group {group_id}."),
        api_input(
            input.endpoint,
            "POST",
            group_path(&group_id, "leave"),
            Some(json!({})),
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_group_request_cancel(
    state: State<'_, AppState>,
    input: BackendGroupIdInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let group_id = require_text(
        input.group_id,
        "BackendGroupRequestCancel requires groupId.",
    )?;
    execute_group_api(
        state,
        "app__backend_group_request_cancel",
        format!("Canceling group request for {group_id}."),
        api_input(
            input.endpoint,
            "DELETE",
            group_path(&group_id, "requests"),
            None,
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_group_invite_send(
    state: State<'_, AppState>,
    input: BackendGroupUserInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let group_id = require_text(input.group_id, "BackendGroupInviteSend requires groupId.")?;
    let user_id = require_text(input.user_id, "BackendGroupInviteSend requires userId.")?;
    execute_group_api(
        state,
        "app__backend_group_invite_send",
        format!("Sending group {group_id} invite to {user_id}."),
        api_input(
            input.endpoint,
            "POST",
            group_path(&group_id, "invites"),
            Some(json!({ "userId": user_id })),
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_group_member_kick(
    state: State<'_, AppState>,
    input: BackendGroupUserInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let group_id = require_text(input.group_id, "BackendGroupMemberKick requires groupId.")?;
    let user_id = require_text(input.user_id, "BackendGroupMemberKick requires userId.")?;
    execute_group_api(
        state,
        "app__backend_group_member_kick",
        format!("Kicking {user_id} from group {group_id}."),
        api_input(
            input.endpoint,
            "DELETE",
            group_path(
                &group_id,
                &format!("members/{}", encode_path_segment(&user_id)),
            ),
            None,
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_group_member_ban(
    state: State<'_, AppState>,
    input: BackendGroupUserInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let group_id = require_text(input.group_id, "BackendGroupMemberBan requires groupId.")?;
    let user_id = require_text(input.user_id, "BackendGroupMemberBan requires userId.")?;
    execute_group_api(
        state,
        "app__backend_group_member_ban",
        format!("Banning {user_id} from group {group_id}."),
        api_input(
            input.endpoint,
            "POST",
            group_path(&group_id, "bans"),
            Some(json!({ "userId": user_id })),
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_group_member_unban(
    state: State<'_, AppState>,
    input: BackendGroupUserInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let group_id = require_text(input.group_id, "BackendGroupMemberUnban requires groupId.")?;
    let user_id = require_text(input.user_id, "BackendGroupMemberUnban requires userId.")?;
    execute_group_api(
        state,
        "app__backend_group_member_unban",
        format!("Unbanning {user_id} from group {group_id}."),
        api_input(
            input.endpoint,
            "DELETE",
            group_path(
                &group_id,
                &format!("members/{}", encode_path_segment(&user_id)),
            ),
            None,
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_group_invite_delete(
    state: State<'_, AppState>,
    input: BackendGroupUserInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let group_id = require_text(input.group_id, "BackendGroupInviteDelete requires groupId.")?;
    let user_id = require_text(input.user_id, "BackendGroupInviteDelete requires userId.")?;
    execute_group_api(
        state,
        "app__backend_group_invite_delete",
        format!("Deleting group {group_id} invite for {user_id}."),
        api_input(
            input.endpoint,
            "DELETE",
            group_path(
                &group_id,
                &format!("invites/{}", encode_path_segment(&user_id)),
            ),
            None,
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_group_join_request_respond(
    state: State<'_, AppState>,
    input: BackendGroupJoinRequestRespondInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let group_id = require_text(
        input.group_id,
        "BackendGroupJoinRequestRespond requires groupId.",
    )?;
    let user_id = require_text(
        input.user_id,
        "BackendGroupJoinRequestRespond requires userId.",
    )?;
    let action = require_text(
        input.action,
        "BackendGroupJoinRequestRespond requires action.",
    )?;
    let mut body = json!({ "action": action });
    if input.block {
        body["block"] = Value::Bool(true);
    }
    execute_group_api(
        state,
        "app__backend_group_join_request_respond",
        format!("Responding to group {group_id} join request from {user_id}."),
        api_input(
            input.endpoint,
            "PUT",
            group_path(
                &group_id,
                &format!("requests/{}", encode_path_segment(&user_id)),
            ),
            Some(body),
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_group_representation_set(
    state: State<'_, AppState>,
    input: BackendGroupRepresentationInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let group_id = require_text(
        input.group_id,
        "BackendGroupRepresentationSet requires groupId.",
    )?;
    execute_group_api(
        state,
        "app__backend_group_representation_set",
        format!("Setting group {group_id} representation."),
        api_input(
            input.endpoint,
            "PUT",
            group_path(&group_id, "representation"),
            Some(json!({ "isRepresenting": input.is_representing })),
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_group_member_props_set(
    state: State<'_, AppState>,
    input: BackendGroupMemberPropsInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let group_id = require_text(
        input.group_id,
        "BackendGroupMemberPropsSet requires groupId.",
    )?;
    let user_id = require_text(input.user_id, "BackendGroupMemberPropsSet requires userId.")?;
    execute_group_api(
        state,
        "app__backend_group_member_props_set",
        format!("Setting group {group_id} member props for {user_id}."),
        api_input(
            input.endpoint,
            "PUT",
            group_path(
                &group_id,
                &format!("members/{}", encode_path_segment(&user_id)),
            ),
            Some(object_body(input.params)),
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_group_block(
    state: State<'_, AppState>,
    input: BackendGroupIdInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let group_id = require_text(input.group_id, "BackendGroupBlock requires groupId.")?;
    execute_group_api(
        state,
        "app__backend_group_block",
        format!("Blocking group {group_id}."),
        api_input(
            input.endpoint,
            "POST",
            group_path(&group_id, "block"),
            Some(json!({})),
        ),
    )
    .await
}

#[tauri::command]
pub async fn app__backend_group_unblock(
    state: State<'_, AppState>,
    input: BackendGroupUserInput,
) -> Result<HttpApiExecuteResponse, AppError> {
    let group_id = require_text(input.group_id, "BackendGroupUnblock requires groupId.")?;
    let user_id = require_text(input.user_id, "BackendGroupUnblock requires userId.")?;
    execute_group_api(
        state,
        "app__backend_group_unblock",
        format!("Unblocking group {group_id} for {user_id}."),
        api_input(
            input.endpoint,
            "DELETE",
            group_path(
                &group_id,
                &format!("bans/{}", encode_path_segment(&user_id)),
            ),
            None,
        ),
    )
    .await
}
