use std::collections::BTreeMap;

use serde_json::{Map, Value};
use vrcx_0_contracts::activity::ActivityKind;

use super::types::{
    ActivityCategory, ActivityFavoriteGroupKeys, ActivityFilters, ActivityRule, ActivityScope,
    ActivitySurfaceFilters, ActivityTypeDefinition, NotificationSurface,
};

#[derive(Clone, Copy)]
pub(super) struct KindDefinition {
    pub(super) kind: ActivityKind,
    pub(super) category: ActivityCategory,
    allowed_scopes: &'static [ActivityScope],
    wrist_default_scope: ActivityScope,
    alert_default_scope: ActivityScope,
    tts_default_scope: ActivityScope,
    widget_default_scope: ActivityScope,
    aliases: &'static [&'static str],
}

const BOOLEAN_SCOPES: &[ActivityScope] = &[ActivityScope::Off, ActivityScope::On];
const DIRECT_ACTOR_SCOPES: &[ActivityScope] = &[
    ActivityScope::Off,
    ActivityScope::On,
    ActivityScope::Friends,
    ActivityScope::SelectedFavorites,
    ActivityScope::AllFavorites,
];
const FRIEND_ACTOR_SCOPES: &[ActivityScope] = &[
    ActivityScope::Off,
    ActivityScope::Friends,
    ActivityScope::SelectedFavorites,
    ActivityScope::AllFavorites,
];
const INSTANCE_ACTOR_SCOPES: &[ActivityScope] = &[
    ActivityScope::Off,
    ActivityScope::Friends,
    ActivityScope::SelectedFavorites,
    ActivityScope::AllFavorites,
    ActivityScope::EveryoneInInstance,
];
const GROUP_FAVORITE_SCOPES: &[ActivityScope] = &[
    ActivityScope::Off,
    ActivityScope::AllFavorites,
    ActivityScope::SelectedFavorites,
];

pub(super) fn definition(kind: ActivityKind) -> KindDefinition {
    use ActivityCategory as C;
    use ActivityKind as K;
    use ActivityScope as S;
    let (
        category,
        allowed_scopes,
        wrist_default_scope,
        alert_default_scope,
        tts_default_scope,
        widget_default_scope,
    ) = match kind {
        K::Invite | K::RequestInvite | K::InviteResponse | K::RequestInviteResponse | K::Boop => (
            C::ActionRequired,
            DIRECT_ACTOR_SCOPES,
            S::Friends,
            S::Friends,
            S::Friends,
            S::Friends,
        ),
        K::FriendRequest | K::GroupQueueReady | K::InstanceClosed => (
            C::ActionRequired,
            BOOLEAN_SCOPES,
            S::On,
            S::On,
            S::On,
            S::On,
        ),
        K::OnPlayerJoining => (
            C::CurrentInstance,
            INSTANCE_ACTOR_SCOPES,
            S::Friends,
            S::Friends,
            S::AllFavorites,
            S::Friends,
        ),
        K::OnPlayerJoined | K::OnPlayerLeft => (
            C::CurrentInstance,
            INSTANCE_ACTOR_SCOPES,
            S::EveryoneInInstance,
            S::AllFavorites,
            S::Off,
            S::Friends,
        ),
        K::LobbyAvatarChange => (
            C::CurrentInstance,
            INSTANCE_ACTOR_SCOPES,
            S::Off,
            S::Off,
            S::Off,
            S::Off,
        ),
        K::Online | K::Offline => (
            C::FavoriteMovement,
            FRIEND_ACTOR_SCOPES,
            S::Friends,
            S::AllFavorites,
            S::Off,
            S::AllFavorites,
        ),
        K::Gps | K::Status => (
            C::FavoriteMovement,
            FRIEND_ACTOR_SCOPES,
            S::Friends,
            S::Off,
            S::Off,
            S::AllFavorites,
        ),
        K::Friend | K::Unfriend => (
            C::ProfileChange,
            BOOLEAN_SCOPES,
            S::On,
            S::On,
            S::Off,
            S::On,
        ),
        K::DisplayName | K::TrustLevel => (
            C::ProfileChange,
            FRIEND_ACTOR_SCOPES,
            S::Friends,
            S::AllFavorites,
            S::Off,
            S::AllFavorites,
        ),
        K::AvatarChange | K::Bio => (
            C::ProfileChange,
            FRIEND_ACTOR_SCOPES,
            S::Off,
            S::Off,
            S::Off,
            S::Off,
        ),
        K::GroupChange => (
            C::GroupSocial,
            BOOLEAN_SCOPES,
            S::Off,
            S::Off,
            S::Off,
            S::Off,
        ),
        K::GroupAnnouncement
        | K::GroupEventCreated
        | K::GroupEventStarting
        | K::GroupInformative
        | K::GroupInvite
        | K::GroupTransfer => (C::GroupSocial, BOOLEAN_SCOPES, S::On, S::On, S::Off, S::On),
        K::GroupJoinRequest => (C::GroupSocial, BOOLEAN_SCOPES, S::On, S::Off, S::Off, S::On),
        K::GroupInstanceOpened => (
            C::GroupSocial,
            GROUP_FAVORITE_SCOPES,
            S::Off,
            S::Off,
            S::Off,
            S::Off,
        ),
        K::Event | K::External => (C::SystemSafety, BOOLEAN_SCOPES, S::On, S::On, S::Off, S::On),
        K::BlockedOnPlayerJoined | K::MutedOnPlayerJoined => (
            C::SystemSafety,
            INSTANCE_ACTOR_SCOPES,
            S::Off,
            S::Off,
            S::Off,
            S::EveryoneInInstance,
        ),
        K::BlockedOnPlayerLeft | K::MutedOnPlayerLeft => (
            C::SystemSafety,
            INSTANCE_ACTOR_SCOPES,
            S::Off,
            S::Off,
            S::Off,
            S::Off,
        ),
        K::VideoPlay => (C::Media, BOOLEAN_SCOPES, S::On, S::Off, S::Off, S::Off),
    };
    KindDefinition {
        kind,
        category,
        allowed_scopes,
        wrist_default_scope,
        alert_default_scope,
        tts_default_scope,
        widget_default_scope,
        aliases: match kind {
            K::AvatarChange => &["Avatar"],
            _ => &[],
        },
    }
}

fn definitions() -> impl Iterator<Item = KindDefinition> {
    ActivityKind::ALL.iter().copied().map(definition)
}

pub(super) fn activity_type_definitions() -> Vec<ActivityTypeDefinition> {
    definitions()
        .map(|definition| ActivityTypeDefinition {
            key: definition.kind,
            category: definition.category,
            allowed_scopes: definition.allowed_scopes.to_vec(),
            wrist_default_scope: definition.wrist_default_scope,
            alert_default_scope: definition.alert_default_scope,
            tts_default_scope: definition.tts_default_scope,
            widget_default_scope: definition.widget_default_scope,
            aliases: definition
                .aliases
                .iter()
                .map(|alias| (*alias).to_string())
                .collect(),
        })
        .collect()
}

fn default_scope(definition: &KindDefinition, surface: NotificationSurface) -> ActivityScope {
    match surface {
        NotificationSurface::Wrist => definition.wrist_default_scope,
        NotificationSurface::Desktop
        | NotificationSurface::ExternalOverlay
        | NotificationSurface::Hmd => definition.alert_default_scope,
        NotificationSurface::Tts => definition.tts_default_scope,
        NotificationSurface::Webhook => ActivityScope::Off,
        NotificationSurface::DesktopWidget => definition.widget_default_scope,
    }
}

pub(super) fn default_activity_rules(
    surface: NotificationSurface,
) -> BTreeMap<String, ActivityRule> {
    definitions()
        .map(|definition| {
            (
                definition.kind.key().to_string(),
                default_rule(&definition, surface),
            )
        })
        .collect()
}

pub(super) fn default_rule(
    definition: &KindDefinition,
    surface: NotificationSurface,
) -> ActivityRule {
    rule_with_scope(default_scope(definition, surface))
}

fn rule_with_scope(scope: ActivityScope) -> ActivityRule {
    ActivityRule {
        scope,
        favorite_group_keys: ActivityFavoriteGroupKeys::All,
    }
}

pub(super) fn has_persisted_filter_rules(value: &Value) -> bool {
    ["wrist", "desktop", "vr", "hmd", "webhook", "tts", "widget"]
        .iter()
        .any(|surface| {
            value
                .get(*surface)
                .and_then(Value::as_object)
                .is_some_and(|surface| surface.get("types").and_then(Value::as_object).is_some())
        })
}

pub(super) fn normalize_filters(value: Value) -> ActivityFilters {
    let surface = |key: &str, surface: NotificationSurface| {
        normalize_surface_with_default(value.get(key), &default_activity_rules(surface))
    };
    ActivityFilters {
        version: 1,
        wrist: surface("wrist", NotificationSurface::Wrist),
        desktop: surface("desktop", NotificationSurface::Desktop),
        vr: surface("vr", NotificationSurface::ExternalOverlay),
        hmd: surface("hmd", NotificationSurface::Hmd),
        webhook: surface("webhook", NotificationSurface::Webhook),
        tts: surface("tts", NotificationSurface::Tts),
        widget: surface("widget", NotificationSurface::DesktopWidget),
    }
}

pub(super) fn normalize_surface_with_default(
    value: Option<&Value>,
    default_types: &BTreeMap<String, ActivityRule>,
) -> ActivitySurfaceFilters {
    let surface = value.and_then(Value::as_object);
    let types = surface
        .and_then(|surface| surface.get("types"))
        .and_then(Value::as_object);
    let mut normalized = ActivitySurfaceFilters {
        types: default_types.clone(),
    };
    for definition in definitions() {
        let Some(fallback_rule) = default_types.get(definition.kind.key()).cloned() else {
            continue;
        };
        let rule = types
            .and_then(|types| get_type_candidate(types, &definition))
            .map(|source| normalize_rule(source, &definition, &fallback_rule))
            .unwrap_or(fallback_rule);
        normalized
            .types
            .insert(definition.kind.key().to_string(), rule);
    }
    normalized
}

pub(super) fn normalize_id(value: &str) -> String {
    value.trim().to_string()
}

fn normalize_rule(
    source: &Value,
    definition: &KindDefinition,
    fallback: &ActivityRule,
) -> ActivityRule {
    let scope = source
        .get("scope")
        .and_then(Value::as_str)
        .and_then(parse_scope)
        .filter(|scope| definition.allowed_scopes.contains(scope))
        .unwrap_or(fallback.scope);
    let favorite_group_keys = if scope == ActivityScope::SelectedFavorites {
        if source.get("favoriteGroupKeys").is_some() {
            normalize_favorite_group_keys(source.get("favoriteGroupKeys"))
        } else {
            fallback.favorite_group_keys.clone()
        }
    } else {
        ActivityFavoriteGroupKeys::All
    };
    normalize_group_instance_rule(
        definition,
        ActivityRule {
            scope,
            favorite_group_keys,
        },
    )
}

fn parse_scope(value: &str) -> Option<ActivityScope> {
    match value {
        "off" => Some(ActivityScope::Off),
        "on" => Some(ActivityScope::On),
        "friends" => Some(ActivityScope::Friends),
        "selectedFavorites" => Some(ActivityScope::SelectedFavorites),
        "allFavorites" => Some(ActivityScope::AllFavorites),
        "everyoneInInstance" => Some(ActivityScope::EveryoneInInstance),
        _ => None,
    }
}

fn normalize_group_instance_rule(definition: &KindDefinition, rule: ActivityRule) -> ActivityRule {
    if definition.kind == ActivityKind::GroupInstanceOpened
        && rule.scope == ActivityScope::SelectedFavorites
        && matches!(rule.favorite_group_keys, ActivityFavoriteGroupKeys::All)
    {
        ActivityRule {
            scope: ActivityScope::Off,
            favorite_group_keys: ActivityFavoriteGroupKeys::All,
        }
    } else {
        rule
    }
}

fn get_type_candidate<'a>(
    values: &'a Map<String, Value>,
    definition: &KindDefinition,
) -> Option<&'a Value> {
    values.get(definition.kind.key()).or_else(|| {
        definition
            .aliases
            .iter()
            .find_map(|alias| values.get(*alias))
    })
}

fn normalize_favorite_group_keys(value: Option<&Value>) -> ActivityFavoriteGroupKeys {
    let Some(value) = value else {
        return ActivityFavoriteGroupKeys::All;
    };
    if value.as_str() == Some("all") {
        return ActivityFavoriteGroupKeys::All;
    }
    let Some(values) = value.as_array() else {
        return ActivityFavoriteGroupKeys::All;
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
        ActivityFavoriteGroupKeys::All
    } else {
        ActivityFavoriteGroupKeys::Selected(keys)
    }
}
