use serde_json::Value;
use vrcx_0_contracts::notifications::{NotificationListItemOutput, NotificationListQueryInput};

use super::LocalDataStore;
use crate::Result;

impl LocalDataStore {
    pub fn notification_add_v1(&self, user_id: String, notification: Value) -> Result<()> {
        Ok(vrcx_0_persistence::notifications::notification_add_v1(
            self.db.as_ref(),
            user_id,
            notification,
        )?)
    }

    pub fn notification_delete(&self, user_id: String, id: String) -> Result<()> {
        Ok(vrcx_0_persistence::notifications::notification_delete(
            self.db.as_ref(),
            user_id,
            id,
        )?)
    }

    pub fn notification_expire(&self, user_id: String, id: String) -> Result<()> {
        Ok(vrcx_0_persistence::notifications::notification_expire(
            self.db.as_ref(),
            user_id,
            id,
        )?)
    }

    pub fn notification_list_query(
        &self,
        query: NotificationListQueryInput,
    ) -> Result<Vec<NotificationListItemOutput>> {
        Ok(vrcx_0_persistence::notifications::notification_list_query(
            self.db.as_ref(),
            query,
        )?)
    }

    pub fn notification_update_expired(
        &self,
        user_id: String,
        id: String,
        expired: bool,
    ) -> Result<()> {
        Ok(
            vrcx_0_persistence::notifications::notification_update_expired(
                self.db.as_ref(),
                user_id,
                id,
                expired,
            )?,
        )
    }

    pub fn notification_v2_expire(&self, user_id: String, id: String) -> Result<()> {
        Ok(vrcx_0_persistence::notifications::notification_v2_expire(
            self.db.as_ref(),
            user_id,
            id,
        )?)
    }

    pub fn notification_v2_mark_seen(&self, user_id: String, id: String) -> Result<()> {
        Ok(
            vrcx_0_persistence::notifications::notification_v2_mark_seen(
                self.db.as_ref(),
                user_id,
                id,
            )?,
        )
    }
}
