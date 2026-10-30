use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use chrono::Utc;

use serde::Serialize;
use serde_json::Value;
use tokio::sync::Notify;
use tokio::time::Instant;
use vrcx_0_application::auth::{
    verify_saved_account_password, wait_for_device_approval, AuthCredentialStore,
    DeviceApprovalOutcome, PrivacyLockPasswordCheck, PrivacyLockStore,
};
use vrcx_0_application_core::{
    Result, RuntimeAuthScopeObserver, RuntimeAuthScopeSnapshot, RuntimeEventBus,
    RuntimeEventPayload,
};
use vrcx_0_contracts::vrchat_api::{vrchat_response, VrchatResponse};
use vrcx_0_contracts::vrchat_device_login::interpret_device_code_response;
use vrcx_0_contracts::vrchat_login::{interpret_login_config_response, VrchatLoginStep};
use vrcx_0_core::json::JsonExt;
use vrcx_0_core::vrchat_endpoints::VRCHAT_API_DEFAULT_ENDPOINT;
use vrcx_0_vrchat_client::auth::{
    config_get_input, current_user_get_input, device_code_input, device_status_input, logout_input,
};
use vrcx_0_vrchat_client::http_api::{build_web_execute_request, ApiScope, HttpApiRequestInput};
use vrcx_0_vrchat_client::web_client::WebClient as VrchatWebClient;

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
    AccountMismatch,
    DeviceCodeExpired,
    DeviceDenied,
    DeviceFailed { reason: String },
    Cancelled,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum PrivacyLockDeviceStart {
    #[serde(rename_all = "camelCase")]
    Pending {
        attempt_id: String,
        verification_url: String,
        expires_at: i64,
    },
    NoActiveSession,
    Failed {
        reason: String,
    },
}

struct DeviceVerification {
    attempt: u64,
    client: Arc<VrchatWebClient>,
    device_code: String,
    interval: Duration,
    deadline: Instant,
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

pub type PrivacyLockObserver = Arc<dyn Fn(&PrivacyLockSnapshot) + Send + Sync>;

pub struct PrivacyLockRuntime {
    state: Mutex<PrivacyLockState>,
    observers: Mutex<Vec<PrivacyLockObserver>>,
    setup_requested: AtomicBool,
    credentials: Arc<dyn AuthCredentialStore>,
    event_bus: RuntimeEventBus,
    proxy_url: Option<String>,
    device: Mutex<Option<DeviceVerification>>,
    device_attempt: AtomicU64,
    device_superseded: Notify,
}

impl PrivacyLockRuntime {
    pub fn new(
        credentials: Arc<dyn AuthCredentialStore>,
        event_bus: RuntimeEventBus,
        proxy_url: Option<String>,
    ) -> Result<Self> {
        let store = PrivacyLockStore::load(credentials.as_ref())?;
        Ok(Self {
            state: Mutex::new(PrivacyLockState {
                store,
                user_id: String::new(),
                revision: 0,
            }),
            observers: Mutex::new(Vec::new()),
            setup_requested: AtomicBool::new(false),
            credentials,
            event_bus,
            proxy_url,
            device: Mutex::new(None),
            device_attempt: AtomicU64::new(0),
            device_superseded: Notify::new(),
        })
    }

    pub fn snapshot(&self) -> PrivacyLockSnapshot {
        self.lock_state().snapshot()
    }

    pub fn add_observer(&self, observer: PrivacyLockObserver) {
        self.observers
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .push(observer);
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

    pub async fn start_device_verification(&self, app_version: &str) -> PrivacyLockDeviceStart {
        if self.lock_state().user_id.is_empty() {
            return PrivacyLockDeviceStart::NoActiveSession;
        }
        let attempt = self.supersede_device_verification();
        let client = match VrchatWebClient::new(self.proxy_url.clone(), None, app_version) {
            Ok(client) => client,
            Err(error) => {
                return PrivacyLockDeviceStart::Failed {
                    reason: error.to_string(),
                }
            }
        };
        let authorization = match request_device_authorization(&client).await {
            Ok(authorization) => authorization,
            Err(reason) => return PrivacyLockDeviceStart::Failed { reason },
        };
        let mut device = self.lock_device();
        if self.device_attempt.load(Ordering::SeqCst) != attempt {
            return PrivacyLockDeviceStart::Failed {
                reason: "Verification was superseded by a newer request.".into(),
            };
        }
        let expires_at = authorization.expires_at_unix_millis(Utc::now().timestamp_millis());
        *device = Some(DeviceVerification {
            attempt,
            client: Arc::new(client),
            device_code: authorization.device_code,
            interval: authorization.interval,
            deadline: Instant::now() + authorization.expires_in,
        });
        PrivacyLockDeviceStart::Pending {
            attempt_id: attempt.to_string(),
            verification_url: authorization.verification_url,
            expires_at,
        }
    }

    pub async fn await_device_verification(&self, attempt_id: &str) -> Result<PrivacyLockOutcome> {
        let verification = {
            let mut device = self.lock_device();
            match device.take() {
                Some(verification) if verification.attempt.to_string() == attempt_id => {
                    verification
                }
                other => {
                    *device = other;
                    return Ok(PrivacyLockOutcome::Cancelled);
                }
            }
        };
        let client = Arc::clone(&verification.client);
        let outcome = wait_for_device_approval(
            verification.interval,
            verification.deadline,
            &self.device_superseded,
            || self.device_attempt.load(Ordering::SeqCst) == verification.attempt,
            || {
                let client = Arc::clone(&client);
                let input = device_status_input(
                    VRCHAT_API_DEFAULT_ENDPOINT.into(),
                    verification.device_code.clone(),
                );
                async move { execute(&client, input).await }
            },
        )
        .await;
        match outcome {
            DeviceApprovalOutcome::Approved => {
                let approved_user_id = approved_user_id(&client).await;
                let _ = execute(&client, logout_input(VRCHAT_API_DEFAULT_ENDPOINT.into())).await;
                match approved_user_id {
                    Ok(user_id) => self.clear_after_device_verification(&user_id),
                    Err(reason) => Ok(PrivacyLockOutcome::DeviceFailed { reason }),
                }
            }
            DeviceApprovalOutcome::Expired => Ok(PrivacyLockOutcome::DeviceCodeExpired),
            DeviceApprovalOutcome::Denied => Ok(PrivacyLockOutcome::DeviceDenied),
            DeviceApprovalOutcome::Failed(reason) => {
                Ok(PrivacyLockOutcome::DeviceFailed { reason })
            }
            DeviceApprovalOutcome::Superseded => Ok(PrivacyLockOutcome::Cancelled),
        }
    }

    pub fn cancel_device_verification(&self) {
        self.supersede_device_verification();
    }

    fn supersede_device_verification(&self) -> u64 {
        let attempt = self.device_attempt.fetch_add(1, Ordering::SeqCst) + 1;
        self.lock_device().take();
        self.device_superseded.notify_waiters();
        attempt
    }

    fn clear_after_device_verification(
        &self,
        approved_user_id: &str,
    ) -> Result<PrivacyLockOutcome> {
        self.mutate(|state, credentials| {
            if approved_user_id.is_empty() || approved_user_id != state.user_id {
                return Ok(Some(PrivacyLockOutcome::AccountMismatch));
            }
            state.store.clear(credentials, &state.user_id)?;
            Ok(None)
        })
    }

    fn lock_device(&self) -> MutexGuard<'_, Option<DeviceVerification>> {
        self.device
            .lock()
            .unwrap_or_else(|error| error.into_inner())
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
        self.notify(&snapshot);
        Ok(PrivacyLockOutcome::Ok { snapshot })
    }

    fn notify(&self, snapshot: &PrivacyLockSnapshot) {
        let observers = self
            .observers
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clone();
        for observer in observers {
            observer(snapshot);
        }
    }

    fn lock_state(&self) -> MutexGuard<'_, PrivacyLockState> {
        self.state.lock().unwrap_or_else(|error| error.into_inner())
    }
}

async fn execute(
    client: &VrchatWebClient,
    input: HttpApiRequestInput,
) -> std::result::Result<VrchatResponse, String> {
    let request =
        build_web_execute_request(input, ApiScope::Vrchat).map_err(|error| error.to_string())?;
    let (status, data) = client
        .execute(request)
        .await
        .map_err(|error| error.to_string())?;
    Ok(vrchat_response(status, data))
}

async fn request_device_authorization(
    client: &VrchatWebClient,
) -> std::result::Result<vrcx_0_contracts::vrchat_device_login::VrchatDeviceAuthorization, String> {
    let config = execute(client, config_get_input(VRCHAT_API_DEFAULT_ENDPOINT.into())).await?;
    if let Some(VrchatLoginStep::Failed { reason, .. }) = interpret_login_config_response(&config) {
        return Err(reason);
    }
    let response = execute(
        client,
        device_code_input(VRCHAT_API_DEFAULT_ENDPOINT.into()),
    )
    .await?;
    interpret_device_code_response(&response)
}

async fn approved_user_id(client: &VrchatWebClient) -> std::result::Result<String, String> {
    let response = execute(
        client,
        current_user_get_input(VRCHAT_API_DEFAULT_ENDPOINT.into()),
    )
    .await?;
    if response.status != 200 {
        return Err(format!(
            "VRChat current-user request failed with HTTP {}.",
            response.status
        ));
    }
    Ok(serde_json::from_str::<Value>(&response.data)
        .ok()
        .and_then(|user| user.scalar_field("id"))
        .unwrap_or_default())
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
        self.event_bus.emit(snapshot.clone());
        self.notify(&snapshot);
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use std::sync::{Arc, Mutex};

    use vrcx_0_application::auth::{AuthCredentialStore, SealedAuthSecret};
    use vrcx_0_application_core::{Result, RuntimeAuthScope, RuntimeEventBus};

    use super::*;

    #[derive(Clone, Default)]
    pub(crate) struct MemoryCredentials {
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
        fn seal_secret(&self, _previous: Option<&str>, plaintext: &str) -> SealedAuthSecret {
            SealedAuthSecret {
                stored: plaintext.to_string(),
                encrypted: false,
            }
        }
        fn is_sealed_secret(&self, _value: &str) -> bool {
            false
        }
        fn is_other_machine_secret(&self, _value: &str) -> bool {
            false
        }
        fn is_own_secret_behind_other_machines(&self, _value: &str) -> bool {
            false
        }
    }

    pub(crate) fn runtime_with_scope() -> (Arc<PrivacyLockRuntime>, RuntimeAuthScope) {
        let credentials: Arc<dyn AuthCredentialStore> = Arc::new(MemoryCredentials::default());
        let runtime = Arc::new(
            PrivacyLockRuntime::new(credentials, RuntimeEventBus::new(), None).expect("runtime"),
        );
        let scope = RuntimeAuthScope::new();
        scope.add_observer(runtime.clone());
        (runtime, scope)
    }

    #[test]
    fn watchers_hear_when_the_lock_engages_releases_or_follows_an_account_switch() -> Result<()> {
        let (runtime, scope) = runtime_with_scope();
        let heard = Arc::new(Mutex::new(Vec::new()));
        let recorded = Arc::clone(&heard);
        runtime.add_observer(Arc::new(move |snapshot: &PrivacyLockSnapshot| {
            recorded.lock().unwrap().push(snapshot.locked);
        }));
        scope.set("usr_1", "https://api.example.test/api/1");
        runtime.set_password("1234")?;
        heard.lock().unwrap().clear();

        runtime.engage()?;
        runtime.unlock("1234")?;
        runtime.engage()?;
        scope.set("usr_2", "https://api.example.test/api/1");

        assert_eq!(*heard.lock().unwrap(), [true, false, true, false]);
        Ok(())
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

    #[test]
    fn qr_verification_only_clears_the_lock_for_the_locked_account() -> Result<()> {
        let (runtime, scope) = runtime_with_scope();
        scope.set("usr_1", "https://api.example.test/api/1");
        runtime.set_password("1234")?;
        runtime.engage()?;

        assert_eq!(
            runtime.clear_after_device_verification("usr_2")?,
            PrivacyLockOutcome::AccountMismatch
        );
        assert_eq!(
            runtime.clear_after_device_verification("")?,
            PrivacyLockOutcome::AccountMismatch
        );
        assert!(runtime.is_locked());

        assert!(matches!(
            runtime.clear_after_device_verification("usr_1")?,
            PrivacyLockOutcome::Ok { .. }
        ));
        assert!(!runtime.is_locked());
        assert!(!runtime.snapshot().has_password);
        Ok(())
    }

    #[tokio::test]
    async fn waiting_on_a_cancelled_qr_verification_reports_cancelled() -> Result<()> {
        let (runtime, scope) = runtime_with_scope();
        scope.set("usr_1", "https://api.example.test/api/1");
        runtime.cancel_device_verification();

        assert_eq!(
            runtime.await_device_verification("1").await?,
            PrivacyLockOutcome::Cancelled
        );
        Ok(())
    }
}
