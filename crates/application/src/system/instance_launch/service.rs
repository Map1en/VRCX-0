use std::collections::HashSet;

use serde_json::Value;
use vrcx_0_core::location::{parse_location, ParsedLocation};

use crate::{Error, Result};
use vrcx_0_application_core::vrchat_api::VrchatApiResponse;

use super::types::{
    InstanceActionGates, InstanceActionGatesBatchInput, InstanceActionGatesBatchOutput,
    InstanceLaunchDeps, InstanceLaunchHttpClient, InstanceLaunchInput, InstanceLaunchMode,
    InstanceLaunchOutcome, InstanceLaunchPipe,
};

struct JoinTarget {
    endpoint: String,
    world_id: String,
    instance_id: String,
    location: String,
    mode: InstanceLaunchMode,
    provided_token: String,
    parsed: ParsedLocation,
}

pub async fn join_instance_launch(
    deps: &InstanceLaunchDeps<'_>,
    input: InstanceLaunchInput,
) -> Result<InstanceLaunchOutcome> {
    let Some(target) = normalize_join_target(input) else {
        return Ok(failed("Unable to open this instance in VRChat."));
    };
    let launch_token = resolve_launch_token(deps.api, &target).await;

    match &target.mode {
        InstanceLaunchMode::OpenOnly => open_join_target(deps.launch_pipe, &target, &launch_token),
        InstanceLaunchMode::SelfInviteOnly => {
            self_invite_join_target(deps.api, &target, &launch_token).await
        }
        InstanceLaunchMode::Auto => {
            match open_join_target(deps.launch_pipe, &target, &launch_token)? {
                InstanceLaunchOutcome::Opened => Ok(InstanceLaunchOutcome::Opened),
                InstanceLaunchOutcome::Failed { .. } => {
                    self_invite_join_target(deps.api, &target, &launch_token).await
                }
                InstanceLaunchOutcome::SelfInvited => Ok(InstanceLaunchOutcome::SelfInvited),
            }
        }
    }
}

pub fn evaluate_instance_action_gates(
    input: InstanceActionGatesBatchInput,
) -> InstanceActionGatesBatchOutput {
    let current_user_id = input.current_user_id.trim().to_string();
    let friend_user_ids: HashSet<String> = input
        .friend_user_ids
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect();
    let closed_locations = closed_location_set(input.closed_locations);
    let current_location = input.current_invite_location.trim().to_string();
    let current_parsed = parse_location(&current_location);
    let can_invite_from_current_location = check_can_invite(
        &current_location,
        &current_parsed,
        &current_user_id,
        &current_location,
        &closed_locations,
    );

    InstanceActionGatesBatchOutput {
        targets: input
            .targets
            .into_iter()
            .map(|target| {
                let location = target.location.trim().to_string();
                let parsed = parse_location(&location);
                let is_online = target.state_bucket.trim().eq_ignore_ascii_case("online");
                let is_current_user =
                    target.is_current_user || same_non_empty(&target.user_id, &current_user_id);
                let can_self_invite = check_can_invite_self(
                    &location,
                    &parsed,
                    &current_user_id,
                    &friend_user_ids,
                    &closed_locations,
                );
                let can_open_in_game = input.is_game_running
                    && is_concrete_open_instance(&location, &parsed, &closed_locations);
                InstanceActionGates {
                    key: target.key,
                    can_join: can_self_invite,
                    can_open_in_game,
                    can_self_invite,
                    can_request_invite: is_online && !is_current_user,
                    can_invite: input.is_game_running
                        && !is_current_user
                        && can_invite_from_current_location,
                }
            })
            .collect(),
    }
}

fn normalize_join_target(input: InstanceLaunchInput) -> Option<JoinTarget> {
    let raw_location = input.location.trim().to_string();
    let parsed = parse_location(&raw_location);
    if !parsed.is_real_instance || parsed.world_id.is_empty() || parsed.instance_id.is_empty() {
        return None;
    }
    let provided_token = first_non_empty([input.short_name.as_str(), parsed.short_name.as_str()]);
    Some(JoinTarget {
        endpoint: input.endpoint.trim().to_string(),
        location: format!("{}:{}", parsed.world_id, parsed.instance_id),
        world_id: parsed.world_id.clone(),
        instance_id: parsed.instance_id.clone(),
        mode: input.mode,
        provided_token,
        parsed,
    })
}

async fn resolve_launch_token(api: &dyn InstanceLaunchHttpClient, target: &JoinTarget) -> String {
    if should_use_provided_launch_token(&target.parsed, &target.provided_token) {
        return target.provided_token.clone();
    }

    match api
        .instance_short_name(&target.endpoint, &target.world_id, &target.instance_id)
        .await
    {
        Ok(response) => match require_api_success(response, "VRChat instance request failed") {
            Ok(json) => first_non_empty([
                json.get("shortName").and_then(Value::as_str).unwrap_or(""),
                json.get("secureName").and_then(Value::as_str).unwrap_or(""),
                target.provided_token.as_str(),
            ]),
            Err(_) => target.provided_token.clone(),
        },
        Err(_) => target.provided_token.clone(),
    }
}

fn open_join_target(
    launch_pipe: &dyn InstanceLaunchPipe,
    target: &JoinTarget,
    launch_token: &str,
) -> Result<InstanceLaunchOutcome> {
    let launch_url = build_vrc_launch_url(&target.location, launch_token);
    match launch_pipe.try_open_vrchat_launch_url(&launch_url) {
        Ok(true) => Ok(InstanceLaunchOutcome::Opened),
        Ok(false) => Ok(failed("VRChat launch pipe did not accept the URL.")),
        Err(error) => Ok(failed(error.to_string())),
    }
}

async fn self_invite_join_target(
    api: &dyn InstanceLaunchHttpClient,
    target: &JoinTarget,
    launch_token: &str,
) -> Result<InstanceLaunchOutcome> {
    let short_name = first_non_empty([target.parsed.short_name.as_str(), launch_token]);
    match api
        .self_invite(
            &target.endpoint,
            &target.world_id,
            &target.instance_id,
            &short_name,
        )
        .await
    {
        Ok(response) => match require_api_success(response, "VRChat instance request failed") {
            Ok(_) => Ok(InstanceLaunchOutcome::SelfInvited),
            Err(error) => Ok(failed(error.to_string())),
        },
        Err(error) => Ok(failed(error.to_string())),
    }
}

fn build_vrc_launch_url(location: &str, short_name: &str) -> String {
    let mut launch_url = format!("vrchat://launch?id={location}");
    if !short_name.is_empty() {
        launch_url.push_str("&shortName=");
        launch_url.push_str(short_name);
    }
    launch_url
}

fn should_use_provided_launch_token(parsed: &ParsedLocation, short_name: &str) -> bool {
    !short_name.is_empty()
        && parsed.access_type != "public"
        && parsed.group_access_type.as_deref() != Some("public")
}

fn require_api_success(response: VrchatApiResponse, fallback_message: &str) -> Result<Value> {
    let json = parse_api_json(&response.data);
    if response.status >= 400 || json.get("error").is_some() {
        return Err(Error::Custom(unwrap_api_error_message(
            &json,
            response.status,
            fallback_message,
        )));
    }
    Ok(json)
}

fn parse_api_json(data: &str) -> Value {
    if data.is_empty() {
        return Value::Null;
    }
    serde_json::from_str(data).unwrap_or_else(|_| Value::String(data.to_string()))
}

fn unwrap_api_error_message(json: &Value, status: i32, fallback_message: &str) -> String {
    if let Some(value) = json.as_str().filter(|value| !value.trim().is_empty()) {
        return value.trim_matches('"').to_string();
    }
    let message = json
        .get("error")
        .and_then(|error| error.get("message"))
        .or_else(|| json.get("message"))
        .and_then(Value::as_str)
        .unwrap_or("");
    if !message.trim().is_empty() {
        return message.trim_matches('"').to_string();
    }
    format!("{fallback_message} ({status})")
}

pub(super) fn check_can_invite(
    location: &str,
    parsed: &ParsedLocation,
    current_user_id: &str,
    last_location: &str,
    closed_locations: &HashSet<String>,
) -> bool {
    if !is_concrete_open_instance(location, parsed, closed_locations) {
        return false;
    }
    if parsed.access_type == "public"
        || parsed.access_type == "group"
        || parsed.user_id.as_deref() == Some(current_user_id)
    {
        return true;
    }
    if parsed.access_type == "invite" || parsed.access_type == "friends" {
        return false;
    }
    last_location == location
}

fn check_can_invite_self(
    location: &str,
    parsed: &ParsedLocation,
    current_user_id: &str,
    friend_user_ids: &HashSet<String>,
    closed_locations: &HashSet<String>,
) -> bool {
    if !is_concrete_open_instance(location, parsed, closed_locations) {
        return false;
    }
    if parsed.user_id.as_deref() == Some(current_user_id) {
        return true;
    }
    if parsed.access_type == "invite" || parsed.access_type == "invite+" {
        return false;
    }
    if parsed.access_type == "friends" {
        let Some(user_id) = parsed.user_id.as_deref() else {
            return false;
        };
        if !friend_user_ids.contains(user_id) {
            return false;
        }
    }
    true
}

fn is_concrete_open_instance(
    location: &str,
    parsed: &ParsedLocation,
    closed_locations: &HashSet<String>,
) -> bool {
    !location.is_empty()
        && parsed.is_real_instance
        && !parsed.world_id.is_empty()
        && !parsed.instance_id.is_empty()
        && !is_closed_location(location, parsed, closed_locations)
}

fn is_closed_location(
    location: &str,
    parsed: &ParsedLocation,
    closed_locations: &HashSet<String>,
) -> bool {
    closed_locations.contains(location.trim())
        || closed_locations.contains(&location_cache_key(parsed))
}

fn closed_location_set(locations: Vec<String>) -> HashSet<String> {
    locations
        .into_iter()
        .flat_map(|location| {
            let trimmed = location.trim().to_string();
            let parsed = parse_location(&trimmed);
            [trimmed, location_cache_key(&parsed)]
        })
        .filter(|value| !value.is_empty())
        .collect()
}

fn location_cache_key(parsed: &ParsedLocation) -> String {
    if parsed.world_id.is_empty() || parsed.instance_id.is_empty() {
        String::new()
    } else {
        format!("{}:{}", parsed.world_id, parsed.instance_id)
    }
}

fn first_non_empty(values: impl IntoIterator<Item = impl AsRef<str>>) -> String {
    values
        .into_iter()
        .map(|value| value.as_ref().trim().to_string())
        .find(|value| !value.is_empty())
        .unwrap_or_default()
}

fn same_non_empty(left: &str, right: &str) -> bool {
    !left.trim().is_empty() && left.trim() == right.trim()
}

fn failed(reason: impl Into<String>) -> InstanceLaunchOutcome {
    InstanceLaunchOutcome::Failed {
        reason: reason.into(),
    }
}
