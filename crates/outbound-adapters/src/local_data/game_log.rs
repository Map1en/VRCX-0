use std::collections::HashMap;

use serde_json::Value;
use vrcx_0_contracts::game_log::{
    GameLogEntryDeleteKind, GameLogPreviousInstanceGroupOutput, GameLogPreviousInstanceWorldOutput,
    GameLogWriteKind,
};
use vrcx_0_contracts::game_log_query::{GameLogQuery, GameLogQueryOutput};
use vrcx_0_contracts::player_list::InstanceActivityRowOutput;
use vrcx_0_contracts::WorldSummaryOutput;
use vrcx_0_core::OwnerId;

use super::LocalDataStore;
use crate::Result;

impl LocalDataStore {
    pub fn game_log_entries_add(
        &self,
        owner: &OwnerId,
        kind: GameLogWriteKind,
        entries: Vec<Value>,
    ) -> Result<u64> {
        Ok(vrcx_0_persistence::game_log::game_log_entries_add(
            self.db.as_ref(),
            owner,
            kind,
            entries,
        )?)
    }

    pub fn game_log_entry_delete(
        &self,
        owner: &OwnerId,
        kind: GameLogEntryDeleteKind,
        entry: Value,
    ) -> Result<i64> {
        Ok(vrcx_0_persistence::game_log::game_log_entry_delete(
            self.db.as_ref(),
            owner,
            kind,
            entry,
        )?)
    }

    pub fn game_log_instance_delete(
        &self,
        owner: &OwnerId,
        location: String,
        event_ids: Vec<i64>,
    ) -> Result<i64> {
        Ok(vrcx_0_persistence::game_log::game_log_instance_delete(
            self.db.as_ref(),
            owner,
            location,
            event_ids,
        )?)
    }

    pub fn game_log_instance_delete_by_location(
        &self,
        owner: &OwnerId,
        location: String,
    ) -> Result<i64> {
        Ok(
            vrcx_0_persistence::game_log::game_log_instance_delete_by_location(
                self.db.as_ref(),
                owner,
                location,
            )?,
        )
    }

    pub fn game_log_query(
        &self,
        owner: &OwnerId,
        query: GameLogQuery,
    ) -> Result<GameLogQueryOutput> {
        Ok(vrcx_0_persistence::game_log::game_log_query(
            self.db.as_ref(),
            owner,
            query,
        )?)
    }

    pub fn previous_instances_by_group_id(
        &self,
        owner: &OwnerId,
        group_id: String,
    ) -> Result<Vec<GameLogPreviousInstanceGroupOutput>> {
        Ok(
            vrcx_0_persistence::game_log::get_previous_instances_by_group_id(
                self.db.as_ref(),
                owner,
                &group_id,
            )?,
        )
    }

    pub fn previous_instances_by_world_id(
        &self,
        owner: &OwnerId,
        world_id: String,
    ) -> Result<Vec<GameLogPreviousInstanceWorldOutput>> {
        Ok(
            vrcx_0_persistence::game_log::get_previous_instances_by_world_id(
                self.db.as_ref(),
                owner,
                &world_id,
            )?,
        )
    }

    pub fn instance_activity_dates_get(
        &self,
        owner: &OwnerId,
        user_id: String,
    ) -> Result<Vec<String>> {
        Ok(
            vrcx_0_persistence::player_list::instance_activity_dates_get(
                self.db.as_ref(),
                owner,
                user_id,
            )?,
        )
    }

    pub fn instance_activity_rows_get(
        &self,
        owner: &OwnerId,
        start_date: String,
        end_date: String,
    ) -> Result<Vec<InstanceActivityRowOutput>> {
        Ok(vrcx_0_persistence::player_list::instance_activity_rows_get(
            self.db.as_ref(),
            owner,
            start_date,
            end_date,
        )?)
    }

    pub fn world_summaries_get(
        &self,
        owner: &OwnerId,
        world_ids: Vec<String>,
    ) -> Result<HashMap<String, WorldSummaryOutput>> {
        Ok(vrcx_0_persistence::player_list::world_summaries_get(
            self.db.as_ref(),
            owner,
            world_ids,
        )?)
    }
}
