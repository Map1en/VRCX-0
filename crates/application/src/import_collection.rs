use std::collections::HashSet;

use serde::Serialize;
use serde_json::json;
use vrcx_0_integrations::world_collections::{
    fetch_world_collection, WorldCollectionSnapshotResponse, WorldCollectionSnapshotWorld,
};
use vrcx_0_persistence::{
    cache_entities::CacheEntityInput,
    favorites::favorite_add,
    worlds::{world_cache_get_many, world_cache_upsert},
    DatabaseService,
};

use crate::create_local_favorite_group;
use crate::share_collection::SHARE_COLLECTION_MAX_WORLDS;
use crate::Error;

const IMPORT_PREVIEW_WORLD_LIMIT: usize = 20;
const IMPORT_FALLBACK_GROUP_NAME: &str = "Imported collection";
const WORLD_ID_PREFIX: &str = "wrld_";

pub struct ImportCollectionDeps<'a> {
    pub db: &'a DatabaseService,
}

#[derive(Clone, Debug, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreviewWorld {
    pub world_id: String,
    pub name: String,
    pub image_url: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    pub title: String,
    pub author_name: String,
    pub world_count: i64,
    pub worlds: Vec<ImportPreviewWorld>,
}

#[derive(Clone, Debug, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub group_key: String,
    pub imported_count: i64,
}

pub async fn preview_shared_collection(id: &str) -> Result<ImportPreview, Error> {
    let snapshot = fetch_world_collection(id)
        .await
        .map_err(|error| Error::Custom(error.to_string()))?;
    let valid_worlds = valid_snapshot_worlds(&snapshot);
    Ok(ImportPreview {
        title: snapshot.title.trim().to_string(),
        author_name: snapshot.author_name.trim().to_string(),
        world_count: valid_worlds.len() as i64,
        worlds: valid_worlds
            .iter()
            .take(IMPORT_PREVIEW_WORLD_LIMIT)
            .map(|world| ImportPreviewWorld {
                world_id: world.world_id.trim().to_string(),
                name: world.name.trim().to_string(),
                image_url: world.image_url.trim().to_string(),
            })
            .collect(),
    })
}

pub async fn import_shared_collection(
    deps: ImportCollectionDeps<'_>,
    id: &str,
) -> Result<ImportResult, Error> {
    let snapshot = fetch_world_collection(id)
        .await
        .map_err(|error| Error::Custom(error.to_string()))?;
    let valid_worlds = valid_snapshot_worlds(&snapshot);
    if valid_worlds.is_empty() {
        return Err(Error::Custom(
            "Shared collection has no valid worlds to import.".into(),
        ));
    }

    let title = snapshot.title.trim();
    let group_name = if title.is_empty() {
        IMPORT_FALLBACK_GROUP_NAME.to_string()
    } else {
        title.to_string()
    };
    create_local_favorite_group(deps.db, "world", group_name.clone())?;

    let world_ids = valid_worlds
        .iter()
        .map(|world| world.world_id.trim().to_string())
        .collect::<Vec<_>>();
    let cached_ids = world_cache_get_many(deps.db, &world_ids)?
        .into_iter()
        .map(|world| world.id)
        .collect::<HashSet<_>>();

    let mut imported_count = 0i64;
    for world in &valid_worlds {
        let world_id = world.world_id.trim().to_string();
        // Only seed the world cache when it is empty for this id so an
        // import never clobbers richer facts already synced from the
        // VRChat API for a world the user already favorited.
        if !cached_ids.contains(&world_id) {
            world_cache_upsert(
                deps.db,
                CacheEntityInput {
                    id: json!(world_id),
                    author_id: json!(""),
                    author_name: json!(world.author_name.trim()),
                    created_at: json!(""),
                    description: json!(world.description.trim()),
                    image_url: json!(world.image_url.trim()),
                    name: json!(world.name.trim()),
                    release_status: json!("public"),
                    thumbnail_image_url: json!(world.image_url.trim()),
                    updated_at: json!(""),
                    version: json!(0),
                },
            )?;
        }
        favorite_add(deps.db, "world".to_string(), world_id, group_name.clone())?;
        imported_count += 1;
    }

    Ok(ImportResult {
        group_key: group_name,
        imported_count,
    })
}

fn valid_snapshot_worlds(
    snapshot: &WorldCollectionSnapshotResponse,
) -> Vec<&WorldCollectionSnapshotWorld> {
    let mut seen = HashSet::new();
    snapshot
        .worlds
        .iter()
        .filter(|world| {
            let world_id = world.world_id.trim();
            is_valid_world_id(world_id) && seen.insert(world_id.to_string())
        })
        .take(SHARE_COLLECTION_MAX_WORLDS)
        .collect()
}

fn is_valid_world_id(world_id: &str) -> bool {
    world_id.starts_with(WORLD_ID_PREFIX) && world_id.len() > WORLD_ID_PREFIX.len()
}
