use std::collections::BTreeMap;

use serde_json::{Map, Value};

use super::types::{
    OverlayActivityCategory, OverlayActivityFavoriteGroupKeys, OverlayActivityFilters,
    OverlayActivityRule, OverlayActivityScope, OverlayActivityTypeDefinition,
};

#[derive(Clone, Copy)]
pub(super) struct ActivityTypeDefinition {
    pub(super) key: &'static str,
    pub(super) category: OverlayActivityCategory,
    allowed_scopes: &'static [OverlayActivityScope],
    default_scope: OverlayActivityScope,
    aliases: &'static [&'static str],
}

const BOOLEAN_SCOPES: &[OverlayActivityScope] =
    &[OverlayActivityScope::Off, OverlayActivityScope::On];
const DIRECT_ACTOR_SCOPES: &[OverlayActivityScope] = &[
    OverlayActivityScope::Off,
    OverlayActivityScope::On,
    OverlayActivityScope::Friends,
    OverlayActivityScope::SelectedFavorites,
    OverlayActivityScope::AllFavorites,
];
const FRIEND_ACTOR_SCOPES: &[OverlayActivityScope] = &[
    OverlayActivityScope::Off,
    OverlayActivityScope::Friends,
    OverlayActivityScope::SelectedFavorites,
    OverlayActivityScope::AllFavorites,
];
const INSTANCE_ACTOR_SCOPES: &[OverlayActivityScope] = &[
    OverlayActivityScope::Off,
    OverlayActivityScope::Friends,
    OverlayActivityScope::SelectedFavorites,
    OverlayActivityScope::AllFavorites,
    OverlayActivityScope::EveryoneInInstance,
];

const ACTIVITY_TYPES: &[ActivityTypeDefinition] = &[
    definition(
        "invite",
        OverlayActivityCategory::ActionRequired,
        DIRECT_ACTOR_SCOPES,
        OverlayActivityScope::Friends,
        &[],
    ),
    definition(
        "requestInvite",
        OverlayActivityCategory::ActionRequired,
        DIRECT_ACTOR_SCOPES,
        OverlayActivityScope::Friends,
        &[],
    ),
    definition(
        "inviteResponse",
        OverlayActivityCategory::ActionRequired,
        DIRECT_ACTOR_SCOPES,
        OverlayActivityScope::Friends,
        &[],
    ),
    definition(
        "requestInviteResponse",
        OverlayActivityCategory::ActionRequired,
        DIRECT_ACTOR_SCOPES,
        OverlayActivityScope::Friends,
        &[],
    ),
    definition(
        "friendRequest",
        OverlayActivityCategory::ActionRequired,
        BOOLEAN_SCOPES,
        OverlayActivityScope::On,
        &[],
    ),
    definition(
        "boop",
        OverlayActivityCategory::ActionRequired,
        DIRECT_ACTOR_SCOPES,
        OverlayActivityScope::Friends,
        &[],
    ),
    definition(
        "group.queueReady",
        OverlayActivityCategory::ActionRequired,
        BOOLEAN_SCOPES,
        OverlayActivityScope::On,
        &[],
    ),
    definition(
        "instance.closed",
        OverlayActivityCategory::ActionRequired,
        BOOLEAN_SCOPES,
        OverlayActivityScope::On,
        &[],
    ),
    definition(
        "OnPlayerJoining",
        OverlayActivityCategory::CurrentInstance,
        INSTANCE_ACTOR_SCOPES,
        OverlayActivityScope::Friends,
        &[],
    ),
    definition(
        "OnPlayerJoined",
        OverlayActivityCategory::CurrentInstance,
        INSTANCE_ACTOR_SCOPES,
        OverlayActivityScope::EveryoneInInstance,
        &[],
    ),
    definition(
        "OnPlayerLeft",
        OverlayActivityCategory::CurrentInstance,
        INSTANCE_ACTOR_SCOPES,
        OverlayActivityScope::EveryoneInInstance,
        &[],
    ),
    definition(
        "ChatBoxMessage",
        OverlayActivityCategory::CurrentInstance,
        INSTANCE_ACTOR_SCOPES,
        OverlayActivityScope::Off,
        &[],
    ),
    definition(
        "Online",
        OverlayActivityCategory::FavoriteMovement,
        FRIEND_ACTOR_SCOPES,
        OverlayActivityScope::Friends,
        &[],
    ),
    definition(
        "Offline",
        OverlayActivityCategory::FavoriteMovement,
        FRIEND_ACTOR_SCOPES,
        OverlayActivityScope::Friends,
        &[],
    ),
    definition(
        "GPS",
        OverlayActivityCategory::FavoriteMovement,
        FRIEND_ACTOR_SCOPES,
        OverlayActivityScope::Friends,
        &[],
    ),
    definition(
        "Status",
        OverlayActivityCategory::FavoriteMovement,
        FRIEND_ACTOR_SCOPES,
        OverlayActivityScope::Friends,
        &[],
    ),
    definition(
        "Friend",
        OverlayActivityCategory::ProfileChange,
        BOOLEAN_SCOPES,
        OverlayActivityScope::On,
        &[],
    ),
    definition(
        "Unfriend",
        OverlayActivityCategory::ProfileChange,
        BOOLEAN_SCOPES,
        OverlayActivityScope::On,
        &[],
    ),
    definition(
        "DisplayName",
        OverlayActivityCategory::ProfileChange,
        FRIEND_ACTOR_SCOPES,
        OverlayActivityScope::Friends,
        &[],
    ),
    definition(
        "TrustLevel",
        OverlayActivityCategory::ProfileChange,
        FRIEND_ACTOR_SCOPES,
        OverlayActivityScope::Friends,
        &[],
    ),
    definition(
        "AvatarChange",
        OverlayActivityCategory::ProfileChange,
        FRIEND_ACTOR_SCOPES,
        OverlayActivityScope::Off,
        &["Avatar"],
    ),
    definition(
        "Bio",
        OverlayActivityCategory::ProfileChange,
        FRIEND_ACTOR_SCOPES,
        OverlayActivityScope::Off,
        &[],
    ),
    definition(
        "groupChange",
        OverlayActivityCategory::GroupSocial,
        BOOLEAN_SCOPES,
        OverlayActivityScope::On,
        &[],
    ),
    definition(
        "group.announcement",
        OverlayActivityCategory::GroupSocial,
        BOOLEAN_SCOPES,
        OverlayActivityScope::On,
        &[],
    ),
    definition(
        "group.informative",
        OverlayActivityCategory::GroupSocial,
        BOOLEAN_SCOPES,
        OverlayActivityScope::On,
        &[],
    ),
    definition(
        "group.invite",
        OverlayActivityCategory::GroupSocial,
        BOOLEAN_SCOPES,
        OverlayActivityScope::On,
        &[],
    ),
    definition(
        "group.joinRequest",
        OverlayActivityCategory::GroupSocial,
        BOOLEAN_SCOPES,
        OverlayActivityScope::On,
        &[],
    ),
    definition(
        "group.transfer",
        OverlayActivityCategory::GroupSocial,
        BOOLEAN_SCOPES,
        OverlayActivityScope::On,
        &[],
    ),
    definition(
        "Event",
        OverlayActivityCategory::SystemSafety,
        BOOLEAN_SCOPES,
        OverlayActivityScope::On,
        &[],
    ),
    definition(
        "External",
        OverlayActivityCategory::SystemSafety,
        BOOLEAN_SCOPES,
        OverlayActivityScope::On,
        &[],
    ),
    definition(
        "Blocked",
        OverlayActivityCategory::SystemSafety,
        BOOLEAN_SCOPES,
        OverlayActivityScope::On,
        &[],
    ),
    definition(
        "Unblocked",
        OverlayActivityCategory::SystemSafety,
        BOOLEAN_SCOPES,
        OverlayActivityScope::On,
        &[],
    ),
    definition(
        "Muted",
        OverlayActivityCategory::SystemSafety,
        BOOLEAN_SCOPES,
        OverlayActivityScope::On,
        &[],
    ),
    definition(
        "Unmuted",
        OverlayActivityCategory::SystemSafety,
        BOOLEAN_SCOPES,
        OverlayActivityScope::On,
        &[],
    ),
    definition(
        "BlockedOnPlayerJoined",
        OverlayActivityCategory::SystemSafety,
        INSTANCE_ACTOR_SCOPES,
        OverlayActivityScope::Off,
        &[],
    ),
    definition(
        "BlockedOnPlayerLeft",
        OverlayActivityCategory::SystemSafety,
        INSTANCE_ACTOR_SCOPES,
        OverlayActivityScope::Off,
        &[],
    ),
    definition(
        "MutedOnPlayerJoined",
        OverlayActivityCategory::SystemSafety,
        INSTANCE_ACTOR_SCOPES,
        OverlayActivityScope::Off,
        &[],
    ),
    definition(
        "MutedOnPlayerLeft",
        OverlayActivityCategory::SystemSafety,
        INSTANCE_ACTOR_SCOPES,
        OverlayActivityScope::Off,
        &[],
    ),
    definition(
        "VideoPlay",
        OverlayActivityCategory::Media,
        BOOLEAN_SCOPES,
        OverlayActivityScope::On,
        &[],
    ),
];

const fn definition(
    key: &'static str,
    category: OverlayActivityCategory,
    allowed_scopes: &'static [OverlayActivityScope],
    default_scope: OverlayActivityScope,
    aliases: &'static [&'static str],
) -> ActivityTypeDefinition {
    ActivityTypeDefinition {
        key,
        category,
        allowed_scopes,
        default_scope,
        aliases,
    }
}

pub(super) fn known_definition_for_type(
    activity_type: &str,
) -> Option<&'static ActivityTypeDefinition> {
    ACTIVITY_TYPES.iter().find(|definition| {
        definition.key == activity_type || definition.aliases.contains(&activity_type)
    })
}

pub(super) fn activity_type_definitions() -> Vec<OverlayActivityTypeDefinition> {
    ACTIVITY_TYPES
        .iter()
        .map(|definition| OverlayActivityTypeDefinition {
            key: definition.key.to_string(),
            category: definition.category,
            allowed_scopes: definition.allowed_scopes.to_vec(),
            default_scope: definition.default_scope,
            aliases: definition
                .aliases
                .iter()
                .map(|alias| (*alias).to_string())
                .collect(),
        })
        .collect()
}

pub(super) fn default_activity_rules() -> BTreeMap<String, OverlayActivityRule> {
    ACTIVITY_TYPES
        .iter()
        .map(|definition| (definition.key.to_string(), default_rule(definition)))
        .collect()
}

pub(super) fn default_rule(definition: &ActivityTypeDefinition) -> OverlayActivityRule {
    OverlayActivityRule {
        scope: definition.default_scope,
        favorite_group_keys: OverlayActivityFavoriteGroupKeys::All,
    }
}

pub(super) fn has_persisted_filter_rules(value: &Value) -> bool {
    let Some(wrist) = value.get("wrist").and_then(Value::as_object) else {
        return false;
    };
    wrist.get("types").and_then(Value::as_object).is_some()
        || wrist.get("categories").and_then(Value::as_object).is_some()
}

pub(super) fn normalize_filters(value: Value) -> OverlayActivityFilters {
    let wrist = value.get("wrist").and_then(Value::as_object);
    let types = wrist
        .and_then(|wrist| wrist.get("types"))
        .and_then(Value::as_object);
    let categories = wrist
        .and_then(|wrist| wrist.get("categories"))
        .and_then(Value::as_object);
    let legacy_favorite_group_keys =
        normalize_favorite_group_keys(wrist.and_then(|wrist| wrist.get("favoriteGroupKeys")));
    let mut normalized = OverlayActivityFilters::default();
    for definition in ACTIVITY_TYPES {
        let legacy_rule = legacy_category_rule(definition, categories, &legacy_favorite_group_keys);
        let source = types.and_then(|types| {
            types.get(definition.key).or_else(|| {
                definition
                    .aliases
                    .iter()
                    .find_map(|alias| types.get(*alias))
            })
        });
        let fallback_rule = legacy_rule.unwrap_or_else(|| default_rule(definition));
        let rule = source
            .map(|source| normalize_rule(source, definition, &fallback_rule))
            .unwrap_or(fallback_rule);
        normalized
            .wrist
            .types
            .insert(definition.key.to_string(), rule);
    }
    normalized
}

pub(super) fn migrate_legacy_shared_feed_wrist_filters(value: Value) -> OverlayActivityFilters {
    let wrist = value.get("wrist").and_then(Value::as_object);
    let mut normalized = OverlayActivityFilters::default();
    for definition in ACTIVITY_TYPES {
        let source = wrist.and_then(|wrist| get_type_candidate(wrist, definition));
        if let Some(scope) = source
            .and_then(Value::as_str)
            .and_then(|value| legacy_shared_feed_scope(value, definition))
        {
            normalized.wrist.types.insert(
                definition.key.to_string(),
                OverlayActivityRule {
                    scope,
                    favorite_group_keys: OverlayActivityFavoriteGroupKeys::All,
                },
            );
        }
    }
    normalized
}

pub(super) fn normalize_id(value: &str) -> String {
    value.trim().to_string()
}

fn normalize_rule(
    source: &Value,
    definition: &ActivityTypeDefinition,
    fallback: &OverlayActivityRule,
) -> OverlayActivityRule {
    let scope = source
        .get("scope")
        .and_then(Value::as_str)
        .and_then(|value| parse_scope_for_definition(value, definition))
        .filter(|scope| definition.allowed_scopes.contains(scope))
        .unwrap_or(fallback.scope);
    let favorite_group_keys = if scope == OverlayActivityScope::SelectedFavorites {
        if source.get("favoriteGroupKeys").is_some() {
            normalize_favorite_group_keys(source.get("favoriteGroupKeys"))
        } else {
            fallback.favorite_group_keys.clone()
        }
    } else {
        OverlayActivityFavoriteGroupKeys::All
    };
    OverlayActivityRule {
        scope,
        favorite_group_keys,
    }
}

fn parse_scope(value: &str) -> Option<OverlayActivityScope> {
    match value {
        "off" => Some(OverlayActivityScope::Off),
        "on" => Some(OverlayActivityScope::On),
        "friends" => Some(OverlayActivityScope::Friends),
        "selectedFavorites" => Some(OverlayActivityScope::SelectedFavorites),
        "allFavorites" => Some(OverlayActivityScope::AllFavorites),
        "everyoneInInstance" => Some(OverlayActivityScope::EveryoneInInstance),
        _ => None,
    }
}

fn legacy_category_rule(
    definition: &ActivityTypeDefinition,
    categories: Option<&Map<String, Value>>,
    legacy_favorite_group_keys: &OverlayActivityFavoriteGroupKeys,
) -> Option<OverlayActivityRule> {
    let category = categories?
        .get(category_key(definition.category))?
        .as_object()?;
    let category_favorite_group_keys = category
        .get("favoriteGroupKeys")
        .map(|value| normalize_favorite_group_keys(Some(value)))
        .unwrap_or_else(|| legacy_favorite_group_keys.clone());
    let type_override = category
        .get("typeOverrides")
        .and_then(Value::as_object)
        .and_then(|overrides| get_type_candidate(overrides, definition));
    let source_scope = type_override
        .and_then(|value| value.get("scope"))
        .or_else(|| category.get("scope"));
    let source_favorite_group_keys = type_override
        .and_then(|value| value.get("favoriteGroupKeys"))
        .map(|value| normalize_favorite_group_keys(Some(value)))
        .unwrap_or(category_favorite_group_keys);
    let scope = source_scope
        .and_then(Value::as_str)
        .and_then(|value| parse_scope_for_definition(value, definition))
        .filter(|scope| definition.allowed_scopes.contains(scope))
        .unwrap_or(definition.default_scope);
    Some(OverlayActivityRule {
        scope,
        favorite_group_keys: if scope == OverlayActivityScope::SelectedFavorites {
            source_favorite_group_keys
        } else {
            OverlayActivityFavoriteGroupKeys::All
        },
    })
}

fn get_type_candidate<'a>(
    values: &'a Map<String, Value>,
    definition: &ActivityTypeDefinition,
) -> Option<&'a Value> {
    values.get(definition.key).or_else(|| {
        definition
            .aliases
            .iter()
            .find_map(|alias| values.get(*alias))
    })
}

fn category_key(category: OverlayActivityCategory) -> &'static str {
    match category {
        OverlayActivityCategory::ActionRequired => "actionRequired",
        OverlayActivityCategory::CurrentInstance => "currentInstance",
        OverlayActivityCategory::FavoriteMovement => "favoriteMovement",
        OverlayActivityCategory::ProfileChange => "profileChange",
        OverlayActivityCategory::GroupSocial => "groupSocial",
        OverlayActivityCategory::SystemSafety => "systemSafety",
        OverlayActivityCategory::Media => "media",
    }
}

fn parse_scope_for_definition(
    value: &str,
    definition: &ActivityTypeDefinition,
) -> Option<OverlayActivityScope> {
    if let Some(scope) = parse_scope(value) {
        return Some(scope);
    }
    match value {
        "everyone" | "currentInstance"
            if definition
                .allowed_scopes
                .contains(&OverlayActivityScope::EveryoneInInstance) =>
        {
            Some(OverlayActivityScope::EveryoneInInstance)
        }
        "friendsAndFavorites"
            if definition
                .allowed_scopes
                .contains(&OverlayActivityScope::Friends) =>
        {
            Some(OverlayActivityScope::Friends)
        }
        "direct" | "criticalOnly" | "everyone" | "currentInstance"
            if definition
                .allowed_scopes
                .contains(&OverlayActivityScope::On) =>
        {
            Some(OverlayActivityScope::On)
        }
        _ => None,
    }
}

fn legacy_shared_feed_scope(
    value: &str,
    definition: &ActivityTypeDefinition,
) -> Option<OverlayActivityScope> {
    match value {
        "Off" => Some(OverlayActivityScope::Off),
        "VIP" => {
            if definition
                .allowed_scopes
                .contains(&OverlayActivityScope::AllFavorites)
            {
                Some(OverlayActivityScope::AllFavorites)
            } else if definition
                .allowed_scopes
                .contains(&OverlayActivityScope::SelectedFavorites)
            {
                Some(OverlayActivityScope::SelectedFavorites)
            } else if definition
                .allowed_scopes
                .contains(&OverlayActivityScope::On)
            {
                Some(OverlayActivityScope::On)
            } else {
                None
            }
        }
        "Friends" => {
            if definition
                .allowed_scopes
                .contains(&OverlayActivityScope::Friends)
            {
                Some(OverlayActivityScope::Friends)
            } else if definition
                .allowed_scopes
                .contains(&OverlayActivityScope::On)
            {
                Some(OverlayActivityScope::On)
            } else {
                None
            }
        }
        "Everyone" => {
            if definition
                .allowed_scopes
                .contains(&OverlayActivityScope::EveryoneInInstance)
            {
                Some(OverlayActivityScope::EveryoneInInstance)
            } else if definition
                .allowed_scopes
                .contains(&OverlayActivityScope::On)
            {
                Some(OverlayActivityScope::On)
            } else {
                None
            }
        }
        "On" => definition
            .allowed_scopes
            .contains(&OverlayActivityScope::On)
            .then_some(OverlayActivityScope::On),
        _ => None,
    }
}

fn normalize_favorite_group_keys(value: Option<&Value>) -> OverlayActivityFavoriteGroupKeys {
    let Some(value) = value else {
        return OverlayActivityFavoriteGroupKeys::All;
    };
    if value.as_str() == Some("all") {
        return OverlayActivityFavoriteGroupKeys::All;
    }
    let Some(values) = value.as_array() else {
        return OverlayActivityFavoriteGroupKeys::All;
    };
    let mut keys = values
        .iter()
        .filter_map(Value::as_str)
        .map(normalize_id)
        .filter(|key| !key.is_empty())
        .collect::<Vec<_>>();
    keys.sort();
    keys.dedup();
    if keys.is_empty() {
        OverlayActivityFavoriteGroupKeys::All
    } else {
        OverlayActivityFavoriteGroupKeys::Selected(keys)
    }
}
