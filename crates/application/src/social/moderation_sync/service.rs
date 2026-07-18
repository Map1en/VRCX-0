use chrono::{SecondsFormat, Utc};
use serde_json::Value;
use vrcx_0_persistence::local_moderation::{
    self, LocalModerationInput, LocalModerationOutput, RemoteModerationInput,
};
use vrcx_0_vrchat_client::http_api::{
    normalize_vrchat_api_endpoint, ApiScope, HttpApiRequestInput,
};
use vrcx_0_vrchat_client::moderation::{
    player_moderation_update_input, player_moderations_get_input,
};

use super::types::{
    ModerationSyncDeps, ModerationSyncMutationInput, ModerationSyncMutationOutput,
    ModerationSyncRefreshInput, ModerationSyncRefreshOutput, RemoteModerationRow,
};
use crate::{Error, Result};

pub async fn refresh_player_moderations(
    deps: ModerationSyncDeps<'_>,
    input: ModerationSyncRefreshInput,
) -> Result<ModerationSyncRefreshOutput> {
    let user_id = normalize_text(input.user_id);
    if user_id.is_empty() {
        return Ok(ModerationSyncRefreshOutput {
            accepted: false,
            user_id,
            remote_count: 0,
            local_count: 0,
            rows: Vec::new(),
        });
    }

    let (remote_count, rows) = fetch_remote_moderations(&deps, &input.endpoint).await?;
    let accepted = should_write_refresh_snapshot(&deps, &user_id, &input.endpoint, &rows);
    let local_count = if accepted {
        let local_inputs: Vec<RemoteModerationInput> = rows
            .iter()
            .map(RemoteModerationRow::to_local_input)
            .collect();
        local_moderation::local_moderation_sync_snapshot(deps.db, user_id.clone(), local_inputs)?
            .len()
    } else {
        0
    };

    Ok(ModerationSyncRefreshOutput {
        accepted,
        user_id,
        remote_count,
        local_count,
        rows,
    })
}

pub async fn update_player_moderation(
    deps: ModerationSyncDeps<'_>,
    input: ModerationSyncMutationInput,
) -> Result<ModerationSyncMutationOutput> {
    let owner_user_id = normalize_text(input.owner_user_id);
    let target_user_id = normalize_text(input.target_user_id);
    let target_display_name = input.target_display_name.clone();
    let r#type = normalize_text(input.r#type);
    if owner_user_id.is_empty() || target_user_id.is_empty() || r#type.is_empty() {
        return Err(Error::Custom(
            "ModerationSyncUpdate requires ownerUserId, targetUserId and type.".into(),
        ));
    }
    ensure_current_auth_scope(&deps, &owner_user_id, &input.endpoint)?;

    execute_vrchat_json_request(
        &deps,
        player_moderation_update_input(
            normalize_endpoint(&input.endpoint),
            input.enabled,
            target_user_id.clone(),
            r#type.clone(),
        ),
    )
    .await?;

    let local = if is_local_player_moderation_type(&r#type) {
        let existing = local_moderation::local_moderation_get(
            deps.db,
            owner_user_id.clone(),
            target_user_id.clone(),
        )?;
        let (block, mute) =
            resolve_local_moderation_state(existing.as_ref(), &r#type, input.enabled);
        let updated_at = now_iso();
        if block || mute {
            local_moderation::local_moderation_set(
                deps.db,
                owner_user_id,
                LocalModerationInput {
                    user_id: target_user_id.clone(),
                    updated_at: updated_at.clone(),
                    display_name: target_display_name.clone(),
                    block,
                    mute,
                },
            )?;
            Some(LocalModerationOutput {
                user_id: target_user_id.clone(),
                updated_at,
                display_name: target_display_name.clone(),
                block,
                mute,
            })
        } else {
            local_moderation::local_moderation_delete(
                deps.db,
                owner_user_id,
                target_user_id.clone(),
            )?;
            Some(LocalModerationOutput {
                user_id: target_user_id.clone(),
                updated_at,
                display_name: target_display_name.clone(),
                block: false,
                mute: false,
            })
        }
    } else {
        None
    };

    Ok(ModerationSyncMutationOutput {
        target_user_id,
        r#type,
        enabled: input.enabled,
        local,
    })
}

fn normalize_text(value: impl AsRef<str>) -> String {
    value.as_ref().trim().to_string()
}

fn normalize_scope_endpoint(value: &str) -> String {
    normalize_endpoint(value)
}

fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn value_as_normalized_text(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(value)) => normalize_text(value),
        Some(Value::Null) | None => String::new(),
        Some(value) => normalize_text(value.to_string()),
    }
}

fn value_as_string_or_empty(value: Option<&Value>) -> String {
    value
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn normalize_endpoint(endpoint: &str) -> String {
    normalize_vrchat_api_endpoint(Some(endpoint))
}

async fn execute_vrchat_json_request(
    deps: &ModerationSyncDeps<'_>,
    request: HttpApiRequestInput,
) -> Result<Value> {
    let response = deps
        .web
        .execute_api(request, ApiScope::Vrchat, deps.db)
        .await?;

    let json = parse_response_json(&response.data);
    if response.status >= 400 || response_has_error(&json) {
        return Err(Error::Custom(unwrap_error_message(&json, response.status)));
    }

    Ok(json)
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

    format!("VRChat moderation request failed ({status})")
}

fn normalize_remote_moderation_row(row: &Value) -> Option<RemoteModerationRow> {
    let record = row.as_object()?;
    let id = value_as_normalized_text(record.get("id"));
    let r#type = value_as_normalized_text(record.get("type"));
    let source_user_id = value_as_normalized_text(record.get("sourceUserId"));
    let target_user_id = value_as_normalized_text(record.get("targetUserId"));

    if id.is_empty() || r#type.is_empty() || target_user_id.is_empty() {
        return None;
    }

    Some(RemoteModerationRow {
        id,
        r#type,
        source_user_id,
        source_display_name: value_as_string_or_empty(record.get("sourceDisplayName")),
        target_user_id,
        target_display_name: value_as_string_or_empty(record.get("targetDisplayName")),
        created: value_as_string_or_empty(record.get("created")),
    })
}

fn normalize_remote_moderation_rows(json: &Value) -> Vec<RemoteModerationRow> {
    json.as_array()
        .map(|rows| {
            rows.iter()
                .filter_map(normalize_remote_moderation_row)
                .collect()
        })
        .unwrap_or_default()
}

async fn fetch_remote_moderations(
    deps: &ModerationSyncDeps<'_>,
    endpoint: &str,
) -> Result<(usize, Vec<RemoteModerationRow>)> {
    let json = execute_vrchat_json_request(
        deps,
        player_moderations_get_input(normalize_endpoint(endpoint)),
    )
    .await?;
    let remote_count = json.as_array().map_or(0, Vec::len);
    Ok((remote_count, normalize_remote_moderation_rows(&json)))
}

fn is_local_player_moderation_type(r#type: &str) -> bool {
    r#type == "block" || r#type == "mute"
}

fn rows_have_verified_owner(rows: &[RemoteModerationRow], user_id: &str) -> bool {
    !rows.is_empty()
        && rows
            .iter()
            .all(|row| !row.source_user_id.is_empty() && row.source_user_id == user_id)
}

fn runtime_auth_scope_scope_matches(
    deps: &ModerationSyncDeps<'_>,
    user_id: &str,
    endpoint: &str,
) -> bool {
    let snapshot = deps.session.snapshot();
    let Some(context) = snapshot.realtime_context else {
        return false;
    };

    context.current_user_id == user_id
        && normalize_scope_endpoint(&context.endpoint) == normalize_scope_endpoint(endpoint)
}

fn should_write_refresh_snapshot(
    deps: &ModerationSyncDeps<'_>,
    user_id: &str,
    endpoint: &str,
    rows: &[RemoteModerationRow],
) -> bool {
    let auth_scope = deps.auth_scope.snapshot();
    if auth_scope.active {
        return deps.auth_scope.matches(user_id, endpoint);
    }

    runtime_auth_scope_scope_matches(deps, user_id, endpoint)
        || rows_have_verified_owner(rows, user_id)
}

fn ensure_current_auth_scope(
    deps: &ModerationSyncDeps<'_>,
    user_id: &str,
    endpoint: &str,
) -> Result<()> {
    if deps.auth_scope.matches(user_id, endpoint) {
        return Ok(());
    }

    Err(Error::Custom(
        "Backend moderation request is stale for the current auth scope.".into(),
    ))
}

fn resolve_local_moderation_state(
    existing: Option<&LocalModerationOutput>,
    r#type: &str,
    enabled: bool,
) -> (bool, bool) {
    let block = if r#type == "block" {
        enabled
    } else {
        existing.is_some_and(|entry| entry.block)
    };
    let mute = if r#type == "mute" {
        enabled
    } else {
        existing.is_some_and(|entry| entry.mute)
    };

    (block, mute)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn normalizes_only_complete_remote_moderation_rows() {
        let rows = normalize_remote_moderation_rows(&json!([
            {
                "id": " mod_1 ",
                "type": " block ",
                "targetUserId": " usr_target ",
                "targetDisplayName": "Target",
                "created": "2026-05-16T00:00:00.000Z"
            },
            {
                "id": "mod_2",
                "type": "mute",
                "targetDisplayName": "Missing target"
            },
            {
                "type": "block",
                "targetUserId": "usr_missing_id"
            }
        ]));

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].r#type, "block");
        assert_eq!(rows[0].target_user_id, "usr_target");
        assert_eq!(rows[0].target_display_name, "Target");
        assert_eq!(rows[0].created, "2026-05-16T00:00:00.000Z");
    }

    #[test]
    fn verifies_refresh_owner_from_remote_rows() {
        let rows = vec![RemoteModerationRow {
            id: "mod_1".into(),
            r#type: "block".into(),
            source_user_id: "usr_current".into(),
            source_display_name: String::new(),
            target_user_id: "usr_target".into(),
            target_display_name: String::new(),
            created: String::new(),
        }];

        assert!(rows_have_verified_owner(&rows, "usr_current"));
        assert!(!rows_have_verified_owner(&rows, "usr_other"));
        assert!(!rows_have_verified_owner(&[], "usr_current"));
    }

    #[test]
    fn local_moderation_update_preserves_other_bit_when_not_supplied() {
        let existing = LocalModerationOutput {
            user_id: "usr_target".into(),
            updated_at: String::new(),
            display_name: String::new(),
            block: true,
            mute: true,
        };

        assert_eq!(
            resolve_local_moderation_state(Some(&existing), "block", false),
            (false, true)
        );
        assert_eq!(
            resolve_local_moderation_state(Some(&existing), "mute", false),
            (true, false)
        );
        assert_eq!(
            resolve_local_moderation_state(Some(&existing), "block", true),
            (true, true)
        );
    }
}
