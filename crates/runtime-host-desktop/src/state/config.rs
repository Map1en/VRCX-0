use crate::desktop_widget::is_desktop_widget_config_key;
use vrcx_0_composition::Result;

use super::DesktopRuntimeHostState;

impl DesktopRuntimeHostState {
    pub fn proxy_url(&self) -> Option<&str> {
        self.runtime.web_client().proxy_url()
    }

    pub fn try_config_bool(&self, key: &str, fallback: bool) -> Option<bool> {
        self.runtime
            .desktop_assembly()
            .config_store()
            .get_bool(key, fallback)
            .ok()
    }

    pub fn config_string(&self, key: &str, fallback: &str) -> String {
        self.runtime
            .desktop_assembly()
            .config_store()
            .get_string(key, fallback)
            .unwrap_or_else(|_| fallback.to_string())
    }

    pub fn storage_get(&self, key: &str) -> Option<String> {
        self.runtime.storage().get(key)
    }

    pub fn storage_set(&self, key: String, value: String) {
        self.runtime.storage().set(key, value);
    }

    pub fn storage_flush(&self) -> Result<()> {
        Ok(self.runtime.storage().save()?)
    }

    pub fn storage_remove(&self, key: &str) -> Option<String> {
        self.runtime.storage().remove(key)
    }

    pub fn storage_snapshot(&self) -> std::collections::HashMap<String, String> {
        self.runtime.storage().get_all()
    }

    pub fn config_bool(&self, key: &str, fallback: bool) -> bool {
        self.runtime
            .desktop_assembly()
            .config_store()
            .get_bool(key, fallback)
            .unwrap_or(fallback)
    }

    pub fn config_set_values(
        &self,
        entries: Vec<vrcx_0_contracts::ConfigWriteEntry>,
    ) -> Result<()> {
        let touches_desktop_widget = entries
            .iter()
            .any(|entry| is_desktop_widget_config_key(&entry.key));
        self.local_data.config_set_values(entries)?;
        self.desktop.services.reload_overlay_activity_filters();
        self.desktop.vr_overlay_runtime.mark_config_dirty();
        if touches_desktop_widget {
            self.desktop.desktop_widget.reload_settings();
        }
        Ok(())
    }

    pub fn config_remove_value(&self, key: String) -> Result<i64> {
        let touches_desktop_widget = is_desktop_widget_config_key(&key);
        let removed = self.local_data.config_remove_value(key)?;
        self.desktop.services.reload_overlay_activity_filters();
        self.desktop.vr_overlay_runtime.mark_config_dirty();
        if touches_desktop_widget {
            self.desktop.desktop_widget.reload_settings();
        }
        Ok(removed)
    }
}
