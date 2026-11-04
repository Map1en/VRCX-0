mod activity;
mod avatars;
mod browse_history;
mod game_log;
mod maintenance;
mod memos;
mod notifications;
mod social;

use std::sync::Arc;

use vrcx_0_persistence::DatabaseService;

#[derive(Clone)]
pub struct LocalDataStore {
    db: Arc<DatabaseService>,
}

impl LocalDataStore {
    pub fn new(db: Arc<DatabaseService>) -> Self {
        Self { db }
    }
}
