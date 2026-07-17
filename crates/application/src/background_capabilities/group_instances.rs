use std::collections::{HashMap, HashSet};

use chrono::Utc;
use futures_util::{stream, StreamExt};
use serde_json::{json, Map, Value};
use vrcx_0_core::location::parse_location;
use vrcx_0_persistence::DatabaseService;
use vrcx_0_vrchat_client::groups::current_user_group_instances_get_input;
use vrcx_0_vrchat_client::groups::profile_get_input as group_profile_get_input;
use vrcx_0_vrchat_client::http_api::{normalize_vrchat_api_endpoint, ApiScope};

use crate::{Error, Result, WebClient};

use super::shared::{parse_response_json, BackgroundCapabilitySession};

const GROUP_PROFILE_HYDRATION_CONCURRENCY: usize = 4;
#[derive(Clone, Debug, Default)]
pub struct BackgroundGroupInstancesRefresh {
    pub instances: Vec<Value>,
    pub fetched_at: String,
}

pub async fn refresh_background_current_user(
    web: &WebClient,
    db: &DatabaseService,
    session: &BackgroundCapabilitySession,
) -> Result<Value> {
    let response = web
        .execute_api(
            vrcx_0_vrchat_client::auth::current_user_get_input(normalize_vrchat_api_endpoint(
                Some(&session.endpoint),
            )),
            ApiScope::Vrchat,
            db,
        )
        .await?;
    if !(200..=299).contains(&response.status) {
        return Err(Error::Custom(format!(
            "current user refresh returned HTTP {}",
            response.status
        )));
    }
    parse_response_json(&response.data)
        .ok_or_else(|| Error::Custom("current user refresh returned invalid JSON".into()))
}

pub async fn refresh_background_group_instances(
    web: &WebClient,
    db: &DatabaseService,
    session: &BackgroundCapabilitySession,
) -> Result<BackgroundGroupInstancesRefresh> {
    let (_, request) = current_user_group_instances_get_input(
        normalize_vrchat_api_endpoint(Some(&session.endpoint)),
        session.current_user_id.clone(),
    )?;
    let response = web.execute_api(request, ApiScope::Vrchat, db).await?;
    if !(200..=299).contains(&response.status) {
        return Err(Error::Custom(format!(
            "group instance refresh returned HTTP {}",
            response.status
        )));
    }
    let fetched_at = Utc::now().to_rfc3339();
    let value = parse_response_json(&response.data).unwrap_or(Value::Null);
    let instances = value
        .as_array()
        .cloned()
        .or_else(|| value.get("instances").and_then(Value::as_array).cloned())
        .unwrap_or_default();
    let instances = hydrate_background_group_instances(web, db, &session.endpoint, instances).await;
    Ok(BackgroundGroupInstancesRefresh {
        instances,
        fetched_at,
    })
}

async fn hydrate_background_group_instances(
    web: &WebClient,
    db: &DatabaseService,
    endpoint: &str,
    instances: Vec<Value>,
) -> Vec<Value> {
    let mut group_ids = Vec::new();
    let mut seen = HashSet::new();
    for instance in &instances {
        if has_complete_group_instance_group(instance) {
            continue;
        }
        let group_id = normalize_group_instance_group_id(instance);
        if !group_id.is_empty() && seen.insert(group_id.clone()) {
            group_ids.push(group_id);
        }
    }
    if group_ids.is_empty() {
        return instances;
    }

    let endpoint = normalize_vrchat_api_endpoint(Some(endpoint));
    let group_fetches = group_ids.into_iter().filter_map(|group_id| {
        let Ok((_, request)) = group_profile_get_input(endpoint.clone(), group_id.clone(), false)
        else {
            return None;
        };
        Some(async move {
            match web.execute_api(request, ApiScope::Vrchat, db).await {
                Ok(response) if (200..=299).contains(&response.status) => {
                    parse_response_json(&response.data).map(|group| (group_id, group))
                }
                Ok(response) => {
                    tracing::warn!(
                        group_id,
                        status = response.status,
                        "background group instance profile hydration failed"
                    );
                    None
                }
                Err(error) => {
                    tracing::warn!(
                        group_id,
                        error = %error,
                        "background group instance profile hydration failed"
                    );
                    None
                }
            }
        })
    });
    let groups_by_id: HashMap<String, Value> = stream::iter(group_fetches)
        .buffer_unordered(GROUP_PROFILE_HYDRATION_CONCURRENCY)
        .collect::<Vec<_>>()
        .await
        .into_iter()
        .flatten()
        .collect();

    instances
        .into_iter()
        .map(|instance| hydrate_group_instance(instance, &groups_by_id))
        .collect()
}

fn hydrate_group_instance(mut instance: Value, groups_by_id: &HashMap<String, Value>) -> Value {
    let group_id = normalize_group_instance_group_id(&instance);
    let existing_group = group_instance_group(&instance)
        .cloned()
        .or_else(|| group_fallback(&group_id));
    let fetched_group = groups_by_id.get(&group_id).cloned();
    let Some(group) = merge_group_instance_group(existing_group, fetched_group, &group_id) else {
        return instance;
    };
    if let Some(object) = instance.as_object_mut() {
        object.insert("group".into(), group);
    }
    instance
}

fn group_instance_group(instance: &Value) -> Option<&Value> {
    instance.get("group").or_else(|| {
        instance
            .get("instance")
            .and_then(|value| value.get("group"))
    })
}

fn group_fallback(group_id: &str) -> Option<Value> {
    if group_id.is_empty() {
        None
    } else {
        Some(json!({
            "id": group_id,
            "groupId": group_id,
            "name": group_id,
        }))
    }
}

fn merge_group_instance_group(
    existing_group: Option<Value>,
    fetched_group: Option<Value>,
    group_id: &str,
) -> Option<Value> {
    let existing_name = existing_group
        .as_ref()
        .and_then(|group| resolve_group_instance_name_value(group, group_id));
    let fetched_name = fetched_group
        .as_ref()
        .and_then(|group| resolve_group_instance_name_value(group, group_id));
    let mut merged = Map::new();
    if let Some(Value::Object(fetched)) = fetched_group {
        merged.extend(fetched);
    }
    if let Some(Value::Object(existing)) = existing_group {
        merged.extend(existing);
    }
    if merged.is_empty() {
        return None;
    }

    let id = first_non_empty_owned([
        string_field_value(merged.get("id")).unwrap_or_default(),
        string_field_value(merged.get("groupId")).unwrap_or_default(),
        group_id.to_string(),
    ]);
    if !id.is_empty() {
        merged.insert("id".into(), Value::String(id.clone()));
        merged.insert("groupId".into(), Value::String(id));
    }

    let name = first_non_empty_owned([
        existing_name.unwrap_or_default(),
        fetched_name.unwrap_or_default(),
        resolve_group_instance_name(&merged, group_id),
    ]);
    if !name.is_empty() {
        merged.insert("name".into(), Value::String(name));
    }
    Some(Value::Object(merged))
}

fn resolve_group_instance_name_value(group: &Value, group_id: &str) -> Option<String> {
    let group = group.as_object()?;
    let name = resolve_group_instance_name(group, group_id);
    if name.is_empty() {
        None
    } else {
        Some(name)
    }
}

fn resolve_group_instance_name(group: &Map<String, Value>, group_id: &str) -> String {
    let name = first_non_empty_owned([
        string_field_value(group.get("name")).unwrap_or_default(),
        string_field_value(group.get("displayName")).unwrap_or_default(),
    ]);
    if name.is_empty() || name == group_id {
        String::new()
    } else {
        name
    }
}

fn has_complete_group_instance_group(instance: &Value) -> bool {
    let Some(group) = group_instance_group(instance) else {
        return false;
    };
    let has_id = string_field_value(group.get("id")).is_some()
        || string_field_value(group.get("groupId")).is_some();
    let has_name = string_field_value(group.get("name")).is_some();
    let has_icon = ["iconUrl", "icon", "thumbnailUrl", "imageUrl"]
        .iter()
        .any(|key| string_field_value(group.get(*key)).is_some());
    has_id && has_name && has_icon
}

fn normalize_group_instance_group_id(instance: &Value) -> String {
    let location = string_field_value(instance.get("location"))
        .or_else(|| {
            instance
                .get("instance")
                .and_then(|value| string_field_value(value.get("location")))
        })
        .unwrap_or_default();
    let parsed_location = parse_location(&location);
    first_group_id([
        nested_string(instance, &["group", "groupId"]),
        nested_string(instance, &["group", "id"]),
        nested_string(instance, &["instance", "group", "groupId"]),
        nested_string(instance, &["instance", "group", "id"]),
        string_field_value(instance.get("groupId")).unwrap_or_default(),
        string_field_value(instance.get("group_id")).unwrap_or_default(),
        nested_string(instance, &["instance", "groupId"]),
        nested_string(instance, &["instance", "group_id"]),
        string_field_value(instance.get("ownerId")).unwrap_or_default(),
        string_field_value(instance.get("owner_id")).unwrap_or_default(),
        nested_string(instance, &["instance", "ownerId"]),
        nested_string(instance, &["instance", "owner_id"]),
        parsed_location.group_id.unwrap_or_default(),
    ])
}

fn first_group_id(values: impl IntoIterator<Item = String>) -> String {
    values
        .into_iter()
        .map(|value| value.trim().to_string())
        .find(|value| value.starts_with("grp_"))
        .unwrap_or_default()
}

fn first_non_empty_owned(values: impl IntoIterator<Item = String>) -> String {
    values
        .into_iter()
        .map(|value| value.trim().to_string())
        .find(|value| !value.is_empty())
        .unwrap_or_default()
}

fn nested_string(value: &Value, path: &[&str]) -> String {
    let mut current = value;
    for key in path {
        let Some(next) = current.get(*key) else {
            return String::new();
        };
        current = next;
    }
    string_field_value(Some(current)).unwrap_or_default()
}

fn string_field_value(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

#[cfg(test)]
mod tests;
