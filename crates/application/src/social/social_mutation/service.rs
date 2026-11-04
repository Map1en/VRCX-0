use std::time::Duration;

use vrcx_0_core::text::normalize_text;

use serde_json::{json, Value};
use vrcx_0_core::time::now_iso;

use vrcx_0_application_core::RuntimeVrchatAuthFailurePayload;
use vrcx_0_application_core::{Error, Result, RuntimeAuthScopeSnapshot};
use vrcx_0_application_realtime::{
    SyntheticFriendEventOutcome, UserQueryCachePolicy, UserQueryKind, UserQueryOptions,
};
use vrcx_0_contracts::friend_log::{
    FriendLogCurrentEntryInput, FriendLogDeleteOptionsInput, FriendLogHistoryEntryInput,
    FriendLogUpsertOptionsInput,
};
use vrcx_0_contracts::vrchat_api::VrchatRequest;
use vrcx_0_contracts::vrchat_api::{VrchatJsonResponse, VrchatScope};

use super::types::{
    SocialFriendMutationInput, SocialFriendMutationOutcome, SocialFriendRequestAcceptInput,
    SocialFriendRequestCancelInput, SocialFriendRequestNotificationAcceptOutput,
    SocialFriendRequestNotificationAcceptStatus, SocialMutationDeps,
};
use crate::scope_gate::ScopeGate;
use vrcx_0_core::OwnerId;

const GATE: ScopeGate = ScopeGate::new("Backend social mutation");

const SOCIAL_REMOTE_MUTATION_INTERVAL: Duration = Duration::from_millis(250);

pub async fn unfriend(
    deps: SocialMutationDeps<'_>,
    input: SocialFriendMutationInput,
) -> Result<SocialFriendMutationOutcome> {
    let target_user_id = normalize_text(&input.target_user_id);
    require_target(&target_user_id)?;
    let auth_scope = GATE.require_active(deps.auth_scope)?;

    unfriend_with_expected_scope(
        &deps,
        &auth_scope,
        &target_user_id,
        &input.target_display_name,
    )
    .await
}

pub(super) async fn unfriend_with_expected_scope(
    deps: &SocialMutationDeps<'_>,
    auth_scope: &RuntimeAuthScopeSnapshot,
    target_user_id: &str,
    target_display_name: &str,
) -> Result<SocialFriendMutationOutcome> {
    GATE.ensure_matches(deps.auth_scope, auth_scope)?;
    let request = vrcx_0_vrchat_protocol::friends::friend_delete_input(
        auth_scope.endpoint.clone(),
        target_user_id.to_string(),
    )?
    .1;
    execute_vrchat_json_request(deps, auth_scope, request).await?;
    if let Err(error) = GATE.ensure_matches(deps.auth_scope, auth_scope) {
        return Ok(SocialFriendMutationOutcome::remote_ok_local_failed(
            target_user_id,
            error,
        ));
    }
    Ok(apply_unfriend_locally(
        deps,
        &OwnerId::new(auth_scope.current_user_id.clone()),
        &auth_scope.endpoint,
        target_user_id,
        target_display_name,
    ))
}

pub async fn send_friend_request(
    deps: SocialMutationDeps<'_>,
    input: SocialFriendMutationInput,
) -> Result<SocialFriendMutationOutcome> {
    let target_user_id = normalize_text(&input.target_user_id);
    require_target(&target_user_id)?;
    let auth_scope = GATE.require_active(deps.auth_scope)?;

    let request = vrcx_0_vrchat_protocol::friends::friend_request_send_input(
        auth_scope.endpoint.clone(),
        target_user_id.clone(),
    )?
    .1;
    execute_vrchat_json_request(&deps, &auth_scope, request).await?;
    if let Err(error) = GATE.ensure_matches(deps.auth_scope, &auth_scope) {
        return Ok(SocialFriendMutationOutcome::remote_ok_local_failed(
            &target_user_id,
            error,
        ));
    }

    Ok(write_friend_request_history(
        &deps,
        &OwnerId::new(auth_scope.current_user_id),
        &target_user_id,
        &input.target_display_name,
        "FriendRequest",
    ))
}

pub async fn cancel_friend_request(
    deps: SocialMutationDeps<'_>,
    input: SocialFriendRequestCancelInput,
) -> Result<SocialFriendMutationOutcome> {
    let target_user_id = normalize_text(&input.target_user_id);
    require_target(&target_user_id)?;
    let auth_scope = GATE.require_active(deps.auth_scope)?;

    let request = vrcx_0_vrchat_protocol::friends::friend_request_cancel_input(
        auth_scope.endpoint.clone(),
        target_user_id.clone(),
        normalize_text(&input.notification_id),
    )?
    .1;
    execute_vrchat_json_request(&deps, &auth_scope, request).await?;
    if let Err(error) = GATE.ensure_matches(deps.auth_scope, &auth_scope) {
        return Ok(SocialFriendMutationOutcome::remote_ok_local_failed(
            &target_user_id,
            error,
        ));
    }

    Ok(write_friend_request_history(
        &deps,
        &OwnerId::new(auth_scope.current_user_id),
        &target_user_id,
        &input.target_display_name,
        "CancelFriendRequest",
    ))
}

pub async fn accept_friend_request(
    deps: SocialMutationDeps<'_>,
    input: SocialFriendRequestAcceptInput,
) -> Result<SocialFriendMutationOutcome> {
    let auth_scope = GATE.require_active(deps.auth_scope)?;
    accept_friend_request_with_expected_scope(&deps, &auth_scope, input).await
}

async fn accept_friend_request_with_expected_scope(
    deps: &SocialMutationDeps<'_>,
    auth_scope: &RuntimeAuthScopeSnapshot,
    input: SocialFriendRequestAcceptInput,
) -> Result<SocialFriendMutationOutcome> {
    let target_user_id = normalize_text(&input.target_user_id);
    let notification_id = normalize_text(&input.notification_id);
    require_target(&target_user_id)?;
    if notification_id.is_empty() {
        return Err(Error::Custom(
            "SocialFriendRequestAccept requires notificationId.".into(),
        ));
    }
    GATE.ensure_matches(deps.auth_scope, auth_scope)?;

    let request = vrcx_0_vrchat_protocol::notifications::notification_accept_friend_request_input(
        auth_scope.endpoint.clone(),
        notification_id,
    )?
    .1;
    execute_vrchat_json_request(deps, auth_scope, request).await?;
    if let Err(error) = GATE.ensure_matches(deps.auth_scope, auth_scope) {
        return Ok(SocialFriendMutationOutcome::remote_ok_local_failed(
            &target_user_id,
            error,
        ));
    }

    let profile = resolve_target_profile(
        deps,
        auth_scope,
        &target_user_id,
        &input.target_display_name,
    )
    .await;
    if let Err(error) = GATE.ensure_matches(deps.auth_scope, auth_scope) {
        return Ok(SocialFriendMutationOutcome::remote_ok_local_failed(
            &target_user_id,
            error,
        ));
    }
    Ok(apply_friend_request_accept_locally(
        deps,
        &OwnerId::new(auth_scope.current_user_id.clone()),
        &auth_scope.endpoint,
        &target_user_id,
        &input.target_display_name,
        profile,
    ))
}

pub async fn accept_friend_request_notification(
    deps: SocialMutationDeps<'_>,
    input: SocialFriendRequestAcceptInput,
) -> Result<SocialFriendRequestNotificationAcceptOutput> {
    let auth_scope = GATE.require_active(deps.auth_scope)?;
    let notification_id = normalize_text(&input.notification_id);
    let outcome = match accept_friend_request_with_expected_scope(&deps, &auth_scope, input).await {
        Ok(outcome) => Some(outcome),
        Err(error) if is_not_found_error(&error) => None,
        Err(error) => return Err(error),
    };
    GATE.ensure_matches(deps.auth_scope, &auth_scope)?;
    deps.store
        .expire_notification(&auth_scope.current_user_id, &notification_id)?;
    Ok(SocialFriendRequestNotificationAcceptOutput {
        status: if outcome.is_some() {
            SocialFriendRequestNotificationAcceptStatus::Accepted
        } else {
            SocialFriendRequestNotificationAcceptStatus::NotFound
        },
        outcome,
    })
}

fn is_not_found_error(error: &Error) -> bool {
    matches!(
        error,
        Error::VrchatApi {
            status_code: 404,
            ..
        }
    )
}

pub(in crate::social) fn apply_unfriend_locally(
    deps: &SocialMutationDeps<'_>,
    owner_user_id: &OwnerId,
    endpoint: &str,
    target_user_id: &str,
    target_display_name: &str,
) -> SocialFriendMutationOutcome {
    match deps.realtime.apply_synthetic_friend_delete(
        owner_user_id,
        endpoint,
        target_user_id,
        now_iso(),
    ) {
        SyntheticFriendEventOutcome::Applied => {
            SocialFriendMutationOutcome::applied(target_user_id)
        }
        SyntheticFriendEventOutcome::PersistFailed => {
            SocialFriendMutationOutcome::remote_ok_local_failed(
                target_user_id,
                "Realtime friend persistence failed.",
            )
        }
        SyntheticFriendEventOutcome::MissingBaseline
        | SyntheticFriendEventOutcome::TransportInactive
        | SyntheticFriendEventOutcome::Ignored => fallback_unfriend(
            deps,
            owner_user_id,
            endpoint,
            target_user_id,
            target_display_name,
        ),
    }
}

fn fallback_unfriend(
    deps: &SocialMutationDeps<'_>,
    owner_user_id: &OwnerId,
    endpoint: &str,
    target_user_id: &str,
    target_display_name: &str,
) -> SocialFriendMutationOutcome {
    let history_entry = history_entry("Unfriend", target_user_id, target_display_name);
    let result = deps.realtime.run_scoped_friend_log_removal(
        owner_user_id,
        endpoint,
        target_user_id,
        || {
            deps.store.delete_current_friend(
                owner_user_id.as_str(),
                vec![target_user_id.to_string()],
                FriendLogDeleteOptionsInput {
                    history_entries: vec![history_entry],
                },
            )
        },
    );
    match result {
        Ok(_) => SocialFriendMutationOutcome::applied(target_user_id),
        Err(error) => SocialFriendMutationOutcome::remote_ok_local_failed(target_user_id, error),
    }
}

pub(in crate::social) fn apply_friend_request_accept_locally(
    deps: &SocialMutationDeps<'_>,
    owner_user_id: &OwnerId,
    endpoint: &str,
    target_user_id: &str,
    target_display_name: &str,
    profile: Value,
) -> SocialFriendMutationOutcome {
    match deps.realtime.apply_synthetic_trusted_friend_add(
        owner_user_id,
        endpoint,
        target_user_id,
        profile.clone(),
        now_iso(),
    ) {
        SyntheticFriendEventOutcome::Applied => {
            SocialFriendMutationOutcome::applied(target_user_id)
        }
        SyntheticFriendEventOutcome::PersistFailed => {
            SocialFriendMutationOutcome::remote_ok_local_failed(
                target_user_id,
                "Realtime friend persistence failed.",
            )
        }
        SyntheticFriendEventOutcome::MissingBaseline
        | SyntheticFriendEventOutcome::TransportInactive
        | SyntheticFriendEventOutcome::Ignored => fallback_accept(
            deps,
            owner_user_id,
            endpoint,
            target_user_id,
            target_display_name,
            &profile,
        ),
    }
}

fn fallback_accept(
    deps: &SocialMutationDeps<'_>,
    owner_user_id: &OwnerId,
    endpoint: &str,
    target_user_id: &str,
    target_display_name: &str,
    profile: &Value,
) -> SocialFriendMutationOutcome {
    let display_name = display_name_or_fallback(target_display_name, target_user_id);
    let mut entry =
        serde_json::from_value::<vrcx_0_core::friends::FriendBaselineEntry>(profile.clone())
            .unwrap_or_default();
    if entry.record.display_name.trim().is_empty() {
        entry.record.display_name = display_name.clone().into();
    }
    let entry = entry.normalized(target_user_id).unwrap_or_else(|| {
        vrcx_0_core::friends::FriendBaselineEntry {
            record: vrcx_0_core::friends::FriendRecord {
                id: target_user_id.to_string(),
                display_name: display_name.clone().into(),
                ..vrcx_0_core::friends::FriendRecord::default()
            },
            ..vrcx_0_core::friends::FriendBaselineEntry::default()
        }
    });
    let history_entry = history_entry("Friend", target_user_id, target_display_name);
    let result = deps
        .realtime
        .run_scoped_friend_log_upsert(owner_user_id, endpoint, entry, || {
            deps.store.upsert_current_friend(
                owner_user_id.as_str(),
                FriendLogCurrentEntryInput {
                    user_id: target_user_id.to_string(),
                    display_name,
                    trust_level: None,
                    friend_number: Value::Null,
                },
                FriendLogUpsertOptionsInput {
                    history_entry: Some(history_entry),
                    force_history: false,
                },
            )
        });
    match result {
        Ok(_) => SocialFriendMutationOutcome::applied(target_user_id),
        Err(error) => SocialFriendMutationOutcome::remote_ok_local_failed(target_user_id, error),
    }
}

fn write_friend_request_history(
    deps: &SocialMutationDeps<'_>,
    owner_user_id: &OwnerId,
    target_user_id: &str,
    target_display_name: &str,
    history_type: &str,
) -> SocialFriendMutationOutcome {
    let entry = history_entry(history_type, target_user_id, target_display_name);
    match deps
        .store
        .add_friend_history(owner_user_id.as_str(), vec![entry])
    {
        Ok(_) => SocialFriendMutationOutcome::applied(target_user_id),
        Err(error) => SocialFriendMutationOutcome::remote_ok_local_failed(target_user_id, error),
    }
}

fn history_entry(
    history_type: &str,
    target_user_id: &str,
    target_display_name: &str,
) -> FriendLogHistoryEntryInput {
    FriendLogHistoryEntryInput {
        row_id: Value::Null,
        created_at: now_iso(),
        r#type: history_type.to_string(),
        user_id: target_user_id.to_string(),
        display_name: display_name_or_fallback(target_display_name, target_user_id),
        previous_display_name: String::new(),
        trust_level: String::new(),
        previous_trust_level: String::new(),
        friend_number: Value::Null,
    }
}

async fn resolve_target_profile(
    deps: &SocialMutationDeps<'_>,
    auth_scope: &RuntimeAuthScopeSnapshot,
    target_user_id: &str,
    target_display_name: &str,
) -> Value {
    let placeholder = || {
        json!({
            "id": target_user_id,
            "displayName": display_name_or_fallback(target_display_name, target_user_id),
        })
    };
    let Ok(response) = deps
        .realtime
        .get_user_via_cache_with_options(
            auth_scope.endpoint.clone(),
            target_user_id.to_string(),
            UserQueryOptions {
                kind: UserQueryKind::LiveFriend,
                cache_policy: UserQueryCachePolicy::Refresh,
            },
        )
        .await
    else {
        return placeholder();
    };
    if !(200..300).contains(&response.status) {
        let response = VrchatJsonResponse::from(&response);
        let message = response
            .error_message()
            .unwrap_or_else(|| "VRChat social mutation request failed".to_string());
        emit_current_scope_auth_failure(
            deps,
            auth_scope,
            &format!("users/{target_user_id}"),
            &message,
            response.status,
        );
        return placeholder();
    }
    match serde_json::from_str::<Value>(&response.data) {
        Ok(value) if value.get("id").and_then(Value::as_str) == Some(target_user_id) => value,
        _ => placeholder(),
    }
}

fn display_name_or_fallback(target_display_name: &str, target_user_id: &str) -> String {
    let trimmed = target_display_name.trim();
    if trimmed.is_empty() {
        target_user_id.to_string()
    } else {
        trimmed.to_string()
    }
}

fn require_target(target_user_id: &str) -> Result<()> {
    if target_user_id.is_empty() {
        return Err(Error::Custom(
            "Social friend mutation requires targetUserId.".into(),
        ));
    }
    Ok(())
}

async fn execute_vrchat_json_request(
    deps: &SocialMutationDeps<'_>,
    auth_scope: &RuntimeAuthScopeSnapshot,
    mut request: VrchatRequest,
) -> Result<Value> {
    let path = request
        .path
        .as_deref()
        .or(request.url.as_deref())
        .unwrap_or("runtime/social-mutation")
        .trim()
        .to_string();
    GATE.ensure_matches(deps.auth_scope, auth_scope)?;
    deps.remote_mutations
        .wait(auth_scope, SOCIAL_REMOTE_MUTATION_INTERVAL)
        .await;
    GATE.ensure_matches(deps.auth_scope, auth_scope)?;
    if request.url.is_none() {
        request.endpoint = Some(auth_scope.endpoint.clone());
    }
    let response = deps.remote.send(request, VrchatScope::Vrchat).await?;
    match validate_vrchat_mutation_response(response.status, &response.data) {
        Ok(payload) => Ok(payload),
        Err(error) => {
            if let Error::VrchatApi {
                status_code,
                message,
            } = &error
            {
                emit_current_scope_auth_failure(deps, auth_scope, &path, message, *status_code);
            }
            Err(error)
        }
    }
}

fn validate_vrchat_mutation_response(status: i32, data: &str) -> Result<Value> {
    let trimmed = data.trim();
    let payload = if trimmed.is_empty() {
        Value::Null
    } else {
        match serde_json::from_str::<Value>(trimmed) {
            Ok(payload) => payload,
            Err(error) if (200..300).contains(&status) => {
                return Err(Error::Custom(format!(
                    "VRChat social mutation returned invalid JSON: {error}"
                )));
            }
            Err(_) => Value::String(data.to_string()),
        }
    };
    let response = VrchatJsonResponse {
        status,
        json: payload,
    };
    if !(200..300).contains(&status) || response.has_error_field() {
        return Err(response
            .to_failure("VRChat social mutation request failed")
            .into());
    }
    Ok(response.json)
}

fn emit_current_scope_auth_failure(
    deps: &SocialMutationDeps<'_>,
    expected_scope: &RuntimeAuthScopeSnapshot,
    path: &str,
    reason: &str,
    status_code: i32,
) {
    if status_code != 401 {
        return;
    }
    let scope = deps.auth_scope.snapshot();
    if !scope.active
        || scope.current_user_id != expected_scope.current_user_id
        || scope.endpoint != expected_scope.endpoint
        || scope.generation != expected_scope.generation
    {
        return;
    }
    deps.realtime
        .report_vrchat_auth_failure(RuntimeVrchatAuthFailurePayload {
            owner_user_id: OwnerId::new(scope.current_user_id),
            endpoint: scope.endpoint,
            path: path.to_string(),
            reason: reason.to_string(),
            status_code,
            auth_scope_generation: scope.generation,
            realtime_transport: None,
        });
}

#[cfg(test)]
mod tests;
