use std::time::Duration;

use serde::{Deserialize, Serialize};

pub const WORLD_COLLECTIONS_SITE_ORIGIN: &str = "https://worlds.vrcx-0.dev";
pub const WORLD_COLLECTIONS_API_ENDPOINT: &str = "https://worlds.vrcx-0.dev/api/collections";
pub const WORLD_COLLECTIONS_TOKEN_MINT_ENDPOINT: &str = "https://worlds.vrcx-0.dev/api/token/mint";
const WORLD_COLLECTIONS_UPLOAD_TIMEOUT: Duration = Duration::from_secs(60);
const WORLD_COLLECTIONS_FETCH_TIMEOUT: Duration = Duration::from_secs(30);
const COLLECTION_SHORTCODE_MIN_LEN: usize = 6;
const COLLECTION_SHORTCODE_MAX_LEN: usize = 12;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct WorldCollectionCreatePayload {
    pub schema: i64,
    pub owner_hint: String,
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
#[serde(rename_all = "camelCase")]
pub struct WorldCollectionSkippedWorld {
    pub world_id: String,
    pub name: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldCollectionCreateResponse {
    pub id: String,
    #[serde(default)]
    pub skipped_worlds: Vec<WorldCollectionSkippedWorld>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct WorldCollectionTokenMintRequest {
    pub owner_hint: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
pub struct WorldCollectionTokenMintResponse {
    pub token: String,
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
    pub note: Option<String>,
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
    token: &str,
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
        .bearer_auth(token)
        .json(payload)
        .send()
        .await
        .map_err(|error| {
            WorldCollectionShareError::Custom(format!("share collection upload failed: {error}"))
        })?;
    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        let detail = redact_secret(body.trim(), token);
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

fn redact_secret(value: &str, secret: &str) -> String {
    value.replace(secret, "[redacted]")
}

pub async fn mint_world_collection_token(
    owner_hint: &str,
) -> Result<WorldCollectionTokenMintResponse, WorldCollectionShareError> {
    let client = reqwest::Client::builder()
        .timeout(WORLD_COLLECTIONS_FETCH_TIMEOUT)
        .build()
        .map_err(|error| {
            WorldCollectionShareError::Custom(format!(
                "share collection token client failed: {error}"
            ))
        })?;
    let response = client
        .post(WORLD_COLLECTIONS_TOKEN_MINT_ENDPOINT)
        .json(&WorldCollectionTokenMintRequest {
            owner_hint: owner_hint.to_string(),
        })
        .send()
        .await
        .map_err(|error| {
            WorldCollectionShareError::Custom(format!(
                "share collection token mint failed: {error}"
            ))
        })?;
    let status = response.status();
    if status != reqwest::StatusCode::CREATED {
        let body = response.text().await.unwrap_or_default();
        let detail = body.trim();
        let message = if detail.is_empty() {
            format!("share collection token mint returned HTTP {status}")
        } else {
            format!("share collection token mint returned HTTP {status}: {detail}")
        };
        return Err(WorldCollectionShareError::Custom(message));
    }
    response.json().await.map_err(|error| {
        WorldCollectionShareError::Custom(format!(
            "share collection token response is invalid: {error}"
        ))
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

#[cfg(test)]
mod tests {
    use super::{
        redact_secret, WorldCollectionCreatePayload, WorldCollectionCreateResponse,
        WorldCollectionSnapshotResponse, WorldCollectionTokenMintRequest,
    };

    #[test]
    fn token_and_create_payloads_match_the_bearer_contract() {
        let owner_hint = "a".repeat(64);
        assert_eq!(
            serde_json::to_value(WorldCollectionTokenMintRequest {
                owner_hint: owner_hint.clone()
            })
            .unwrap(),
            serde_json::json!({ "owner_hint": owner_hint })
        );

        let payload = WorldCollectionCreatePayload {
            schema: 1,
            owner_hint: "b".repeat(64),
            title: "Worlds".into(),
            listed: false,
            access: "open".into(),
            author_name: "Curator".into(),
            updated_at: 0,
            worlds: Vec::new(),
        };
        let value = serde_json::to_value(payload).unwrap();
        assert_eq!(value["owner_hint"], "b".repeat(64));
        assert!(value.get("owner_key").is_none());
    }

    #[test]
    fn upload_error_detail_redacts_bearer_token() {
        let token = format!("w1.{}", "A".repeat(43));

        assert_eq!(
            redact_secret(&format!("invalid token {token}"), &token),
            "invalid token [redacted]"
        );
    }

    #[test]
    fn snapshot_accepts_nullable_note_from_public_api() {
        let snapshot: WorldCollectionSnapshotResponse = serde_json::from_value(serde_json::json!({
            "id": "AbC123z",
            "title": "Worlds",
            "note": null,
            "author_name": "Curator",
            "author_profile": null,
            "category": null,
            "listed": false,
            "updated_at": 0,
            "worlds": []
        }))
        .expect("nullable note should match the public API contract");

        assert_eq!(snapshot.note, None);
    }

    #[test]
    fn create_response_accepts_skipped_world_summaries() {
        let response: WorldCollectionCreateResponse = serde_json::from_value(serde_json::json!({
            "id": "AbC123z",
            "skippedWorlds": [
                { "worldId": "legacy-world-id", "name": "Incomplete world" }
            ]
        }))
        .expect("skipped world summaries should match the create API contract");

        assert_eq!(response.id, "AbC123z");
        assert_eq!(response.skipped_worlds.len(), 1);
        assert_eq!(response.skipped_worlds[0].world_id, "legacy-world-id");

        let legacy: WorldCollectionCreateResponse =
            serde_json::from_value(serde_json::json!({ "id": "AbC123z" }))
                .expect("older create responses should remain compatible");
        assert!(legacy.skipped_worlds.is_empty());
    }
}
