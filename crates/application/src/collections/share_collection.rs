use std::collections::{HashMap, HashSet};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use vrcx_0_core::vrchat_ids::is_world_id;
use vrcx_0_integrations::world_collections::{
    create_world_collection, mint_world_collection_token, WorldCollectionCreatePayload,
    WorldCollectionCreateResponse, WorldCollectionPayloadWorld, WorldCollectionShareError,
    WorldCollectionTokenMintResponse, WORLD_COLLECTIONS_SITE_ORIGIN,
};
use vrcx_0_persistence::{
    config::{get_json, set_json},
    memos::memo_get_worlds_many,
    worlds::{world_cache_get_many, WorldSummaryOutput},
    DatabaseService,
};

use super::blocking_db::run_blocking_db;
use crate::Error;

pub const SHARE_COLLECTION_MAX_WORLDS: usize = 1_000;
const SHARE_COLLECTION_WORLD_BATCH_SIZE: usize = 500;
const SHARE_OWNER_TOKENS_CONFIG_KEY: &str = "VRCX_ShareOwnerKeys";
const SHARE_OWNER_TOKEN_PREFIX: &str = "w1.";
const SHARE_OWNER_TOKEN_BYTES: usize = 32;
static SHARE_OWNER_TOKENS_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

trait WorldCollectionShareApi {
    async fn mint_token(
        &self,
        owner_hint: &str,
    ) -> Result<WorldCollectionTokenMintResponse, WorldCollectionShareError>;

    async fn create_collection(
        &self,
        token: &str,
        payload: &WorldCollectionCreatePayload,
    ) -> Result<WorldCollectionCreateResponse, WorldCollectionShareError>;
}

struct LiveWorldCollectionShareApi;

impl WorldCollectionShareApi for LiveWorldCollectionShareApi {
    async fn mint_token(
        &self,
        owner_hint: &str,
    ) -> Result<WorldCollectionTokenMintResponse, WorldCollectionShareError> {
        mint_world_collection_token(owner_hint).await
    }

    async fn create_collection(
        &self,
        token: &str,
        payload: &WorldCollectionCreatePayload,
    ) -> Result<WorldCollectionCreateResponse, WorldCollectionShareError> {
        create_world_collection(token, payload).await
    }
}

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
        if !row.release_status.as_str().eq_ignore_ascii_case("public") {
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
    share_collection_create_with_api(deps, input, &LiveWorldCollectionShareApi).await
}

async fn share_collection_create_with_api(
    deps: ShareCollectionDeps<'_>,
    input: ShareCollectionCreateInput,
    api: &impl WorldCollectionShareApi,
) -> Result<ShareCollectionCreateResult, Error> {
    let db = deps.db;
    let current_user_id = deps.current_user_id;
    let prepared = run_blocking_db(move || prepare_share_collection_payload(deps, input))?;
    let owner_token = get_or_create_share_owner_token_with_api(db, current_user_id, api).await?;
    let response = api
        .create_collection(&owner_token, &prepared.payload)
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

pub(crate) fn payload_world_from_row(
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
        created_at: row.created_at.to_string(),
        image_url: row.image_url.clone(),
        description: row.description.clone(),
        release_status: row.release_status.as_str().to_string(),
        thumbnail_image_url,
        comment,
        updated_at: row.updated_at.to_string(),
        version: row.version,
    }
}

pub async fn get_or_create_share_owner_token(
    db: &DatabaseService,
    user_id: &str,
) -> Result<String, Error> {
    get_or_create_share_owner_token_with_api(db, user_id, &LiveWorldCollectionShareApi).await
}

async fn get_or_create_share_owner_token_with_api(
    db: &DatabaseService,
    user_id: &str,
    api: &impl WorldCollectionShareApi,
) -> Result<String, Error> {
    let user_id = require_current_user_id(user_id)?;
    let _guard = SHARE_OWNER_TOKENS_LOCK.lock().await;
    let mut owner_tokens = run_blocking_db(|| read_share_owner_tokens(db))?;
    if let Some(owner_token) = share_owner_token_for_user(&owner_tokens, user_id)? {
        return Ok(owner_token);
    }

    let owner_hint = share_collection_owner_hint(user_id);
    let response = api
        .mint_token(&owner_hint)
        .await
        .map_err(|error| Error::Custom(error.to_string()))?;
    if !is_valid_share_owner_token(&response.token) {
        return Err(Error::Custom(
            "Share collection token service returned an invalid token.".into(),
        ));
    }
    set_share_owner_token(&mut owner_tokens, user_id, &response.token)?;
    run_blocking_db(|| set_json(db, SHARE_OWNER_TOKENS_CONFIG_KEY, &owner_tokens))?;
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
    use std::{
        path::PathBuf,
        sync::atomic::{AtomicUsize, Ordering},
    };

    use serde_json::json;
    use vrcx_0_persistence::{
        cache_entities::CacheEntityInput, worlds::world_cache_upsert, DatabaseService,
    };

    use super::*;

    struct TestDir(PathBuf);

    impl TestDir {
        fn new(name: &str) -> Self {
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "vrcx0-share-contract-{name}-{}-{nonce}",
                std::process::id()
            ));
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    struct RejectingShareApi {
        mint_calls: AtomicUsize,
        create_calls: AtomicUsize,
    }

    impl WorldCollectionShareApi for RejectingShareApi {
        async fn mint_token(
            &self,
            _owner_hint: &str,
        ) -> Result<WorldCollectionTokenMintResponse, WorldCollectionShareError> {
            self.mint_calls.fetch_add(1, Ordering::SeqCst);
            Ok(WorldCollectionTokenMintResponse {
                token: valid_token(),
            })
        }

        async fn create_collection(
            &self,
            _token: &str,
            _payload: &WorldCollectionCreatePayload,
        ) -> Result<WorldCollectionCreateResponse, WorldCollectionShareError> {
            self.create_calls.fetch_add(1, Ordering::SeqCst);
            Err(WorldCollectionShareError::Custom(
                "share collection upload returned HTTP 401 Unauthorized".into(),
            ))
        }
    }

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

    #[tokio::test]
    async fn create_401_preserves_valid_token_without_mint_or_retry() {
        let dir = TestDir::new("create-401");
        let db = DatabaseService::new(&dir.0.join("VRCX-0.sqlite3")).unwrap();
        let token = valid_token();
        set_json(
            &db,
            SHARE_OWNER_TOKENS_CONFIG_KEY,
            &json!({ "usr_current": token }),
        )
        .unwrap();
        world_cache_upsert(
            &db,
            CacheEntityInput {
                id: json!("wrld_11111111-1111-1111-1111-111111111111"),
                author_id: json!("usr_author"),
                author_name: json!("World Author"),
                created_at: json!("2026-01-01T00:00:00.000Z"),
                description: json!("Description"),
                image_url: json!("https://images.example/world.png"),
                name: json!("World"),
                release_status: json!("public"),
                thumbnail_image_url: json!(""),
                updated_at: json!("2026-01-02T00:00:00.000Z"),
                version: json!(1),
            },
        )
        .unwrap();
        let api = RejectingShareApi {
            mint_calls: AtomicUsize::new(0),
            create_calls: AtomicUsize::new(0),
        };

        let error = share_collection_create_with_api(
            ShareCollectionDeps {
                db: &db,
                current_user_id: "usr_current",
                current_user_display_name: "Current User",
            },
            ShareCollectionCreateInput {
                title: "Worlds".into(),
                listed: false,
                include_notes: false,
                world_ids: vec!["wrld_11111111-1111-1111-1111-111111111111".into()],
            },
            &api,
        )
        .await
        .unwrap_err();

        assert!(error.to_string().contains("401 Unauthorized"));
        assert_eq!(api.create_calls.load(Ordering::SeqCst), 1);
        assert_eq!(api.mint_calls.load(Ordering::SeqCst), 0);
        assert_eq!(
            get_json(&db, SHARE_OWNER_TOKENS_CONFIG_KEY, json!({})).unwrap(),
            json!({ "usr_current": valid_token() })
        );
    }
}
