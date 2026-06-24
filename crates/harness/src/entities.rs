use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use specta::Type;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Type)]
#[serde(rename_all = "camelCase")]
pub struct Entity {
    pub kind: String,
    pub id: String,
    pub display_name: String,
}

/// Recursively scan a tool result JSON for user/world entities.
///
/// Heuristic: any object carrying a VRChat id (`usr_*` / `wrld_*`, found in an
/// `id` field or a `*_id`/`*Id` field) together with a name-like sibling is
/// collected once, keyed by id so duplicates across the payload collapse.
pub fn extract_entities(value: &Value) -> Vec<Entity> {
    let mut found: BTreeMap<String, Entity> = BTreeMap::new();
    walk(value, &mut found);
    found.into_values().collect()
}

fn walk(value: &Value, found: &mut BTreeMap<String, Entity>) {
    match value {
        Value::Object(map) => {
            if let Some(entity) = entity_from_object(map) {
                found.entry(entity.id.clone()).or_insert(entity);
            }
            for nested in map.values() {
                walk(nested, found);
            }
        }
        Value::Array(items) => {
            for item in items {
                walk(item, found);
            }
        }
        _ => {}
    }
}

fn entity_from_object(map: &serde_json::Map<String, Value>) -> Option<Entity> {
    let id = object_entity_id(map)?;
    let kind = if id.starts_with("usr_") {
        "user"
    } else if id.starts_with("wrld_") {
        "world"
    } else {
        return None;
    };
    let display_name = name_field(map).unwrap_or_default();
    Some(Entity {
        kind: kind.into(),
        id,
        display_name,
    })
}

fn object_entity_id(map: &serde_json::Map<String, Value>) -> Option<String> {
    for (key, value) in map {
        let Some(text) = value.as_str() else {
            continue;
        };
        if !(text.starts_with("usr_") || text.starts_with("wrld_")) {
            continue;
        }
        let lowered = key.to_ascii_lowercase();
        if lowered == "id" || lowered.ends_with("_id") || lowered.ends_with("id") {
            return Some(text.to_string());
        }
    }
    None
}

fn name_field(map: &serde_json::Map<String, Value>) -> Option<String> {
    const NAME_KEYS: [&str; 4] = ["display_name", "displayName", "name", "world_name"];
    for key in NAME_KEYS {
        if let Some(text) = map.get(key).and_then(Value::as_str) {
            if !text.trim().is_empty() {
                return Some(text.to_string());
            }
        }
    }
    None
}

/// Entities the final answer actually names, ordered by where they first appear
/// in the answer (earlier mention = higher priority). No cap — the panel shows
/// everyone the answer surfaced. Empty when the answer names nobody.
pub fn surfaced_entities(candidates: Vec<Entity>, answer: &str) -> Vec<Entity> {
    let lowered_answer = answer.to_ascii_lowercase();
    let mut named: Vec<(usize, Entity)> = candidates
        .into_iter()
        .filter_map(|entity| {
            if entity.display_name.is_empty() {
                return None;
            }
            let position = lowered_answer.find(&entity.display_name.to_ascii_lowercase())?;
            Some((position, entity))
        })
        .collect();
    named.sort_by_key(|(position, _)| *position);
    named.into_iter().map(|(_, entity)| entity).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn user(id: &str, name: &str) -> Entity {
        Entity {
            kind: "user".into(),
            id: id.into(),
            display_name: name.into(),
        }
    }

    #[test]
    fn orders_by_first_mention_and_keeps_all() {
        // Candidate order (Bob, Alice, Carol) differs from mention order in the
        // answer (Alice, Carol, Bob); the result follows the answer, uncapped.
        let candidates = vec![
            user("usr_b", "Bob"),
            user("usr_a", "Alice"),
            user("usr_c", "Carol"),
        ];
        let answer = "Alice plays the most, then Carol, and sometimes Bob.";
        let surfaced = surfaced_entities(candidates, answer);
        let ids: Vec<&str> = surfaced.iter().map(|e| e.id.as_str()).collect();
        assert_eq!(ids, ["usr_a", "usr_c", "usr_b"]);
    }

    #[test]
    fn drops_entities_the_answer_does_not_name() {
        let candidates = vec![user("usr_a", "Alice"), user("usr_b", "Bob")];
        let surfaced = surfaced_entities(candidates, "You mostly play with Alice.");
        assert_eq!(surfaced.len(), 1);
        assert_eq!(surfaced[0].id, "usr_a");
    }

    #[test]
    fn empty_when_answer_names_nobody() {
        let candidates = vec![user("usr_a", "Alice")];
        assert!(surfaced_entities(candidates, "No friends were observed.").is_empty());
    }
}
