use std::collections::{HashMap, VecDeque};
use vrcx_0_application_core::RuntimeOperationStatus;
use vrcx_0_core::text::normalize_text;
use vrcx_0_core::GroupPermission;

use futures_util::stream::{FuturesUnordered, StreamExt};
use serde_json::Value;
use vrcx_0_application_core::RuntimeAuthScope;
use vrcx_0_application_core::{Error, Result};
use vrcx_0_contracts::vrchat_api::VrchatRequest;
use vrcx_0_contracts::VrchatJsonResponse;
use vrcx_0_core::json::{object_scalar_text, result_rows, scalar_text_array};

use super::super::permissions::{has_permission, parse_permission_map, permissions_for_group};
use super::super::service::{execute_group_api_raw, GroupApiDeps};
use super::types::{
    GroupQuickModerationAction, GroupQuickModerationActionInput, GroupQuickModerationActionOutput,
    GroupQuickModerationGroup, GroupQuickModerationInput, GroupQuickModerationOutput,
};

const KICK_PERMISSION: GroupPermission = GroupPermission::MembersRemove;
const BAN_PERMISSION: GroupPermission = GroupPermission::BansManage;
const MEMBERSHIP_PROBE_CONCURRENCY: usize = 5;

#[derive(Clone)]
pub struct GroupQuickModerationDeps {
    pub groups: GroupApiDeps,
    pub auth_scope: RuntimeAuthScope,
}

struct MembershipProbe {
    group: GroupQuickModerationGroup,
    member: Option<Value>,
    failed: bool,
}

struct ValidatedUserId(String);

impl ValidatedUserId {
    fn new(value: impl AsRef<str>) -> Result<Self> {
        Ok(Self(require_non_empty(
            value,
            "Group quick moderation requires a user id.",
        )?))
    }

    fn as_str(&self) -> &str {
        &self.0
    }

    fn into_string(self) -> String {
        self.0
    }
}

struct ValidatedGroupId(String);

impl ValidatedGroupId {
    fn new(value: impl AsRef<str>) -> Result<Self> {
        Ok(Self(require_non_empty(
            value,
            "Group quick moderation requires groupId.",
        )?))
    }

    fn as_str(&self) -> &str {
        &self.0
    }

    fn into_string(self) -> String {
        self.0
    }
}

pub async fn get_group_quick_moderation(
    deps: GroupQuickModerationDeps,
    input: GroupQuickModerationInput,
) -> Result<GroupQuickModerationOutput> {
    let command = "app__user_group_quick_moderation_get";
    deps.groups.diagnostics.record_command(
        command,
        RuntimeOperationStatus::Running,
        "Group quick moderation snapshot started.",
    );
    let result = load_group_quick_moderation(deps.clone(), input).await;
    match &result {
        Ok(output) => {
            let status = if output.stale {
                RuntimeOperationStatus::Stale
            } else {
                RuntimeOperationStatus::Ok
            };
            let sync_status = if output.stale {
                RuntimeOperationStatus::Stale
            } else {
                RuntimeOperationStatus::Ready
            };
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
            deps.groups.diagnostics.record_command(
                command,
                RuntimeOperationStatus::Error,
                error.to_string(),
            );
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
        vrcx_0_vrchat_protocol::groups::user_groups_get_input(
            endpoint.clone(),
            current_user_id.clone(),
        )?
        .1,
        "VRChat group quick moderation current groups request failed",
    )
    .await?;
    let permission_map = parse_permission_map(
        &execute_vrchat_json_request(
            &deps,
            vrcx_0_vrchat_protocol::groups::user_group_permissions_get_input(
                endpoint.clone(),
                current_user_id.clone(),
            )?
            .1,
            "VRChat group quick moderation permissions request failed",
        )
        .await?,
    );

    let group_rows = result_rows(&current_groups);
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
        membership_error_count: crate::wire_count(membership_error_count),
    })
}

pub async fn run_group_quick_moderation_action(
    deps: GroupQuickModerationDeps,
    input: GroupQuickModerationActionInput,
) -> Result<GroupQuickModerationActionOutput> {
    let command = "app__user_group_quick_moderation_action";
    deps.groups.diagnostics.record_command(
        command,
        RuntimeOperationStatus::Running,
        "Group quick moderation action started.",
    );
    let result = execute_group_quick_moderation_action(deps.clone(), input).await;
    match &result {
        Ok(output) => {
            deps.groups.diagnostics.record_command(
                command,
                RuntimeOperationStatus::Ok,
                format!(
                    "group={} target={} action={} status={}",
                    output.group_id, output.target_user_id, output.action, output.status
                ),
            );
            deps.groups.sync.record(
                "groupModeration",
                RuntimeOperationStatus::Ready,
                format!(
                    "Group quick moderation {} completed for {}.",
                    output.action, output.target_user_id
                ),
                0,
            );
        }
        Err(error) => {
            deps.groups.diagnostics.record_command(
                command,
                RuntimeOperationStatus::Error,
                error.to_string(),
            );
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
    let current_user_id = ValidatedUserId::new(input.current_user_id)?;
    let target_user_id = ValidatedUserId::new(input.target_user_id)?;
    if current_user_id.as_str() == target_user_id.as_str() {
        return Err(Error::Custom(
            "Group quick moderation cannot target the current user.".into(),
        ));
    }
    let group_id = ValidatedGroupId::new(input.group_id)?;
    let endpoint = normalize_endpoint(&input.endpoint);
    ensure_current_scope(&deps, current_user_id.as_str(), &endpoint)?;
    let action = input.action;

    let request = match action {
        GroupQuickModerationAction::Kick => {
            vrcx_0_vrchat_protocol::groups::member_kick_input(
                endpoint.to_string(),
                group_id.as_str().to_string(),
                target_user_id.as_str().to_string(),
            )?
            .2
        }
        GroupQuickModerationAction::Ban => {
            vrcx_0_vrchat_protocol::groups::member_ban_input(
                endpoint.to_string(),
                group_id.as_str().to_string(),
                target_user_id.as_str().to_string(),
            )?
            .2
        }
    };
    let response = execute_vrchat_api(&deps, request).await?;
    if let Some(failure) = response.failure_or("VRChat group quick moderation action failed") {
        return Err(failure.into());
    }

    Ok(GroupQuickModerationActionOutput {
        group_id: group_id.into_string(),
        target_user_id: target_user_id.into_string(),
        action,
        status: response.status,
    })
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
    let request = match vrcx_0_vrchat_protocol::groups::member_get_input(
        endpoint,
        group.group_id.clone(),
        target_user_id,
    ) {
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
    request: VrchatRequest,
    fallback: &str,
) -> Result<Value> {
    let response = execute_vrchat_api(deps, request).await?;
    if let Some(failure) = response.failure_or(fallback) {
        return Err(failure.into());
    }
    Ok(response.json)
}

async fn execute_vrchat_api(
    deps: &GroupQuickModerationDeps,
    request: VrchatRequest,
) -> Result<VrchatJsonResponse> {
    let response = execute_group_api_raw(&deps.groups, request).await?;
    Ok(VrchatJsonResponse::from(&response))
}

fn normalize_endpoint(value: &str) -> String {
    vrcx_0_core::vrchat_endpoints::normalize_vrchat_api_endpoint(Some(value))
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
    deps.auth_scope.matches(user_id, endpoint)
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

fn nested_object_string(value: &Value, object_key: &str, keys: &[&str]) -> String {
    value
        .as_object()
        .and_then(|object| object.get(object_key))
        .map(|nested| object_scalar_text(nested, keys))
        .unwrap_or_default()
}

fn group_from_value(group: &Value) -> Option<GroupQuickModerationGroup> {
    let group_id = object_scalar_text(group, &["groupId", "id"]);
    if group_id.is_empty() {
        return None;
    }
    let name = object_scalar_text(group, &["name", "displayName"]);
    let name = if name.is_empty() {
        group_id.clone()
    } else {
        name
    };
    let owner_id = object_scalar_text(group, &["ownerId", "ownerID"]);
    let owner_id = if owner_id.is_empty() {
        nested_object_string(group, "owner", &["id", "userId"])
    } else {
        owner_id
    };
    Some(GroupQuickModerationGroup {
        group_id,
        name,
        short_code: object_scalar_text(group, &["shortCode", "shortcode"]),
        icon_url: object_scalar_text(
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
    permission_map: &HashMap<String, Vec<GroupPermission>>,
    permission: GroupPermission,
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
            has_permission(&permissions, &permission).then_some(parsed)
        })
        .collect::<Vec<_>>();
    groups.sort_by_key(|group| group.name.to_lowercase());
    groups
}

fn group_with_member(
    mut group: GroupQuickModerationGroup,
    member: &Value,
) -> GroupQuickModerationGroup {
    group.membership_label = object_scalar_text(member, &["membershipStatus", "status"]);
    if group.membership_label.is_empty() {
        group.membership_label = "member".into();
    }
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
                        _ => object_scalar_text(role, &["name", "displayName", "id"]),
                    };
                    (!name.is_empty()).then_some(name)
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if !role_names.is_empty() {
        return role_names.join(", ");
    }
    scalar_text_array(object.get("roleIds")).join(", ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    struct RecordingPort {
        sent: std::sync::Mutex<Vec<VrchatRequest>>,
    }

    impl crate::remote::VrchatRequestPort for RecordingPort {
        fn send(
            &self,
            input: VrchatRequest,
            _scope: vrcx_0_contracts::vrchat_api::VrchatScope,
        ) -> crate::remote::VrchatRequestFuture<'_> {
            self.sent.lock().unwrap().push(input);
            Box::pin(async {
                Ok(vrcx_0_contracts::vrchat_api::VrchatResponse {
                    status: 200,
                    data: "{}".into(),
                })
            })
        }
    }

    #[tokio::test(start_paused = true)]
    async fn quick_actions_send_kick_and_ban_to_encoded_group_member_paths() {
        let endpoint = "https://api.vrchat.cloud/api/1";
        let port = std::sync::Arc::new(RecordingPort {
            sent: std::sync::Mutex::default(),
        });
        let auth_scope = RuntimeAuthScope::new();
        auth_scope.set("usr_self", endpoint);
        let deps = GroupQuickModerationDeps {
            groups: GroupApiDeps::new(
                port.clone(),
                vrcx_0_application_core::RuntimeDiagnostics::new(),
                vrcx_0_application_core::RuntimeSyncEngine::new(),
                auth_scope.clone(),
                std::sync::Arc::new(vrcx_0_application_core::RemoteMutationGate::default()),
            ),
            auth_scope,
        };
        for action in [
            GroupQuickModerationAction::Kick,
            GroupQuickModerationAction::Ban,
        ] {
            run_group_quick_moderation_action(
                deps.clone(),
                GroupQuickModerationActionInput {
                    current_user_id: "usr_self".into(),
                    target_user_id: "usr 1".into(),
                    group_id: "grp 1".into(),
                    endpoint: endpoint.into(),
                    action,
                },
            )
            .await
            .unwrap();
        }

        let sent = port.sent.lock().unwrap();
        assert_eq!(sent.len(), 2);
        assert_eq!(sent[0].method.as_deref(), Some("DELETE"));
        assert_eq!(
            sent[0].path.as_deref(),
            Some("groups/grp%201/members/usr%201")
        );
        assert_eq!(sent[1].method.as_deref(), Some("POST"));
        assert_eq!(sent[1].path.as_deref(), Some("groups/grp%201/bans"));
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
    fn prefers_group_id_over_membership_record_id() {
        let groups = vec![json!({
            "id": "gmem_11111111-1111-1111-1111-111111111111",
            "groupId": "grp_1",
            "name": "Group",
            "ownerId": "usr_owner"
        })];
        let permissions = parse_permission_map(&json!({ "grp_1": ["group-members-remove"] }));

        let kick = groups_for_permission(&groups, &permissions, KICK_PERMISSION, "usr_target");

        assert_eq!(
            kick.iter()
                .map(|group| group.group_id.as_str())
                .collect::<Vec<_>>(),
            vec!["grp_1"]
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
