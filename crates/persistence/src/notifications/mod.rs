mod query;
mod schema;
mod types;
mod write;

pub use query::{notification_list_query, notification_rows_query};
pub use types::{
    NotificationListItemOutput, NotificationListQueryInput, NotificationRowsOutput,
    NotificationRowsQueryInput, NotificationV1RowOutput, NotificationV2RowOutput,
};
pub use write::{
    notification_add_v1, notification_add_v2, notification_delete, notification_expire,
    notification_friend_requests_sync, notification_mark_seen_local_bulk,
    notification_update_expired, notification_v2_expire, notification_v2_mark_seen,
};

#[cfg(test)]
mod query_integration_tests;
