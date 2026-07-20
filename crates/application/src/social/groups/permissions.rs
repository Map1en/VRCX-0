use std::collections::HashMap;

use serde_json::Value;

pub(super) fn parse_permission_map(value: &Value) -> HashMap<String, Vec<String>> {
    value
        .as_object()
        .map(|object| {
            object
                .iter()
                .map(|(group_id, permissions)| (group_id.clone(), string_array(Some(permissions))))
                .collect()
        })
        .unwrap_or_default()
}

pub(super) fn permissions_for_group(
    group: &Value,
    permission_map: &HashMap<String, Vec<String>>,
    group_id: &str,
) -> Vec<String> {
    if let Some(permissions) = permission_map.get(group_id) {
        return permissions.clone();
    }
    group
        .as_object()
        .and_then(|object| object.get("myMember"))
        .and_then(Value::as_object)
        .map(|member| string_array(member.get("permissions")))
        .unwrap_or_default()
}

pub(super) fn has_permission(permissions: &[String], permission: &str) -> bool {
    permissions
        .iter()
        .any(|value| value == "*" || value == permission)
}

fn string_array(value: Option<&Value>) -> Vec<String> {
    match value {
        Some(Value::Array(values)) => values
            .iter()
            .filter_map(|value| {
                let text = value_as_string(Some(value));
                (!text.is_empty()).then_some(text)
            })
            .collect(),
        Some(value) => {
            let text = value_as_string(Some(value));
            if text.is_empty() {
                Vec::new()
            } else {
                vec![text]
            }
        }
        None => Vec::new(),
    }
}

fn value_as_string(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(value)) => value.trim().to_string(),
        Some(Value::Number(value)) => value.to_string(),
        Some(Value::Bool(value)) => value.to_string(),
        _ => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn permissions_for_group_prefers_permission_map_over_my_member() {
        let permission_map = parse_permission_map(&json!({ "grp_1": ["group-bans-manage"] }));
        let group = json!({
            "id": "grp_1",
            "myMember": { "permissions": ["group-members-remove"] }
        });

        assert_eq!(
            permissions_for_group(&group, &permission_map, "grp_1"),
            vec!["group-bans-manage".to_string()]
        );
    }

    #[test]
    fn permissions_for_group_falls_back_to_my_member_when_missing_from_map() {
        let permission_map = HashMap::new();
        let group = json!({
            "id": "grp_1",
            "myMember": { "permissions": ["group-members-remove"] }
        });

        assert_eq!(
            permissions_for_group(&group, &permission_map, "grp_1"),
            vec!["group-members-remove".to_string()]
        );
    }

    #[test]
    fn permissions_for_group_returns_empty_when_both_sources_are_missing() {
        let group = json!({ "id": "grp_1" });
        assert!(permissions_for_group(&group, &HashMap::new(), "grp_1").is_empty());
    }

    #[test]
    fn has_permission_matches_wildcard_and_exact_values() {
        assert!(has_permission(&["*".to_string()], "group-bans-manage"));
        assert!(has_permission(
            &["group-bans-manage".to_string()],
            "group-bans-manage"
        ));
        assert!(!has_permission(
            &["group-invites-manage".to_string()],
            "group-bans-manage"
        ));
    }
}
