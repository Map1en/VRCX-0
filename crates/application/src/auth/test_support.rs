use std::sync::Mutex;

use vrcx_0_application_core::Result;

use super::AuthSessionCookies;

#[derive(Default)]
pub(super) struct MemoryAuthSessionCookies {
    value: Mutex<String>,
}

impl MemoryAuthSessionCookies {
    pub(super) fn get_cookies(&self) -> String {
        self.get()
    }

    pub(super) fn set_cookies(&self, cookies: &str) -> Result<()> {
        self.set(cookies)
    }
}

impl AuthSessionCookies for MemoryAuthSessionCookies {
    fn get(&self) -> String {
        self.value
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clone()
    }

    fn set(&self, cookies: &str) -> Result<()> {
        *self.value.lock().unwrap_or_else(|error| error.into_inner()) = cookies.to_string();
        Ok(())
    }

    fn clear(&self) {
        self.value
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clear();
    }

    fn clear_everywhere(&self) {
        self.clear();
    }

    fn clear_auth(&self) {
        self.clear();
    }

    fn save(&self) {}
}
