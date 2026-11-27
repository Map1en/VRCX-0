use serde_json::Value;
use vrcx_0_core::FavoriteEntityKind;

use crate::common::row_string;
use crate::config::resolve_config_key;
use crate::migration::MigrationTx;
use crate::Error;

const LOCAL_PREFIX: &str = "local:";

const FRIEND_REFERENCE_KEYS: [&str; 13] = [
    "localFavoriteFriendsGroups",
    "sidebarFavoriteGroups",
    "sidebarFavoriteGroupOrder",
    "sidebarTabLayout",
    "autoAcceptInviteGroups",
    "feedColumnsConfig",
    "overlayActivityFilters",
    "vrNotificationActivityFilters",
    "hmdNotificationActivityFilters",
    "desktopNotificationActivityFilters",
    "webhookActivityFilters",
    "ttsNotificationActivityFilters",
    "desktopWidgetActivityFilters",
];

const PRESENCE_RULE_KEYS: [&str; 2] = [
    "presenceAutomationTimeRules",
    "presenceAutomationContextRules",
];

const SELECTED_GROUP_KEYS: [(&str, FavoriteEntityKind); 3] = [
    (
        "VRCX_FavoritesFriendSelectedGroup",
        FavoriteEntityKind::Friend,
    ),
    (
        "VRCX_FavoritesWorldSelectedGroup",
        FavoriteEntityKind::World,
    ),
    (
        "VRCX_FavoritesAvatarSelectedGroup",
        FavoriteEntityKind::Avatar,
    ),
];

type GroupLookup<'a> = dyn Fn(FavoriteEntityKind, &str) -> Vec<i64> + 'a;

pub(crate) fn rewrite_config_references(
    tx: &dyn MigrationTx,
    lookup: &GroupLookup<'_>,
) -> Result<(), Error> {
    if !table_exists(tx, "configs")? {
        return Ok(());
    }
    let keys = FRIEND_REFERENCE_KEYS
        .iter()
        .chain(PRESENCE_RULE_KEYS.iter())
        .chain(SELECTED_GROUP_KEYS.iter().map(|(key, _)| key))
        .map(|key| quote(&resolve_config_key(key)))
        .collect::<Vec<_>>();
    let rows = tx.query(&format!(
        "SELECT key, value FROM configs WHERE key IN ({})",
        keys.join(", ")
    ))?;
    for row in rows {
        let key = row_string(&row, 0);
        if let Some(value) = rewrite_config_value(&key, &row_string(&row, 1), lookup) {
            tx.execute_non_query(&format!(
                "UPDATE configs SET value = {} WHERE key = {}",
                quote(&value),
                quote(&key)
            ))?;
        }
    }
    Ok(())
}

pub(crate) fn table_exists(tx: &dyn MigrationTx, table: &str) -> Result<bool, Error> {
    Ok(!tx
        .query(&format!(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = {}",
            quote(table)
        ))?
        .is_empty())
}

pub(crate) fn quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn rewrite_config_value(stored_key: &str, raw: &str, lookup: &GroupLookup<'_>) -> Option<String> {
    let mut value = serde_json::from_str::<Value>(raw).ok()?;
    let matches = |key: &&str| resolve_config_key(key) == stored_key;
    let changed = if FRIEND_REFERENCE_KEYS.iter().any(matches) {
        rewrite_references(&mut value, FavoriteEntityKind::Friend, lookup)
    } else if PRESENCE_RULE_KEYS.iter().any(matches) {
        rewrite_presence_rules(&mut value, lookup)
    } else if let Some((_, kind)) = SELECTED_GROUP_KEYS
        .iter()
        .find(|(key, _)| resolve_config_key(key) == stored_key)
    {
        rewrite_selected_group(&mut value, *kind, lookup)
    } else {
        false
    };
    changed.then(|| value.to_string())
}

fn rewrite_presence_rules(value: &mut Value, lookup: &GroupLookup<'_>) -> bool {
    let mut changed = false;
    for rule in value.as_array_mut().into_iter().flatten() {
        if let Some(selected) = rule.get_mut("selectedGroups") {
            changed |= rewrite_references(selected, FavoriteEntityKind::Friend, lookup);
        }
        if let Some(selected) = rule.get_mut("selectedWorldGroups") {
            changed |= rewrite_references(selected, FavoriteEntityKind::World, lookup);
        }
        for condition in rule
            .get_mut("conditions")
            .and_then(Value::as_array_mut)
            .into_iter()
            .flatten()
        {
            let kind = match condition.get("type").and_then(Value::as_str) {
                Some("hasFriendInGroups") => FavoriteEntityKind::Friend,
                Some("worldInFavoriteGroups") => FavoriteEntityKind::World,
                _ => continue,
            };
            if let Some(values) = condition.get_mut("values") {
                changed |= rewrite_references(values, kind, lookup);
            }
        }
    }
    changed
}

fn rewrite_selected_group(
    value: &mut Value,
    kind: FavoriteEntityKind,
    lookup: &GroupLookup<'_>,
) -> bool {
    let Some(fields) = value.as_object_mut() else {
        return false;
    };
    if fields.get("source").and_then(Value::as_str) != Some("local") {
        return false;
    }
    let Some(key) = fields.get("key").and_then(Value::as_str) else {
        return false;
    };
    let key = lookup(kind, key.trim())
        .first()
        .map(ToString::to_string)
        .unwrap_or_default();
    fields.insert("key".into(), Value::String(key));
    true
}

fn rewrite_references(
    value: &mut Value,
    kind: FavoriteEntityKind,
    lookup: &GroupLookup<'_>,
) -> bool {
    match value {
        Value::String(text) => match replacement_keys(text, kind, lookup) {
            Some(keys) if !keys.is_empty() => {
                *text = keys[0].clone();
                true
            }
            _ => false,
        },
        Value::Array(items) => {
            let mut changed = false;
            let mut rewritten: Vec<Value> = Vec::with_capacity(items.len());
            for mut item in std::mem::take(items) {
                let replacements = item
                    .as_str()
                    .and_then(|text| replacement_keys(text, kind, lookup));
                let entries = match replacements {
                    Some(keys) => {
                        changed = true;
                        keys.into_iter().map(Value::String).collect()
                    }
                    None => {
                        changed |= rewrite_references(&mut item, kind, lookup);
                        vec![item]
                    }
                };
                for entry in entries {
                    if entry.is_string() && rewritten.contains(&entry) {
                        changed = true;
                    } else {
                        rewritten.push(entry);
                    }
                }
            }
            *items = rewritten;
            changed
        }
        Value::Object(fields) => fields.values_mut().fold(false, |changed, item| {
            rewrite_references(item, kind, lookup) | changed
        }),
        _ => false,
    }
}

fn replacement_keys(
    text: &str,
    kind: FavoriteEntityKind,
    lookup: &GroupLookup<'_>,
) -> Option<Vec<String>> {
    let token = text.strip_prefix(LOCAL_PREFIX)?.trim();
    Some(
        lookup(kind, token)
            .into_iter()
            .map(|id| format!("{LOCAL_PREFIX}{id}"))
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(kind: FavoriteEntityKind, token: &str) -> Vec<i64> {
        match (kind, token) {
            (FavoriteEntityKind::Friend, "Close") => vec![3, 7],
            (FavoriteEntityKind::World, "Close") => vec![9],
            _ => Vec::new(),
        }
    }

    #[test]
    fn friend_reference_arrays_expand_to_every_matching_group_and_drop_unknown_refs() {
        let rewritten = rewrite_config_value(
            &resolve_config_key("sidebarFavoriteGroupOrder"),
            r#"["friend:group_0","local:Close","local:Gone","local:Close"]"#,
            &names,
        )
        .unwrap();

        assert_eq!(rewritten, r#"["friend:group_0","local:3","local:7"]"#);
    }

    #[test]
    fn presence_rules_rewrite_friend_and_world_fields_by_kind() {
        let raw = serde_json::json!([{
            "selectedGroups": ["local:Close"],
            "selectedWorldGroups": ["local:Close"],
            "conditions": [
                {"type": "hasFriendInGroups", "values": ["local:Close"]},
                {"type": "worldInFavoriteGroups", "values": ["local:Close"]},
                {"type": "other", "values": ["local:Close"]}
            ]
        }])
        .to_string();

        let rewritten: Value = serde_json::from_str(
            &rewrite_config_value(
                &resolve_config_key("presenceAutomationContextRules"),
                &raw,
                &names,
            )
            .unwrap(),
        )
        .unwrap();

        assert_eq!(
            rewritten,
            serde_json::json!([{
                "selectedGroups": ["local:3", "local:7"],
                "selectedWorldGroups": ["local:9"],
                "conditions": [
                    {"type": "hasFriendInGroups", "values": ["local:3", "local:7"]},
                    {"type": "worldInFavoriteGroups", "values": ["local:9"]},
                    {"type": "other", "values": ["local:Close"]}
                ]
            }])
        );
    }

    #[test]
    fn selected_local_group_points_at_the_first_matching_group_or_clears() {
        let key = resolve_config_key("VRCX_FavoritesWorldSelectedGroup");
        assert_eq!(
            rewrite_config_value(&key, r#"{"key":"Close","source":"local"}"#, &names).unwrap(),
            r#"{"key":"9","source":"local"}"#
        );
        assert_eq!(
            rewrite_config_value(&key, r#"{"key":"Gone","source":"local"}"#, &names).unwrap(),
            r#"{"key":"","source":"local"}"#
        );
        assert_eq!(
            rewrite_config_value(&key, r#"{"key":"Close","source":"remote"}"#, &names),
            None
        );
    }

    #[test]
    fn unrelated_keys_and_unparsable_values_are_left_alone() {
        assert_eq!(
            rewrite_config_value(
                &resolve_config_key("someOtherSetting"),
                r#"["local:Close"]"#,
                &names
            ),
            None
        );
        assert_eq!(
            rewrite_config_value(
                &resolve_config_key("sidebarFavoriteGroups"),
                "not json",
                &names
            ),
            None
        );
    }
}
