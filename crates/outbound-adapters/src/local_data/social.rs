use chrono::{Duration, SecondsFormat, Utc};
use vrcx_0_contracts::feed::{WorldFriendVisitsOutput, WorldRecentFriendCountRow};
use vrcx_0_contracts::friend_log::{
    FriendLogCurrentOutput, FriendLogHistoryEntryInput, FriendLogHistoryOutput,
    FriendLogHistoryQueryInput,
};
use vrcx_0_contracts::local_moderation::LocalModerationOutput;
use vrcx_0_contracts::mutual_graph::MutualGraphSnapshotOutput;
use vrcx_0_contracts::profile_bio::ProfileBioOutput;
use vrcx_0_core::OwnerId;

use super::LocalDataStore;
use crate::Result;

impl LocalDataStore {
    pub fn friend_log_current_list(&self, user_id: String) -> Result<Vec<FriendLogCurrentOutput>> {
        Ok(vrcx_0_persistence::friends::friend_log_current_list(
            self.db.as_ref(),
            user_id,
        )?)
    }

    pub fn friend_log_history_delete(
        &self,
        user_id: String,
        entry: FriendLogHistoryEntryInput,
    ) -> Result<i64> {
        Ok(vrcx_0_persistence::friends::friend_log_history_delete(
            self.db.as_ref(),
            user_id,
            entry,
        )?)
    }

    pub fn friend_log_history_query(
        &self,
        query: FriendLogHistoryQueryInput,
    ) -> Result<Vec<FriendLogHistoryOutput>> {
        Ok(vrcx_0_persistence::friends::friend_log_history_query(
            self.db.as_ref(),
            query,
        )?)
    }

    pub fn world_friend_visits(
        &self,
        owner: &OwnerId,
        world_id: String,
    ) -> Result<WorldFriendVisitsOutput> {
        Ok(
            vrcx_0_persistence::social_aggregates::get_world_friend_visits(
                self.db.as_ref(),
                owner,
                &world_id,
            )?,
        )
    }

    pub fn world_recent_friend_counts(
        &self,
        owner: &OwnerId,
        world_ids: Vec<String>,
    ) -> Result<Vec<WorldRecentFriendCountRow>> {
        let since = (Utc::now() - Duration::days(7)).to_rfc3339_opts(SecondsFormat::Millis, true);
        Ok(
            vrcx_0_persistence::social_aggregates::get_world_recent_friend_counts(
                self.db.as_ref(),
                owner,
                &world_ids,
                &since,
            )?,
        )
    }

    pub fn local_moderation_get(
        &self,
        owner_user_id: OwnerId,
        user_id: String,
    ) -> Result<Option<LocalModerationOutput>> {
        Ok(vrcx_0_persistence::local_moderation::local_moderation_get(
            self.db.as_ref(),
            owner_user_id,
            user_id,
        )?)
    }

    pub fn mutual_graph_snapshot_get(&self, user_id: String) -> Result<MutualGraphSnapshotOutput> {
        Ok(vrcx_0_persistence::mutual_graph::mutual_graph_snapshot_get(
            self.db.as_ref(),
            user_id,
        )?)
    }

    pub fn local_moderation_list(
        &self,
        owner_user_id: OwnerId,
    ) -> Result<Vec<LocalModerationOutput>> {
        Ok(vrcx_0_persistence::local_moderation::local_moderation_list(
            self.db.as_ref(),
            owner_user_id,
        )?)
    }

    pub fn profile_bio_list(&self, owner_user_id: OwnerId) -> Result<Vec<ProfileBioOutput>> {
        Ok(vrcx_0_persistence::profile_bio::profile_bio_list(
            self.db.as_ref(),
            &owner_user_id,
        )?)
    }
}
