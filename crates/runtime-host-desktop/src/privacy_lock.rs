use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use serde::Serialize;
use vrcx_0_application::auth::{
    verify_saved_account_password, AuthCredentialStore, PrivacyLockPasswordCheck, PrivacyLockStore,
};
use vrcx_0_application_activity::OverlayActivitySurface;
use vrcx_0_application_core::{
    Result, RuntimeAuthScopeObserver, RuntimeAuthScopeSnapshot, RuntimeEventBus,
    RuntimeEventPayload,
};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PrivacyLockSnapshot {
    pub revision: u64,
    pub user_id: String,
    pub locked: bool,
    pub has_password: bool,
}

impl RuntimeEventPayload for PrivacyLockSnapshot {
    const EVENT_NAME: &'static str = "privacyLockState";
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum PrivacyLockOutcome {
    Ok { snapshot: PrivacyLockSnapshot },
    NoActiveSession,
    PasswordNotSet,
    PasswordAlreadySet,
    WrongPassword,
    AccountPasswordUnavailable,
}

struct PrivacyLockState {
    store: PrivacyLockStore,
    user_id: String,
    revision: u64,
}

impl PrivacyLockState {
    fn snapshot(&self) -> PrivacyLockSnapshot {
        let record = self.store.record(&self.user_id);
        PrivacyLockSnapshot {
            revision: self.revision,
            user_id: self.user_id.clone(),
            locked: record.locked,
            has_password: record.has_password,
        }
    }

    fn bump(&mut self) -> PrivacyLockSnapshot {
        self.revision = self.revision.saturating_add(1);
        self.snapshot()
    }
}

pub struct PrivacyLockRuntime {
    state: Mutex<PrivacyLockState>,
    setup_requested: AtomicBool,
    credentials: Arc<dyn AuthCredentialStore>,
    event_bus: RuntimeEventBus,
}

impl PrivacyLockRuntime {
    pub fn new(
        credentials: Arc<dyn AuthCredentialStore>,
        event_bus: RuntimeEventBus,
    ) -> Result<Self> {
        let store = PrivacyLockStore::load(credentials.as_ref())?;
        Ok(Self {
            state: Mutex::new(PrivacyLockState {
                store,
                user_id: String::new(),
                revision: 0,
            }),
            setup_requested: AtomicBool::new(false),
            credentials,
            event_bus,
        })
    }

    pub fn snapshot(&self) -> PrivacyLockSnapshot {
        self.lock_state().snapshot()
    }

    pub fn is_locked(&self) -> bool {
        self.lock_state().snapshot().locked
    }

    pub fn request_setup(&self) {
        self.setup_requested.store(true, Ordering::Release);
    }

    pub fn take_setup_request(&self) -> bool {
        self.setup_requested.swap(false, Ordering::AcqRel)
    }

    pub fn suppresses(&self, surface: OverlayActivitySurface) -> bool {
        self.is_locked()
            && matches!(
                surface,
                OverlayActivitySurface::Desktop
                    | OverlayActivitySurface::Vr
                    | OverlayActivitySurface::Hmd
                    | OverlayActivitySurface::Tts
            )
    }

    pub fn engage(&self) -> Result<PrivacyLockOutcome> {
        self.mutate(|state, credentials| {
            if !state.store.engage(credentials, &state.user_id)? {
                return Ok(Some(PrivacyLockOutcome::PasswordNotSet));
            }
            Ok(None)
        })
    }

    pub fn unlock(&self, password: &str) -> Result<PrivacyLockOutcome> {
        self.mutate(|state, credentials| {
            match state.store.unlock(credentials, &state.user_id, password)? {
                PrivacyLockPasswordCheck::Matched => Ok(None),
                PrivacyLockPasswordCheck::Mismatched => Ok(Some(PrivacyLockOutcome::WrongPassword)),
                PrivacyLockPasswordCheck::Unavailable => {
                    Ok(Some(PrivacyLockOutcome::PasswordNotSet))
                }
            }
        })
    }

    pub fn set_password(&self, password: &str) -> Result<PrivacyLockOutcome> {
        self.mutate(|state, credentials| {
            if !state
                .store
                .set_password(credentials, &state.user_id, password)?
            {
                return Ok(Some(PrivacyLockOutcome::PasswordAlreadySet));
            }
            Ok(None)
        })
    }

    pub fn change_password(&self, current: &str, next: &str) -> Result<PrivacyLockOutcome> {
        self.mutate(|state, credentials| {
            match state
                .store
                .change_password(credentials, &state.user_id, current, next)?
            {
                PrivacyLockPasswordCheck::Matched => Ok(None),
                PrivacyLockPasswordCheck::Mismatched => Ok(Some(PrivacyLockOutcome::WrongPassword)),
                PrivacyLockPasswordCheck::Unavailable => {
                    Ok(Some(PrivacyLockOutcome::PasswordNotSet))
                }
            }
        })
    }

    pub fn clear_with_account_password(
        &self,
        account_password: &str,
    ) -> Result<PrivacyLockOutcome> {
        self.mutate(|state, credentials| {
            match verify_saved_account_password(credentials, &state.user_id, account_password)? {
                PrivacyLockPasswordCheck::Matched => {
                    state.store.clear(credentials, &state.user_id)?;
                    Ok(None)
                }
                PrivacyLockPasswordCheck::Mismatched => Ok(Some(PrivacyLockOutcome::WrongPassword)),
                PrivacyLockPasswordCheck::Unavailable => {
                    Ok(Some(PrivacyLockOutcome::AccountPasswordUnavailable))
                }
            }
        })
    }

    fn mutate(
        &self,
        apply: impl FnOnce(
            &mut PrivacyLockState,
            &dyn AuthCredentialStore,
        ) -> Result<Option<PrivacyLockOutcome>>,
    ) -> Result<PrivacyLockOutcome> {
        let snapshot = {
            let mut state = self.lock_state();
            if state.user_id.is_empty() {
                return Ok(PrivacyLockOutcome::NoActiveSession);
            }
            if let Some(outcome) = apply(&mut state, self.credentials.as_ref())? {
                return Ok(outcome);
            }
            state.bump()
        };
        self.event_bus.emit(snapshot.clone());
        Ok(PrivacyLockOutcome::Ok { snapshot })
    }

    fn lock_state(&self) -> MutexGuard<'_, PrivacyLockState> {
        self.state.lock().unwrap_or_else(|error| error.into_inner())
    }
}

impl RuntimeAuthScopeObserver for PrivacyLockRuntime {
    fn runtime_auth_scope_changed(&self, scope: &RuntimeAuthScopeSnapshot) {
        let snapshot = {
            let mut state = self.lock_state();
            let user_id = if scope.active {
                scope.current_user_id.clone()
            } else {
                String::new()
            };
            if state.user_id == user_id {
                return;
            }
            state.user_id = user_id;
            state.bump()
        };
        self.event_bus.emit(snapshot);
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use vrcx_0_application::auth::{AuthCredentialStore, SealedAuthSecret};
    use vrcx_0_application_core::{Result, RuntimeAuthScope, RuntimeEventBus};

    use super::*;

    #[derive(Clone, Default)]
    struct MemoryCredentials {
        values: Arc<Mutex<std::collections::HashMap<String, String>>>,
    }

    impl AuthCredentialStore for MemoryCredentials {
        fn get_raw(&self, key: &str) -> Result<Option<String>> {
            Ok(self.values.lock().unwrap().get(key).cloned())
        }
        fn get_string(&self, key: &str, default_value: &str) -> Result<String> {
            Ok(self
                .get_raw(key)?
                .unwrap_or_else(|| default_value.to_string()))
        }
        fn get_bool(&self, key: &str, default_value: bool) -> Result<bool> {
            Ok(self
                .get_raw(key)?
                .and_then(|value| value.parse().ok())
                .unwrap_or(default_value))
        }
        fn set_string(&self, key: &str, value: &str) -> Result<()> {
            self.values
                .lock()
                .unwrap()
                .insert(key.to_string(), value.to_string());
            Ok(())
        }
        fn remove(&self, key: &str) -> Result<()> {
            self.values.lock().unwrap().remove(key);
            Ok(())
        }
        fn is_encrypting_writes(&self) -> bool {
            false
        }
        fn is_secret_store_initialized(&self) -> bool {
            false
        }
        fn open_secret(&self, stored: &str) -> Option<String> {
            Some(stored.to_string())
        }
        fn seal_secret(&self, plaintext: &str) -> SealedAuthSecret {
            SealedAuthSecret {
                stored: plaintext.to_string(),
                encrypted: false,
            }
        }
        fn is_sealed_secret(&self, _value: &str) -> bool {
            false
        }
    }

    fn runtime_with_scope() -> (Arc<PrivacyLockRuntime>, RuntimeAuthScope) {
        let credentials: Arc<dyn AuthCredentialStore> = Arc::new(MemoryCredentials::default());
        let runtime = Arc::new(
            PrivacyLockRuntime::new(credentials, RuntimeEventBus::new()).expect("runtime"),
        );
        let scope = RuntimeAuthScope::new();
        scope.add_observer(runtime.clone());
        (runtime, scope)
    }

    #[test]
    fn mutations_require_an_active_session() -> Result<()> {
        let (runtime, _scope) = runtime_with_scope();
        assert_eq!(
            runtime.set_password("1234")?,
            PrivacyLockOutcome::NoActiveSession
        );
        assert_eq!(runtime.engage()?, PrivacyLockOutcome::NoActiveSession);
        Ok(())
    }

    #[test]
    fn lock_follows_the_signed_in_user_and_survives_scope_changes() -> Result<()> {
        let (runtime, scope) = runtime_with_scope();
        scope.set("usr_1", "https://api.example.test/api/1");
        assert_eq!(runtime.engage()?, PrivacyLockOutcome::PasswordNotSet);
        assert!(matches!(
            runtime.set_password("1234")?,
            PrivacyLockOutcome::Ok { .. }
        ));
        assert_eq!(
            runtime.set_password("9999")?,
            PrivacyLockOutcome::PasswordAlreadySet
        );
        assert!(matches!(runtime.engage()?, PrivacyLockOutcome::Ok { .. }));
        assert!(runtime.is_locked());
        assert!(runtime.suppresses(OverlayActivitySurface::Desktop));
        assert!(!runtime.suppresses(OverlayActivitySurface::Wrist));

        scope.set("", "https://api.example.test/api/1");
        assert!(!runtime.is_locked());
        assert_eq!(runtime.snapshot().user_id, "");

        scope.set("usr_2", "https://api.example.test/api/1");
        assert!(!runtime.is_locked());

        scope.set("usr_1", "https://api.example.test/api/1");
        assert!(runtime.is_locked());
        assert_eq!(runtime.unlock("nope")?, PrivacyLockOutcome::WrongPassword);
        assert!(matches!(
            runtime.unlock("1234")?,
            PrivacyLockOutcome::Ok { .. }
        ));
        assert!(!runtime.is_locked());
        assert!(!runtime.suppresses(OverlayActivitySurface::Desktop));
        Ok(())
    }

    #[test]
    fn clearing_needs_a_saved_account_password() -> Result<()> {
        let (runtime, scope) = runtime_with_scope();
        scope.set("usr_1", "https://api.example.test/api/1");
        runtime.set_password("1234")?;
        runtime.engage()?;
        assert_eq!(
            runtime.clear_with_account_password("secret")?,
            PrivacyLockOutcome::AccountPasswordUnavailable
        );
        assert!(runtime.is_locked());
        Ok(())
    }
}
