use std::time::Duration;

use serde::{Deserialize, Serialize};

pub const WORLD_COLLECTIONS_SITE_ORIGIN: &str = "https://worlds.vrcx-0.dev";
pub const WORLD_COLLECTIONS_API_ENDPOINT: &str = "https://worlds.vrcx-0.dev/api/collections";
const WORLD_COLLECTIONS_UPLOAD_TIMEOUT: Duration = Duration::from_secs(60);
const WORLD_COLLECTIONS_FETCH_TIMEOUT: Duration = Duration::from_secs(30);
const COLLECTION_SHORTCODE_MIN_LEN: usize = 6;
const COLLECTION_SHORTCODE_MAX_LEN: usize = 12;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct WorldCollectionCreatePayload {
    pub schema: i64,
    pub owner_key: String,
    pub title: String,
    pub listed: bool,
    pub access: String,
    pub author_name: String,
    pub updated_at: i64,
    pub worlds: Vec<WorldCollectionPayloadWorld>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct WorldCollectionPayloadWorld {
    pub world_id: String,
    pub author_id: String,
    pub name: String,
    pub author_name: String,
    pub created_at: String,
    pub image_url: String,
    pub description: String,
    pub release_status: String,
    pub thumbnail_image_url: String,
    pub comment: String,
    pub updated_at: String,
    pub version: i64,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
pub struct WorldCollectionCreateResponse {
    pub id: String,
}

#[derive(Clone, Debug, Default, PartialEq, Deserialize, Serialize)]
#[serde(default)]
pub struct WorldCollectionSnapshotWorld {
    pub world_id: String,
    pub name: String,
    pub author_name: String,
    pub image_url: String,
    pub description: String,
    pub comment: String,
}

#[derive(Clone, Debug, Default, PartialEq, Deserialize, Serialize)]
#[serde(default)]
pub struct WorldCollectionSnapshotResponse {
    pub id: String,
    pub title: String,
    pub note: String,
    pub author_name: String,
    pub author_profile: Option<String>,
    pub category: Option<String>,
    pub listed: bool,
    pub updated_at: i64,
    pub worlds: Vec<WorldCollectionSnapshotWorld>,
}

#[derive(Debug, thiserror::Error)]
pub enum WorldCollectionShareError {
    #[error("{0}")]
    Custom(String),
}

pub async fn create_world_collection(
    payload: &WorldCollectionCreatePayload,
) -> Result<WorldCollectionCreateResponse, WorldCollectionShareError> {
    let client = reqwest::Client::builder()
        .timeout(WORLD_COLLECTIONS_UPLOAD_TIMEOUT)
        .build()
        .map_err(|error| {
            WorldCollectionShareError::Custom(format!(
                "share collection upload client failed: {error}"
            ))
        })?;
    let response = client
        .post(WORLD_COLLECTIONS_API_ENDPOINT)
        .json(payload)
        .send()
        .await
        .map_err(|error| {
            WorldCollectionShareError::Custom(format!("share collection upload failed: {error}"))
        })?;
    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        let detail = body.trim();
        let message = if detail.is_empty() {
            format!("share collection upload returned HTTP {status}")
        } else {
            format!("share collection upload returned HTTP {status}: {detail}")
        };
        return Err(WorldCollectionShareError::Custom(message));
    }
    response.json().await.map_err(|error| {
        WorldCollectionShareError::Custom(format!("share collection response is invalid: {error}"))
    })
}

/// Validates a collection shortcode is a plain base62-ish token before it is
/// interpolated into the fetch URL, per the deep link "id, not URL" decision
/// in `docs/WORLD_COLLECTION_SHARING.md` §4.6 (blocks SSRF via a crafted id).
pub fn validate_collection_shortcode(id: &str) -> Result<String, WorldCollectionShareError> {
    let id = id.trim();
    let valid_len =
        (COLLECTION_SHORTCODE_MIN_LEN..=COLLECTION_SHORTCODE_MAX_LEN).contains(&id.len());
    let valid_chars = !id.is_empty() && id.chars().all(|value| value.is_ascii_alphanumeric());
    if valid_len && valid_chars {
        Ok(id.to_string())
    } else {
        Err(WorldCollectionShareError::Custom(
            "Invalid share collection id.".into(),
        ))
    }
}

pub async fn fetch_world_collection(
    id: &str,
) -> Result<WorldCollectionSnapshotResponse, WorldCollectionShareError> {
    let id = validate_collection_shortcode(id)?;
    let client = reqwest::Client::builder()
        .timeout(WORLD_COLLECTIONS_FETCH_TIMEOUT)
        .build()
        .map_err(|error| {
            WorldCollectionShareError::Custom(format!(
                "share collection fetch client failed: {error}"
            ))
        })?;
    let url = format!("{WORLD_COLLECTIONS_API_ENDPOINT}/{id}");
    let response = client.get(url).send().await.map_err(|error| {
        WorldCollectionShareError::Custom(format!("share collection fetch failed: {error}"))
    })?;
    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        let detail = body.trim();
        let message = if detail.is_empty() {
            format!("share collection fetch returned HTTP {status}")
        } else {
            format!("share collection fetch returned HTTP {status}: {detail}")
        };
        return Err(WorldCollectionShareError::Custom(message));
    }
    response.json().await.map_err(|error| {
        WorldCollectionShareError::Custom(format!(
            "share collection fetch response is invalid: {error}"
        ))
    })
}
