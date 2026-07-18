use std::{collections::HashSet, future::Future, pin::Pin};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use vrcx_0_core::json::RawJson;
use vrcx_0_persistence::DatabaseService;
use vrcx_0_vrchat_client::{
    avatars::{avatar_get_input, avatar_save_input},
    groups::{leave_input, member_props_set_input},
    http_api::{ApiScope, HttpApiRequestInput},
    users::user_groups_get_input,
};

use crate::{Error, Result, RuntimeAuthScope, RuntimeAuthScopeSnapshot, WebClient};

pub const BATCH_MUTATION_MAX_ITEMS: usize = 1_000;

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AvatarContentTagsBatchInput {
    #[serde(default)]
    pub avatar_ids: Vec<String>,
    #[serde(default)]
    pub content_tags: Vec<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum GroupVisibility {
    Visible,
    Friends,
    Hidden,
}

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GroupVisibilityBatchInput {
    #[serde(default)]
    pub group_ids: Vec<String>,
    pub visibility: GroupVisibility,
}

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GroupLeaveBatchInput {
    #[serde(default)]
    pub group_ids: Vec<String>,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum BatchMutationItemState {
    Updated,
    Left,
    RolledBack,
    RollbackFailed,
    Failed,
    NotAttempted,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct BatchMutationItemResult {
    pub id: String,
    pub state: BatchMutationItemState,
    pub message: String,
    pub entity: Option<RawJson>,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct BatchMutationResult {
    pub total: usize,
    pub succeeded: usize,
    pub failed: usize,
    pub applied_before_failure: usize,
    pub rolled_back: usize,
    pub rollback_failed: usize,
    pub items: Vec<BatchMutationItemResult>,
    pub last_error: Option<String>,
}

pub trait BatchMutationActions: Send + Sync {
    fn fetch_avatar<'a>(
        &'a self,
        avatar_id: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<Value>> + Send + 'a>>;
    fn save_avatar_tags<'a>(
        &'a self,
        avatar_id: &'a str,
        tags: &'a [String],
    ) -> Pin<Box<dyn Future<Output = Result<Value>> + Send + 'a>>;
    fn fetch_current_user_groups(
        &self,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<Value>>> + Send + '_>>;
    fn set_group_visibility<'a>(
        &'a self,
        group_id: &'a str,
        visibility: GroupVisibility,
    ) -> Pin<Box<dyn Future<Output = Result<()>> + Send + 'a>>;
    fn leave_group<'a>(
        &'a self,
        group_id: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<()>> + Send + 'a>>;
    fn current_user_id(&self) -> &str;
}

pub struct VrchatBatchMutationActions<'a> {
    pub db: &'a DatabaseService,
    pub web: &'a WebClient,
    pub auth_scope: &'a RuntimeAuthScope,
    pub expected_scope: RuntimeAuthScopeSnapshot,
}

impl VrchatBatchMutationActions<'_> {
    async fn execute_json(&self, request: HttpApiRequestInput, action: &str) -> Result<Value> {
        ensure_scope_matches(&self.auth_scope.snapshot(), &self.expected_scope)?;
        let response = self
            .web
            .execute_api(request, ApiScope::Vrchat, self.db)
            .await?;
        ensure_scope_matches(&self.auth_scope.snapshot(), &self.expected_scope)?;
        let payload = serde_json::from_str::<Value>(&response.data)
            .unwrap_or_else(|_| Value::String(response.data.clone()));
        if response.status >= 400 || payload.get("error").is_some() {
            return Err(Error::Custom(response_error_message(
                &payload,
                response.status,
                action,
            )));
        }
        Ok(payload)
    }
}

impl BatchMutationActions for VrchatBatchMutationActions<'_> {
    fn fetch_avatar<'a>(
        &'a self,
        avatar_id: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<Value>> + Send + 'a>> {
        Box::pin(async move {
            let (_, request) =
                avatar_get_input(self.expected_scope.endpoint.clone(), avatar_id.to_string())?;
            self.execute_json(request, "avatar snapshot").await
        })
    }

    fn save_avatar_tags<'a>(
        &'a self,
        avatar_id: &'a str,
        tags: &'a [String],
    ) -> Pin<Box<dyn Future<Output = Result<Value>> + Send + 'a>> {
        Box::pin(async move {
            let (_, request) = avatar_save_input(
                self.expected_scope.endpoint.clone(),
                avatar_id.to_string(),
                Some(json!({ "id": avatar_id, "tags": tags })),
            )?;
            self.execute_json(request, "avatar content tag update")
                .await
        })
    }

    fn fetch_current_user_groups(
        &self,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<Value>>> + Send + '_>> {
        Box::pin(async move {
            let (_, request) = user_groups_get_input(
                self.expected_scope.endpoint.clone(),
                self.expected_scope.current_user_id.clone(),
            )?;
            let payload = self
                .execute_json(request, "group membership snapshot")
                .await?;
            Ok(payload.as_array().cloned().unwrap_or_default())
        })
    }

    fn set_group_visibility<'a>(
        &'a self,
        group_id: &'a str,
        visibility: GroupVisibility,
    ) -> Pin<Box<dyn Future<Output = Result<()>> + Send + 'a>> {
        Box::pin(async move {
            let (_, _, request) = member_props_set_input(
                self.expected_scope.endpoint.clone(),
                group_id.to_string(),
                self.expected_scope.current_user_id.clone(),
                Some(json!({ "visibility": visibility_name(visibility) })),
            )?;
            self.execute_json(request, "group visibility update")
                .await?;
            Ok(())
        })
    }

    fn leave_group<'a>(
        &'a self,
        group_id: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<()>> + Send + 'a>> {
        Box::pin(async move {
            let (_, request) =
                leave_input(self.expected_scope.endpoint.clone(), group_id.to_string())?;
            self.execute_json(request, "group leave").await?;
            Ok(())
        })
    }

    fn current_user_id(&self) -> &str {
        &self.expected_scope.current_user_id
    }
}

pub async fn run_avatar_content_tags_batch(
    actions: &dyn BatchMutationActions,
    input: AvatarContentTagsBatchInput,
) -> Result<BatchMutationResult> {
    let avatar_ids = normalize_entity_ids(input.avatar_ids, "avtr_")?;
    let content_tags = normalize_content_tags(input.content_tags)?;
    let mut snapshots = Vec::with_capacity(avatar_ids.len());
    for (index, avatar_id) in avatar_ids.iter().enumerate() {
        let avatar = match actions.fetch_avatar(avatar_id).await {
            Ok(avatar) => avatar,
            Err(error) => {
                return Ok(preflight_failure(&avatar_ids, index, error.to_string()));
            }
        };
        if value_text(&avatar, &["id"]) != *avatar_id {
            return Ok(preflight_failure(
                &avatar_ids,
                index,
                "Avatar snapshot id did not match request.".into(),
            ));
        }
        if value_text(&avatar, &["authorId"]) != actions.current_user_id() {
            return Ok(preflight_failure(
                &avatar_ids,
                index,
                format!("Avatar {avatar_id} is not owned by the authenticated user."),
            ));
        }
        let original_tags = value_string_array(&avatar, "tags");
        let mut next_tags = original_tags
            .iter()
            .filter(|tag| !tag.starts_with("content_"))
            .cloned()
            .collect::<Vec<_>>();
        next_tags.extend(content_tags.iter().cloned());
        snapshots.push((original_tags, next_tags));
    }

    let mut items = avatar_ids
        .iter()
        .map(|id| not_attempted(id))
        .collect::<Vec<_>>();
    let mut applied = Vec::new();
    let mut failure = None;
    for (index, avatar_id) in avatar_ids.iter().enumerate() {
        match actions
            .save_avatar_tags(avatar_id, &snapshots[index].1)
            .await
        {
            Ok(entity) => {
                items[index] = BatchMutationItemResult {
                    id: avatar_id.clone(),
                    state: BatchMutationItemState::Updated,
                    message: String::new(),
                    entity: Some(RawJson::from(entity)),
                };
                applied.push(index);
            }
            Err(error) => {
                let message = error.to_string();
                items[index] = failed_item(avatar_id, message.clone());
                failure = Some(message);
                break;
            }
        }
    }

    if let Some(last_error) = failure {
        let applied_before_failure = applied.len();
        let mut rolled_back = 0;
        let mut rollback_failed = 0;
        for index in applied.into_iter().rev() {
            let avatar_id = &avatar_ids[index];
            match actions
                .save_avatar_tags(avatar_id, &snapshots[index].0)
                .await
            {
                Ok(entity) => {
                    rolled_back += 1;
                    items[index] = BatchMutationItemResult {
                        id: avatar_id.clone(),
                        state: BatchMutationItemState::RolledBack,
                        message: String::new(),
                        entity: Some(RawJson::from(entity)),
                    };
                }
                Err(error) => {
                    rollback_failed += 1;
                    let entity = items[index].entity.take();
                    items[index] = BatchMutationItemResult {
                        id: avatar_id.clone(),
                        state: BatchMutationItemState::RollbackFailed,
                        message: error.to_string(),
                        entity,
                    };
                }
            }
        }
        return Ok(BatchMutationResult {
            total: items.len(),
            succeeded: 0,
            failed: items.len(),
            applied_before_failure,
            rolled_back,
            rollback_failed,
            items,
            last_error: Some(last_error),
        });
    }

    Ok(BatchMutationResult {
        total: items.len(),
        succeeded: items.len(),
        failed: 0,
        applied_before_failure: items.len(),
        rolled_back: 0,
        rollback_failed: 0,
        items,
        last_error: None,
    })
}

pub async fn run_group_visibility_batch(
    actions: &dyn BatchMutationActions,
    input: GroupVisibilityBatchInput,
) -> Result<BatchMutationResult> {
    let group_ids = normalize_entity_ids(input.group_ids, "grp_")?;
    let groups = match actions.fetch_current_user_groups().await {
        Ok(groups) => groups,
        Err(error) => return Ok(preflight_failure(&group_ids, 0, error.to_string())),
    };
    let mut snapshots = Vec::with_capacity(group_ids.len());
    for (index, group_id) in group_ids.iter().enumerate() {
        let Some(visibility) = groups
            .iter()
            .find(|group| group_id_from_value(group) == *group_id)
            .map(group_visibility_from_value)
        else {
            return Ok(preflight_failure(
                &group_ids,
                index,
                format!("Group {group_id} is not in the authenticated user's memberships."),
            ));
        };
        snapshots.push(visibility);
    }
    let mut items = group_ids
        .iter()
        .map(|id| not_attempted(id))
        .collect::<Vec<_>>();
    let mut applied = Vec::new();
    let mut failure = None;
    for (index, group_id) in group_ids.iter().enumerate() {
        match actions
            .set_group_visibility(group_id, input.visibility)
            .await
        {
            Ok(()) => {
                items[index] = succeeded_item(group_id, BatchMutationItemState::Updated);
                applied.push(index);
            }
            Err(error) => {
                let message = error.to_string();
                items[index] = failed_item(group_id, message.clone());
                failure = Some(message);
                break;
            }
        }
    }

    if let Some(last_error) = failure {
        let applied_before_failure = applied.len();
        let mut rolled_back = 0;
        let mut rollback_failed = 0;
        for index in applied.into_iter().rev() {
            let group_id = &group_ids[index];
            match actions
                .set_group_visibility(group_id, snapshots[index])
                .await
            {
                Ok(()) => {
                    rolled_back += 1;
                    items[index] = succeeded_item(group_id, BatchMutationItemState::RolledBack);
                }
                Err(error) => {
                    rollback_failed += 1;
                    items[index] = BatchMutationItemResult {
                        id: group_id.clone(),
                        state: BatchMutationItemState::RollbackFailed,
                        message: error.to_string(),
                        entity: None,
                    };
                }
            }
        }
        return Ok(BatchMutationResult {
            total: items.len(),
            succeeded: 0,
            failed: items.len(),
            applied_before_failure,
            rolled_back,
            rollback_failed,
            items,
            last_error: Some(last_error),
        });
    }

    Ok(BatchMutationResult {
        total: items.len(),
        succeeded: items.len(),
        failed: 0,
        applied_before_failure: items.len(),
        rolled_back: 0,
        rollback_failed: 0,
        items,
        last_error: None,
    })
}

pub async fn run_group_leave_batch(
    actions: &dyn BatchMutationActions,
    input: GroupLeaveBatchInput,
) -> Result<BatchMutationResult> {
    let group_ids = normalize_entity_ids(input.group_ids, "grp_")?;
    let memberships = match actions.fetch_current_user_groups().await {
        Ok(groups) => groups,
        Err(error) => return Ok(preflight_failure(&group_ids, 0, error.to_string())),
    };
    let membership_ids = memberships
        .iter()
        .map(group_id_from_value)
        .filter(|id| !id.is_empty())
        .collect::<HashSet<_>>();
    let mut succeeded = 0;
    let mut items = Vec::with_capacity(group_ids.len());
    let mut last_error = None;
    for group_id in &group_ids {
        if !membership_ids.contains(group_id) {
            let message =
                format!("Group {group_id} is not in the authenticated user's memberships.");
            last_error = Some(message.clone());
            items.push(failed_item(group_id, message));
            continue;
        }
        match actions.leave_group(group_id).await {
            Ok(()) => {
                succeeded += 1;
                items.push(succeeded_item(group_id, BatchMutationItemState::Left));
            }
            Err(error) => {
                let message = error.to_string();
                last_error = Some(message.clone());
                items.push(failed_item(group_id, message));
            }
        }
    }
    Ok(BatchMutationResult {
        total: items.len(),
        succeeded,
        failed: items.len() - succeeded,
        applied_before_failure: succeeded,
        rolled_back: 0,
        rollback_failed: 0,
        items,
        last_error,
    })
}

fn normalize_entity_ids(ids: Vec<String>, prefix: &str) -> Result<Vec<String>> {
    let mut seen = HashSet::new();
    let mut normalized = Vec::new();
    for id in ids {
        let id = id.trim().to_string();
        if !id.starts_with(prefix) || id.len() == prefix.len() {
            return Err(Error::Custom(format!(
                "Batch mutation contains an invalid {prefix} entity id."
            )));
        }
        if seen.insert(id.clone()) {
            normalized.push(id);
        }
    }
    let ids = normalized;
    if ids.is_empty() {
        Err(Error::Custom(
            "Batch mutation requires at least one valid entity id.".into(),
        ))
    } else if ids.len() > BATCH_MUTATION_MAX_ITEMS {
        Err(Error::Custom(format!(
            "Batch mutation cannot exceed {BATCH_MUTATION_MAX_ITEMS} items."
        )))
    } else {
        Ok(ids)
    }
}

fn normalize_content_tags(tags: Vec<String>) -> Result<Vec<String>> {
    let mut seen = HashSet::new();
    let mut normalized = Vec::new();
    for tag in tags {
        let tag = tag.trim().to_string();
        if !tag.starts_with("content_") || tag.len() == "content_".len() {
            return Err(Error::Custom(
                "Avatar content tag batch contains an invalid content tag.".into(),
            ));
        }
        if seen.insert(tag.clone()) {
            normalized.push(tag);
        }
    }
    Ok(normalized)
}

fn value_string_array(value: &Value, key: &str) -> Vec<String> {
    value
        .get(key)
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_string)
        .collect()
}

fn value_text(value: &Value, keys: &[&str]) -> String {
    keys.iter()
        .find_map(|key| value.get(*key).and_then(Value::as_str))
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn group_id_from_value(value: &Value) -> String {
    let nested = value.get("group").unwrap_or(&Value::Null);
    for candidate in [
        value_text(value, &["groupId", "group_id"]),
        value_text(nested, &["id", "groupId", "group_id"]),
        value_text(value, &["id"]),
    ] {
        if candidate.starts_with("grp_") {
            return candidate;
        }
    }
    String::new()
}

fn group_visibility_from_value(value: &Value) -> GroupVisibility {
    let my_member = value
        .get("myMember")
        .or_else(|| value.get("my_member"))
        .unwrap_or(&Value::Null);
    let visibility = value_text(
        value,
        &["memberVisibility", "member_visibility", "visibility"],
    );
    let visibility = if visibility.is_empty() {
        value_text(my_member, &["visibility"])
    } else {
        visibility
    };
    match visibility.as_str() {
        "friends" => GroupVisibility::Friends,
        "hidden" => GroupVisibility::Hidden,
        _ => GroupVisibility::Visible,
    }
}

fn visibility_name(visibility: GroupVisibility) -> &'static str {
    match visibility {
        GroupVisibility::Visible => "visible",
        GroupVisibility::Friends => "friends",
        GroupVisibility::Hidden => "hidden",
    }
}

fn not_attempted(id: &str) -> BatchMutationItemResult {
    succeeded_item(id, BatchMutationItemState::NotAttempted)
}

fn succeeded_item(id: &str, state: BatchMutationItemState) -> BatchMutationItemResult {
    BatchMutationItemResult {
        id: id.to_string(),
        state,
        message: String::new(),
        entity: None,
    }
}

fn failed_item(id: &str, message: String) -> BatchMutationItemResult {
    BatchMutationItemResult {
        id: id.to_string(),
        state: BatchMutationItemState::Failed,
        message,
        entity: None,
    }
}

fn preflight_failure(ids: &[String], failed_index: usize, message: String) -> BatchMutationResult {
    let mut items = ids.iter().map(|id| not_attempted(id)).collect::<Vec<_>>();
    items[failed_index] = failed_item(&ids[failed_index], message.clone());
    BatchMutationResult {
        total: items.len(),
        succeeded: 0,
        failed: items.len(),
        applied_before_failure: 0,
        rolled_back: 0,
        rollback_failed: 0,
        items,
        last_error: Some(message),
    }
}

fn ensure_scope_matches(
    current: &RuntimeAuthScopeSnapshot,
    expected: &RuntimeAuthScopeSnapshot,
) -> Result<()> {
    if current.active
        && current.generation == expected.generation
        && current.current_user_id == expected.current_user_id
        && current.endpoint == expected.endpoint
    {
        Ok(())
    } else {
        Err(Error::Custom(
            "Batch mutation authentication scope changed.".into(),
        ))
    }
}

fn response_error_message(payload: &Value, status: i32, action: &str) -> String {
    payload
        .get("error")
        .and_then(Value::as_object)
        .and_then(|error| error.get("message"))
        .and_then(Value::as_str)
        .or_else(|| payload.get("message").and_then(Value::as_str))
        .map(str::to_string)
        .unwrap_or_else(|| format!("VRChat {action} failed with HTTP {status}."))
}

#[cfg(test)]
mod tests;
