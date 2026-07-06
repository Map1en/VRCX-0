use std::collections::BTreeMap;

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::Value;

use super::definitions::{
    default_activity_rules, default_rule, disabled_activity_rules, has_persisted_filter_rules,
    hmd_activity_rules, known_definition_for_type, migrate_legacy_shared_feed_wrist_filters,
    normalize_filters, normalize_surface,
};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum OverlayActivityCategory {
    #[default]
    ActionRequired,
    CurrentInstance,
    FavoriteMovement,
    ProfileChange,
    GroupSocial,
    SystemSafety,
    Media,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum OverlayActivityScope {
    #[default]
    Off,
    On,
    Friends,
    SelectedFavorites,
    AllFavorites,
    EveryoneInInstance,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct OverlayActivityTypeDefinition {
    pub key: String,
    pub category: OverlayActivityCategory,
    pub allowed_scopes: Vec<OverlayActivityScope>,
    pub default_scope: OverlayActivityScope,
    pub hmd_default_scope: OverlayActivityScope,
    pub aliases: Vec<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub enum OverlayActivityFavoriteGroupKeys {
    #[default]
    All,
    Selected(Vec<String>),
}

impl Serialize for OverlayActivityFavoriteGroupKeys {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        match self {
            Self::All => serializer.serialize_str("all"),
            Self::Selected(keys) => keys.serialize(serializer),
        }
    }
}

impl<'de> Deserialize<'de> for OverlayActivityFavoriteGroupKeys {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = Value::deserialize(deserializer)?;
        if value.as_str() == Some("all") {
            return Ok(Self::All);
        }
        let Some(values) = value.as_array() else {
            return Ok(Self::All);
        };
        let keys = values
            .iter()
            .filter_map(Value::as_str)
            .map(str::trim)
            .filter(|key| !key.is_empty())
            .map(ToString::to_string)
            .collect::<Vec<_>>();
        if keys.is_empty() {
            Ok(Self::All)
        } else {
            Ok(Self::Selected(keys))
        }
    }
}

#[derive(Serialize, Deserialize, specta::Type)]
#[serde(untagged)]
enum FavoriteGroupKeysShape {
    All(String),
    Selected(Vec<String>),
}

impl specta::Type for OverlayActivityFavoriteGroupKeys {
    fn inline(
        type_map: &mut specta::TypeCollection,
        generics: specta::Generics,
    ) -> specta::DataType {
        FavoriteGroupKeysShape::inline(type_map, generics)
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct OverlayActivityRule {
    pub scope: OverlayActivityScope,
    pub favorite_group_keys: OverlayActivityFavoriteGroupKeys,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OverlayActivitySurface {
    Wrist,
    Desktop,
    Vr,
    Hmd,
    Webhook,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct OverlayActivityFilters {
    pub version: u32,
    pub wrist: OverlayActivitySurfaceFilters,
    #[serde(default = "OverlayActivitySurfaceFilters::default_rules")]
    pub desktop: OverlayActivitySurfaceFilters,
    #[serde(default = "OverlayActivitySurfaceFilters::default_rules")]
    pub vr: OverlayActivitySurfaceFilters,
    #[serde(default = "OverlayActivitySurfaceFilters::hmd_default_rules")]
    pub hmd: OverlayActivitySurfaceFilters,
    #[serde(default = "OverlayActivitySurfaceFilters::disabled_rules")]
    pub webhook: OverlayActivitySurfaceFilters,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct OverlayActivitySurfaceFilters {
    pub types: BTreeMap<String, OverlayActivityRule>,
}

impl OverlayActivitySurfaceFilters {
    pub(super) fn default_rules() -> Self {
        Self {
            types: default_activity_rules(),
        }
    }

    pub(super) fn disabled_rules() -> Self {
        Self {
            types: disabled_activity_rules(),
        }
    }

    pub(super) fn hmd_default_rules() -> Self {
        Self {
            types: hmd_activity_rules(),
        }
    }

    pub fn from_types_json(value: &Value) -> Self {
        normalize_surface(Some(value))
    }
}

impl Default for OverlayActivityFilters {
    fn default() -> Self {
        Self {
            version: 1,
            wrist: OverlayActivitySurfaceFilters::default_rules(),
            desktop: OverlayActivitySurfaceFilters::default_rules(),
            vr: OverlayActivitySurfaceFilters::default_rules(),
            hmd: OverlayActivitySurfaceFilters::hmd_default_rules(),
            webhook: OverlayActivitySurfaceFilters::disabled_rules(),
        }
    }
}

impl OverlayActivityFilters {
    pub fn from_json(value: Value) -> Self {
        normalize_filters(value)
    }

    pub fn has_persisted_rules(value: &Value) -> bool {
        has_persisted_filter_rules(value)
    }

    pub fn from_legacy_shared_feed_filters(value: Value) -> Self {
        migrate_legacy_shared_feed_wrist_filters(value)
    }

    pub fn surface(&self, surface: OverlayActivitySurface) -> &OverlayActivitySurfaceFilters {
        match surface {
            OverlayActivitySurface::Wrist => &self.wrist,
            OverlayActivitySurface::Desktop => &self.desktop,
            OverlayActivitySurface::Vr => &self.vr,
            OverlayActivitySurface::Hmd => &self.hmd,
            OverlayActivitySurface::Webhook => &self.webhook,
        }
    }

    pub fn rule_for(
        &self,
        surface: OverlayActivitySurface,
        activity_type: &str,
    ) -> OverlayActivityRule {
        let Some(definition) = known_definition_for_type(activity_type) else {
            return OverlayActivityRule::default();
        };
        self.surface(surface)
            .types
            .get(definition.key)
            .cloned()
            .unwrap_or_else(|| default_rule(definition))
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct OverlayActivityCandidate {
    pub source_id: String,
    pub activity_type: String,
    pub created_at: String,
    pub actor_user_id: String,
    pub actor_display_name: String,
    pub current_instance: bool,
    #[serde(default)]
    pub payload: Value,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct OverlayActivityText {
    pub key: String,
    pub fallback: String,
    #[serde(default)]
    pub params: Value,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct OverlayActivityContent {
    pub icon: String,
    pub title: OverlayActivityText,
    pub body: OverlayActivityText,
    pub summary: String,
    pub detail: String,
    pub location: String,
    pub world_id: String,
    pub display_location: String,
    pub world_name: String,
    pub group_name: String,
    pub status: String,
    pub status_description: String,
    pub avatar_name: String,
    pub image_url: String,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum OverlayActivityActorRelation {
    #[default]
    None,
    Friend,
    Favorite,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct OverlayActivityEntry {
    pub sequence: u64,
    pub source_id: String,
    pub activity_type: String,
    pub category: OverlayActivityCategory,
    pub created_at: String,
    pub actor_user_id: String,
    pub actor_display_name: String,
    pub content: OverlayActivityContent,
    #[serde(default)]
    pub actor_relation: OverlayActivityActorRelation,
    #[serde(default)]
    pub payload: Value,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct OverlayActivitySnapshot {
    pub entries: Vec<OverlayActivityEntry>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct OverlayActivityDelivery {
    pub entry: OverlayActivityEntry,
    pub desktop: bool,
    pub vr: bool,
    pub hmd: bool,
    pub webhook: bool,
}
