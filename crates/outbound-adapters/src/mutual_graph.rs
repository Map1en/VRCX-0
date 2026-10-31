use std::sync::Arc;

use vrcx_0_application::social::{
    MutualGraphLinkOutput, MutualGraphMetaInput, MutualGraphMetaOutput, MutualGraphRemoteRequests,
    MutualGraphSnapshotEntryInput, MutualGraphSnapshotOutput, MutualGraphStore,
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
        mutual_graph::mutual_graph_snapshot_get(&self.db, owner_user_id)
            .map(|snapshot| MutualGraphSnapshotOutput {
                friend_ids: snapshot.friend_ids,
                links: snapshot
                    .links
                    .into_iter()
                    .map(|link| MutualGraphLinkOutput {
                        friend_id: link.friend_id,
                        mutual_id: link.mutual_id,
                    })
                    .collect(),
                meta: snapshot
                    .meta
                    .into_iter()
                    .map(|meta| MutualGraphMetaOutput {
                        friend_id: meta.friend_id,
                        last_fetched_at: meta.last_fetched_at,
                        opted_out: meta.opted_out,
                        total_count: meta.total_count.map(|count| count as usize),
                    })
                    .collect(),
            })
            .map_err(crate::Error::from)
    }

    fn snapshot_commit(
        &self,
        owner_user_id: String,
        entries: Vec<MutualGraphSnapshotEntryInput>,
        meta: Vec<MutualGraphMetaInput>,
    ) -> Result<()> {
        mutual_graph::mutual_graph_snapshot_commit(
            &self.db,
            owner_user_id,
            entries
                .into_iter()
                .map(|entry| mutual_graph::MutualGraphSnapshotEntryInput {
                    friend_id: entry.friend_id,
                    mutual_ids: entry.mutual_ids,
                })
                .collect(),
            meta.into_iter()
                .map(|entry| mutual_graph::MutualGraphMetaInput {
                    friend_id: entry.friend_id,
                    last_fetched_at: entry.last_fetched_at,
                    opted_out: entry.opted_out,
                    total_count: entry.total_count,
                })
                .collect(),
        )
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
