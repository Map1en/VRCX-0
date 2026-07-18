use vrcx_0_host_desktop::host_capabilities::{is_host_capability_available, HostCapability};
use vrcx_0_runtime_host::GroupOrderSource;

pub struct HostGroupOrderSource;

impl GroupOrderSource for HostGroupOrderSource {
    fn read_group_order(&self, user_id: &str) -> Vec<String> {
        if !is_host_capability_available(HostCapability::RegistryPrefs) {
            return Vec::new();
        }
        let key = format!("VRC_GROUP_ORDER_{}", user_id.trim());
        let Ok(raw) = vrcx_0_host_desktop::vrchat_registry::get_registry_key_string(&key) else {
            return Vec::new();
        };
        serde_json::from_str(&raw).unwrap_or_default()
    }
}
