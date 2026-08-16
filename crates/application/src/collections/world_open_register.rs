use std::collections::HashMap;

use vrcx_0_integrations::world_collections::{
    register_world_revision, WorldOpenRegisterPayload, WorldOpenRegisterWorld,
};
use vrcx_0_persistence::{worlds::world_cache_get, DatabaseService};

use super::blocking_db::run_blocking_db;
use crate::Error;

use super::share_collection::{
    get_or_create_share_owner_token, payload_world_from_row, share_collection_owner_hint,
};

pub async fn register_world_open_share(
    db: &DatabaseService,
    current_user_id: &str,
    world_id: &str,
) -> Result<(), Error> {
    let current_user_id = current_user_id.trim();
    if current_user_id.is_empty() {
        return Err(Error::Custom(
            "World open register requires an authenticated user.".into(),
        ));
    }
    let world_id = world_id.trim();
    if world_id.is_empty() {
        return Err(Error::Custom(
            "World open register requires a world id.".into(),
        ));
    }

    let Some(row) = run_blocking_db(|| world_cache_get(db, world_id.to_string()))? else {
        return Err(Error::Custom("World is not cached locally.".into()));
    };
    if row.id.trim().is_empty()
        || row.name.trim().is_empty()
        || row.author_id.trim().is_empty()
        || row.author_name.trim().is_empty()
        || row.image_url.trim().is_empty()
    {
        return Err(Error::Custom("World cache entry is incomplete.".into()));
    }

    let world = payload_world_from_row(&row, &HashMap::new());
    let owner_hint = share_collection_owner_hint(current_user_id);
    let owner_token = get_or_create_share_owner_token(db, current_user_id).await?;
    let payload = WorldOpenRegisterPayload {
        schema: 1,
        owner_hint,
        world: WorldOpenRegisterWorld {
            world_id: world.world_id,
            author_id: world.author_id,
            name: world.name,
            author_name: world.author_name,
            created_at: world.created_at,
            image_url: world.image_url,
            thumbnail_image_url: world.thumbnail_image_url,
            description: world.description,
            release_status: world.release_status,
            updated_at: world.updated_at,
            version: world.version,
        },
    };
    register_world_revision(&owner_token, &payload)
        .await
        .map_err(|error| Error::Custom(error.to_string()))
}
