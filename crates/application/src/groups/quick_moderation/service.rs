use std::collections::{HashMap, VecDeque};

use futures_util::stream::{FuturesUnordered, StreamExt};
use serde_json::Value;
use vrcx_0_vrchat_client::http_api::normalize_vrchat_api_endpoint;

use crate::auth_scope::RuntimeAuthScope;
use crate::session::HostSessionRuntime;
use crate::vrchat_api::groups::{
    member_ban_input, member_get_input, member_kick_input, user_group_permissions_get_input,
    user_groups_get_input,
};
use crate::vrchat_api::VrchatApiRequest;
use crate::{Error, Result};

use super::super::service::{execute_group_api_raw, GroupApiDeps};
use super::types::{
    GroupQuickModerationActionInput, GroupQuickModerationActionOutput, GroupQuickModerationGroup,
    GroupQuickModerationInput, GroupQuickModerationOutput,
};

const KICK_PERMISSION: &str = "group-members-remove";
const BAN_PERMISSION: &str = "group-bans-manage";
const MEMBERSHIP_PROBE_CONCURRENCY: usize = 5;

#[derive(Clone)]
pub struct GroupQuickModerationDeps {
    pub groups: GroupApiDeps,
    pub auth_scope: RuntimeAuthScope,
    pub session: HostSessionRuntime,
}

struct ApiJsonResponse {
    status: i32,
    json: Value,
}

struct MembershipProbe {
    group: GroupQuickModerationGroup,
    member: Option<Value>,
    failed: bool,
}

pub async fn get_group_quick_moderation(
    deps: GroupQuickModerationDeps,
    input: GroupQuickModerationInput,
) -> Result<GroupQuickModerationOutput> {
    let command = "app__user_group_quick_moderation_get";
    deps.groups.diagnostics.record_command(
        command,
        "running",
        "Group quick moderation snapshot started.",
    );
    let result = load_group_quick_moderation(deps.clone(), input).await;
    match &result {
        Ok(output) => {
            let status = if output.stale { "stale" } else { "ok" };
            let sync_status = if output.stale { "stale" } else { "ready" };
            deps.groups.diagnostics.record_command(
                command,
                status,
                format!(
                    "target={} kick={} ban={} membershipErrors={}",
                    output.target_user_id,
                    output.kick_groups.len(),
                    output.ban_groups.len(),
                    output.membership_error_count
                ),
            );
            deps.groups.sync.record(
                "groupModeration",
                sync_status,
                if output.stale {
                    format!(
                        "Group quick moderation skipped stale request for {}.",
                        output.target_user_id
                    )
                } else {
                    format!(
                        "Group quick moderation loaded for {}.",
                        output.target_user_id
                    )
                },
                0,
            );
        }
        Err(error) => {
            deps.groups
                .diagnostics
                .record_command(command, "error", error.to_string());
            deps.groups
                .sync
                .record_failure("groupModeration", error.to_string());
        }
    }
    result
}

async fn load_group_quick_moderation(
    deps: GroupQuickModerationDeps,
    input: GroupQuickModerationInput,
) -> Result<GroupQuickModerationOutput> {
    let current_user_id = normalize_text(input.current_user_id);
    let target_user_id = normalize_text(input.target_user_id);
    ensure_user_ids(&current_user_id, &target_user_id)?;
    let endpoint = normalize_endpoint(&input.endpoint);
    if !auth_scope_matches(&deps, &current_user_id, &endpoint) {
        return Ok(stale_output(current_user_id, target_user_id));
    }

    let current_groups = execute_vrchat_json_request(
        &deps,
        user_groups_get_input(endpoint.clone(), current_user_id.clone())?.1,
        "VRChat group quick moderation current groups request failed",
    )
    .await?;
    let permission_map = parse_permission_map(
        &execute_vrchat_json_request(
            &deps,
            user_group_permissions_get_input(endpoint.clone(), current_user_id.clone())?.1,
            "VRChat group quick moderation permissions request failed",
        )
        .await?,
    );

    let group_rows = array_rows(&current_groups);
    let ban_groups = groups_for_permission(
        &group_rows,
        &permission_map,
        BAN_PERMISSION,
        &target_user_id,
    );
    let kick_candidates = groups_for_permission(
        &group_rows,
        &permission_map,
        KICK_PERMISSION,
        &target_user_id,
    );
    let (kick_groups, membership_error_count) =
        probe_kick_memberships(&deps, &endpoint, &target_user_id, kick_candidates).await;

    Ok(GroupQuickModerationOutput {
        current_user_id,
        target_user_id,
        stale: false,
        kick_groups,
        ban_groups,
        membership_error_count,
    })
}

pub async fn run_group_quick_moderation_action(
    deps: GroupQuickModerationDeps,
    input: GroupQuickModerationActionInput,
) -> Result<GroupQuickModerationActionOutput> {
    let command = "app__user_group_quick_moderation_action";
    deps.groups.diagnostics.record_command(
        command,
        "running",
        "Group quick moderation action started.",
    );
    let result = execute_group_quick_moderation_action(deps.clone(), input).await;
    match &result {
        Ok(output) => {
            deps.groups.diagnostics.record_command(
                command,
                "ok",
                format!(
                    "group={} target={} action={} status={}",
                    output.group_id, output.target_user_id, output.action, output.status
                ),
            );
            deps.groups.sync.record(
                "groupModeration",
                "ready",
                format!(
                    "Group quick moderation {} completed for {}.",
                    output.action, output.target_user_id
                ),
                0,
            );
        }
        Err(error) => {
            deps.groups
                .diagnostics
                .record_command(command, "error", error.to_string());
            deps.groups
                .sync
                .record_failure("groupModeration", error.to_string());
        }
    }
    result
}

async fn execute_group_quick_moderation_action(
    deps: GroupQuickModerationDeps,
    input: GroupQuickModerationActionInput,
) -> Result<GroupQuickModerationActionOutput> {
    let current_user_id = normalize_text(input.current_user_id);
    let target_user_id = normalize_text(input.target_user_id);
    ensure_user_ids(&current_user_id, &target_user_id)?;
    let group_id = require_non_empty(input.group_id, "Group quick moderation requires groupId.")?;
    let endpoint = normalize_endpoint(&input.endpoint);
    ensure_current_scope(&deps, &current_user_id, &endpoint)?;
    let action = normalize_text(input.action);

    let request = quick_action_request(&endpoint, &group_id, &target_user_id, &action)?;
    let response = execute_vrchat_api(&deps, request).await?;
    if response.status >= 400 || response_has_error(&response.json) {
        return Err(Error::Custom(unwrap_error_message(
            &response.json,
            response.status,
            "VRChat group quick moderation action failed",
        )));
    }

    Ok(GroupQuickModerationActionOutput {
        group_id,
        target_user_id,
        action,
        status: response.status,
    })
}

fn quick_action_request(
    endpoint: &str,
    group_id: &str,
    target_user_id: &str,
    action: &str,
) -> Result<VrchatApiRequest> {
    match action {
        "kick" => Ok(member_kick_input(
            endpoint.to_string(),
            group_id.to_string(),
            target_user_id.to_string(),
        )?
        .2),
        "ban" => Ok(member_ban_input(
            endpoint.to_string(),
            group_id.to_string(),
            target_user_id.to_string(),
        )?
        .2),
        _ => Err(Error::Custom(
            "Group quick moderation action must be kick or ban.".into(),
        )),
    }
}

async fn probe_kick_memberships(
    deps: &GroupQuickModerationDeps,
    endpoint: &str,
    target_user_id: &str,
    candidates: Vec<GroupQuickModerationGroup>,
) -> (Vec<GroupQuickModerationGroup>, usize) {
    let mut pending = VecDeque::from(candidates);
    let mut in_flight = FuturesUnordered::new();
    let mut groups = Vec::new();
    let mut error_count = 0usize;

    for _ in 0..MEMBERSHIP_PROBE_CONCURRENCY {
        let Some(group) = pending.pop_front() else {
            break;
        };
        in_flight.push(probe_group_member(
            deps,
            endpoint.to_string(),
            target_user_id.to_string(),
            group,
        ));
    }

    while let Some(probe) = in_flight.next().await {
        if probe.failed {
            error_count += 1;
        }
        if let Some(member) = probe.member {
            groups.push(group_with_member(probe.group, &member));
        }
        if let Some(group) = pending.pop_front() {
            in_flight.push(probe_group_member(
                deps,
                endpoint.to_string(),
                target_user_id.to_string(),
                group,
            ));
        }
    }

    groups.sort_by_key(|group| group.name.to_lowercase());
    (groups, error_count)
}

async fn probe_group_member(
    deps: &GroupQuickModerationDeps,
    endpoint: String,
    target_user_id: String,
    group: GroupQuickModerationGroup,
) -> MembershipProbe {
    let request = match member_get_input(endpoint, group.group_id.clone(), target_user_id) {
        Ok((_, _, request)) => request,
        Err(_) => {
            return MembershipProbe {
                group,
                member: None,
                failed: true,
            }
        }
    };

    match execute_vrchat_api(deps, request).await {
        Ok(response) if (200..=299).contains(&response.status) => MembershipProbe {
            group,
            member: Some(response.json),
            failed: false,
        },
        Ok(response) if response.status == 404 => MembershipProbe {
            group,
            member: None,
            failed: false,
        },
        Ok(_) | Err(_) => MembershipProbe {
            group,
            member: None,
            failed: true,
        },
    }
}

async fn execute_vrchat_json_request(
    deps: &GroupQuickModerationDeps,
    request: VrchatApiRequest,
    fallback: &str,
) -> Result<Value> {
    let response = execute_vrchat_api(deps, request).await?;
    if response.status >= 400 || response_has_error(&response.json) {
        return Err(Error::Custom(unwrap_error_message(
            &response.json,
            response.status,
            fallback,
        )));
    }
    Ok(response.json)
}

async fn execute_vrchat_api(
    deps: &GroupQuickModerationDeps,
    request: VrchatApiRequest,
) -> Result<ApiJsonResponse> {
    let response = execute_group_api_raw(&deps.groups, request).await?;
    Ok(ApiJsonResponse {
        status: response.status,
        json: parse_response_json(&response.data),
    })
}

fn parse_response_json(data: &str) -> Value {
    serde_json::from_str(data).unwrap_or_else(|_| Value::String(data.to_string()))
}

fn response_has_error(json: &Value) -> bool {
    json.as_object()
        .is_some_and(|object| object.contains_key("error"))
}

fn value_message(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|message| !message.is_empty())
        .map(|message| message.trim_matches('"').to_string())
}

fn unwrap_error_message(json: &Value, status: i32, fallback: &str) -> String {
    if let Some(message) = value_message(Some(json)) {
        return message;
    }

    let object = json.as_object();
    if let Some(message) = value_message(
        object
            .and_then(|record| record.get("error"))
            .and_then(Value::as_object)
            .and_then(|error| error.get("message")),
    ) {
        return message;
    }
    if let Some(message) = value_message(object.and_then(|record| record.get("message"))) {
        return message;
    }

    format!("{fallback} ({status})")
}

fn normalize_text(value: impl AsRef<str>) -> String {
    value.as_ref().trim().to_string()
}

fn normalize_endpoint(value: &str) -> String {
    normalize_vrchat_api_endpoint(Some(value))
}

fn require_non_empty(value: impl AsRef<str>, message: &str) -> Result<String> {
    let value = normalize_text(value);
    if value.is_empty() {
        return Err(Error::Custom(message.into()));
    }
    Ok(value)
}

fn ensure_user_ids(current_user_id: &str, target_user_id: &str) -> Result<()> {
    if current_user_id.is_empty() || target_user_id.is_empty() {
        return Err(Error::Custom(
            "Group quick moderation requires currentUserId and targetUserId.".into(),
        ));
    }
    if current_user_id == target_user_id {
        return Err(Error::Custom(
            "Group quick moderation cannot target the current user.".into(),
        ));
    }
    Ok(())
}

fn auth_scope_matches(deps: &GroupQuickModerationDeps, user_id: &str, endpoint: &str) -> bool {
    let auth_scope = deps.auth_scope.snapshot();
    if auth_scope.active {
        return deps.auth_scope.matches(user_id, endpoint);
    }

    let snapshot = deps.session.snapshot();
    let Some(context) = snapshot.realtime_context else {
        return true;
    };
    context.current_user_id == user_id && normalize_endpoint(&context.endpoint) == endpoint
}

fn ensure_current_scope(
    deps: &GroupQuickModerationDeps,
    user_id: &str,
    endpoint: &str,
) -> Result<()> {
    if auth_scope_matches(deps, user_id, endpoint) {
        return Ok(());
    }
    Err(Error::Custom(
        "Backend group moderation request is stale for the current auth scope.".into(),
    ))
}

fn stale_output(current_user_id: String, target_user_id: String) -> GroupQuickModerationOutput {
    GroupQuickModerationOutput {
        current_user_id,
        target_user_id,
        stale: true,
        kick_groups: Vec::new(),
        ban_groups: Vec::new(),
        membership_error_count: 0,
    }
}

fn array_rows(value: &Value) -> Vec<Value> {
    if let Some(rows) = value.as_array() {
        return rows.clone();
    }
    value
        .as_object()
        .and_then(|object| object.get("results"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

fn value_as_string(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(value)) => normalize_text(value),
        Some(Value::Number(value)) => value.to_string(),
        Some(Value::Bool(value)) => value.to_string(),
        _ => String::new(),
    }
}

fn object_string(value: &Value, keys: &[&str]) -> String {
    let Some(object) = value.as_object() else {
        return String::new();
    };
    for key in keys {
        let text = value_as_string(object.get(*key));
        if !text.is_empty() {
            return text;
        }
    }
    String::new()
}

fn nested_object_string(value: &Value, object_key: &str, keys: &[&str]) -> String {
    value
        .as_object()
        .and_then(|object| object.get(object_key))
        .map(|nested| object_string(nested, keys))
        .unwrap_or_default()
}

fn string_array(value: Option<&Value>) -> Vec<String> {
    match value {
        Some(Value::Array(values)) => values
            .iter()
            .filter_map(|value| {
                let text = value_as_string(Some(value));
                (!text.is_empty()).then_some(text)
            })
            .collect(),
        Some(value) => {
            let text = value_as_string(Some(value));
            if text.is_empty() {
                Vec::new()
            } else {
                vec![text]
            }
        }
        None => Vec::new(),
    }
}

fn parse_permission_map(value: &Value) -> HashMap<String, Vec<String>> {
    value
        .as_object()
        .map(|object| {
            object
                .iter()
                .map(|(group_id, permissions)| (group_id.clone(), string_array(Some(permissions))))
                .collect()
        })
        .unwrap_or_default()
}

fn permissions_for_group(
    group: &Value,
    permission_map: &HashMap<String, Vec<String>>,
    group_id: &str,
) -> Vec<String> {
    if let Some(permissions) = permission_map.get(group_id) {
        return permissions.clone();
    }
    group
        .as_object()
        .and_then(|object| object.get("myMember"))
        .and_then(Value::as_object)
        .map(|member| string_array(member.get("permissions")))
        .unwrap_or_default()
}

fn has_permission(permissions: &[String], permission: &str) -> bool {
    permissions
        .iter()
        .any(|value| value == "*" || value == permission)
}

fn group_from_value(group: &Value) -> Option<GroupQuickModerationGroup> {
    let group_id = object_string(group, &["id", "groupId"]);
    if group_id.is_empty() {
        return None;
    }
    let name = object_string(group, &["name", "displayName"]).if_empty_then(|| group_id.clone());
    let owner_id = object_string(group, &["ownerId", "ownerID"])
        .if_empty_then(|| nested_object_string(group, "owner", &["id", "userId"]));
    Some(GroupQuickModerationGroup {
        group_id,
        name,
        short_code: object_string(group, &["shortCode", "shortcode"]),
        icon_url: object_string(
            group,
            &["iconUrl", "imageUrl", "thumbnailImageUrl", "bannerUrl"],
        ),
        owner_id,
        membership_label: String::new(),
        role_label: String::new(),
    })
}

fn groups_for_permission(
    group_rows: &[Value],
    permission_map: &HashMap<String, Vec<String>>,
    permission: &str,
    target_user_id: &str,
) -> Vec<GroupQuickModerationGroup> {
    let mut groups = group_rows
        .iter()
        .filter_map(|group| {
            let parsed = group_from_value(group)?;
            if !parsed.owner_id.is_empty() && parsed.owner_id == target_user_id {
                return None;
            }
            let permissions = permissions_for_group(group, permission_map, &parsed.group_id);
            has_permission(&permissions, permission).then_some(parsed)
        })
        .collect::<Vec<_>>();
    groups.sort_by_key(|group| group.name.to_lowercase());
    groups
}

fn group_with_member(
    mut group: GroupQuickModerationGroup,
    member: &Value,
) -> GroupQuickModerationGroup {
    group.membership_label =
        object_string(member, &["membershipStatus", "status"]).if_empty_then(|| "member".into());
    group.role_label = role_label_from_member(member);
    group
}

fn role_label_from_member(member: &Value) -> String {
    let Some(object) = member.as_object() else {
        return String::new();
    };
    let role_names = object
        .get("roles")
        .and_then(Value::as_array)
        .map(|roles| {
            roles
                .iter()
                .filter_map(|role| {
                    let name = match role {
                        Value::String(value) => normalize_text(value),
                        _ => object_string(role, &["name", "displayName", "id"]),
                    };
                    (!name.is_empty()).then_some(name)
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if !role_names.is_empty() {
        return role_names.join(", ");
    }
    string_array(object.get("roleIds")).join(", ")
}

trait IfEmptyThen {
    fn if_empty_then(self, fallback: impl FnOnce() -> String) -> String;
}

impl IfEmptyThen for String {
    fn if_empty_then(self, fallback: impl FnOnce() -> String) -> String {
        if self.is_empty() {
            fallback()
        } else {
            self
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn endpoint() -> &'static str {
        "https://api.vrchat.cloud/api/1"
    }

    #[test]
    fn quick_action_request_uses_group_member_builders() {
        let kick = quick_action_request(endpoint(), "grp 1", "usr 1", "kick").unwrap();
        let ban = quick_action_request(endpoint(), "grp 1", "usr 1", "ban").unwrap();

        assert_eq!(kick.method.as_deref(), Some("DELETE"));
        assert_eq!(kick.path.as_deref(), Some("groups/grp%201/members/usr%201"));
        assert_eq!(ban.method.as_deref(), Some("POST"));
        assert_eq!(ban.path.as_deref(), Some("groups/grp%201/bans"));
        assert!(quick_action_request(endpoint(), "grp 1", "usr 1", "unban").is_err());
        assert!(quick_action_request(endpoint(), "grp 1", "usr 1", "noop").is_err());
    }

    #[test]
    fn filters_groups_by_permission_and_excludes_target_owned_groups() {
        let groups = vec![
            json!({ "id": "grp_kick", "name": "Kick", "ownerId": "usr_owner" }),
            json!({ "id": "grp_ban", "name": "Ban", "ownerId": "usr_owner" }),
            json!({ "id": "grp_target_owned", "name": "Owned", "ownerId": "usr_target" }),
        ];
        let permissions = parse_permission_map(&json!({
            "grp_kick": ["group-members-remove"],
            "grp_ban": ["group-bans-manage"],
            "grp_target_owned": ["*"]
        }));

        let kick = groups_for_permission(&groups, &permissions, KICK_PERMISSION, "usr_target");
        let ban = groups_for_permission(&groups, &permissions, BAN_PERMISSION, "usr_target");

        assert_eq!(
            kick.iter()
                .map(|group| group.group_id.as_str())
                .collect::<Vec<_>>(),
            vec!["grp_kick"]
        );
        assert_eq!(
            ban.iter()
                .map(|group| group.group_id.as_str())
                .collect::<Vec<_>>(),
            vec!["grp_ban"]
        );
    }

    #[test]
    fn wildcard_permissions_enable_kick_and_ban() {
        let groups = vec![json!({ "id": "grp_1", "name": "Group", "ownerId": "usr_owner" })];
        let permissions = parse_permission_map(&json!({ "grp_1": ["*"] }));

        assert_eq!(
            groups_for_permission(&groups, &permissions, KICK_PERMISSION, "usr_target").len(),
            1
        );
        assert_eq!(
            groups_for_permission(&groups, &permissions, BAN_PERMISSION, "usr_target").len(),
            1
        );
    }

    #[test]
    fn self_target_is_rejected() {
        assert!(ensure_user_ids("usr_1", "usr_1").is_err());
        assert!(ensure_user_ids("usr_1", "usr_2").is_ok());
    }
}
