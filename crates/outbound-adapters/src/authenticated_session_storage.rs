use std::sync::Arc;

use vrcx_0_application::auth::AuthenticatedSessionStorage;
use vrcx_0_application_core::Result;
use vrcx_0_persistence::{maintenance::user_tables_ensure, DatabaseService};

pub struct LocalAuthenticatedSessionStorage {
    db: Arc<DatabaseService>,
}

impl LocalAuthenticatedSessionStorage {
    pub fn new(db: Arc<DatabaseService>) -> Self {
        Self { db }
    }
}

impl AuthenticatedSessionStorage for LocalAuthenticatedSessionStorage {
    fn ensure_user_scope(&self, user_id: &str) -> Result<()> {
        user_tables_ensure(self.db.as_ref(), user_id.to_string())
            .map(|_| ())
            .map_err(crate::Error::from)
    }
}
