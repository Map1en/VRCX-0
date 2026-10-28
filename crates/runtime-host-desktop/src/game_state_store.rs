use std::sync::Arc;

use serde_json::Value;
use vrcx_0_application_game::{GameStateStore, PlayerModeration};
use vrcx_0_contracts::game_log::{
    GameLogJoinLeaveSnapshot, GameLogLocationSnapshot, GameLogWriteBatch, GameLogWriteCount,
    PreviousInstanceEventRow, SessionEventRow, SessionLocationSegmentRow, SessionPlayerDurationRow,
};
use vrcx_0_core::OwnerId;
use vrcx_0_persistence::{config, game_log, local_moderation, DatabaseService};

pub(crate) struct PersistenceGameStateStore {
    db: Arc<DatabaseService>,
}

impl PersistenceGameStateStore {
    pub(crate) fn new(db: Arc<DatabaseService>) -> Self {
        Self { db }
    }
}

impl GameStateStore for PersistenceGameStateStore {
    fn get_bool(&self, key: &str, default: bool) -> vrcx_0_application_core::Result<bool> {
        Ok(config::get_bool(self.db.as_ref(), key, default)?)
    }

    fn get_string(&self, key: &str, default: &str) -> vrcx_0_application_core::Result<String> {
        Ok(config::get_string(self.db.as_ref(), key, default)?)
    }

    fn get_json(&self, key: &str, default: Value) -> vrcx_0_application_core::Result<Value> {
        Ok(config::get_json(self.db.as_ref(), key, default)?)
    }

    fn set_bool(&self, key: &str, value: bool) -> vrcx_0_application_core::Result<()> {
        Ok(config::set_bool(self.db.as_ref(), key, value)?)
    }

    fn set_string(&self, key: &str, value: &str) -> vrcx_0_application_core::Result<()> {
        Ok(config::set_string(self.db.as_ref(), key, value)?)
    }

    fn set_json(&self, key: &str, value: &Value) -> vrcx_0_application_core::Result<()> {
        Ok(config::set_json(self.db.as_ref(), key, value)?)
    }

    fn write_game_log(
        &self,
        owner: &OwnerId,
        batch: &GameLogWriteBatch,
    ) -> vrcx_0_application_core::Result<GameLogWriteCount> {
        Ok(game_log::write_batch(self.db.as_ref(), owner, batch)?)
    }

    fn fill_location_group_name(
        &self,
        owner: &OwnerId,
        created_at: &str,
        location: &str,
        group_name: &str,
    ) -> vrcx_0_application_core::Result<u64> {
        Ok(game_log::fill_location_group_name(
            self.db.as_ref(),
            owner,
            created_at,
            location,
            group_name,
        )?)
    }

    fn join_leave_for_location(
        &self,
        owner: &OwnerId,
        location: &str,
        after_date: &str,
        before_date: &str,
    ) -> vrcx_0_application_core::Result<Vec<GameLogJoinLeaveSnapshot>> {
        Ok(game_log::get_join_leave_entries_for_location_range(
            self.db.as_ref(),
            owner,
            location,
            after_date,
            before_date,
        )?)
    }

    fn previous_instance_events(
        &self,
        owner: &OwnerId,
        user_id: &str,
        date_from: &str,
        date_to: &str,
        limit: usize,
    ) -> vrcx_0_application_core::Result<Vec<PreviousInstanceEventRow>> {
        Ok(game_log::previous_instance_event_rows_query(
            self.db.as_ref(),
            owner,
            user_id,
            date_from,
            date_to,
            limit,
        )?)
    }

    fn user_id_from_display_name(
        &self,
        owner: &OwnerId,
        display_name: &str,
    ) -> vrcx_0_application_core::Result<String> {
        Ok(game_log::get_user_id_from_display_name(
            self.db.as_ref(),
            owner,
            display_name,
        )?)
    }

    fn ensure_game_log_tables(&self) -> vrcx_0_application_core::Result<()> {
        Ok(game_log::ensure_game_log_tables(self.db.as_ref())?)
    }

    fn location_before_or_at(
        &self,
        owner: &OwnerId,
        created_at: &str,
    ) -> vrcx_0_application_core::Result<Option<GameLogLocationSnapshot>> {
        Ok(game_log::get_location_before_or_at(
            self.db.as_ref(),
            owner,
            created_at,
        )?)
    }

    fn session_location_segments(
        &self,
        owner: &OwnerId,
        before_id: Option<i64>,
        limit: i64,
    ) -> vrcx_0_application_core::Result<Vec<SessionLocationSegmentRow>> {
        Ok(game_log::get_session_location_segments(
            self.db.as_ref(),
            owner,
            before_id,
            limit,
        )?)
    }

    fn session_location_segments_by_date_range(
        &self,
        owner: &OwnerId,
        after_date: &str,
        before_date: &str,
        limit: i64,
    ) -> vrcx_0_application_core::Result<Vec<SessionLocationSegmentRow>> {
        Ok(game_log::get_session_location_segments_by_date_range(
            self.db.as_ref(),
            owner,
            after_date,
            before_date,
            limit,
        )?)
    }

    fn session_events_for_range(
        &self,
        owner: &OwnerId,
        after_date: &str,
        before_date: &str,
    ) -> vrcx_0_application_core::Result<Vec<SessionEventRow>> {
        Ok(game_log::get_session_events_for_range(
            self.db.as_ref(),
            owner,
            after_date,
            before_date,
        )?)
    }

    fn session_player_duration_rows(
        &self,
        owner: &OwnerId,
        locations: &[String],
    ) -> vrcx_0_application_core::Result<Vec<SessionPlayerDurationRow>> {
        Ok(game_log::get_session_player_duration_rows(
            self.db.as_ref(),
            owner,
            locations,
        )?)
    }

    fn favorite_friend_group_names_for_users(
        &self,
        owner: &OwnerId,
        user_ids: &[String],
    ) -> vrcx_0_application_core::Result<Vec<String>> {
        let user_ids = user_ids
            .iter()
            .map(String::as_str)
            .collect::<std::collections::HashSet<_>>();
        Ok(vrcx_0_persistence::favorites::favorite_list(
            self.db.as_ref(),
            Some(owner),
            vrcx_0_core::FavoriteEntityKind::Friend,
        )?
        .into_iter()
        .filter_map(|row| {
            let user_id = row.user_id.unwrap_or_default();
            (!row.group_name.is_empty() && user_ids.contains(user_id.as_str()))
                .then_some(row.group_name)
        })
        .collect())
    }

    fn player_moderation(
        &self,
        owner: &OwnerId,
        user_id: &str,
    ) -> vrcx_0_application_core::Result<PlayerModeration> {
        Ok(local_moderation::local_moderation_get(
            self.db.as_ref(),
            owner.clone(),
            user_id.to_string(),
        )?
        .map(|row| PlayerModeration {
            blocked: row.block,
            muted: row.mute,
        })
        .unwrap_or_default())
    }
}
