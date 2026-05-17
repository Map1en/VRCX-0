use vrcx_0_host::proxy::{normalize_proxy_url, PROXY_STORAGE_KEY};
use vrcx_0_store::storage::StorageService;

pub fn load_proxy_url(storage: &StorageService) -> Option<String> {
    let raw_proxy_url = storage.get(PROXY_STORAGE_KEY)?;
    match normalize_proxy_url(&raw_proxy_url) {
        Ok(proxy_url) => proxy_url,
        Err(error) => {
            tracing::warn!(
                error = %error,
                "invalid proxy setting; clearing VRCX_ProxyServer"
            );
            storage.remove(PROXY_STORAGE_KEY);
            if let Err(error) = storage.save() {
                tracing::error!(?error, "failed to persist cleared proxy setting");
            }
            None
        }
    }
}
