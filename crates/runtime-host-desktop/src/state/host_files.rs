use vrcx_0_composition::Result;

use super::DesktopRuntimeHostState;

impl DesktopRuntimeHostState {
    pub fn register_host_file_access(&self, path: impl AsRef<std::path::Path>) {
        self.desktop.host_file_access.register_path(path);
    }

    pub fn ensure_host_read_allowed(&self, path: impl AsRef<std::path::Path>) -> Result<()> {
        self.desktop
            .host_file_access
            .ensure_read_allowed(path, self.runtime.paths())
    }

    pub fn is_known_runtime_root_path(&self, path: impl AsRef<std::path::Path>) -> bool {
        crate::is_known_root_path(path, self.runtime.paths())
    }

    pub fn is_screenshot_thumbnail_path(&self, path: impl AsRef<std::path::Path>) -> bool {
        vrcx_0_platform::path_utils::is_path_inside_directory(
            path.as_ref(),
            &self.runtime.paths().screenshot_thumbs,
        )
    }

    pub fn app_data_path(&self) -> &std::path::Path {
        &self.runtime.paths().app_data
    }

    pub fn start_screenshot_library_scan(
        &self,
        force: bool,
    ) -> vrcx_0_core::screenshots::ScreenshotLibraryScanStatus {
        vrcx_0_outbound_adapters::screenshots::start_screenshot_library_scan(
            &self.game.screenshot_cache,
            self.screenshots.screenshot_favorites().clone(),
            self.runtime.paths().screenshot_thumbs.clone(),
            self.runtime.desktop_assembly().event_bus().clone(),
            self.runtime.desktop_assembly().tasks().clone(),
            force,
            vrcx_0_host_desktop::vrchat_paths::vrchat_photos_location(),
        )
    }

    pub fn append_error_log(&self, entry: &str) {
        vrcx_0_platform::error_log::append_error_log_entry(&self.runtime.paths().app_data, entry);
    }
}
