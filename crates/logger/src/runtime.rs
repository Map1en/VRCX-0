use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

use vrcx_0_logger_protocol::wire::{DeviceLoginState, SessionState, PRESENCE_TTL_SECS};

const PRESENCE_TTL: Duration = Duration::from_secs(PRESENCE_TTL_SECS);

#[derive(Default)]
pub struct Presence {
    last: Mutex<Option<(Instant, String)>>,
}

impl Presence {
    pub fn touch(&self, account_id: String) -> bool {
        let mut last = lock(&self.last);
        let was_present = present_in(last.as_ref(), &account_id);
        *last = Some((Instant::now(), account_id));
        !was_present
    }

    pub fn leave(&self, account_id: &str) {
        let mut last = lock(&self.last);
        if last
            .as_ref()
            .is_some_and(|(_, seen_account)| seen_account == account_id)
        {
            *last = None;
        }
    }

    pub fn is_present(&self, account_id: &str) -> bool {
        present_in(lock(&self.last).as_ref(), account_id)
    }
}

fn present_in(last: Option<&(Instant, String)>, account_id: &str) -> bool {
    last.is_some_and(|(seen_at, seen_account)| {
        seen_account == account_id && seen_at.elapsed() < PRESENCE_TTL
    })
}

#[derive(Clone, Default)]
pub struct SessionInfo {
    pub state: SessionState,
    pub account_id: Option<String>,
    pub password_saved: bool,
    pub last_login_at: Option<i64>,
    pub last_error: Option<String>,
    pub storage_error: Option<String>,
    pub relogin_attempts: u32,
    pub connected_since: Option<i64>,
    pub last_snapshot_at: Option<i64>,
    pub device_login: Option<DeviceLoginState>,
}

#[derive(Default)]
pub struct Shared {
    info: Mutex<SessionInfo>,
}

impl Shared {
    pub fn snapshot(&self) -> SessionInfo {
        lock(&self.info).clone()
    }

    pub fn update<R>(&self, change: impl FnOnce(&mut SessionInfo) -> R) -> R {
        change(&mut lock(&self.info))
    }
}

pub fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}
