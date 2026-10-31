use std::sync::Arc;

use vrcx_0_application::social::{
    MutualGraphMetaInput, MutualGraphRemoteRequests, MutualGraphSnapshotEntryInput,
    MutualGraphSnapshotOutput, MutualGraphStore,
};
use vrcx_0_application_core::{vrchat_api::VrchatApiRequest, Result};
use vrcx_0_persistence::{mutual_graph, DatabaseService};
use vrcx_0_vrchat_client::users::user_mutual_friends_get_input;

pub struct LocalMutualGraphStore {
    db: Arc<DatabaseService>,
}

impl LocalMutualGraphStore {
    pub fn new(db: Arc<DatabaseService>) -> Self {
        Self { db }
    }
}

impl MutualGraphStore for LocalMutualGraphStore {
    fn friend_refresh_commit(
        &self,
        owner_user_id: String,
        friend_id: String,
        mutual_ids: Option<Vec<String>>,
        total_count: Option<usize>,
        opted_out: bool,
    ) -> Result<()> {
        mutual_graph::mutual_graph_friend_refresh_commit(
            &self.db,
            owner_user_id,
            friend_id,
            mutual_ids,
            total_count,
            opted_out,
        )
        .map_err(crate::Error::from)
    }

    fn snapshot_get(&self, owner_user_id: String) -> Result<MutualGraphSnapshotOutput> {
        mutual_graph::mutual_graph_snapshot_get(&self.db, owner_user_id).map_err(crate::Error::from)
    }

    fn snapshot_commit(
        &self,
        owner_user_id: String,
        entries: Vec<MutualGraphSnapshotEntryInput>,
        meta: Vec<MutualGraphMetaInput>,
    ) -> Result<()> {
        mutual_graph::mutual_graph_snapshot_commit(&self.db, owner_user_id, entries, meta)
            .map_err(crate::Error::from)
    }
}

pub struct VrchatMutualGraphRemoteRequests;

impl MutualGraphRemoteRequests for VrchatMutualGraphRemoteRequests {
    fn mutual_friends(
        &self,
        endpoint: String,
        user_id: String,
        n: i32,
        offset: i32,
    ) -> Result<VrchatApiRequest> {
        Ok(user_mutual_friends_get_input(endpoint, user_id, n, offset)?.1)
    }
}
