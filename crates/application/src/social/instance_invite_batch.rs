use futures_util::future::BoxFuture;

use std::time::Duration;

use serde::{Deserialize, Serialize};
#[cfg(test)]
use serde_json::json;
use serde_json::Value;
use vrcx_0_core::location::parse_location;

use crate::remote::VrchatRequestPort;
use vrcx_0_application_core::{
    vrchat_api::{VrchatApiRequest, VrchatScope},
    AuthenticatedMutationContext, Error, Result,
};

const INSTANCE_INVITE_MAX_RETRIES: usize = 3;
const INSTANCE_INVITE_RETRY_BASE_DELAY: Duration = Duration::from_secs(1);
const INSTANCE_INVITE_REMOTE_INTERVAL: Duration = Duration::from_millis(250);
const INSTANCE_INVITE_BATCH_MAX_ITEMS: usize = 1_000;
const INSTANCE_INVITE_SCOPE_CHANGED: &str = "Instance invite batch authentication scope changed.";

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct InstanceInviteBatchInput {
    #[serde(default)]
    pub receiver_user_ids: Vec<String>,
    #[serde(default)]
    pub location: String,
    #[serde(default)]
    pub short_name: String,
    #[serde(default)]
    pub world_name: String,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum InstanceInviteItemState {
    Succeeded,
    Failed,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct InstanceInviteItemResult {
    pub receiver_user_id: String,
    pub state: InstanceInviteItemState,
    pub attempts: u32,
    pub message: String,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct InstanceInviteBatchResult {
    pub total: u32,
    pub succeeded: u32,
    pub failed: u32,
    pub items: Vec<InstanceInviteItemResult>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum InstanceInviteTargetKind {
    SelfInvite,
    UserInvite,
}

#[derive(Clone, Debug)]
struct InstanceInviteTarget {
    receiver_user_id: String,
    kind: InstanceInviteTargetKind,
}

struct InstanceInviteContext {
    location: String,
    world_id: String,
    instance_id: String,
    short_name: String,
    world_name: String,
}

struct InstanceInviteRemoteError {
    message: String,
    retryable: bool,
}

impl InstanceInviteRemoteError {
    fn terminal(error: impl ToString) -> Self {
        Self {
            message: error.to_string(),
            retryable: false,
        }
    }

    fn response(payload: &Value, status: i32, fallback_message: &str) -> Self {
        let effective_status = api_error_status(payload, status);
        Self {
            message: response_error_message(payload, effective_status, fallback_message),
            retryable: effective_status == 429 || effective_status >= 500,
        }
    }
}

trait InstanceInviteBatchActions: Send + Sync {
    fn send<'a>(
        &'a self,
        context: &'a InstanceInviteContext,
        target: &'a InstanceInviteTarget,
    ) -> BoxFuture<'a, std::result::Result<(), InstanceInviteRemoteError>>;
    fn scope_matches(&self) -> bool;
}

pub trait InstanceInviteRemoteRequests: Send + Sync {
    fn self_invite(
        &self,
        endpoint: String,
        world_id: String,
        instance_id: String,
        short_name: String,
    ) -> Result<VrchatApiRequest>;
    fn user_invite(
        &self,
        endpoint: String,
        receiver_user_id: String,
        location: String,
        world_id: String,
        world_name: String,
    ) -> Result<VrchatApiRequest>;
}

pub type WorldNameFuture<'a> = BoxFuture<'a, Option<String>>;

pub trait WorldNameResolver: Send + Sync {
    fn resolve<'a>(&'a self, endpoint: &'a str, world_id: &'a str) -> WorldNameFuture<'a>;
}

pub struct VrchatInstanceInviteBatchActions<'a> {
    remote: &'a dyn VrchatRequestPort,
    remote_requests: &'a dyn InstanceInviteRemoteRequests,
    mutation: AuthenticatedMutationContext<'a>,
    world_names: &'a dyn WorldNameResolver,
}

impl<'a> VrchatInstanceInviteBatchActions<'a> {
    pub fn new(
        remote: &'a dyn VrchatRequestPort,
        remote_requests: &'a dyn InstanceInviteRemoteRequests,
        mutation: AuthenticatedMutationContext<'a>,
        world_names: &'a dyn WorldNameResolver,
    ) -> Self {
        Self {
            remote,
            remote_requests,
            mutation,
            world_names,
        }
    }
}

impl VrchatInstanceInviteBatchActions<'_> {
    async fn execute_request(
        &self,
        request: VrchatApiRequest,
        fallback_message: &str,
        allow_success_plain_text: bool,
    ) -> std::result::Result<(), InstanceInviteRemoteError> {
        if !self.scope_matches() {
            return Err(InstanceInviteRemoteError::terminal(
                INSTANCE_INVITE_SCOPE_CHANGED,
            ));
        }
        let response = self
            .remote
            .send(request, VrchatScope::Vrchat)
            .await
            .map_err(InstanceInviteRemoteError::terminal)?;
        let request_failed = !(200..300).contains(&response.status);
        let payload = if response.data.trim().is_empty() {
            Value::String(String::new())
        } else {
            match serde_json::from_str::<Value>(&response.data) {
                Ok(payload) => payload,
                Err(_) if request_failed || allow_success_plain_text => {
                    Value::String(response.data.clone())
                }
                Err(_) => {
                    return Err(InstanceInviteRemoteError::terminal(format!(
                        "{fallback_message}: invalid JSON response ({})",
                        response.status
                    )))
                }
            }
        };
        if request_failed || has_api_error(&payload) {
            return Err(InstanceInviteRemoteError::response(
                &payload,
                response.status,
                fallback_message,
            ));
        }
        Ok(())
    }
}

impl InstanceInviteBatchActions for VrchatInstanceInviteBatchActions<'_> {
    fn send<'a>(
        &'a self,
        context: &'a InstanceInviteContext,
        target: &'a InstanceInviteTarget,
    ) -> BoxFuture<'a, std::result::Result<(), InstanceInviteRemoteError>> {
        Box::pin(async move {
            self.mutation.pace(INSTANCE_INVITE_REMOTE_INTERVAL).await;
            let (request, fallback_message, allow_success_plain_text) = match target.kind {
                InstanceInviteTargetKind::SelfInvite => {
                    let request = self
                        .remote_requests
                        .self_invite(
                            self.mutation.scope().endpoint.clone(),
                            context.world_id.clone(),
                            context.instance_id.clone(),
                            context.short_name.clone(),
                        )
                        .map_err(InstanceInviteRemoteError::terminal)?;
                    (request, "VRChat instance request failed", true)
                }
                InstanceInviteTargetKind::UserInvite => {
                    let request = self
                        .remote_requests
                        .user_invite(
                            self.mutation.scope().endpoint.clone(),
                            target.receiver_user_id.clone(),
                            context.location.clone(),
                            context.world_id.clone(),
                            context.world_name.clone(),
                        )
                        .map_err(InstanceInviteRemoteError::terminal)?;
                    (request, "VRChat notification request failed", false)
                }
            };
            self.execute_request(request, fallback_message, allow_success_plain_text)
                .await
        })
    }

    fn scope_matches(&self) -> bool {
        self.mutation.is_current()
    }
}

pub async fn send_instance_invites_batch(
    actions: &VrchatInstanceInviteBatchActions<'_>,
    input: InstanceInviteBatchInput,
) -> Result<InstanceInviteBatchResult> {
    let (mut context, targets) = normalize_input(input, &actions.mutation.scope().current_user_id)?;
    if context.world_name == context.world_id {
        if let Some(world_name) = actions
            .world_names
            .resolve(&actions.mutation.scope().endpoint, &context.world_id)
            .await
        {
            context.world_name = world_name;
        }
    }
    if !actions.scope_matches() {
        return Err(Error::Custom(INSTANCE_INVITE_SCOPE_CHANGED.into()));
    }
    Ok(
        run_instance_invite_batch(actions, &context, targets, INSTANCE_INVITE_RETRY_BASE_DELAY)
            .await,
    )
}

async fn run_instance_invite_batch(
    actions: &dyn InstanceInviteBatchActions,
    context: &InstanceInviteContext,
    targets: Vec<InstanceInviteTarget>,
    retry_base_delay: Duration,
) -> InstanceInviteBatchResult {
    let total = targets.len();
    let mut items = Vec::with_capacity(total);
    let mut succeeded = 0;
    let mut index = 0;

    while index < targets.len() {
        let target = &targets[index];
        let (attempts, result) =
            send_with_backoff(actions, context, target, retry_base_delay).await;
        match result {
            Ok(()) => {
                succeeded += 1;
                items.push(InstanceInviteItemResult {
                    receiver_user_id: target.receiver_user_id.clone(),
                    state: InstanceInviteItemState::Succeeded,
                    attempts: crate::wire_count(attempts),
                    message: String::new(),
                });
            }
            Err(error) => {
                items.push(InstanceInviteItemResult {
                    receiver_user_id: target.receiver_user_id.clone(),
                    state: InstanceInviteItemState::Failed,
                    attempts: crate::wire_count(attempts),
                    message: error.message,
                });
            }
        }
        index += 1;

        if !actions.scope_matches() {
            append_scope_changed_results(&targets[index..], &mut items);
            break;
        }
    }

    InstanceInviteBatchResult {
        total: crate::wire_count(total),
        succeeded,
        failed: crate::wire_count(total).saturating_sub(succeeded),
        items,
    }
}

async fn send_with_backoff(
    actions: &dyn InstanceInviteBatchActions,
    context: &InstanceInviteContext,
    target: &InstanceInviteTarget,
    retry_base_delay: Duration,
) -> (usize, std::result::Result<(), InstanceInviteRemoteError>) {
    for attempt in 0..=INSTANCE_INVITE_MAX_RETRIES {
        if !actions.scope_matches() {
            return (
                attempt,
                Err(InstanceInviteRemoteError::terminal(
                    INSTANCE_INVITE_SCOPE_CHANGED,
                )),
            );
        }
        match actions.send(context, target).await {
            Ok(()) => return (attempt + 1, Ok(())),
            Err(error) if error.retryable && attempt < INSTANCE_INVITE_MAX_RETRIES => {
                tokio::time::sleep(
                    retry_base_delay.saturating_mul(2u32.saturating_pow(attempt as u32)),
                )
                .await;
            }
            Err(error) => return (attempt + 1, Err(error)),
        }
    }
    unreachable!()
}

fn normalize_input(
    input: InstanceInviteBatchInput,
    current_user_id: &str,
) -> Result<(InstanceInviteContext, Vec<InstanceInviteTarget>)> {
    let location = input.location.trim().to_string();
    let parsed = parse_location(&location);
    if parsed.world_id.is_empty() || parsed.instance_id.is_empty() {
        return Err(Error::Custom(
            "Instance invite batch requires a concrete instance location.".into(),
        ));
    }

    let receiver_user_ids = input
        .receiver_user_ids
        .into_iter()
        .map(|user_id| user_id.trim().to_string())
        .collect::<Vec<_>>();
    if receiver_user_ids.is_empty() {
        return Err(Error::Custom(
            "Instance invite batch requires at least one recipient.".into(),
        ));
    }
    if receiver_user_ids.len() > INSTANCE_INVITE_BATCH_MAX_ITEMS {
        return Err(Error::Custom(format!(
            "Instance invite batch cannot exceed {INSTANCE_INVITE_BATCH_MAX_ITEMS} recipients."
        )));
    }
    if receiver_user_ids.iter().any(String::is_empty) {
        return Err(Error::Custom(
            "Instance invite batch contains an invalid recipient.".into(),
        ));
    }

    let short_name = if input.short_name.trim().is_empty() {
        parsed.short_name.to_string()
    } else {
        input.short_name.trim().to_string()
    };
    let world_name = if input.world_name.trim().is_empty() {
        parsed.world_id.clone()
    } else {
        input.world_name.trim().to_string()
    };
    let targets = receiver_user_ids
        .into_iter()
        .map(|receiver_user_id| InstanceInviteTarget {
            kind: if receiver_user_id == current_user_id {
                InstanceInviteTargetKind::SelfInvite
            } else {
                InstanceInviteTargetKind::UserInvite
            },
            receiver_user_id,
        })
        .collect();
    Ok((
        InstanceInviteContext {
            location: parsed.tag,
            world_id: parsed.world_id,
            instance_id: parsed.instance_id,
            short_name,
            world_name,
        },
        targets,
    ))
}

fn append_scope_changed_results(
    targets: &[InstanceInviteTarget],
    items: &mut Vec<InstanceInviteItemResult>,
) {
    items.extend(targets.iter().map(|target| InstanceInviteItemResult {
        receiver_user_id: target.receiver_user_id.clone(),
        state: InstanceInviteItemState::Failed,
        attempts: 0,
        message: INSTANCE_INVITE_SCOPE_CHANGED.into(),
    }));
}

fn has_api_error(payload: &Value) -> bool {
    match payload.get("error") {
        Some(Value::Object(_)) => true,
        Some(Value::String(message)) => !message.trim().is_empty(),
        _ => false,
    }
}

fn api_error_status(payload: &Value, response_status: i32) -> i32 {
    payload
        .get("error")
        .and_then(Value::as_object)
        .and_then(|error| error.get("status_code"))
        .or_else(|| payload.get("status_code"))
        .and_then(Value::as_i64)
        .filter(|status| (100..=599).contains(status))
        .and_then(|status| i32::try_from(status).ok())
        .unwrap_or(response_status)
}

fn response_error_message(payload: &Value, status: i32, fallback_message: &str) -> String {
    if let Some(message) = payload
        .as_str()
        .filter(|message| !message.trim().is_empty())
    {
        return message.trim_matches('"').to_string();
    }
    if let Some(message) = payload
        .get("error")
        .and_then(Value::as_str)
        .filter(|message| !message.trim().is_empty())
    {
        return message.trim_matches('"').to_string();
    }
    payload
        .get("error")
        .and_then(Value::as_object)
        .and_then(|error| error.get("message"))
        .or_else(|| payload.get("message"))
        .and_then(Value::as_str)
        .filter(|message| !message.trim().is_empty())
        .map(|message| message.trim_matches('"').to_string())
        .unwrap_or_else(|| format!("{fallback_message} ({status})"))
}

#[cfg(test)]
mod tests {
    use std::{collections::HashMap, sync::Mutex};

    use super::*;

    #[derive(Default)]
    struct FakeActions {
        calls: Mutex<Vec<(String, InstanceInviteTargetKind)>>,
        rate_limit_failures: Mutex<HashMap<String, usize>>,
    }

    impl InstanceInviteBatchActions for FakeActions {
        fn send<'a>(
            &'a self,
            _context: &'a InstanceInviteContext,
            target: &'a InstanceInviteTarget,
        ) -> BoxFuture<'a, std::result::Result<(), InstanceInviteRemoteError>> {
            Box::pin(async move {
                self.calls
                    .lock()
                    .unwrap()
                    .push((target.receiver_user_id.clone(), target.kind));
                let mut failures = self.rate_limit_failures.lock().unwrap();
                let remaining = failures.entry(target.receiver_user_id.clone()).or_default();
                if *remaining > 0 {
                    *remaining -= 1;
                    return Err(InstanceInviteRemoteError {
                        message: "rate limited".into(),
                        retryable: true,
                    });
                }
                Ok(())
            })
        }

        fn scope_matches(&self) -> bool {
            true
        }
    }

    fn input(receiver_user_ids: Vec<&str>) -> InstanceInviteBatchInput {
        InstanceInviteBatchInput {
            receiver_user_ids: receiver_user_ids.into_iter().map(str::to_string).collect(),
            location: "wrld_test:12345~hidden(usr_owner)&shortName=from-tag".into(),
            short_name: "explicit-token".into(),
            world_name: "Test World".into(),
        }
    }

    #[tokio::test]
    async fn routes_self_and_user_invites_in_input_order() {
        let actions = FakeActions::default();
        let (context, targets) =
            normalize_input(input(vec!["usr_a", "usr_self", "usr_b"]), "usr_self").unwrap();

        let result = run_instance_invite_batch(&actions, &context, targets, Duration::ZERO).await;

        assert_eq!(result.succeeded, 3);
        assert_eq!(result.failed, 0);
        assert_eq!(
            *actions.calls.lock().unwrap(),
            vec![
                ("usr_a".into(), InstanceInviteTargetKind::UserInvite),
                ("usr_self".into(), InstanceInviteTargetKind::SelfInvite),
                ("usr_b".into(), InstanceInviteTargetKind::UserInvite),
            ]
        );
        assert_eq!(context.location, input(Vec::new()).location);
        assert_eq!(context.short_name, "explicit-token");
    }

    #[tokio::test]
    async fn retries_rate_limits_and_continues_after_exhaustion() {
        let actions = FakeActions::default();
        actions
            .rate_limit_failures
            .lock()
            .unwrap()
            .extend([("usr_a".into(), 10), ("usr_b".into(), 1)]);
        let (context, targets) =
            normalize_input(input(vec!["usr_a", "usr_b"]), "usr_self").unwrap();

        let result = run_instance_invite_batch(&actions, &context, targets, Duration::ZERO).await;

        assert_eq!(result.succeeded, 1);
        assert_eq!(result.failed, 1);
        assert_eq!(result.items[0].attempts, 4);
        assert_eq!(result.items[1].attempts, 2);
        assert_eq!(
            actions
                .calls
                .lock()
                .unwrap()
                .iter()
                .map(|(user_id, _)| user_id.as_str())
                .collect::<Vec<_>>(),
            vec!["usr_a", "usr_a", "usr_a", "usr_a", "usr_b", "usr_b"]
        );
    }

    #[test]
    fn rejects_invalid_inputs_instead_of_dropping_them() {
        assert!(normalize_input(input(Vec::new()), "usr_self").is_err());
        assert!(normalize_input(input(vec![" "]), "usr_self").is_err());

        let mut invalid_location = input(vec!["usr_a"]);
        invalid_location.location = "private".into();
        assert!(normalize_input(invalid_location, "usr_self").is_err());
    }

    #[test]
    fn extracts_nested_rate_limit_status_and_error_message() {
        let payload = json!({
            "error": {
                "message": "Slow down",
                "status_code": 429
            }
        });
        let error = InstanceInviteRemoteError::response(
            &payload,
            200,
            "VRChat notification request failed",
        );

        assert!(error.retryable);
        assert_eq!(error.message, "Slow down");
    }
}
