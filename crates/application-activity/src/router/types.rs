use std::collections::BTreeMap;

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::Value;
use vrcx_0_contracts::activity::ActivityKind;
use vrcx_0_i18n::{render_overlay_message, OverlayMessage};

use super::definitions::{
    default_activity_rules, default_rule, definition, has_persisted_filter_rules,
    normalize_filters, normalize_surface_with_default,
};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ActivityCategory {
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
pub enum ActivityScope {
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
pub struct ActivityTypeDefinition {
    pub key: ActivityKind,
    pub category: ActivityCategory,
    pub allowed_scopes: Vec<ActivityScope>,
    pub wrist_default_scope: ActivityScope,
    pub alert_default_scope: ActivityScope,
    pub tts_default_scope: ActivityScope,
    pub widget_default_scope: ActivityScope,
    pub aliases: Vec<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub enum ActivityFavoriteGroupKeys {
    #[default]
    All,
    Selected(Vec<String>),
}

impl Serialize for ActivityFavoriteGroupKeys {
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

impl<'de> Deserialize<'de> for ActivityFavoriteGroupKeys {
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

impl specta::Type for ActivityFavoriteGroupKeys {
    fn inline(
        type_map: &mut specta::TypeCollection,
        generics: specta::Generics,
    ) -> specta::DataType {
        FavoriteGroupKeysShape::inline(type_map, generics)
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ActivityRule {
    pub scope: ActivityScope,
    pub favorite_group_keys: ActivityFavoriteGroupKeys,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
#[specta(rename = "NotificationActivityFilterSurface")]
pub enum NotificationSurface {
    Wrist,
    #[serde(rename = "vr")]
    ExternalOverlay,
    Hmd,
    Desktop,
    Webhook,
    Tts,
    #[serde(rename = "widget")]
    DesktopWidget,
}

impl NotificationSurface {
    pub const ALL: [Self; 7] = [
        Self::Wrist,
        Self::ExternalOverlay,
        Self::Hmd,
        Self::Desktop,
        Self::Webhook,
        Self::Tts,
        Self::DesktopWidget,
    ];
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ActivityFilters {
    pub version: u32,
    pub wrist: ActivitySurfaceFilters,
    #[serde(default = "ActivitySurfaceFilters::alert_defaults")]
    pub desktop: ActivitySurfaceFilters,
    #[serde(default = "ActivitySurfaceFilters::alert_defaults")]
    pub vr: ActivitySurfaceFilters,
    #[serde(default = "ActivitySurfaceFilters::alert_defaults")]
    pub hmd: ActivitySurfaceFilters,
    #[serde(default = "ActivitySurfaceFilters::webhook_defaults")]
    pub webhook: ActivitySurfaceFilters,
    #[serde(default = "ActivitySurfaceFilters::tts_defaults")]
    pub tts: ActivitySurfaceFilters,
    #[serde(default = "ActivitySurfaceFilters::widget_defaults")]
    pub widget: ActivitySurfaceFilters,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ActivitySurfaceFilters {
    pub types: BTreeMap<String, ActivityRule>,
}

impl ActivitySurfaceFilters {
    fn defaults(surface: NotificationSurface) -> Self {
        Self {
            types: default_activity_rules(surface),
        }
    }

    fn alert_defaults() -> Self {
        Self::defaults(NotificationSurface::Desktop)
    }

    fn webhook_defaults() -> Self {
        Self::defaults(NotificationSurface::Webhook)
    }

    fn tts_defaults() -> Self {
        Self::defaults(NotificationSurface::Tts)
    }

    fn widget_defaults() -> Self {
        Self::defaults(NotificationSurface::DesktopWidget)
    }

    pub fn from_saved_types_json(value: &Value, surface: NotificationSurface) -> Self {
        normalize_surface_with_default(Some(value), &default_activity_rules(surface))
    }
}

impl Default for ActivityFilters {
    fn default() -> Self {
        Self {
            version: 1,
            wrist: ActivitySurfaceFilters::defaults(NotificationSurface::Wrist),
            desktop: ActivitySurfaceFilters::defaults(NotificationSurface::Desktop),
            vr: ActivitySurfaceFilters::defaults(NotificationSurface::ExternalOverlay),
            hmd: ActivitySurfaceFilters::defaults(NotificationSurface::Hmd),
            webhook: ActivitySurfaceFilters::defaults(NotificationSurface::Webhook),
            tts: ActivitySurfaceFilters::defaults(NotificationSurface::Tts),
            widget: ActivitySurfaceFilters::defaults(NotificationSurface::DesktopWidget),
        }
    }
}

impl ActivityFilters {
    pub fn from_json(value: Value) -> Self {
        normalize_filters(value)
    }

    pub fn has_persisted_rules(value: &Value) -> bool {
        has_persisted_filter_rules(value)
    }

    pub fn surface(&self, surface: NotificationSurface) -> &ActivitySurfaceFilters {
        match surface {
            NotificationSurface::Wrist => &self.wrist,
            NotificationSurface::Desktop => &self.desktop,
            NotificationSurface::ExternalOverlay => &self.vr,
            NotificationSurface::Hmd => &self.hmd,
            NotificationSurface::Webhook => &self.webhook,
            NotificationSurface::Tts => &self.tts,
            NotificationSurface::DesktopWidget => &self.widget,
        }
    }

    pub fn rule_for(&self, surface: NotificationSurface, kind: ActivityKind) -> ActivityRule {
        self.surface(surface)
            .types
            .get(kind.key())
            .cloned()
            .unwrap_or_else(|| default_rule(&definition(kind), surface))
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(tag = "kind", content = "value", rename_all = "camelCase")]
pub enum ActivityText {
    Message(OverlayMessage),
    Literal(String),
}

impl Default for ActivityText {
    fn default() -> Self {
        Self::Literal(String::new())
    }
}

impl ActivityText {
    pub fn message(message: OverlayMessage) -> Self {
        Self::Message(message)
    }

    pub fn literal(value: impl Into<String>) -> Self {
        Self::Literal(value.into())
    }

    pub fn as_message(&self) -> Option<&OverlayMessage> {
        match self {
            Self::Message(message) => Some(message),
            Self::Literal(_) => None,
        }
    }

    pub fn source_text(&self) -> String {
        match self {
            Self::Message(message) => render_overlay_message("en", message),
            Self::Literal(value) => value.trim().to_string(),
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ActivityContent {
    pub icon: String,
    pub title: ActivityText,
    pub body: ActivityText,
    pub summary: String,
    pub detail: String,
    pub location: String,
    pub world_id: String,
    pub display_location: String,
    pub world_name: String,
    pub group_id: String,
    pub group_name: String,
    pub status: String,
    pub status_description: String,
    pub avatar_name: String,
    pub image_url: String,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ActivityActorRelation {
    #[default]
    None,
    Friend,
    Favorite,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ActivityEntry {
    pub sequence: u64,
    pub source_id: String,
    pub kind: ActivityKind,
    pub category: ActivityCategory,
    pub created_at: String,
    pub actor_user_id: String,
    pub actor_display_name: String,
    pub content: ActivityContent,
    #[serde(default)]
    pub actor_relation: ActivityActorRelation,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ActivitySnapshot {
    pub entries: Vec<ActivityEntry>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ActivityDelivery {
    pub entry: ActivityEntry,
    pub desktop: bool,
    pub vr: bool,
    pub hmd: bool,
    pub webhook: bool,
    pub tts: bool,
    pub widget: bool,
}
