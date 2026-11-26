use std::collections::HashSet;

use futures_util::{stream, StreamExt};
use serde::Serialize;
use vrcx_0_application_core::{FavoriteEntityKind, Result};
use vrcx_0_core::OwnerId;

use super::local_favorites::{list_local_favorites, FavoriteStore};
use super::FavoriteRemoteFuture;

const LOCAL_WORLD_DETAILS_REFRESH_CONCURRENCY: usize = 3;

#[derive(Clone, Debug, Default, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct LocalWorldDetailsRefreshOutput {
    pub requested: u32,
    pub refreshed: u32,
}

pub trait LocalWorldDetailsRemote: Send + Sync {
    fn refresh<'a>(&'a self, endpoint: &'a str, world_id: &'a str)
        -> FavoriteRemoteFuture<'a, i32>;
}

pub async fn refresh_local_world_details(
    store: &dyn FavoriteStore,
    owner_user_id: &OwnerId,
    remote: &dyn LocalWorldDetailsRemote,
    endpoint: &str,
) -> Result<LocalWorldDetailsRefreshOutput> {
    let mut seen = HashSet::new();
    let world_ids = list_local_favorites(store, owner_user_id, FavoriteEntityKind::World)?
        .into_iter()
        .filter_map(|row| row.world_id)
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty() && seen.insert(id.clone()))
        .collect::<Vec<_>>();
    let requested = world_ids.len() as u32;
    let refreshed = stream::iter(world_ids)
        .map(|world_id| async move {
            match remote.refresh(endpoint, &world_id).await {
                Ok(status) => (200..=299).contains(&status),
                Err(error) => {
                    tracing::warn!(world_id, "local favorite world refresh failed: {error}");
                    false
                }
            }
        })
        .buffer_unordered(LOCAL_WORLD_DETAILS_REFRESH_CONCURRENCY)
        .filter(|ok| std::future::ready(*ok))
        .count()
        .await as u32;
    Ok(LocalWorldDetailsRefreshOutput {
        requested,
        refreshed,
    })
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;
    use crate::favorites::test_support::TestFavoriteStore;

    #[derive(Default)]
    struct TestWorldDetailsRemote {
        calls: Mutex<Vec<String>>,
    }

    impl LocalWorldDetailsRemote for TestWorldDetailsRemote {
        fn refresh<'a>(
            &'a self,
            _endpoint: &'a str,
            world_id: &'a str,
        ) -> FavoriteRemoteFuture<'a, i32> {
            Box::pin(async move {
                self.calls.lock().unwrap().push(world_id.to_string());
                Ok(if world_id == "wrld_fresh" { 200 } else { 404 })
            })
        }
    }

    #[tokio::test]
    async fn refreshes_every_local_world_favorite_and_counts_successful_fetches() {
        let store = TestFavoriteStore::default();
        let owner = OwnerId::new("usr_owner".to_string());
        for (world_id, group) in [
            ("wrld_fresh", "Favorites"),
            ("wrld_fresh", "Other"),
            ("wrld_gone", "Favorites"),
        ] {
            let group = store
                .create_group(Some(&owner), FavoriteEntityKind::World, group)
                .unwrap();
            store
                .add(
                    Some(&owner),
                    FavoriteEntityKind::World,
                    world_id.to_string(),
                    group.id,
                )
                .unwrap();
        }
        let remote = TestWorldDetailsRemote::default();

        let output =
            refresh_local_world_details(&store, &owner, &remote, "https://api.vrchat.cloud/api/1")
                .await
                .unwrap();

        assert_eq!(output.requested, 2);
        assert_eq!(output.refreshed, 1);
        let mut calls = remote.calls.lock().unwrap().clone();
        calls.sort();
        assert_eq!(calls, ["wrld_fresh", "wrld_gone"]);
    }
}
