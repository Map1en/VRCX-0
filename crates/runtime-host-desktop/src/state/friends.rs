use vrcx_0_application_core::RuntimeOperationStatus;

use serde_json::Value;
use vrcx_0_application_core::{FriendProfileLoadStatusPayload, VrcStatusSnapshot};
use vrcx_0_composition::Result;

use super::{CurrentUserRefreshOutcome, DesktopRuntimeHostState};

impl DesktopRuntimeHostState {
    pub async fn refresh_social_baseline(
        &self,
    ) -> Result<vrcx_0_application::social::SocialBaselineRefreshOutput> {
        let command = "app__social_baseline_refresh";
        self.runtime
            .desktop_assembly()
            .diagnostics()
            .record_command(
                command,
                RuntimeOperationStatus::Running,
                "Social baseline refresh started.",
            );
        let result = self.runtime.refresh_social_baseline_now().await;
        self.social.record_baseline_refresh(&result);
        Ok(result?)
    }

    pub async fn refresh_current_user(&self) -> Result<CurrentUserRefreshOutcome> {
        let applied = self
            .runtime
            .realtime_runtime()
            .refresh_current_user_now(Value::Null)
            .await?;
        Ok(CurrentUserRefreshOutcome { applied })
    }

    pub fn ingest_user_facts(&self, entries: Vec<Value>) {
        self.runtime.realtime_runtime().ingest_user_facts(entries);
    }

    pub fn start_friend_profile_bulk_load(&self) -> Result<FriendProfileLoadStatusPayload> {
        Ok(self
            .runtime
            .realtime_runtime()
            .start_friend_profile_bulk_load()?)
    }

    pub fn cancel_friend_profile_bulk_load(&self) -> Result<FriendProfileLoadStatusPayload> {
        Ok(self
            .runtime
            .realtime_runtime()
            .cancel_friend_profile_bulk_load()?)
    }

    pub fn friend_snapshot(&self) -> Option<vrcx_0_application_realtime::RealtimeFriendSnapshot> {
        self.runtime.realtime_runtime().friend_snapshot()
    }

    pub fn vrc_status_snapshot(&self) -> VrcStatusSnapshot {
        self.runtime.desktop_assembly().vrc_status().snapshot()
    }

    pub async fn refresh_vrc_status(&self) -> Result<VrcStatusSnapshot> {
        Ok(self
            .runtime
            .desktop_assembly()
            .vrc_status()
            .refresh()
            .await?)
    }
}
