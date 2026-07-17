use chrono::Utc;
use serde::Serialize;
use vrcx_0_persistence::{
    maintenance::{avatar_auto_cleanup_run, AvatarAutoCleanupOutcome},
    DatabaseService,
};

use crate::{Error, Result};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AuthenticatedSessionMaintenanceOutcome {
    pub user_id: String,
    pub avatar_cleanup: AvatarAutoCleanupOutcome,
}

pub fn run_authenticated_session_maintenance(
    db: &DatabaseService,
    user_id: &str,
) -> Result<AuthenticatedSessionMaintenanceOutcome> {
    let user_id = user_id.trim();
    if user_id.is_empty() {
        return Err(Error::Custom(
            "Authenticated session maintenance requires a user id.".into(),
        ));
    }
    Ok(AuthenticatedSessionMaintenanceOutcome {
        user_id: user_id.to_string(),
        avatar_cleanup: avatar_auto_cleanup_run(db, user_id, Utc::now())?,
    })
}
