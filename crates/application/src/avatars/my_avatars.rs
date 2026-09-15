use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};
use vrcx_0_core::derived_keys;

use serde::Deserialize;
use serde_json::{json, Value};
use vrcx_0_application_core::{Error, Result, RuntimeAuthScope, RuntimeAuthScopeSnapshot};

const MY_AVATARS_PAGE_SIZE: i32 = 50;
const MY_AVATARS_MAX_OFFSET: i32 = 5_000;

pub struct MyAvatarsDeps<'a> {
    pub(crate) store: &'a dyn super::MyAvatarsStore,
    pub(crate) remote: &'a dyn super::AvatarRemote,
    pub auth_scope: &'a RuntimeAuthScope,
    pub expected_scope: RuntimeAuthScopeSnapshot,
}

impl<'a> MyAvatarsDeps<'a> {
    pub fn new(
        store: &'a dyn super::MyAvatarsStore,
        remote: &'a dyn super::AvatarRemote,
        auth_scope: &'a RuntimeAuthScope,
        expected_scope: RuntimeAuthScopeSnapshot,
    ) -> Self {
        Self {
            store,
            remote,
            auth_scope,
            expected_scope,
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct MyAvatarsInput {
    #[serde(default)]
    pub current_avatar_id: String,
    #[serde(default)]
    pub previous_avatar_swap_time: f64,
}

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct MyAvatarByIdInput {
    pub avatar_id: String,
}

pub async fn get_my_avatars(deps: &MyAvatarsDeps<'_>, input: MyAvatarsInput) -> Result<Vec<Value>> {
    let avatars = fetch_my_avatar_pages(deps, None).await?;
    let tags_by_avatar = collect_tags_by_avatar(deps.store)?;
    let time_spent_by_avatar: HashMap<String, i64> = deps
        .store
        .avatar_time_spent(deps.expected_scope.current_user_id.clone())?
        .into_iter()
        .map(|row| (row.avatar_id, row.time_spent))
        .collect();

    let current_avatar_id = input.current_avatar_id.trim().to_string();
    let swap_delta = live_swap_delta_ms(input.previous_avatar_swap_time);

    Ok(avatars
        .into_iter()
        .map(|mut avatar| {
            let avatar_id = record_id(&avatar);
            let mut time_spent = time_spent_by_avatar.get(&avatar_id).copied().unwrap_or(0);
            if !current_avatar_id.is_empty() && avatar_id == current_avatar_id {
                time_spent += swap_delta;
            }
            if let Some(object) = avatar.as_object_mut() {
                object.insert(
                    derived_keys::TAGS.into(),
                    Value::Array(tags_by_avatar.get(&avatar_id).cloned().unwrap_or_default()),
                );
                object.insert(derived_keys::TIME_SPENT.into(), json!(time_spent));
            }
            avatar
        })
        .collect())
}

pub async fn get_my_avatar_by_id(
    deps: &MyAvatarsDeps<'_>,
    input: MyAvatarByIdInput,
) -> Result<Option<Value>> {
    let avatar_id = input.avatar_id.trim().to_string();
    if avatar_id.is_empty() {
        return Err(Error::Custom(
            "My avatar lookup requires an avatar id.".into(),
        ));
    }
    let matches = fetch_my_avatar_pages(deps, Some(&avatar_id)).await?;
    Ok(matches.into_iter().next())
}

async fn fetch_my_avatar_pages(
    deps: &MyAvatarsDeps<'_>,
    target_avatar_id: Option<&str>,
) -> Result<Vec<Value>> {
    let mut avatars = Vec::new();
    let mut offset = 0;

    while offset <= MY_AVATARS_MAX_OFFSET {
        ensure_scope_matches(&deps.auth_scope.snapshot(), &deps.expected_scope)?;
        let page = deps
            .remote
            .my_avatar_page(&deps.expected_scope.endpoint, MY_AVATARS_PAGE_SIZE, offset)
            .await?;
        ensure_scope_matches(&deps.auth_scope.snapshot(), &deps.expected_scope)?;
        let page_len = page.len();

        if let Some(target) = target_avatar_id {
            if let Some(found) = page.into_iter().find(|avatar| record_id(avatar) == target) {
                return Ok(vec![found]);
            }
        } else {
            avatars.extend(page);
        }

        if page_len < MY_AVATARS_PAGE_SIZE as usize {
            break;
        }
        offset += MY_AVATARS_PAGE_SIZE;
    }

    Ok(avatars)
}

fn collect_tags_by_avatar(
    store: &dyn super::MyAvatarsStore,
) -> Result<HashMap<String, Vec<Value>>> {
    let mut tags_by_avatar: HashMap<String, Vec<Value>> = HashMap::new();
    for row in store.avatar_tags()? {
        let tag = row.tag.trim().to_string();
        if tag.is_empty() {
            continue;
        }
        let color = if row.color.is_string() {
            row.color
        } else {
            Value::Null
        };
        tags_by_avatar
            .entry(row.avatar_id.trim().to_string())
            .or_default()
            .push(json!({ "tag": tag, "color": color }));
    }
    Ok(tags_by_avatar)
}

fn record_id(record: &Value) -> String {
    record
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn live_swap_delta_ms(previous_avatar_swap_time: f64) -> i64 {
    if !previous_avatar_swap_time.is_finite() || previous_avatar_swap_time <= 0.0 {
        return 0;
    }
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as f64)
        .unwrap_or(0.0);
    let delta = now_ms - previous_avatar_swap_time;
    if delta > 0.0 {
        delta as i64
    } else {
        0
    }
}

fn ensure_scope_matches(
    current: &RuntimeAuthScopeSnapshot,
    expected: &RuntimeAuthScopeSnapshot,
) -> Result<()> {
    crate::scope_gate::ensure_snapshot_scope_matches(current, expected, "My avatars")
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use vrcx_0_application_core::vrchat_api::VrchatApiResponse;
    use vrcx_0_contracts::{AvatarTagOutput, AvatarTimeSpentOutput};

    use super::*;

    struct RecordingMyAvatarsRemote {
        offsets: Mutex<Vec<i32>>,
    }

    impl super::super::AvatarRemote for RecordingMyAvatarsRemote {
        fn moderations<'a>(
            &'a self,
            _endpoint: &'a str,
            _command: &'a str,
            _detail: &'a str,
        ) -> super::super::AvatarRemoteFuture<'a, VrchatApiResponse> {
            Box::pin(async { unreachable!() })
        }

        fn my_avatar_page<'a>(
            &'a self,
            _endpoint: &'a str,
            _page_size: i32,
            offset: i32,
        ) -> super::super::AvatarRemoteFuture<'a, Vec<Value>> {
            Box::pin(async move {
                self.offsets.lock().unwrap().push(offset);
                Ok(vec![json!({ "id": "avtr_semantic", "name": "Semantic" })])
            })
        }

        fn mutate<'a>(
            &'a self,
            _endpoint: &'a str,
            _command: &'a str,
            _detail: &'a str,
            _mutation: super::super::AvatarRemoteMutation,
        ) -> super::super::AvatarRemoteFuture<'a, VrchatApiResponse> {
            Box::pin(async { unreachable!() })
        }
    }

    struct RecordingMyAvatarsStore;

    impl super::super::MyAvatarsStore for RecordingMyAvatarsStore {
        fn avatar_tags(&self) -> Result<Vec<AvatarTagOutput>> {
            Ok(vec![AvatarTagOutput {
                avatar_id: "avtr_semantic".into(),
                tag: "favorite".into(),
                color: json!("blue"),
            }])
        }

        fn avatar_time_spent(&self, owner_user_id: String) -> Result<Vec<AvatarTimeSpentOutput>> {
            assert_eq!(owner_user_id, "usr_semantic");
            Ok(vec![AvatarTimeSpentOutput {
                avatar_id: "avtr_semantic".into(),
                time_spent: 42,
            }])
        }
    }

    #[tokio::test]
    async fn my_avatar_orchestration_uses_semantic_remote_pages() {
        let remote = RecordingMyAvatarsRemote {
            offsets: Mutex::new(Vec::new()),
        };
        let auth_scope = RuntimeAuthScope::new();
        let expected_scope = auth_scope.set("usr_semantic", "https://api.example.test/api/1/");
        let avatars = get_my_avatars(
            &MyAvatarsDeps::new(
                &RecordingMyAvatarsStore,
                &remote,
                &auth_scope,
                expected_scope,
            ),
            MyAvatarsInput::default(),
        )
        .await
        .unwrap();

        assert_eq!(remote.offsets.lock().unwrap().as_slice(), [0]);
        assert_eq!(avatars[0][derived_keys::TIME_SPENT], 42);
        assert_eq!(avatars[0][derived_keys::TAGS][0]["tag"], "favorite");
    }

    #[test]
    fn live_swap_delta_ignores_invalid_swap_times() {
        assert_eq!(live_swap_delta_ms(0.0), 0);
        assert_eq!(live_swap_delta_ms(-5.0), 0);
        assert_eq!(live_swap_delta_ms(f64::NAN), 0);
        assert_eq!(live_swap_delta_ms(f64::INFINITY), 0);
    }

    #[test]
    fn live_swap_delta_counts_elapsed_wall_clock() {
        let one_minute_ago = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as f64
            - 60_000.0;
        let delta = live_swap_delta_ms(one_minute_ago);
        assert!((60_000..120_000).contains(&delta));
    }

    #[test]
    fn record_id_trims_and_defaults() {
        assert_eq!(record_id(&json!({ "id": " avtr_1 " })), "avtr_1");
        assert_eq!(record_id(&json!({ "id": 7 })), "");
        assert_eq!(record_id(&json!("not-an-object")), "");
    }
}
