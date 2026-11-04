use std::time::Duration;

use vrcx_0_core::text::normalize_text;

use serde_json::Value;
use vrcx_0_contracts::vrchat_api::{VrchatRequest, VrchatScope};
use vrcx_0_contracts::VrchatJsonResponse;
use vrcx_0_core::time::now_iso;
use vrcx_0_core::vrchat_endpoints::normalize_vrchat_api_endpoint;

use super::types::{
    LocalModerationInput, LocalModerationOutput, ModerationMutationType, ModerationSyncDeps,
    ModerationSyncMutationInput, ModerationSyncMutationOutput, ModerationSyncRefreshInput,
    ModerationSyncRefreshOutput, RemoteModerationInput, RemoteModerationRow,
};
use super::ModerationSyncRuntime;
use vrcx_0_application_core::{AuthenticatedMutationContext, Error, Result};
use vrcx_0_core::OwnerId;

const MODERATION_REMOTE_MUTATION_INTERVAL: Duration = Duration::from_millis(250);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum LocalPlayerModerationKind {
    Block,
    Mute,
}

impl LocalPlayerModerationKind {
    fn from_mutation_type(value: &ModerationMutationType) -> Option<Self> {
        match value {
            ModerationMutationType::Block => Some(Self::Block),
            ModerationMutationType::Mute => Some(Self::Mute),
            _ => None,
        }
    }
}

pub async fn refresh_player_moderations(
    runtime: &ModerationSyncRuntime,
    deps: ModerationSyncDeps<'_>,
    input: ModerationSyncRefreshInput,
) -> Result<ModerationSyncRefreshOutput> {
    refresh_player_moderations_with_policy(runtime, deps, input, false).await
}

pub async fn force_refresh_player_moderations(
    runtime: &ModerationSyncRuntime,
    deps: ModerationSyncDeps<'_>,
    input: ModerationSyncRefreshInput,
) -> Result<ModerationSyncRefreshOutput> {
    refresh_player_moderations_with_policy(runtime, deps, input, true).await
}

async fn refresh_player_moderations_with_policy(
    runtime: &ModerationSyncRuntime,
    deps: ModerationSyncDeps<'_>,
    input: ModerationSyncRefreshInput,
    force: bool,
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
    let endpoint = normalize_endpoint(&input.endpoint);
    let scope = deps.auth_scope.snapshot();
    let key = runtime.cache_key(&scope, &user_id, &endpoint);
    runtime
        .resolve(key, force, move || async move {
            load_player_moderations(deps, user_id, endpoint).await
        })
        .await
}

async fn load_player_moderations(
    deps: ModerationSyncDeps<'_>,
    user_id: String,
    endpoint: String,
) -> Result<ModerationSyncRefreshOutput> {
    let (remote_count, rows) = fetch_remote_moderations(&deps, &endpoint).await?;
    let accepted = should_write_refresh_snapshot(&deps, &user_id, &endpoint);
    let local_count = if accepted {
        let local_inputs: Vec<RemoteModerationInput> = rows
            .iter()
            .map(RemoteModerationRow::to_local_input)
            .collect();
        deps.store
            .sync_snapshot(OwnerId::new(user_id.clone()), local_inputs)?
            .len()
    } else {
        0
    };

    Ok(ModerationSyncRefreshOutput {
        accepted,
        user_id,
        remote_count: crate::wire_count(remote_count),
        local_count: crate::wire_count(local_count),
        rows,
    })
}

pub async fn update_player_moderation(
    runtime: &ModerationSyncRuntime,
    deps: ModerationSyncDeps<'_>,
    input: ModerationSyncMutationInput,
) -> Result<ModerationSyncMutationOutput> {
    let target_user_id = normalize_text(input.target_user_id);
    let target_display_name = input.target_display_name.clone();
    let moderation_type = input.r#type;
    let r#type = moderation_type.as_str().to_string();
    if target_user_id.is_empty() || r#type.is_empty() {
        return Err(Error::Custom(
            "ModerationSyncUpdate requires targetUserId and type.".into(),
        ));
    }
    if input.enabled && !moderation_type.is_supported_enable() {
        return Err(Error::Custom(
            "ModerationSyncUpdate does not support enabling this moderation type.".into(),
        ));
    }
    let mutation = AuthenticatedMutationContext::capture(
        deps.auth_scope,
        deps.remote_mutations,
        "Moderation mutation",
    )?;
    let owner_user_id = mutation.scope().current_user_id.clone();

    execute_vrchat_mutation(
        &deps,
        &mutation,
        vrcx_0_vrchat_protocol::moderation::player_moderation_update_input(
            mutation.scope().endpoint.clone(),
            input.enabled,
            target_user_id.clone(),
            r#type.clone(),
        ),
    )
    .await?;
    runtime.invalidate();

    let local = if let Some(kind) = LocalPlayerModerationKind::from_mutation_type(&moderation_type)
    {
        let existing = deps
            .store
            .get(OwnerId::new(owner_user_id.clone()), target_user_id.clone())?;
        let (block, mute) = resolve_local_moderation_state(existing.as_ref(), kind, input.enabled);
        let updated_at = now_iso();
        if block || mute {
            deps.store.set(
                OwnerId::new(owner_user_id.clone()),
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
            deps.store
                .delete(OwnerId::new(owner_user_id.clone()), target_user_id.clone())?;
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
        owner_user_id: OwnerId::new(owner_user_id),
        target_user_id,
        r#type,
        enabled: input.enabled,
        local,
    })
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
    request: VrchatRequest,
) -> Result<Value> {
    let response = deps.remote.send(request, VrchatScope::Vrchat).await?;

    let response = VrchatJsonResponse::from(&response);
    if let Some(failure) = response.failure_or("VRChat moderation request failed") {
        return Err(failure.into());
    }

    Ok(response.json)
}

async fn execute_vrchat_mutation(
    deps: &ModerationSyncDeps<'_>,
    mutation: &AuthenticatedMutationContext<'_>,
    mut request: VrchatRequest,
) -> Result<Value> {
    mutation.apply_scope_to_request(&mut request);
    let response = mutation
        .run_after_wait(MODERATION_REMOTE_MUTATION_INTERVAL, || async {
            deps.remote.send(request, VrchatScope::Vrchat).await
        })
        .await?;

    let response = VrchatJsonResponse::from(&response);
    if let Some(failure) = response.failure_or("VRChat moderation request failed") {
        return Err(failure.into());
    }

    Ok(response.json)
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
        vrcx_0_vrchat_protocol::moderation::player_moderations_get_input(normalize_endpoint(
            endpoint,
        )),
    )
    .await?;
    let remote_count = json.as_array().map_or(0, Vec::len);
    Ok((remote_count, normalize_remote_moderation_rows(&json)))
}

fn should_write_refresh_snapshot(
    deps: &ModerationSyncDeps<'_>,
    user_id: &str,
    endpoint: &str,
) -> bool {
    deps.auth_scope.matches(user_id, endpoint)
}

fn resolve_local_moderation_state(
    existing: Option<&LocalModerationOutput>,
    r#type: LocalPlayerModerationKind,
    enabled: bool,
) -> (bool, bool) {
    match r#type {
        LocalPlayerModerationKind::Block => (enabled, existing.is_some_and(|entry| entry.mute)),
        LocalPlayerModerationKind::Mute => (existing.is_some_and(|entry| entry.block), enabled),
    }
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
    fn local_moderation_update_preserves_other_bit_when_not_supplied() {
        let existing = LocalModerationOutput {
            user_id: "usr_target".into(),
            updated_at: String::new(),
            display_name: String::new(),
            block: true,
            mute: true,
        };

        assert_eq!(
            resolve_local_moderation_state(
                Some(&existing),
                LocalPlayerModerationKind::Block,
                false,
            ),
            (false, true)
        );
        assert_eq!(
            resolve_local_moderation_state(Some(&existing), LocalPlayerModerationKind::Mute, false,),
            (true, false)
        );
        assert_eq!(
            resolve_local_moderation_state(Some(&existing), LocalPlayerModerationKind::Block, true,),
            (true, true)
        );
    }

    #[test]
    fn moderation_mutation_types_close_enables_but_preserve_unknown_deletes() {
        let known = ModerationMutationType::from("interactOff".to_string());
        assert!(known.is_supported_enable());
        assert_eq!(known.as_str(), "interactOff");

        let unknown = ModerationMutationType::from("futureModeration".to_string());
        assert!(!unknown.is_supported_enable());
        assert_eq!(unknown.as_str(), "futureModeration");
    }
}
