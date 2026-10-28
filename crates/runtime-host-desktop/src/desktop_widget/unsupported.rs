use std::sync::Arc;

use super::DesktopWidgetSnapshot;
use crate::DesktopRuntimeServices;

pub(super) struct Widget;

impl Widget {
    pub(super) fn new(_services: &Arc<DesktopRuntimeServices>) -> Self {
        Self
    }

    pub(super) fn snapshot(&self) -> DesktopWidgetSnapshot {
        DesktopWidgetSnapshot::default()
    }

    pub(super) fn set_enabled(
        &self,
        _enabled: bool,
    ) -> vrcx_0_application_core::Result<DesktopWidgetSnapshot> {
        Ok(self.snapshot())
    }

    pub(super) fn toggle_pinned(&self) -> vrcx_0_application_core::Result<DesktopWidgetSnapshot> {
        Ok(self.snapshot())
    }

    pub(super) fn toggle_click_through(
        &self,
    ) -> vrcx_0_application_core::Result<DesktopWidgetSnapshot> {
        Ok(self.snapshot())
    }

    pub(super) fn bring_to_front(&self) {}

    pub(super) fn reload_settings(&self) {}

    pub(super) fn shutdown(&self) {}
}

pub(crate) fn is_desktop_widget_config_key(_key: &str) -> bool {
    false
}
