use futures_util::future::BoxFuture;

use std::sync::Arc;

use serde_json::{json, Value};
use vrcx_0_application::collections::{
    SharedCollectionImportActions, SharedCollectionImportActionsFactory, WorldCollectionFuture,
    WorldCollectionRemote, WorldCollectionStore, WorldMemo,
};
use vrcx_0_application_core::{FavoriteEntityKind, WebClient, WorldCache};
use vrcx_0_contracts::world_collections::{
    WorldCollectionCreatePayload, WorldCollectionCreateResponse, WorldCollectionSnapshotResponse,
    WorldCollectionTokenMintResponse, WorldOpenRegisterPayload,
};
use vrcx_0_contracts::WorldSummaryOutput;
use vrcx_0_persistence::DatabaseService;

const SHARE_OWNER_TOKENS_CONFIG_KEY: &str = "VRCX_ShareOwnerKeys";
const LOCAL_WORLD_FAVORITE_GROUPS_KEY: &str = "localFavoriteWorldGroups";

#[derive(Clone)]
pub struct LocalWorldCollectionAdapter {
    db: Arc<DatabaseService>,
}

impl LocalWorldCollectionAdapter {
    pub fn new(db: Arc<DatabaseService>) -> Self {
        Self { db }
    }
}

impl WorldCollectionStore for LocalWorldCollectionAdapter {
    fn world_summaries(&self, world_ids: &[String]) -> crate::Result<Vec<WorldSummaryOutput>> {
        vrcx_0_persistence::worlds::world_cache_get_many(&self.db, world_ids)
            .map_err(crate::Error::from)
    }

    fn world_memos(&self, world_ids: &[String]) -> crate::Result<Vec<WorldMemo>> {
        Ok(
            vrcx_0_persistence::memos::memo_get_worlds_many(&self.db, world_ids)?
                .into_iter()
                .map(|memo| WorldMemo {
                    world_id: memo.world_id,
                    memo: memo.memo,
                })
                .collect(),
        )
    }

    fn world_summary(&self, world_id: &str) -> crate::Result<Option<WorldSummaryOutput>> {
        vrcx_0_persistence::worlds::world_cache_get(&self.db, world_id.to_string())
            .map_err(crate::Error::from)
    }

    fn read_owner_tokens(&self) -> crate::Result<Value> {
        vrcx_0_persistence::config::get_json(&self.db, SHARE_OWNER_TOKENS_CONFIG_KEY, json!({}))
            .map_err(crate::Error::from)
    }

    fn write_owner_tokens(&self, owner_tokens: &Value) -> crate::Result<()> {
        vrcx_0_persistence::config::set_json(&self.db, SHARE_OWNER_TOKENS_CONFIG_KEY, owner_tokens)
            .map_err(crate::Error::from)
    }
}

impl WorldCollectionRemote for LocalWorldCollectionAdapter {
    fn mint_token<'a>(
        &'a self,
        owner_hint: &'a str,
    ) -> WorldCollectionFuture<'a, WorldCollectionTokenMintResponse> {
        Box::pin(async move {
            vrcx_0_integrations::world_collections::mint_world_collection_token(owner_hint)
                .await
                .map_err(|error| crate::Error::Custom(error.to_string()))
        })
    }

    fn create_collection<'a>(
        &'a self,
        token: &'a str,
        payload: &'a WorldCollectionCreatePayload,
    ) -> WorldCollectionFuture<'a, WorldCollectionCreateResponse> {
        Box::pin(async move {
            vrcx_0_integrations::world_collections::create_world_collection(token, payload)
                .await
                .map_err(|error| crate::Error::Custom(error.to_string()))
        })
    }

    fn fetch_collection<'a>(
        &'a self,
        id: &'a str,
    ) -> WorldCollectionFuture<'a, WorldCollectionSnapshotResponse> {
        Box::pin(async move {
            vrcx_0_integrations::world_collections::fetch_world_collection(id)
                .await
                .map_err(|error| crate::Error::Custom(error.to_string()))
        })
    }

    fn register_world<'a>(
        &'a self,
        token: &'a str,
        payload: &'a WorldOpenRegisterPayload,
    ) -> WorldCollectionFuture<'a, ()> {
        Box::pin(async move {
            vrcx_0_integrations::world_collections::register_world_revision(token, payload)
                .await
                .map_err(|error| crate::Error::Custom(error.to_string()))
        })
    }
}

pub struct LocalSharedCollectionImportActionsFactory {
    db: Arc<DatabaseService>,
    web: Arc<WebClient>,
    world_cache: Arc<WorldCache>,
}

impl LocalSharedCollectionImportActionsFactory {
    pub fn new(
        db: Arc<DatabaseService>,
        web: Arc<WebClient>,
        world_cache: Arc<WorldCache>,
    ) -> Self {
        Self {
            db,
            web,
            world_cache,
        }
    }
}

impl SharedCollectionImportActionsFactory for LocalSharedCollectionImportActionsFactory {
    fn create(&self, endpoint: String) -> Arc<dyn SharedCollectionImportActions> {
        Arc::new(LocalSharedCollectionImportActions {
            db: Arc::clone(&self.db),
            web: Arc::clone(&self.web),
            world_cache: Arc::clone(&self.world_cache),
            endpoint,
        })
    }
}

struct LocalSharedCollectionImportActions {
    db: Arc<DatabaseService>,
    web: Arc<WebClient>,
    world_cache: Arc<WorldCache>,
    endpoint: String,
}

impl SharedCollectionImportActions for LocalSharedCollectionImportActions {
    fn create_group(&self, group_name: &str) -> crate::Result<()> {
        let mut groups = vrcx_0_persistence::config::get_json(
            self.db.as_ref(),
            LOCAL_WORLD_FAVORITE_GROUPS_KEY,
            json!([]),
        )?
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|value| value.as_str().map(ToOwned::to_owned))
        .collect::<Vec<_>>();
        if !groups.iter().any(|value| value == group_name) {
            groups.push(group_name.to_string());
            groups.sort();
            groups.dedup();
        }
        vrcx_0_persistence::config::set_json(
            self.db.as_ref(),
            LOCAL_WORLD_FAVORITE_GROUPS_KEY,
            &json!(groups),
        )
        .map_err(crate::Error::from)
    }

    fn fetch_and_cache_world<'a>(&'a self, world_id: &'a str) -> BoxFuture<'a, crate::Result<()>> {
        Box::pin(async move {
            let response = self
                .world_cache
                .get(self.web.as_ref(), &self.endpoint, world_id, true, false)
                .await?;
            if !(200..=299).contains(&response.status) {
                return Err(crate::Error::Custom(format!(
                    "World lookup failed with status {}.",
                    response.status
                )));
            }
            let world: Value = serde_json::from_str(&response.data)
                .map_err(|error| crate::Error::Custom(format!("Invalid world payload: {error}")))?;
            let response_world_id = world
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim();
            if response_world_id != world_id {
                return Err(crate::Error::Custom(
                    "World payload id did not match request.".into(),
                ));
            }
            self.world_cache
                .hydrate_from_payload(&world)
                .ok_or_else(|| crate::Error::Custom("World payload could not be cached.".into()))?;
            Ok(())
        })
    }

    fn add_world_favorite(&self, world_id: &str, group_name: &str) -> crate::Result<()> {
        vrcx_0_persistence::favorites::favorite_add(
            self.db.as_ref(),
            None,
            FavoriteEntityKind::World,
            world_id.to_string(),
            group_name.to_string(),
        )
        .map(|_| ())
        .map_err(crate::Error::from)
    }
}
