use vrcx_0_contracts::memos::{
    AvatarMemoOutput, MemoSaveResult, UserMemoOutput, UserNoteOutput, WorldMemoOutput,
};
use vrcx_0_core::OwnerId;

use super::LocalDataStore;
use crate::Result;

impl LocalDataStore {
    pub fn memo_get_avatar(&self, avatar_id: String) -> Result<Option<AvatarMemoOutput>> {
        Ok(vrcx_0_persistence::memos::memo_get_avatar(
            self.db.as_ref(),
            avatar_id,
        )?)
    }

    pub fn memo_get_user(&self, user_id: String) -> Result<Option<UserMemoOutput>> {
        Ok(vrcx_0_persistence::memos::memo_get_user(
            self.db.as_ref(),
            user_id,
        )?)
    }

    pub fn memo_get_world(&self, world_id: String) -> Result<Option<WorldMemoOutput>> {
        Ok(vrcx_0_persistence::memos::memo_get_world(
            self.db.as_ref(),
            world_id,
        )?)
    }

    pub fn memo_list_user_notes(&self, owner_user_id: OwnerId) -> Result<Vec<UserNoteOutput>> {
        Ok(vrcx_0_persistence::memos::memo_list_user_notes(
            self.db.as_ref(),
            owner_user_id,
        )?)
    }

    pub fn memo_list_users(&self) -> Result<Vec<UserMemoOutput>> {
        Ok(vrcx_0_persistence::memos::memo_list_users(
            self.db.as_ref(),
        )?)
    }

    pub fn memo_save_avatar(&self, avatar_id: String, memo: String) -> Result<MemoSaveResult> {
        Ok(vrcx_0_persistence::memos::memo_save_avatar(
            self.db.as_ref(),
            avatar_id,
            memo,
        )?)
    }

    pub fn memo_save_user(&self, user_id: String, memo: String) -> Result<MemoSaveResult> {
        Ok(vrcx_0_persistence::memos::memo_save_user(
            self.db.as_ref(),
            user_id,
            memo,
        )?)
    }

    pub fn memo_save_world(&self, world_id: String, memo: String) -> Result<MemoSaveResult> {
        Ok(vrcx_0_persistence::memos::memo_save_world(
            self.db.as_ref(),
            world_id,
            memo,
        )?)
    }
}
