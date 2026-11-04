use serde_json::Value;
use vrcx_0_contracts::{
    AvatarCacheOutput, AvatarTagInput, AvatarTagOutput, AvatarTagsPatchInput,
    AvatarTimeSpentOutput, AvatarUsageRow, AvatarWearSegment,
};

use super::LocalDataStore;
use crate::Result;

impl LocalDataStore {
    pub fn avatar_history_clear(&self, user_id: String) -> Result<()> {
        Ok(vrcx_0_persistence::avatars::avatar_history_clear(
            self.db.as_ref(),
            user_id,
        )?)
    }

    pub fn avatar_history_list(
        &self,
        user_id: String,
        limit: i64,
    ) -> Result<Vec<AvatarCacheOutput>> {
        Ok(vrcx_0_persistence::avatars::avatar_history_list(
            self.db.as_ref(),
            user_id,
            limit,
        )?)
    }

    pub fn avatar_usage_ranking(&self, user_id: String, limit: i64) -> Result<Vec<AvatarUsageRow>> {
        Ok(vrcx_0_persistence::avatars::avatar_usage_ranking(
            self.db.as_ref(),
            user_id,
            limit,
        )?)
    }

    pub fn avatar_wear_segments(
        &self,
        user_id: String,
        from_ms: i64,
        to_ms: i64,
    ) -> Result<Vec<AvatarWearSegment>> {
        Ok(vrcx_0_persistence::avatars::avatar_wear_segments(
            self.db.as_ref(),
            user_id,
            from_ms,
            to_ms,
        )?)
    }

    pub fn avatar_tag_add(&self, avatar_id: String, tag: Value, color: Value) -> Result<i64> {
        Ok(vrcx_0_persistence::avatars::avatar_tag_add(
            self.db.as_ref(),
            avatar_id,
            tag,
            color,
        )?)
    }

    pub fn avatar_tag_remove(&self, avatar_id: String, tag: Value) -> Result<i64> {
        Ok(vrcx_0_persistence::avatars::avatar_tag_remove(
            self.db.as_ref(),
            avatar_id,
            tag,
        )?)
    }

    pub fn avatar_tag_update_color(
        &self,
        avatar_id: String,
        tag: Value,
        color: Value,
    ) -> Result<i64> {
        Ok(vrcx_0_persistence::avatars::avatar_tag_update_color(
            self.db.as_ref(),
            avatar_id,
            tag,
            color,
        )?)
    }

    pub fn avatar_tags_distinct(&self) -> Result<Vec<String>> {
        Ok(vrcx_0_persistence::avatars::avatar_tags_distinct(
            self.db.as_ref(),
        )?)
    }

    pub fn avatar_tags_get(&self, avatar_id: String) -> Result<Vec<AvatarTagOutput>> {
        Ok(vrcx_0_persistence::avatars::avatar_tags_get(
            self.db.as_ref(),
            avatar_id,
        )?)
    }

    pub fn avatar_tags_list(&self) -> Result<Vec<AvatarTagOutput>> {
        Ok(vrcx_0_persistence::avatars::avatar_tags_list(
            self.db.as_ref(),
        )?)
    }

    pub fn avatar_tags_patch(&self, avatar_id: String, patch: AvatarTagsPatchInput) -> Result<()> {
        Ok(vrcx_0_persistence::avatars::avatar_tags_patch(
            self.db.as_ref(),
            avatar_id,
            patch,
        )?)
    }

    pub fn avatar_tags_remove_all(&self, avatar_id: String) -> Result<i64> {
        Ok(vrcx_0_persistence::avatars::avatar_tags_remove_all(
            self.db.as_ref(),
            avatar_id,
        )?)
    }

    pub fn avatar_tags_replace(
        &self,
        avatar_id: String,
        entries: Vec<AvatarTagInput>,
    ) -> Result<()> {
        Ok(vrcx_0_persistence::avatars::avatar_tags_replace(
            self.db.as_ref(),
            avatar_id,
            entries,
        )?)
    }

    pub fn avatar_time_spent_get(
        &self,
        user_id: String,
        avatar_id: String,
    ) -> Result<AvatarTimeSpentOutput> {
        Ok(vrcx_0_persistence::avatars::avatar_time_spent_get(
            self.db.as_ref(),
            user_id,
            avatar_id,
        )?)
    }

    pub fn avatar_time_spent_list(&self, user_id: String) -> Result<Vec<AvatarTimeSpentOutput>> {
        Ok(vrcx_0_persistence::avatars::avatar_time_spent_list(
            self.db.as_ref(),
            user_id,
        )?)
    }
}
