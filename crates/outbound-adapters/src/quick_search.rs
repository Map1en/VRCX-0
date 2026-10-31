use std::sync::Arc;

use vrcx_0_application::social::{
    QuickSearchDetailStore, QuickSearchRemoteRequests, QuickSearchRemoteSource,
};
use vrcx_0_application_core::{vrchat_api::VrchatApiRequest, Result};
use vrcx_0_core::OwnerId;
use vrcx_0_persistence::{
    memos::{memo_list_user_notes, memo_list_users},
    DatabaseService,
};
use vrcx_0_vrchat_client::{
    favorites::{favorite_avatars_get_input, favorite_worlds_get_input},
    groups::user_groups_get_input,
    query::{QueryOrder, ReleaseStatusFilter, WorldSearchSort},
    worlds::world_list_by_user_get_input,
};

pub struct LocalQuickSearchDetailStore {
    db: Arc<DatabaseService>,
}

impl LocalQuickSearchDetailStore {
    pub fn new(db: Arc<DatabaseService>) -> Self {
        Self { db }
    }
}

impl QuickSearchDetailStore for LocalQuickSearchDetailStore {
    fn user_memos(&self) -> Result<Vec<(String, String)>> {
        memo_list_users(&self.db)
            .map(|rows| {
                rows.into_iter()
                    .map(|row| (row.user_id, row.memo))
                    .collect()
            })
            .map_err(crate::Error::from)
    }

    fn user_notes(&self, owner: OwnerId) -> Result<Vec<(String, String)>> {
        memo_list_user_notes(&self.db, owner)
            .map(|rows| {
                rows.into_iter()
                    .map(|row| (row.user_id, row.note))
                    .collect()
            })
            .map_err(crate::Error::from)
    }
}

pub struct VrchatQuickSearchRemoteRequests;

impl QuickSearchRemoteRequests for VrchatQuickSearchRemoteRequests {
    fn page(
        &self,
        source: QuickSearchRemoteSource,
        endpoint: String,
        current_user_id: String,
        n: i32,
        offset: i32,
    ) -> Result<VrchatApiRequest> {
        match source {
            QuickSearchRemoteSource::OwnWorlds => Ok(world_list_by_user_get_input(
                endpoint,
                current_user_id,
                n,
                offset,
                WorldSearchSort::Updated,
                QueryOrder::Descending,
                ReleaseStatusFilter::All,
            )?
            .1),
            QuickSearchRemoteSource::FavoriteAvatars => Ok(favorite_avatars_get_input(
                endpoint,
                n,
                offset,
                String::new(),
            )),
            QuickSearchRemoteSource::FavoriteWorlds => Ok(favorite_worlds_get_input(
                endpoint,
                n,
                offset,
                String::new(),
                String::new(),
                String::new(),
            )),
        }
    }

    fn user_groups(&self, endpoint: String, current_user_id: String) -> Result<VrchatApiRequest> {
        Ok(user_groups_get_input(endpoint, current_user_id)?.1)
    }
}
