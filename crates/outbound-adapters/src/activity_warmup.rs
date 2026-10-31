use std::sync::Arc;

use chrono::{Local, Utc};
use vrcx_0_application_activity::{
    ActivityPageWarmupStore, ActivitySessionWarmupOutput, ActivitySessionWarmupStore,
};
use vrcx_0_application_core::Result;
use vrcx_0_core::OwnerId;
use vrcx_0_persistence::DatabaseService;

pub struct LocalActivitySessionWarmupStore {
    db: Arc<DatabaseService>,
}

impl LocalActivitySessionWarmupStore {
    pub fn new(db: Arc<DatabaseService>) -> Self {
        Self { db }
    }
}

fn local_utc_offset_minutes() -> i64 {
    i64::from(Local::now().offset().local_minus_utc()) / 60
}

pub struct LocalActivityPageWarmupStore {
    db: Arc<DatabaseService>,
}

impl LocalActivityPageWarmupStore {
    pub fn new(db: Arc<DatabaseService>) -> Self {
        Self { db }
    }
}

impl ActivityPageWarmupStore for LocalActivityPageWarmupStore {
    fn warm_activity_page(&self, owner_user_id: OwnerId, range_days: i64) -> Result<()> {
        vrcx_0_application_activity::activity_page::activity_page_view_build(
            &crate::LocalActivityPageStore::new(self.db.as_ref()),
            vrcx_0_application_activity::activity_page::ActivityPageBuildInput {
                owner_user_id,
                range_days,
                utc_offset_minutes: local_utc_offset_minutes(),
                now_ms: Utc::now().timestamp_millis(),
                window_to_ms: None,
                companion_order: Default::default(),
                force_refresh: false,
            },
        )?;
        Ok(())
    }
}

impl ActivitySessionWarmupStore for LocalActivitySessionWarmupStore {
    fn warm_self_sessions(
        &self,
        owner_user_id: OwnerId,
        range_days: i64,
    ) -> Result<ActivitySessionWarmupOutput> {
        let output = vrcx_0_persistence::activity::activity_self_sessions_warmup(
            self.db.as_ref(),
            owner_user_id,
            range_days,
            None,
        )?;
        Ok(ActivitySessionWarmupOutput {
            cached_range_days: output.sync.cached_range_days,
            source_count: output.source_count,
            session_count: output.sessions.len(),
        })
    }
}
