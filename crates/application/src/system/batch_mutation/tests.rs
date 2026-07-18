use std::sync::Mutex;

use super::*;

struct FakeActions {
    calls: Mutex<Vec<String>>,
    fail_update_id: Option<String>,
    fail_rollback_id: Option<String>,
    groups: Vec<Value>,
}

impl FakeActions {
    fn calls(&self) -> Vec<String> {
        self.calls.lock().unwrap().clone()
    }
}

impl BatchMutationActions for FakeActions {
    fn fetch_avatar<'a>(
        &'a self,
        avatar_id: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<Value>> + Send + 'a>> {
        Box::pin(async move {
            Ok(json!({
                "id": avatar_id,
                "authorId": if avatar_id == "avtr_not_owned" { "usr_other" } else { "usr_self" },
                "tags": [format!("content_original_{avatar_id}")]
            }))
        })
    }

    fn save_avatar_tags<'a>(
        &'a self,
        avatar_id: &'a str,
        tags: &'a [String],
    ) -> Pin<Box<dyn Future<Output = Result<Value>> + Send + 'a>> {
        Box::pin(async move {
            let rollback = tags
                .iter()
                .any(|tag| tag == &format!("content_original_{avatar_id}"));
            self.calls
                .lock()
                .unwrap()
                .push(format!("avatar:{avatar_id}:{rollback}"));
            if (!rollback && self.fail_update_id.as_deref() == Some(avatar_id))
                || (rollback && self.fail_rollback_id.as_deref() == Some(avatar_id))
            {
                return Err(Error::Custom(format!("save failed for {avatar_id}")));
            }
            Ok(json!({ "id": avatar_id, "tags": tags }))
        })
    }

    fn fetch_current_user_groups(
        &self,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<Value>>> + Send + '_>> {
        Box::pin(async move { Ok(self.groups.clone()) })
    }

    fn set_group_visibility<'a>(
        &'a self,
        group_id: &'a str,
        visibility: GroupVisibility,
    ) -> Pin<Box<dyn Future<Output = Result<()>> + Send + 'a>> {
        Box::pin(async move {
            self.calls.lock().unwrap().push(format!(
                "visibility:{group_id}:{}",
                visibility_name(visibility)
            ));
            if self.fail_update_id.as_deref() == Some(group_id) {
                Err(Error::Custom(format!("visibility failed for {group_id}")))
            } else {
                Ok(())
            }
        })
    }

    fn leave_group<'a>(
        &'a self,
        group_id: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<()>> + Send + 'a>> {
        Box::pin(async move {
            self.calls.lock().unwrap().push(format!("leave:{group_id}"));
            if self.fail_update_id.as_deref() == Some(group_id) {
                Err(Error::Custom(format!("leave failed for {group_id}")))
            } else {
                Ok(())
            }
        })
    }

    fn current_user_id(&self) -> &str {
        "usr_self"
    }
}

#[tokio::test]
async fn avatar_batch_rolls_back_in_reverse_order_and_reports_rollback_failure() {
    let first = "avtr_first";
    let second = "avtr_second";
    let third = "avtr_third";
    let actions = FakeActions {
        calls: Mutex::new(Vec::new()),
        fail_update_id: Some(third.into()),
        fail_rollback_id: Some(first.into()),
        groups: Vec::new(),
    };

    let output = run_avatar_content_tags_batch(
        &actions,
        AvatarContentTagsBatchInput {
            avatar_ids: vec![first.into(), second.into(), third.into()],
            content_tags: vec!["content_horror".into()],
        },
    )
    .await
    .unwrap();

    assert_eq!(output.applied_before_failure, 2);
    assert_eq!(output.rolled_back, 1);
    assert_eq!(output.rollback_failed, 1);
    assert_eq!(
        actions.calls(),
        vec![
            "avatar:avtr_first:false",
            "avatar:avtr_second:false",
            "avatar:avtr_third:false",
            "avatar:avtr_second:true",
            "avatar:avtr_first:true",
        ]
    );
    assert_eq!(
        output.items[0].state,
        BatchMutationItemState::RollbackFailed
    );
    assert_eq!(output.items[1].state, BatchMutationItemState::RolledBack);
    assert_eq!(output.items[2].state, BatchMutationItemState::Failed);
}

#[tokio::test]
async fn group_leave_continues_after_partial_failure() {
    let actions = FakeActions {
        calls: Mutex::new(Vec::new()),
        fail_update_id: Some("grp_second".into()),
        fail_rollback_id: None,
        groups: vec![
            json!({ "groupId": "grp_first" }),
            json!({ "groupId": "grp_second" }),
            json!({ "groupId": "grp_third" }),
        ],
    };

    let output = run_group_leave_batch(
        &actions,
        GroupLeaveBatchInput {
            group_ids: vec!["grp_first".into(), "grp_second".into(), "grp_third".into()],
        },
    )
    .await
    .unwrap();

    assert_eq!(output.succeeded, 2);
    assert_eq!(output.failed, 1);
    assert_eq!(
        actions.calls(),
        vec!["leave:grp_first", "leave:grp_second", "leave:grp_third"]
    );
}

#[tokio::test]
async fn group_visibility_uses_snapshots_and_rolls_back_in_reverse_order() {
    let actions = FakeActions {
        calls: Mutex::new(Vec::new()),
        fail_update_id: Some("grp_third".into()),
        fail_rollback_id: None,
        groups: vec![
            json!({ "groupId": "grp_first", "visibility": "visible" }),
            json!({ "groupId": "grp_second", "visibility": "friends" }),
            json!({ "groupId": "grp_third", "visibility": "hidden" }),
        ],
    };

    let output = run_group_visibility_batch(
        &actions,
        GroupVisibilityBatchInput {
            group_ids: vec!["grp_first".into(), "grp_second".into(), "grp_third".into()],
            visibility: GroupVisibility::Hidden,
        },
    )
    .await
    .unwrap();

    assert_eq!(output.applied_before_failure, 2);
    assert_eq!(output.rolled_back, 2);
    assert_eq!(
        actions.calls(),
        vec![
            "visibility:grp_first:hidden",
            "visibility:grp_second:hidden",
            "visibility:grp_third:hidden",
            "visibility:grp_second:friends",
            "visibility:grp_first:visible",
        ]
    );
}

#[test]
fn batch_validation_rejects_invalid_items_instead_of_dropping_them() {
    assert!(
        normalize_entity_ids(vec!["avtr_valid".into(), "wrld_wrong-kind".into()], "avtr_").is_err()
    );
    assert!(normalize_content_tags(vec!["content_horror".into(), "not-content".into()]).is_err());
}

#[tokio::test]
async fn avatar_preflight_failure_reports_every_item_terminal_state() {
    let actions = FakeActions {
        calls: Mutex::new(Vec::new()),
        fail_update_id: None,
        fail_rollback_id: None,
        groups: Vec::new(),
    };

    let output = run_avatar_content_tags_batch(
        &actions,
        AvatarContentTagsBatchInput {
            avatar_ids: vec!["avtr_first".into(), "avtr_not_owned".into()],
            content_tags: vec!["content_horror".into()],
        },
    )
    .await
    .unwrap();

    assert_eq!(output.items[0].state, BatchMutationItemState::NotAttempted);
    assert_eq!(output.items[1].state, BatchMutationItemState::Failed);
    assert!(actions.calls().is_empty());
}
