use chrono::{SecondsFormat, Utc};
use serde_json::{json, Value};

use vrcx_0_persistence::friends::{
    friend_log_delete_current_array, friend_log_history_add, friend_log_upsert_current,
    FriendLogCurrentEntryInput, FriendLogDeleteOptionsInput, FriendLogHistoryEntryInput,
    FriendLogUpsertOptionsInput,
};
use vrcx_0_vrchat_client::friends::{
    friend_delete_input, friend_request_cancel_input, friend_request_send_input,
};
use vrcx_0_vrchat_client::http_api::{
    normalize_vrchat_api_endpoint, ApiScope, HttpApiRequestInput,
};
use vrcx_0_vrchat_client::notifications::notification_accept_friend_request_input;

use crate::event_bus::RuntimeVrchatAuthFailurePayload;
use crate::realtime::SyntheticFriendEventOutcome;
use crate::{Error, Result, RuntimeAuthScopeSnapshot};

use super::types::{
    SocialFriendMutationInput, SocialFriendMutationOutcome, SocialFriendRequestAcceptInput,
    SocialFriendRequestCancelInput, SocialMutationDeps,
};

pub async fn unfriend(
    deps: SocialMutationDeps<'_>,
    input: SocialFriendMutationInput,
) -> Result<SocialFriendMutationOutcome> {
    let owner_user_id = normalize_text(&input.owner_user_id);
    let target_user_id = normalize_text(&input.target_user_id);
    let endpoint = normalize_endpoint(&input.endpoint);
    require_participants(&owner_user_id, &target_user_id)?;
    let auth_scope = ensure_current_auth_scope(&deps, &owner_user_id, &endpoint)?;

    let (_, request) = friend_delete_input(endpoint.clone(), target_user_id.clone())?;
    execute_vrchat_json_request(&deps, &auth_scope, request).await?;

    Ok(apply_unfriend_locally(
        &deps,
        &owner_user_id,
        &endpoint,
        &target_user_id,
        &input.target_display_name,
    ))
}

pub async fn send_friend_request(
    deps: SocialMutationDeps<'_>,
    input: SocialFriendMutationInput,
) -> Result<SocialFriendMutationOutcome> {
    let owner_user_id = normalize_text(&input.owner_user_id);
    let target_user_id = normalize_text(&input.target_user_id);
    let endpoint = normalize_endpoint(&input.endpoint);
    require_participants(&owner_user_id, &target_user_id)?;
    let auth_scope = ensure_current_auth_scope(&deps, &owner_user_id, &endpoint)?;

    let (_, request) = friend_request_send_input(endpoint.clone(), target_user_id.clone())?;
    execute_vrchat_json_request(&deps, &auth_scope, request).await?;

    Ok(write_friend_request_history(
        &deps,
        &owner_user_id,
        &target_user_id,
        &input.target_display_name,
        "FriendRequest",
    ))
}

pub async fn cancel_friend_request(
    deps: SocialMutationDeps<'_>,
    input: SocialFriendRequestCancelInput,
) -> Result<SocialFriendMutationOutcome> {
    let owner_user_id = normalize_text(&input.owner_user_id);
    let target_user_id = normalize_text(&input.target_user_id);
    let endpoint = normalize_endpoint(&input.endpoint);
    require_participants(&owner_user_id, &target_user_id)?;
    let auth_scope = ensure_current_auth_scope(&deps, &owner_user_id, &endpoint)?;

    let (_, request) = friend_request_cancel_input(
        endpoint.clone(),
        target_user_id.clone(),
        normalize_text(&input.notification_id),
    )?;
    execute_vrchat_json_request(&deps, &auth_scope, request).await?;

    Ok(write_friend_request_history(
        &deps,
        &owner_user_id,
        &target_user_id,
        &input.target_display_name,
        "CancelFriendRequest",
    ))
}

pub async fn accept_friend_request(
    deps: SocialMutationDeps<'_>,
    input: SocialFriendRequestAcceptInput,
) -> Result<SocialFriendMutationOutcome> {
    let owner_user_id = normalize_text(&input.owner_user_id);
    let target_user_id = normalize_text(&input.target_user_id);
    let notification_id = normalize_text(&input.notification_id);
    let endpoint = normalize_endpoint(&input.endpoint);
    require_participants(&owner_user_id, &target_user_id)?;
    if notification_id.is_empty() {
        return Err(Error::Custom(
            "SocialFriendRequestAccept requires notificationId.".into(),
        ));
    }
    let auth_scope = ensure_current_auth_scope(&deps, &owner_user_id, &endpoint)?;

    let (_, request) = notification_accept_friend_request_input(endpoint.clone(), notification_id)?;
    execute_vrchat_json_request(&deps, &auth_scope, request).await?;

    let profile = resolve_target_profile(
        &deps,
        &auth_scope,
        &target_user_id,
        &input.target_display_name,
    )
    .await;
    Ok(apply_friend_request_accept_locally(
        &deps,
        &owner_user_id,
        &endpoint,
        &target_user_id,
        &input.target_display_name,
        profile,
    ))
}

pub(crate) fn apply_unfriend_locally(
    deps: &SocialMutationDeps<'_>,
    owner_user_id: &str,
    endpoint: &str,
    target_user_id: &str,
    target_display_name: &str,
) -> SocialFriendMutationOutcome {
    let content = json!({ "userId": target_user_id });
    match deps.realtime.apply_synthetic_friend_event(
        owner_user_id,
        endpoint,
        "friend-delete",
        content,
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
        SyntheticFriendEventOutcome::MissingBaseline | SyntheticFriendEventOutcome::Ignored => {
            fallback_unfriend(
                deps,
                owner_user_id,
                endpoint,
                target_user_id,
                target_display_name,
            )
        }
    }
}

fn fallback_unfriend(
    deps: &SocialMutationDeps<'_>,
    owner_user_id: &str,
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
            friend_log_delete_current_array(
                deps.db,
                owner_user_id.to_string(),
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

pub(crate) fn apply_friend_request_accept_locally(
    deps: &SocialMutationDeps<'_>,
    owner_user_id: &str,
    endpoint: &str,
    target_user_id: &str,
    target_display_name: &str,
    profile: Value,
) -> SocialFriendMutationOutcome {
    let content = json!({ "userId": target_user_id, "user": profile.clone() });
    match deps.realtime.apply_synthetic_trusted_friend_add(
        owner_user_id,
        endpoint,
        content,
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
        SyntheticFriendEventOutcome::MissingBaseline | SyntheticFriendEventOutcome::Ignored => {
            fallback_accept(
                deps,
                owner_user_id,
                endpoint,
                target_user_id,
                target_display_name,
                &profile,
            )
        }
    }
}

fn fallback_accept(
    deps: &SocialMutationDeps<'_>,
    owner_user_id: &str,
    endpoint: &str,
    target_user_id: &str,
    target_display_name: &str,
    profile: &Value,
) -> SocialFriendMutationOutcome {
    let display_name = display_name_or_fallback(target_display_name, target_user_id);
    let mut record = serde_json::from_value::<vrcx_0_core::friends::FriendRecord>(profile.clone())
        .unwrap_or_default();
    if record.display_name.trim().is_empty() {
        record.display_name = display_name.clone();
    }
    let record =
        record
            .normalized(target_user_id)
            .unwrap_or_else(|| vrcx_0_core::friends::FriendRecord {
                id: target_user_id.to_string(),
                display_name: display_name.clone(),
                state: "offline".to_string(),
                state_bucket: "offline".to_string(),
                ..vrcx_0_core::friends::FriendRecord::default()
            });
    let history_entry = history_entry("Friend", target_user_id, target_display_name);
    let result =
        deps.realtime
            .run_scoped_friend_log_upsert(owner_user_id, endpoint, record, || {
                friend_log_upsert_current(
                    deps.db,
                    owner_user_id.to_string(),
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

pub(crate) fn write_friend_request_history(
    deps: &SocialMutationDeps<'_>,
    owner_user_id: &str,
    target_user_id: &str,
    target_display_name: &str,
    history_type: &str,
) -> SocialFriendMutationOutcome {
    let entry = history_entry(history_type, target_user_id, target_display_name);
    match friend_log_history_add(deps.db, owner_user_id.to_string(), vec![entry]) {
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
        .get_user_via_cache(
            auth_scope.endpoint.clone(),
            target_user_id.to_string(),
            false,
            false,
            Some(true),
        )
        .await
    else {
        return placeholder();
    };
    if !(200..300).contains(&response.status) {
        let json = parse_response_json(&response.data);
        let message = error_message_with_status_suffix(
            unwrap_error_message(&json, response.status),
            response.status,
        );
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

fn require_participants(owner_user_id: &str, target_user_id: &str) -> Result<()> {
    if owner_user_id.is_empty() || target_user_id.is_empty() {
        return Err(Error::Custom(
            "Social friend mutation requires ownerUserId and targetUserId.".into(),
        ));
    }
    Ok(())
}

fn ensure_current_auth_scope(
    deps: &SocialMutationDeps<'_>,
    user_id: &str,
    endpoint: &str,
) -> Result<RuntimeAuthScopeSnapshot> {
    let scope = deps.auth_scope.snapshot();
    if scope.active
        && scope.current_user_id == user_id.trim()
        && scope.endpoint == normalize_endpoint(endpoint)
    {
        return Ok(scope);
    }
    Err(Error::Custom(
        "Backend social mutation request is stale for the current auth scope.".into(),
    ))
}

fn normalize_text(value: &str) -> String {
    value.trim().to_string()
}

fn normalize_endpoint(value: &str) -> String {
    normalize_vrchat_api_endpoint(Some(value))
}

fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn value_message(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|message| !message.is_empty())
        .map(|message| message.trim_matches('"').to_string())
}

fn unwrap_error_message(json: &Value, status: i32) -> String {
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
    format!("VRChat social mutation request failed ({status})")
}

fn error_message_with_status_suffix(message: String, status: i32) -> String {
    if status < 400 {
        return message;
    }
    let suffix = format!("({status})");
    if message.ends_with(&suffix) {
        message
    } else {
        format!("{message} {suffix}")
    }
}

fn response_has_error(json: &Value) -> bool {
    json.as_object()
        .is_some_and(|object| object.contains_key("error"))
}

fn parse_response_json(data: &str) -> Value {
    serde_json::from_str(data).unwrap_or_else(|_| Value::String(data.to_string()))
}

async fn execute_vrchat_json_request(
    deps: &SocialMutationDeps<'_>,
    auth_scope: &RuntimeAuthScopeSnapshot,
    request: HttpApiRequestInput,
) -> Result<Value> {
    let path = request
        .path
        .as_deref()
        .or(request.url.as_deref())
        .unwrap_or("runtime/social-mutation")
        .trim()
        .to_string();
    let response = deps
        .web
        .execute_api(request, ApiScope::Vrchat, deps.db)
        .await?;
    let json = parse_response_json(&response.data);
    if response.status >= 400 || response_has_error(&json) {
        let message = unwrap_error_message(&json, response.status);
        let message = error_message_with_status_suffix(message, response.status);
        emit_current_scope_auth_failure(deps, auth_scope, &path, &message, response.status);
        return Err(Error::Custom(message));
    }
    Ok(json)
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
        .emit_runtime_vrchat_auth_failure(RuntimeVrchatAuthFailurePayload {
            owner_user_id: scope.current_user_id,
            endpoint: scope.endpoint,
            path: path.to_string(),
            reason: reason.to_string(),
            status_code,
            auth_scope_generation: scope.generation,
        });
}

#[cfg(test)]
mod tests;
