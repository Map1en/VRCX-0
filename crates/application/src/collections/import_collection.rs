use std::collections::HashSet;

use serde::Serialize;
use vrcx_0_core::vrchat_ids::is_world_id;
use vrcx_0_integrations::world_collections::{
    fetch_world_collection, WorldCollectionSnapshotWorld,
};

use super::share_collection::SHARE_COLLECTION_MAX_WORLDS;
use crate::Error;

#[derive(Clone, Debug, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    pub title: String,
    pub world_ids: Vec<String>,
}

pub async fn preview_shared_collection(id: &str) -> Result<ImportPreview, Error> {
    let snapshot = fetch_world_collection(id)
        .await
        .map_err(|error| Error::Custom(error.to_string()))?;
    let world_ids = normalize_world_ids(&snapshot.worlds);

    Ok(ImportPreview {
        title: snapshot.title.trim().to_string(),
        world_ids,
    })
}

fn normalize_world_ids(worlds: &[WorldCollectionSnapshotWorld]) -> Vec<String> {
    let mut seen = HashSet::new();
    worlds
        .iter()
        .map(|world| world.world_id.trim())
        .filter(|world_id| is_world_id(world_id) && seen.insert(*world_id))
        .take(SHARE_COLLECTION_MAX_WORLDS)
        .map(str::to_string)
        .collect()
}

#[cfg(test)]
mod tests {
    use vrcx_0_integrations::world_collections::WorldCollectionSnapshotWorld;

    use super::normalize_world_ids;

    #[test]
    fn normalizes_deduplicates_and_filters_snapshot_world_ids() {
        let world = |world_id: &str| WorldCollectionSnapshotWorld {
            world_id: world_id.to_string(),
            ..Default::default()
        };

        assert_eq!(
            normalize_world_ids(&[
                world(" wrld_11111111-1111-1111-1111-111111111111 "),
                world("legacy-world-id"),
                world("wrld_22222222-2222-2222-2222-222222222222"),
                world("wrld_11111111-1111-1111-1111-111111111111"),
            ]),
            vec![
                "wrld_11111111-1111-1111-1111-111111111111",
                "wrld_22222222-2222-2222-2222-222222222222",
            ]
        );
    }
}
