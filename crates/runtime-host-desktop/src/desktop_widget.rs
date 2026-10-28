use std::sync::Arc;

use serde::Serialize;
use vrcx_0_application_core::RuntimeEventPayload;

use crate::DesktopRuntimeServices;

#[cfg(windows)]
#[path = "desktop_widget/supported.rs"]
mod imp;
#[cfg(not(windows))]
#[path = "desktop_widget/unsupported.rs"]
mod imp;

pub(crate) use imp::is_desktop_widget_config_key;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DesktopWidgetSnapshot {
    pub supported: bool,
    pub enabled: bool,
    pub pinned: bool,
    pub click_through: bool,
}

impl RuntimeEventPayload for DesktopWidgetSnapshot {
    const EVENT_NAME: &'static str = "desktopWidgetState";
}

pub struct DesktopWidget {
    imp: imp::Widget,
}

impl DesktopWidget {
    pub fn new(services: &Arc<DesktopRuntimeServices>) -> Self {
        Self {
            imp: imp::Widget::new(services),
        }
    }

    pub fn snapshot(&self) -> DesktopWidgetSnapshot {
        self.imp.snapshot()
    }

    pub fn set_enabled(
        &self,
        enabled: bool,
    ) -> vrcx_0_application_core::Result<DesktopWidgetSnapshot> {
        self.imp.set_enabled(enabled)
    }

    pub fn toggle_pinned(&self) -> vrcx_0_application_core::Result<DesktopWidgetSnapshot> {
        self.imp.toggle_pinned()
    }

    pub fn toggle_click_through(&self) -> vrcx_0_application_core::Result<DesktopWidgetSnapshot> {
        self.imp.toggle_click_through()
    }

    pub fn bring_to_front(&self) {
        self.imp.bring_to_front();
    }

    pub fn reload_settings(&self) {
        self.imp.reload_settings();
    }

    pub fn shutdown(&self) {
        self.imp.shutdown();
    }
}

#[cfg(all(test, windows))]
mod tests;
