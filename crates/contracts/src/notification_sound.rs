use std::collections::BTreeMap;

use serde::{Deserialize, Deserializer, Serialize};

use crate::activity::ActivityKind;

pub const NOTIFICATION_SOUND_RULES_CONFIG_KEY: &str = "notificationSoundRules";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GameLogSoundKind {
    Location,
    PortalSpawn,
    ResourceLoad,
    StringLoad,
    ImageLoad,
}

impl GameLogSoundKind {
    pub const ALL: [Self; 5] = [
        Self::Location,
        Self::PortalSpawn,
        Self::ResourceLoad,
        Self::StringLoad,
        Self::ImageLoad,
    ];

    pub const fn key(self) -> &'static str {
        match self {
            Self::Location => "Location",
            Self::PortalSpawn => "PortalSpawn",
            Self::ResourceLoad => "ResourceLoad",
            Self::StringLoad => "StringLoad",
            Self::ImageLoad => "ImageLoad",
        }
    }
}

pub fn is_notification_sound_event(key: &str) -> bool {
    let key = key.trim();
    ActivityKind::from_key(key).is_some()
        || GameLogSoundKind::ALL
            .into_iter()
            .any(|kind| kind.key() == key)
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize, specta::Type)]
pub struct NotificationSoundRule {
    pub source: NotificationSoundSource,
    #[specta(type = u8)]
    #[serde(deserialize_with = "deserialize_volume")]
    pub volume: u8,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize, specta::Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum NotificationSoundSource {
    Builtin { id: String },
    Custom { path: String },
}

fn deserialize_volume<'de, D: Deserializer<'de>>(deserializer: D) -> Result<u8, D::Error> {
    i64::deserialize(deserializer).map(|volume| volume.clamp(0, 100) as u8)
}

pub fn parse_notification_sound_rules(raw: &str) -> BTreeMap<String, NotificationSoundRule> {
    let Ok(entries) = serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(raw)
    else {
        return BTreeMap::new();
    };
    entries
        .into_iter()
        .filter_map(|(key, value)| {
            let key = key.trim();
            if !is_notification_sound_event(key) {
                return None;
            }
            let rule = serde_json::from_value::<NotificationSoundRule>(value).ok()?;
            let source = match &rule.source {
                NotificationSoundSource::Builtin { id } => id,
                NotificationSoundSource::Custom { path } => path,
            };
            (!source.trim().is_empty()).then(|| (key.to_owned(), rule))
        })
        .collect()
}
