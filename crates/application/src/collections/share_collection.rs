use std::collections::{HashMap, HashSet};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use vrcx_0_core::vrchat_ids::is_world_id;
use vrcx_0_integrations::world_collections::{
    create_world_collection, mint_world_collection_token, WorldCollectionCreatePayload,
    WorldCollectionPayloadWorld, WORLD_COLLECTIONS_SITE_ORIGIN,
};
use vrcx_0_persistence::{
    config::{get_json, set_json},
    memos::memo_get_worlds_many,
    worlds::{world_cache_get_many, WorldSummaryOutput},
    DatabaseService,
};

use crate::Error;

pub const SHARE_COLLECTION_MAX_WORLDS: usize = 1_000;
const SHARE_COLLECTION_WORLD_BATCH_SIZE: usize = 500;
const SHARE_OWNER_TOKENS_CONFIG_KEY: &str = "VRCX_ShareOwnerKeys";
const SHARE_OWNER_TOKEN_PREFIX: &str = "w1.";
const SHARE_OWNER_TOKEN_BYTES: usize = 32;
static SHARE_OWNER_TOKENS_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ShareCollectionCreateInput {
    pub title: String,
    pub listed: bool,
    pub include_notes: bool,
    pub world_ids: Vec<String>,
}

pub struct ShareCollectionDeps<'a> {
    pub db: &'a DatabaseService,
    pub current_user_id: &'a str,
    pub current_user_display_name: &'a str,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PreparedShareCollection {
    pub payload: WorldCollectionCreatePayload,
    pub skipped_worlds: Vec<ShareCollectionSkippedWorld>,
    pub truncated: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ShareCollectionSkippedWorld {
    pub world_id: String,
    pub name: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ShareCollectionCreateResult {
    pub id: String,
    pub url: String,
    pub world_count: i64,
    pub skipped_worlds: Vec<ShareCollectionSkippedWorld>,
}

pub fn prepare_share_collection_payload(
    deps: ShareCollectionDeps<'_>,
    input: ShareCollectionCreateInput,
) -> Result<PreparedShareCollection, Error> {
    let title = normalize_title(&input.title)?;
    let current_user_id = require_current_user_id(deps.current_user_id)?;
    let owner_hint = share_collection_owner_hint(current_user_id);
    let author_name = deps.current_user_display_name.trim().to_string();
    let normalized_world_ids = normalize_world_ids(&input.world_ids);
    let truncated = normalized_world_ids.len() > SHARE_COLLECTION_MAX_WORLDS;
    let capped_world_ids = normalized_world_ids
        .into_iter()
        .take(SHARE_COLLECTION_MAX_WORLDS)
        .collect::<Vec<_>>();
    if capped_world_ids.is_empty() {
        return Err(Error::Custom(
            "Share collection requires at least one world id.".into(),
        ));
    }

    let mut rows = Vec::new();
    for world_id_batch in capped_world_ids.chunks(SHARE_COLLECTION_WORLD_BATCH_SIZE) {
        rows.extend(world_cache_get_many(deps.db, world_id_batch)?);
    }
    let rows_by_id = rows
        .into_iter()
        .map(|row| (row.id.clone(), row))
        .collect::<HashMap<_, _>>();

    let mut memos_by_id: HashMap<String, String> = HashMap::new();
    if input.include_notes {
        for world_id_batch in capped_world_ids.chunks(SHARE_COLLECTION_WORLD_BATCH_SIZE) {
            for memo in memo_get_worlds_many(deps.db, world_id_batch)? {
                memos_by_id.insert(memo.world_id, memo.memo);
            }
        }
    }

    let mut worlds = Vec::new();
    let mut skipped_worlds = Vec::new();
    for world_id in capped_world_ids {
        let Some(row) = rows_by_id.get(&world_id) else {
            skipped_worlds.push(ShareCollectionSkippedWorld {
                world_id,
                name: String::new(),
            });
            continue;
        };
        if !row.release_status.eq_ignore_ascii_case("public") {
            continue;
        }
        if row.id.trim().is_empty()
            || row.name.trim().is_empty()
            || row.author_id.trim().is_empty()
            || row.author_name.trim().is_empty()
            || row.image_url.trim().is_empty()
        {
            skipped_worlds.push(ShareCollectionSkippedWorld {
                world_id: row.id.clone(),
                name: row.name.trim().to_string(),
            });
            continue;
        }
        worlds.push(payload_world_from_row(row, &memos_by_id));
    }
    if worlds.is_empty() {
        return Err(Error::Custom(
            "Share collection has no complete public cached worlds to upload.".into(),
        ));
    }

    Ok(PreparedShareCollection {
        payload: WorldCollectionCreatePayload {
            schema: 1,
            owner_hint,
            title,
            listed: input.listed,
            access: "open".into(),
            author_name,
            updated_at: Utc::now().timestamp(),
            worlds,
        },
        skipped_worlds,
        truncated,
    })
}

pub async fn share_collection_create(
    deps: ShareCollectionDeps<'_>,
    input: ShareCollectionCreateInput,
) -> Result<ShareCollectionCreateResult, Error> {
    let db = deps.db;
    let current_user_id = deps.current_user_id;
    let prepared = prepare_share_collection_payload(deps, input)?;
    let owner_token = get_or_create_share_owner_token(db, current_user_id).await?;
    let response = create_world_collection(&owner_token, &prepared.payload)
        .await
        .map_err(|error| Error::Custom(error.to_string()))?;
    let server_skipped_count = response.skipped_worlds.len();
    let world_count = prepared
        .payload
        .worlds
        .len()
        .saturating_sub(server_skipped_count) as i64;
    let mut skipped_worlds = prepared.skipped_worlds;
    skipped_worlds.extend(response.skipped_worlds.into_iter().map(|world| {
        ShareCollectionSkippedWorld {
            world_id: world.world_id,
            name: world.name,
        }
    }));
    let id = response.id;
    let url = format!("{WORLD_COLLECTIONS_SITE_ORIGIN}/c/{id}");
    Ok(ShareCollectionCreateResult {
        id,
        url,
        world_count,
        skipped_worlds,
    })
}

fn payload_world_from_row(
    row: &WorldSummaryOutput,
    memos_by_id: &HashMap<String, String>,
) -> WorldCollectionPayloadWorld {
    let comment = memos_by_id.get(&row.id).cloned().unwrap_or_default();
    let thumbnail_image_url = if row.thumbnail_image_url.trim().is_empty() {
        row.image_url.clone()
    } else {
        row.thumbnail_image_url.clone()
    };
    WorldCollectionPayloadWorld {
        world_id: row.id.clone(),
        author_id: row.author_id.clone(),
        name: row.name.clone(),
        author_name: row.author_name.clone(),
        created_at: row.created_at.clone(),
        image_url: row.image_url.clone(),
        description: row.description.clone(),
        release_status: row.release_status.clone(),
        thumbnail_image_url,
        comment,
        updated_at: row.updated_at.clone(),
        version: row.version,
    }
}

pub async fn get_or_create_share_owner_token(
    db: &DatabaseService,
    user_id: &str,
) -> Result<String, Error> {
    let user_id = require_current_user_id(user_id)?;
    let _guard = SHARE_OWNER_TOKENS_LOCK.lock().await;
    let mut owner_tokens = read_share_owner_tokens(db)?;
    if let Some(owner_token) = share_owner_token_for_user(&owner_tokens, user_id)? {
        return Ok(owner_token);
    }

    let owner_hint = share_collection_owner_hint(user_id);
    let response = mint_world_collection_token(&owner_hint)
        .await
        .map_err(|error| Error::Custom(error.to_string()))?;
    if !is_valid_share_owner_token(&response.token) {
        return Err(Error::Custom(
            "Share collection token service returned an invalid token.".into(),
        ));
    }
    set_share_owner_token(&mut owner_tokens, user_id, &response.token)?;
    set_json(db, SHARE_OWNER_TOKENS_CONFIG_KEY, &owner_tokens)?;
    Ok(response.token)
}

pub fn share_collection_owner_hint(user_id: &str) -> String {
    hex::encode(Sha256::digest(user_id.trim().as_bytes()))
}

pub fn is_valid_share_owner_token(token: &str) -> bool {
    let Some(encoded) = token.strip_prefix(SHARE_OWNER_TOKEN_PREFIX) else {
        return false;
    };
    URL_SAFE_NO_PAD
        .decode(encoded)
        .map(|bytes| bytes.len() == SHARE_OWNER_TOKEN_BYTES)
        .unwrap_or(false)
}

fn require_current_user_id(user_id: &str) -> Result<&str, Error> {
    let user_id = user_id.trim();
    if user_id.is_empty() {
        return Err(Error::Custom(
            "Share collection requires an authenticated user.".into(),
        ));
    }
    Ok(user_id)
}

fn read_share_owner_tokens(db: &DatabaseService) -> Result<serde_json::Value, Error> {
    let raw = get_json(db, SHARE_OWNER_TOKENS_CONFIG_KEY, serde_json::json!({}))?;
    if raw.is_object() {
        Ok(raw)
    } else {
        Err(Error::Custom(
            "Share collection token storage is not a JSON object.".into(),
        ))
    }
}

fn share_owner_token_for_user(
    owner_tokens: &serde_json::Value,
    user_id: &str,
) -> Result<Option<String>, Error> {
    let owner_tokens = owner_tokens.as_object().ok_or_else(|| {
        Error::Custom("Share collection token storage is not a JSON object.".into())
    })?;
    Ok(owner_tokens
        .get(user_id)
        .and_then(serde_json::Value::as_str)
        .filter(|token| is_valid_share_owner_token(token))
        .map(str::to_string))
}

fn set_share_owner_token(
    owner_tokens: &mut serde_json::Value,
    user_id: &str,
    token: &str,
) -> Result<(), Error> {
    let owner_tokens = owner_tokens.as_object_mut().ok_or_else(|| {
        Error::Custom("Share collection token storage is not a JSON object.".into())
    })?;
    owner_tokens.insert(
        user_id.to_string(),
        serde_json::Value::String(token.to_string()),
    );
    Ok(())
}

fn normalize_title(title: &str) -> Result<String, Error> {
    let title = title.trim();
    if title.is_empty() {
        return Err(Error::Custom("Share collection title is required.".into()));
    }
    Ok(title.to_string())
}

fn normalize_world_ids(world_ids: &[String]) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut normalized = Vec::new();
    for world_id in world_ids {
        let world_id = world_id.trim();
        if !is_world_id(world_id) {
            continue;
        }
        if !seen.insert(world_id) {
            continue;
        }
        normalized.push(world_id.to_string());
    }
    normalized
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{set_share_owner_token, share_owner_token_for_user};

    fn valid_token() -> String {
        format!("w1.{}", "A".repeat(43))
    }

    #[test]
    fn invalid_current_token_is_treated_as_missing_without_dropping_other_entries() {
        let mut owner_tokens = json!({
            "usr_current": "legacy-unversioned-token",
            "usr_valid": valid_token(),
            "usr_broken": { "unexpected": true }
        });

        assert_eq!(
            share_owner_token_for_user(&owner_tokens, "usr_current").unwrap(),
            None
        );
        assert_eq!(
            share_owner_token_for_user(&owner_tokens, "usr_valid").unwrap(),
            Some(valid_token())
        );
        set_share_owner_token(&mut owner_tokens, "usr_current", &valid_token()).unwrap();

        assert_eq!(owner_tokens["usr_valid"], json!(valid_token()));
        assert_eq!(owner_tokens["usr_broken"], json!({ "unexpected": true }));
        assert_eq!(owner_tokens["usr_current"], json!(valid_token()));
    }

    #[test]
    fn non_object_token_storage_fails_closed() {
        let mut owner_tokens = json!(["unexpected"]);

        assert!(share_owner_token_for_user(&owner_tokens, "usr_current").is_err());
        assert!(set_share_owner_token(&mut owner_tokens, "usr_current", &valid_token()).is_err());
    }
}
