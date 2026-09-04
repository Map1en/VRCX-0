use std::sync::Mutex;

use serde_json::json;
use vrcx_0_application_core::vrchat_api::{VrchatApiRequest, VrchatApiResponse};
use vrcx_0_application_realtime::test_support::runtime_with_active_session;
use vrcx_0_application_realtime::{RealtimeWsMessagePayload, SyntheticFriendEventOutcome};

use super::*;
use crate::remote::VrchatRequestFuture;
use crate::social::MutualGraphStore;

#[derive(Debug, PartialEq)]
struct GraphCommit {
    owner_user_id: String,
    friend_id: String,
    mutual_ids: Option<Vec<String>>,
    total_count: Option<usize>,
    opted_out: bool,
}

#[derive(Default)]
struct RecordingStore {
    commits: Mutex<Vec<GraphCommit>>,
}

impl MutualGraphStore for RecordingStore {
    fn friend_refresh_commit(
        &self,
        owner_user_id: String,
        friend_id: String,
        mutual_ids: Option<Vec<String>>,
        total_count: Option<usize>,
        opted_out: bool,
    ) -> Result<()> {
        self.commits.lock().unwrap().push(GraphCommit {
            owner_user_id,
            friend_id,
            mutual_ids,
            total_count,
            opted_out,
        });
        Ok(())
    }

    fn snapshot_get(&self, _owner_user_id: String) -> Result<MutualGraphSnapshotOutput> {
        panic!("list requests must not read the graph snapshot")
    }

    fn snapshot_commit(
        &self,
        _owner_user_id: String,
        _entries: Vec<MutualGraphSnapshotEntryInput>,
        _meta: Vec<MutualGraphMetaInput>,
    ) -> Result<()> {
        panic!("list requests must not replace the graph snapshot")
    }
}

struct MutualRequests;

impl MutualGraphRemoteRequests for MutualRequests {
    fn mutual_friends(
        &self,
        endpoint: String,
        user_id: String,
        _n: i32,
        _offset: i32,
    ) -> Result<VrchatApiRequest> {
        Ok(VrchatApiRequest {
            endpoint: Some(endpoint),
            path: Some(format!("users/{user_id}/mutuals/friends")),
            ..Default::default()
        })
    }
}

struct ResponsePort<F> {
    status: i32,
    rows: Value,
    before_response: F,
}

impl<F: Fn() + Send + Sync> VrchatRequestPort for ResponsePort<F> {
    fn send(&self, _input: VrchatApiRequest, _scope: VrchatScope) -> VrchatRequestFuture<'_> {
        Box::pin(async {
            (self.before_response)();
            Ok(VrchatApiResponse {
                status: self.status,
                data: self.rows.to_string(),
            })
        })
    }
}

#[tokio::test]
async fn non_friend_and_pending_request_lists_only_backfill_after_friend_add() -> Result<()> {
    let (_dir, runtime, session) = runtime_with_active_session("mutual-list-pending")?;
    runtime
        .runtime()
        .sync_friend_snapshot(session.clone(), Some(7), HashMap::new())?;
    let store = RecordingStore::default();
    let remote = ResponsePort {
        status: 200,
        rows: json!([{ "id": "usr_mutual", "displayName": "Mutual" }]),
        before_response: || {},
    };
    let deps = MutualGraphRequestDeps::new(&store, &MutualRequests, &remote, runtime.auth_scope());

    for pending in [false, true] {
        runtime.runtime().record_user_profile(
            &session.endpoint,
            &json!({
                "id": "usr_target",
                "displayName": "Target",
                "isFriend": false,
                "outgoingRequest": pending
            }),
        );
        let result = get_user_mutual_friends_list(
            deps,
            runtime.runtime(),
            UserMutualFriendsListInput {
                user_id: "usr_target".into(),
            },
        )
        .await?;
        assert_eq!(result.rows, vec![RawJson::from(remote.rows[0].clone())]);
        assert!(!result.persisted);
        assert!(store.commits.lock().unwrap().is_empty());
    }

    runtime.handle_active_friend_ws_message_for_test(&RealtimeWsMessagePayload {
        json: json!({
            "type": "friend-add",
            "content": {
                "userId": "usr_target",
                "user": { "id": "usr_target", "displayName": "Target" }
            }
        }),
        raw: "{}".into(),
        received_at: "2026-08-30T00:00:00Z".into(),
    });
    let result = get_user_mutual_friends_list(
        deps,
        runtime.runtime(),
        UserMutualFriendsListInput {
            user_id: "usr_target".into(),
        },
    )
    .await?;
    assert!(result.persisted);
    assert_eq!(
        *store.commits.lock().unwrap(),
        vec![GraphCommit {
            owner_user_id: session.user_id,
            friend_id: "usr_target".into(),
            mutual_ids: Some(vec!["usr_mutual".into()]),
            total_count: Some(1),
            opted_out: false,
        }]
    );
    Ok(())
}

#[tokio::test]
async fn empty_non_friend_list_does_not_create_an_isolated_node() -> Result<()> {
    let (_dir, runtime, session) = runtime_with_active_session("mutual-list-empty")?;
    runtime
        .runtime()
        .sync_friend_snapshot(session, Some(7), HashMap::new())?;
    let store = RecordingStore::default();
    let remote = ResponsePort {
        status: 200,
        rows: json!([]),
        before_response: || {},
    };
    let result = get_user_mutual_friends_list(
        MutualGraphRequestDeps::new(&store, &MutualRequests, &remote, runtime.auth_scope()),
        runtime.runtime(),
        UserMutualFriendsListInput {
            user_id: "usr_target".into(),
        },
    )
    .await?;
    assert!(result.rows.is_empty());
    assert!(!result.persisted);
    assert!(store.commits.lock().unwrap().is_empty());
    Ok(())
}

#[tokio::test]
async fn unavailable_lists_only_update_opt_out_metadata_for_current_friends() -> Result<()> {
    for status in [403, 404] {
        for is_friend in [false, true] {
            let (_dir, runtime, session) = runtime_with_active_session("mutual-list-opt-out")?;
            runtime
                .runtime()
                .sync_friend_snapshot(session.clone(), Some(7), HashMap::new())?;
            if is_friend {
                assert_eq!(
                    runtime.runtime().apply_synthetic_trusted_friend_add(
                        &OwnerId::new(&session.user_id),
                        &session.endpoint,
                        "usr_target",
                        json!({ "id": "usr_target", "displayName": "Target" }),
                        "2026-08-30T00:00:00Z".into(),
                    ),
                    SyntheticFriendEventOutcome::Applied
                );
            }
            let store = RecordingStore::default();
            let remote = ResponsePort {
                status,
                rows: json!({}),
                before_response: || {},
            };
            let result = get_user_mutual_friends_list(
                MutualGraphRequestDeps::new(&store, &MutualRequests, &remote, runtime.auth_scope()),
                runtime.runtime(),
                UserMutualFriendsListInput {
                    user_id: "usr_target".into(),
                },
            )
            .await;
            assert!(result.is_err());
            let commits = store.commits.lock().unwrap();
            if is_friend {
                assert_eq!(
                    *commits,
                    vec![GraphCommit {
                        owner_user_id: session.user_id,
                        friend_id: "usr_target".into(),
                        mutual_ids: None,
                        total_count: None,
                        opted_out: true,
                    }]
                );
            } else {
                assert!(commits.is_empty());
            }
        }
    }
    Ok(())
}

#[tokio::test]
async fn friend_removed_during_list_request_is_not_backfilled() -> Result<()> {
    let (_dir, runtime, session) = runtime_with_active_session("mutual-list-unfriend")?;
    runtime
        .runtime()
        .sync_friend_snapshot(session.clone(), Some(7), HashMap::new())?;
    assert_eq!(
        runtime.runtime().apply_synthetic_trusted_friend_add(
            &OwnerId::new(&session.user_id),
            &session.endpoint,
            "usr_target",
            json!({ "id": "usr_target", "displayName": "Target" }),
            "2026-08-30T00:00:00Z".into(),
        ),
        SyntheticFriendEventOutcome::Applied
    );
    let store = RecordingStore::default();
    let remote = ResponsePort {
        status: 200,
        rows: json!([{ "id": "usr_mutual" }]),
        before_response: || {
            assert_eq!(
                runtime.runtime().apply_synthetic_friend_delete(
                    &OwnerId::new(&session.user_id),
                    &session.endpoint,
                    "usr_target",
                    "2026-08-30T00:00:01Z".into(),
                ),
                SyntheticFriendEventOutcome::Applied
            );
        },
    };
    let result = get_user_mutual_friends_list(
        MutualGraphRequestDeps::new(&store, &MutualRequests, &remote, runtime.auth_scope()),
        runtime.runtime(),
        UserMutualFriendsListInput {
            user_id: "usr_target".into(),
        },
    )
    .await?;
    assert_eq!(result.rows.len(), 1);
    assert!(!result.persisted);
    assert!(store.commits.lock().unwrap().is_empty());
    Ok(())
}
