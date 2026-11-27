use std::sync::{atomic::Ordering, Arc};

use crate::vr_overlay::VrOverlayRuntimeSnapshot;
use serde_json::Value;
use vrcx_0_composition::Result;

use super::DesktopRuntimeHostState;

impl DesktopRuntimeHostState {
    pub fn is_game_running(&self) -> bool {
        self.game.process_monitor.is_game_running()
    }

    pub fn current_player_list_snapshot(
        &self,
        requested_location: &str,
    ) -> vrcx_0_application_game::PlayerListSnapshotOutput {
        let snapshot =
            if self.is_game_running() && !self.desktop.services.game_isolation().is_enabled() {
                self.desktop.services.game_log_snapshot()
            } else {
                Arc::new(vrcx_0_application_game::RuntimeSnapshot::default())
            };
        vrcx_0_application_game::player_list_runtime_snapshot(&snapshot, requested_location)
    }

    pub fn current_log_location_snapshot(
        &self,
    ) -> Option<vrcx_0_application_game::LogLocationSnapshot> {
        if self.desktop.services.game_isolation().is_enabled() {
            return None;
        }
        self.game.log_watcher.current_location_snapshot()
    }

    pub fn now_playing_snapshot(&self) -> vrcx_0_application_game::NowPlayingSnapshot {
        if self.desktop.services.game_isolation().is_enabled() {
            return vrcx_0_application_game::NowPlayingSnapshot::default();
        }
        self.desktop.services.now_playing().as_ref().clone()
    }

    pub fn set_game_log_persistence_disabled(&self, disabled: bool) -> Result<()> {
        self.game
            .game_log_runtime
            .set_persistence_disabled(&self.game.log_watcher, disabled)
    }

    pub(crate) fn game_client_debug_logging_status(
        &self,
    ) -> Option<vrcx_0_application_game::DebugLoggingOutcome> {
        self.game.game_client_runtime.debug_logging_outcome()
    }

    pub fn add_game_log_entries(
        &self,
        kind: vrcx_0_contracts::game_log::GameLogWriteKind,
        entries: Vec<Value>,
    ) -> Result<()> {
        let affected_count = self.local_data.game_log_entries_add(kind, entries)?;
        self.runtime.publish_game_log_persisted(affected_count);
        Ok(())
    }

    pub fn start_game_from_path(&self, path: String, launch_arguments: String) -> Result<bool> {
        let path = crate::ensure_vrchat_launch_path_allowed(
            &self.desktop.host_file_access,
            self.runtime.paths(),
            &path,
        )?;
        vrcx_0_host_desktop::game_launch::start_game_from_path(&path, &launch_arguments)
            .map_err(|error| vrcx_0_application_core::Error::Custom(error.to_string()).into())
    }

    pub fn request_discord_reconcile(&self) -> u64 {
        self.extension
            .discord_reconcile_generation
            .fetch_add(1, Ordering::AcqRel)
            .saturating_add(1)
    }

    pub fn set_vr_overlay_enabled(&self, enabled: bool) -> Result<VrOverlayRuntimeSnapshot> {
        self.desktop.vr_overlay_runtime.set_enabled(enabled)
    }

    pub fn set_vr_overlay_test_mode(&self, test_mode: bool) -> Result<VrOverlayRuntimeSnapshot> {
        self.desktop.vr_overlay_runtime.set_test_mode(test_mode)
    }

    pub fn game_isolation_snapshot(&self) -> crate::GameIsolationSnapshot {
        self.desktop.services.game_isolation().snapshot()
    }

    pub fn set_game_isolation_enabled(
        &self,
        enabled: bool,
    ) -> vrcx_0_application_core::Result<crate::GameIsolationSnapshot> {
        self.desktop.services.game_isolation().set_enabled(enabled)
    }
}
