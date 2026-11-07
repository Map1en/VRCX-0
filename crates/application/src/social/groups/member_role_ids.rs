use std::time::Duration;

use serde_json::Value;
use tokio::sync::Semaphore;

use vrcx_0_application_core::{Error, RateLimitBackoff, Result};
use vrcx_0_contracts::vrchat_api::VrchatResponse;

use super::service::{execute_group_api, GroupApiDeps, GroupRemoteRequest};
use super::types::VrchatGroupUserInput;

const MEMBER_ROLE_LOOKUP_COMMAND: &str = "app__vrchat_group_member_role_ids_get";
const MEMBER_ROLE_LOOKUP_CONCURRENCY: usize = 3;
const MEMBER_ROLE_LOOKUP_BACKOFF: RateLimitBackoff =
    RateLimitBackoff::new(Duration::from_secs(1), 3);
const RATE_LIMITED_STATUS: i32 = 429;

static MEMBER_ROLE_LOOKUP_SLOTS: Semaphore = Semaphore::const_new(MEMBER_ROLE_LOOKUP_CONCURRENCY);

pub async fn get_member_role_ids(
    deps: GroupApiDeps,
    input: VrchatGroupUserInput,
) -> Result<Option<Vec<String>>> {
    let detail = format!(
        "Getting roles of member {} in group {}.",
        input.user_id, input.group_id
    );
    let request = GroupRemoteRequest::GetMember(input).build()?.request;
    let (deps, detail, request) = (&deps, &detail, &request);
    let response = MEMBER_ROLE_LOOKUP_BACKOFF
        .retry(
            || async move {
                let _slot = MEMBER_ROLE_LOOKUP_SLOTS
                    .acquire()
                    .await
                    .map_err(|error| Error::Custom(error.to_string()))?;
                execute_group_api(
                    deps,
                    MEMBER_ROLE_LOOKUP_COMMAND,
                    detail.clone(),
                    request.clone(),
                )
                .await
            },
            |result| matches!(result, Ok(response) if response.status == RATE_LIMITED_STATUS),
        )
        .await?;
    if response.status == RATE_LIMITED_STATUS {
        return Err(Error::VrchatApi {
            status_code: RATE_LIMITED_STATUS,
            message: "Group member lookup is rate limited.".into(),
        });
    }
    Ok(member_role_ids(&response))
}

fn member_role_ids(response: &VrchatResponse) -> Option<Vec<String>> {
    if !(200..300).contains(&response.status) {
        return None;
    }
    let member: Value = serde_json::from_str(&response.data).ok()?;
    member
        .get("userId")
        .and_then(Value::as_str)
        .filter(|user_id| !user_id.is_empty())?;
    Some(
        member
            .get("roleIds")
            .and_then(Value::as_array)
            .map(|role_ids| {
                role_ids
                    .iter()
                    .filter_map(|role_id| role_id.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default(),
    )
}

#[cfg(test)]
mod tests {
    use std::collections::{HashMap, VecDeque};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};

    use futures_util::future::join_all;
    use tokio::sync::Mutex as AsyncMutex;
    use vrcx_0_application_core::{
        RemoteMutationGate, RuntimeAuthScope, RuntimeDiagnostics, RuntimeSyncEngine,
    };
    use vrcx_0_contracts::vrchat_api::{VrchatRequest, VrchatScope};

    use super::*;
    use crate::remote::{VrchatRequestFuture, VrchatRequestPort};

    static SHARED_SLOTS_LOCK: AsyncMutex<()> = AsyncMutex::const_new(());

    type ScriptedResponse = Result<(i32, String)>;

    fn member_path(user_id: &str) -> String {
        format!("groups/grp%5F1/members/{}", user_id.replace('_', "%5F"))
    }

    #[derive(Default)]
    struct ScriptedMemberPort {
        responses: Mutex<HashMap<String, VecDeque<ScriptedResponse>>>,
        calls: Mutex<Vec<String>>,
        in_flight: AtomicUsize,
        max_in_flight: AtomicUsize,
    }

    impl ScriptedMemberPort {
        fn script(&self, user_id: &str, responses: &[(i32, &str)]) {
            self.responses.lock().unwrap().insert(
                member_path(user_id),
                responses
                    .iter()
                    .map(|(status, data)| Ok((*status, data.to_string())))
                    .collect(),
            );
        }

        fn fail(&self, user_id: &str, message: &str) {
            self.responses.lock().unwrap().insert(
                member_path(user_id),
                VecDeque::from([Err(Error::Custom(message.to_string()))]),
            );
        }

        fn calls_for(&self, user_id: &str) -> usize {
            let path = member_path(user_id);
            self.calls
                .lock()
                .unwrap()
                .iter()
                .filter(|call| **call == path)
                .count()
        }
    }

    impl VrchatRequestPort for ScriptedMemberPort {
        fn send(&self, input: VrchatRequest, _scope: VrchatScope) -> VrchatRequestFuture<'_> {
            let path = input.path.unwrap_or_default();
            self.calls.lock().unwrap().push(path.clone());
            let response = self
                .responses
                .lock()
                .unwrap()
                .get_mut(&path)
                .and_then(VecDeque::pop_front)
                .unwrap_or(Ok((404, "{}".to_string())));
            Box::pin(async move {
                let in_flight = self.in_flight.fetch_add(1, Ordering::SeqCst) + 1;
                self.max_in_flight.fetch_max(in_flight, Ordering::SeqCst);
                tokio::time::sleep(Duration::from_millis(100)).await;
                self.in_flight.fetch_sub(1, Ordering::SeqCst);
                response.map(|(status, data)| VrchatResponse { status, data })
            })
        }
    }

    fn deps(port: Arc<ScriptedMemberPort>) -> GroupApiDeps {
        GroupApiDeps::new(
            port,
            RuntimeDiagnostics::new(),
            RuntimeSyncEngine::new(),
            RuntimeAuthScope::new(),
            Arc::new(RemoteMutationGate::default()),
        )
    }

    fn lookup(user_id: &str) -> VrchatGroupUserInput {
        VrchatGroupUserInput {
            group_id: "grp_1".into(),
            user_id: user_id.into(),
        }
    }

    async fn lookup_all(
        port: &Arc<ScriptedMemberPort>,
        user_ids: &[&str],
    ) -> Vec<Result<Option<Vec<String>>>> {
        join_all(
            user_ids
                .iter()
                .map(|user_id| get_member_role_ids(deps(port.clone()), lookup(user_id))),
        )
        .await
    }

    #[tokio::test(start_paused = true)]
    async fn reads_role_ids_and_tells_non_members_from_failed_lookups() {
        let _shared_slots = SHARED_SLOTS_LOCK.lock().await;
        let port = Arc::new(ScriptedMemberPort::default());
        port.script(
            "usr_member",
            &[(
                200,
                r#"{"userId":"usr_member","roleIds":["grol_mod",7,"grol_vip"]}"#,
            )],
        );
        port.script("usr_outsider", &[(404, r#"{"error":"not a member"}"#)]);
        port.script("usr_blank", &[(200, r#"{"roleIds":["grol_mod"]}"#)]);
        port.script("usr_plain", &[(200, r#"{"userId":"usr_plain"}"#)]);
        port.fail("usr_offline", "connection reset");

        let results = lookup_all(
            &port,
            &[
                "usr_member",
                "usr_outsider",
                "usr_blank",
                "usr_plain",
                "usr_offline",
            ],
        )
        .await;

        assert_eq!(
            results[0].as_ref().unwrap(),
            &Some(vec!["grol_mod".to_string(), "grol_vip".to_string()])
        );
        assert_eq!(results[1].as_ref().unwrap(), &None);
        assert_eq!(results[2].as_ref().unwrap(), &None);
        assert_eq!(results[3].as_ref().unwrap(), &Some(Vec::new()));
        assert_eq!(
            results[4].as_ref().unwrap_err().to_string(),
            "connection reset"
        );
    }

    #[tokio::test(start_paused = true)]
    async fn retries_rate_limited_lookups_three_times_then_fails() {
        let _shared_slots = SHARED_SLOTS_LOCK.lock().await;
        let port = Arc::new(ScriptedMemberPort::default());
        port.script(
            "usr_recovers",
            &[
                (429, "{}"),
                (429, "{}"),
                (200, r#"{"userId":"usr_recovers","roleIds":["grol_mod"]}"#),
            ],
        );
        port.script(
            "usr_throttled",
            &[
                (429, "{}"),
                (429, "{}"),
                (429, "{}"),
                (429, "{}"),
                (429, "{}"),
            ],
        );

        let results = lookup_all(&port, &["usr_recovers", "usr_throttled"]).await;

        assert_eq!(
            results[0].as_ref().unwrap(),
            &Some(vec!["grol_mod".to_string()])
        );
        assert!(matches!(
            results[1],
            Err(Error::VrchatApi {
                status_code: 429,
                ..
            })
        ));
        assert_eq!(port.calls_for("usr_recovers"), 3);
        assert_eq!(port.calls_for("usr_throttled"), 4);
    }

    #[tokio::test(start_paused = true)]
    async fn keeps_at_most_three_lookups_in_flight() {
        let _shared_slots = SHARED_SLOTS_LOCK.lock().await;
        let port = Arc::new(ScriptedMemberPort::default());
        let user_ids: Vec<String> = (0..8).map(|index| format!("usr_{index}")).collect();
        for user_id in &user_ids {
            port.script(
                user_id,
                &[(200, r#"{"userId":"usr","roleIds":["grol_member"]}"#)],
            );
        }
        let user_ids: Vec<&str> = user_ids.iter().map(String::as_str).collect();

        let results = lookup_all(&port, &user_ids).await;

        assert!(results.iter().all(|result| matches!(
            result,
            Ok(Some(role_ids)) if role_ids == &vec!["grol_member".to_string()]
        )));
        assert_eq!(port.max_in_flight.load(Ordering::SeqCst), 3);
    }
}
