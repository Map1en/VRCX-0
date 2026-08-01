use serde::{Deserialize, Serialize};

use crate::{Error, Result};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum BackgroundImageMode {
    Off,
    Daily,
    Custom,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "kebab-case")]
pub enum BackgroundImageProviderId {
    NasaEpic,
    AicPublicDomain,
    NasaApodSafe,
}

impl BackgroundImageProviderId {
    pub const ALL: [Self; 3] = [Self::NasaEpic, Self::AicPublicDomain, Self::NasaApodSafe];

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::NasaEpic => "nasa-epic",
            Self::AicPublicDomain => "aic-public-domain",
            Self::NasaApodSafe => "nasa-apod-safe",
        }
    }

    pub fn label(&self) -> &'static str {
        match self {
            Self::NasaEpic => "NASA EPIC",
            Self::AicPublicDomain => "Art Institute of Chicago",
            Self::NasaApodSafe => "NASA APOD",
        }
    }

    pub(super) fn from_config(value: &str) -> Self {
        Self::ALL
            .into_iter()
            .find(|provider| provider.as_str() == value.trim())
            .unwrap_or(Self::NasaEpic)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum BackgroundImageRotationInterval {
    Daily,
    Hourly,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum BackgroundImageCustomSourceKind {
    Files,
    Folder,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundImageCustomSource {
    pub kind: BackgroundImageCustomSourceKind,
    pub paths: Vec<String>,
    pub folder_path: String,
    pub rotation_interval: BackgroundImageRotationInterval,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundImageSnapshot {
    pub mode: BackgroundImageMode,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_id: Option<BackgroundImageProviderId>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_kind: Option<BackgroundImageCustomSourceKind>,
    pub image_url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image_count: Option<u32>,
    pub title: String,
    pub author: String,
    pub license: String,
    pub source: String,
    pub resolved_at: String,
    pub resolved_for_key: String,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundImageProjection {
    pub revision: u64,
    pub enabled: bool,
    pub mode: BackgroundImageMode,
    pub provider_id: BackgroundImageProviderId,
    pub custom_source: Option<BackgroundImageCustomSource>,
    pub snapshot: Option<BackgroundImageSnapshot>,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum BackgroundImageConfigureInput {
    Disable,
    #[serde(rename_all = "camelCase")]
    EnableDaily {
        provider_id: Option<BackgroundImageProviderId>,
    },
    #[serde(rename_all = "camelCase")]
    SetProvider {
        provider_id: BackgroundImageProviderId,
    },
    EnableCustom,
    #[serde(rename_all = "camelCase")]
    SetCustomFiles {
        paths: Vec<String>,
    },
    #[serde(rename_all = "camelCase")]
    SetCustomFolder {
        folder_path: String,
    },
    #[serde(rename_all = "camelCase")]
    SetRotationInterval {
        rotation_interval: BackgroundImageRotationInterval,
    },
    MigrateLegacyNasaApod,
}

pub trait BackgroundImageFileResolver: Send + Sync {
    fn resolve_files(&self, source: &BackgroundImageCustomSource) -> Result<Vec<String>>;
}

pub struct UnavailableBackgroundImageFileResolver;

impl BackgroundImageFileResolver for UnavailableBackgroundImageFileResolver {
    fn resolve_files(&self, _source: &BackgroundImageCustomSource) -> Result<Vec<String>> {
        Err(Error::Custom(
            "Custom background image sources are unavailable on this host.".into(),
        ))
    }
}
