use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use vrcx_0_application::auth::{
    saved_login_credentials, AuthCredentialStore, SavedLoginCredentials,
};
use vrcx_0_application::social::PROFILE_BIO_SCAN_CONFIG_KEY;
use vrcx_0_application_core::{
    BackendRuntime, BackendRuntimeAuthStatus, BackendRuntimePhase, FileCache, RuntimeAuthScope,
    RuntimeEventBus, TaskSupervisor, WebClient, WorldCache,
};
use vrcx_0_application_realtime::{replay_logger_frames, ReplayOutcome, ReplayResolvers};
use vrcx_0_contracts::runtime_event_payload;
use vrcx_0_core::realtime::RealtimeWsStatus;
use vrcx_0_core::OwnerId;
use vrcx_0_integrations::feed_logger::{FeedLoggerClient, FeedLoggerClientError};
use vrcx_0_logger_protocol::wire::{
    AckRequest, CredentialsRequest, DeviceLoginRequest, DeviceLoginState, FrameKind, FramesRequest,
    FramesResponse, HelloResponse, OkResponse, PresenceRequest, PresenceResponse, ProfileCheck,
    SessionState, StatusResponse, TwoFactorRequest, WebhookFormat, WebhookRequest, WireFrame,
    CAPTURE_FORMAT_VERSION, MAX_FRAMES_PAGE, PRESENCE_INTERVAL_SECS, PRESENCE_TTL_SECS,
    PROTOCOL_VERSION,
};
use vrcx_0_persistence::profile_bio::profile_bio_checked_at_list;
use vrcx_0_persistence::realtime::BackfillWrites;
use vrcx_0_persistence::{config::ConfigRepository, secrets, DatabaseService};

mod backfill_history;

pub use backfill_history::{FeedLoggerBackfillHistory, FeedLoggerBackfillRecord};

const SETTINGS_KEY: &str = "feedLogger";
const MIN_LOGGER_PROTOCOL_VERSION: u32 = 1;
const PRESENCE_INTERVAL: Duration = Duration::from_secs(PRESENCE_INTERVAL_SECS);
const PRESENCE_CHECK_INTERVAL: Duration = Duration::from_secs(2);
const HEALTH_CHECK_INTERVAL: Duration = Duration::from_secs(120);
const RECORDER_TAKES_OVER_AFTER: Duration = Duration::from_secs(PRESENCE_TTL_SECS - 5);
const LEAVE_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Debug, thiserror::Error)]
pub enum FeedLoggerError {
    #[error("feed logger is not configured")]
    NotConfigured,
    #[error("sign in to VRChat before syncing the feed logger")]
    NotSignedIn,
    #[error("feed logger sync is already running")]
    SyncInProgress,
    #[error("VRCX-0 is not connected to the feed logger right now")]
    NotPresent,
    #[error("no saved VRChat password for the current account")]
    NoSavedCredentials,
    #[error("feed logger needs to be updated")]
    LoggerTooOld,
    #[error("a stable VRCX-0 only works with a stable feed logger")]
    BetaRecorder,
    #[error("disconnect the feed logger before turning off automatic backups")]
    BackupRequired,
    #[error("the feed logger logged in to a different VRChat account")]
    AccountMismatch,
    #[error(transparent)]
    Client(#[from] FeedLoggerClientError),
    #[error("feed logger storage: {0}")]
    Storage(String),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum FeedLoggerErrorCode {
    NotConfigured,
    NotSignedIn,
    SyncInProgress,
    NotPresent,
    NoSavedCredentials,
    LoggerTooOld,
    BetaRecorder,
    BackupRequired,
    AccountMismatch,
    InvalidAddress,
    InvalidPassword,
    Unreachable,
    Unauthorized,
    ClientTooOld,
    Rejected,
    BadResponse,
    Storage,
}

impl FeedLoggerError {
    pub fn code(&self) -> FeedLoggerErrorCode {
        match self {
            Self::NotConfigured => FeedLoggerErrorCode::NotConfigured,
            Self::NotSignedIn => FeedLoggerErrorCode::NotSignedIn,
            Self::SyncInProgress => FeedLoggerErrorCode::SyncInProgress,
            Self::NotPresent => FeedLoggerErrorCode::NotPresent,
            Self::NoSavedCredentials => FeedLoggerErrorCode::NoSavedCredentials,
            Self::LoggerTooOld => FeedLoggerErrorCode::LoggerTooOld,
            Self::BetaRecorder => FeedLoggerErrorCode::BetaRecorder,
            Self::BackupRequired => FeedLoggerErrorCode::BackupRequired,
            Self::AccountMismatch => FeedLoggerErrorCode::AccountMismatch,
            Self::Client(FeedLoggerClientError::InvalidAddress(_)) => {
                FeedLoggerErrorCode::InvalidAddress
            }
            Self::Client(FeedLoggerClientError::Password(_)) => {
                FeedLoggerErrorCode::InvalidPassword
            }
            Self::Client(FeedLoggerClientError::Transport(_)) => FeedLoggerErrorCode::Unreachable,
            Self::Client(FeedLoggerClientError::Unauthorized) => FeedLoggerErrorCode::Unauthorized,
            Self::Client(FeedLoggerClientError::ClientTooOld) => FeedLoggerErrorCode::ClientTooOld,
            Self::Client(FeedLoggerClientError::Rejected(_)) => FeedLoggerErrorCode::Rejected,
            Self::Client(FeedLoggerClientError::Malformed(_)) => FeedLoggerErrorCode::BadResponse,
            Self::Storage(_) => FeedLoggerErrorCode::Storage,
        }
    }
}

type Result<T> = std::result::Result<T, FeedLoggerError>;

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FeedLoggerSettingsView {
    pub address: Option<String>,
    pub saved_credentials_available: bool,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum FeedLoggerProbe {
    NotConfigured,
    Unreachable { message: String },
    Unauthorized,
    ClientTooOld,
    LoggerTooOld,
    BetaRecorder,
    BadResponse { message: String },
    Connected { status: Box<StatusResponse> },
}

runtime_event_payload!(FeedLoggerProbe, "feedLoggerHealth");

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(tag = "result", rename_all = "camelCase")]
pub enum FeedLoggerSyncReport {
    NotConfigured,
    AccountMismatch {
        #[serde(rename = "loggerAccountId")]
        logger_account_id: Option<String>,
    },
    Synced {
        frames: u32,
        inserted: u32,
        #[serde(rename = "framesWithoutBaseline")]
        frames_without_baseline: u32,
    },
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum FeedLoggerSyncEvent {
    Pulling { frames: u32 },
    Writing { frames: u32 },
    Finished { inserted: u32, skipped: u32 },
    Failed { message: String },
}

runtime_event_payload!(FeedLoggerSyncEvent, "feedLoggerSync");

#[derive(Default)]
struct SyncTotals {
    pulled: usize,
    inserted: u64,
    frames_without_baseline: usize,
    written: BackfillWrites,
}

#[derive(Default)]
struct SegmentBuffer {
    frames: Vec<WireFrame>,
}

impl SegmentBuffer {
    fn push(&mut self, frame: WireFrame) -> Option<Vec<WireFrame>> {
        let completed = (frame.kind == FrameKind::Connect && !self.frames.is_empty())
            .then(|| std::mem::take(&mut self.frames));
        self.frames.push(frame);
        completed
    }

    fn finish(self) -> Option<Vec<WireFrame>> {
        (!self.frames.is_empty()).then_some(self.frames)
    }
}

pub enum SettingsCheck {
    Verified(Box<VerifiedRecorder>),
    Unhealthy(FeedLoggerProbe),
    Invalid(FeedLoggerError),
}

pub struct VerifiedRecorder {
    settings: PersistedSettings,
    client: Arc<dyn RecorderTransport>,
    status: StatusResponse,
}

#[derive(Serialize, Deserialize)]
struct PersistedSettings {
    address: String,
    password: String,
}

#[async_trait::async_trait]
pub trait RecorderTransport: Send + Sync {
    async fn call_value(
        &self,
        path: &str,
        request: Value,
    ) -> std::result::Result<Value, FeedLoggerClientError>;
    async fn presence(
        &self,
        request: &PresenceRequest,
    ) -> std::result::Result<PresenceResponse, FeedLoggerClientError>;
    fn clock_offset_ms(&self) -> i64;
}

#[async_trait::async_trait]
impl RecorderTransport for FeedLoggerClient {
    async fn call_value(
        &self,
        path: &str,
        request: Value,
    ) -> std::result::Result<Value, FeedLoggerClientError> {
        self.call(path, &request).await
    }

    async fn presence(
        &self,
        request: &PresenceRequest,
    ) -> std::result::Result<PresenceResponse, FeedLoggerClientError> {
        FeedLoggerClient::presence(self, request).await
    }

    fn clock_offset_ms(&self) -> i64 {
        FeedLoggerClient::clock_offset_ms(self)
    }
}

#[async_trait::async_trait]
pub trait RecorderConnector: Send + Sync {
    async fn connect(
        &self,
        address: &str,
        password: &str,
    ) -> Result<(Arc<dyn RecorderTransport>, HelloResponse)>;
}

struct HttpRecorderConnector;

#[async_trait::async_trait]
impl RecorderConnector for HttpRecorderConnector {
    async fn connect(
        &self,
        address: &str,
        password: &str,
    ) -> Result<(Arc<dyn RecorderTransport>, HelloResponse)> {
        let address = address.to_string();
        let password = password.to_string();
        let client =
            tokio::task::spawn_blocking(move || FeedLoggerClient::new(&address, &password))
                .await
                .map_err(storage)??;
        let hello = client.hello().await?;
        Ok((Arc::new(client), hello))
    }
}

#[derive(Default)]
pub struct PresenceTicker {
    heartbeat_at: Option<(Instant, String)>,
    probed: Option<Instant>,
}

pub struct DesktopFeedLoggerRuntime {
    db: Arc<DatabaseService>,
    config: ConfigRepository,
    world_cache: Arc<WorldCache>,
    file_cache: FileCache,
    web: Arc<WebClient>,
    event_bus: RuntimeEventBus,
    auth_scope: RuntimeAuthScope,
    auth_credentials: Arc<dyn AuthCredentialStore>,
    client: Mutex<Option<Arc<dyn RecorderTransport>>>,
    connector: Arc<dyn RecorderConnector>,
    presence_generation: AtomicU64,
    syncing: AtomicBool,
    stable_app: bool,
    configured: AtomicBool,
    linked_account: Mutex<Option<(String, Instant)>>,
    last_probe: Mutex<Option<FeedLoggerProbe>>,
}

enum Heartbeat {
    Resumed,
    Present,
    Failed,
}

impl DesktopFeedLoggerRuntime {
    pub fn new(
        db: Arc<DatabaseService>,
        world_cache: Arc<WorldCache>,
        file_cache: FileCache,
        web: Arc<WebClient>,
        event_bus: RuntimeEventBus,
        auth_scope: RuntimeAuthScope,
        auth_credentials: Arc<dyn AuthCredentialStore>,
    ) -> Self {
        Self {
            stable_app: true,
            configured: AtomicBool::new(false),
            config: ConfigRepository::new(Arc::clone(&db)),
            db,
            world_cache,
            file_cache,
            web,
            event_bus,
            auth_scope,
            auth_credentials,
            client: Mutex::new(None),
            connector: Arc::new(HttpRecorderConnector),
            presence_generation: AtomicU64::new(0),
            syncing: AtomicBool::new(false),
            linked_account: Mutex::new(None),
            last_probe: Mutex::new(None),
        }
        .with_configured_from_storage()
    }

    fn with_configured_from_storage(self) -> Self {
        let configured = self
            .load_settings()
            .is_ok_and(|settings| settings.is_some());
        self.configured.store(configured, Ordering::Release);
        self
    }

    pub fn with_connector(self, connector: Arc<dyn RecorderConnector>) -> Self {
        Self { connector, ..self }
    }

    pub fn for_app_version(self, app_version: &str) -> Self {
        Self {
            stable_app: !app_version.contains('-'),
            ..self
        }
    }

    pub fn settings_view(&self) -> Result<FeedLoggerSettingsView> {
        Ok(FeedLoggerSettingsView {
            address: self.load_settings()?.map(|settings| settings.address),
            saved_credentials_available: self.saved_credentials()?.is_some(),
        })
    }

    pub async fn verify_settings(&self, address: String, password: String) -> SettingsCheck {
        let settings = PersistedSettings { address, password };
        let verified = match self.connect(&settings).await {
            Ok(client) => call_transport::<_, StatusResponse>(&*client, "/status", &OkResponse {})
                .await
                .map(|status| (client, status))
                .map_err(FeedLoggerError::from),
            Err(error) => Err(error),
        };
        let (client, status) = match verified {
            Ok(verified) => verified,
            Err(
                error @ FeedLoggerError::Client(
                    FeedLoggerClientError::InvalidAddress(_) | FeedLoggerClientError::Password(_),
                ),
            ) => return SettingsCheck::Invalid(error),
            Err(error) => {
                return match probe_from_error(error) {
                    Ok(probe) => SettingsCheck::Unhealthy(probe),
                    Err(error) => SettingsCheck::Invalid(error),
                }
            }
        };
        SettingsCheck::Verified(Box::new(VerifiedRecorder {
            settings,
            client,
            status,
        }))
    }

    pub fn adopt_settings(&self, verified: Box<VerifiedRecorder>) -> Result<FeedLoggerProbe> {
        let VerifiedRecorder {
            settings,
            client,
            status,
        } = *verified;
        store_settings(&self.config, &settings)?;
        self.configured.store(true, Ordering::Release);
        *lock(&self.client) = Some(client);
        self.report(Ok(FeedLoggerProbe::Connected {
            status: Box::new(status),
        }))
    }

    pub fn ensure_backup_can_turn_off(&self, auto_backup_enabled: bool) -> Result<()> {
        if !auto_backup_enabled && self.configured.load(Ordering::Acquire) {
            return Err(FeedLoggerError::BackupRequired);
        }
        Ok(())
    }

    pub fn clear_settings(&self) -> Result<()> {
        *lock(&self.client) = None;
        self.config.remove(SETTINGS_KEY).map_err(storage)?;
        self.configured.store(false, Ordering::Release);
        self.event_bus.emit(FeedLoggerProbe::NotConfigured);
        Ok(())
    }

    pub async fn probe(&self) -> Result<FeedLoggerProbe> {
        let probe = match self
            .call::<_, StatusResponse>("/status", &OkResponse {})
            .await
        {
            Ok(status) => Ok(FeedLoggerProbe::Connected {
                status: Box::new(status),
            }),
            Err(error) => probe_from_error(error),
        };
        self.report(probe)
    }

    fn report(&self, probe: Result<FeedLoggerProbe>) -> Result<FeedLoggerProbe> {
        if let Ok(probe) = &probe {
            *lock(&self.last_probe) = Some(probe.clone());
            self.event_bus.emit(probe.clone());
        }
        probe
    }

    pub fn recorder_may_be_recording(&self) -> bool {
        self.configured.load(Ordering::Acquire) && self.fresh_linked_account().is_none()
    }

    fn linked_to(&self, account_id: &str) -> bool {
        self.fresh_linked_account().as_deref() == Some(account_id)
    }

    fn fresh_linked_account(&self) -> Option<String> {
        lock(&self.linked_account)
            .as_ref()
            .filter(|(_, at)| at.elapsed() < RECORDER_TAKES_OVER_AFTER)
            .map(|(account_id, _)| account_id.clone())
    }

    fn has_unsynced_for(&self, account_id: &str) -> bool {
        matches!(
            lock(&self.last_probe).as_ref(),
            Some(FeedLoggerProbe::Connected { status })
                if status.unsynced_frames > 0 && status.account_id.as_deref() == Some(account_id)
        )
    }

    pub async fn push_credentials(
        &self,
        username: String,
        password: String,
        save_password: bool,
    ) -> Result<SessionState> {
        let current_user = self.signed_in_user()?;
        let state = self
            .call(
                "/credentials",
                &CredentialsRequest {
                    username,
                    password,
                    save_password,
                },
            )
            .await?;
        self.ensure_recorder_follows(&current_user, state).await
    }

    pub async fn push_saved_credentials(&self, save_password: bool) -> Result<SessionState> {
        let credentials = self
            .saved_credentials()?
            .ok_or(FeedLoggerError::NoSavedCredentials)?;
        self.push_credentials(credentials.username, credentials.password, save_password)
            .await
    }

    fn saved_credentials(&self) -> Result<Option<SavedLoginCredentials>> {
        let scope = self.auth_scope.snapshot();
        if !scope.active {
            return Ok(None);
        }
        saved_login_credentials(self.auth_credentials.as_ref(), &scope.current_user_id)
            .map_err(storage)
    }

    pub async fn start_device_login(&self) -> Result<DeviceLoginState> {
        let account_id = self.signed_in_user()?;
        self.call("/device-login", &DeviceLoginRequest { account_id })
            .await
    }

    pub async fn cancel_device_login(&self) -> Result<()> {
        self.call_ok("/device-login-cancel", &OkResponse {}).await
    }

    pub async fn submit_two_factor(&self, method: String, code: String) -> Result<SessionState> {
        let current_user = self.signed_in_user()?;
        let state = self
            .call("/two-factor", &TwoFactorRequest { method, code })
            .await?;
        self.ensure_recorder_follows(&current_user, state).await
    }

    fn signed_in_user(&self) -> Result<String> {
        let scope = self.auth_scope.snapshot();
        if !scope.active || scope.current_user_id.is_empty() {
            return Err(FeedLoggerError::NotSignedIn);
        }
        Ok(scope.current_user_id)
    }

    async fn ensure_recorder_follows(
        &self,
        current_user: &str,
        state: SessionState,
    ) -> Result<SessionState> {
        if matches!(
            state,
            SessionState::NoCredentials
                | SessionState::AwaitingTwoFactor { .. }
                | SessionState::LoginFailed { .. }
        ) {
            return Ok(state);
        }
        let status = self
            .call::<_, StatusResponse>("/status", &OkResponse {})
            .await?;
        if status.account_id.as_deref() == Some(current_user) {
            return Ok(state);
        }
        if let Err(error) = self.unpair().await {
            tracing::warn!(error = %error, "failed to log out a recorder signed in to another account");
        }
        Err(FeedLoggerError::AccountMismatch)
    }

    pub async fn set_webhook(&self, url: Option<String>, format: WebhookFormat) -> Result<()> {
        self.call_ok("/webhook", &WebhookRequest { url, format })
            .await
    }

    pub async fn test_webhook(&self) -> Result<()> {
        self.call_ok("/webhook-test", &OkResponse {}).await
    }

    pub async fn unpair(&self) -> Result<()> {
        self.call_ok("/unpair", &OkResponse {}).await
    }

    pub fn backfill_history(&self) -> Result<FeedLoggerBackfillHistory> {
        let Ok(account_id) = self.signed_in_user() else {
            return Ok(FeedLoggerBackfillHistory::default());
        };
        backfill_history::load(&self.config, &account_id)
    }

    fn record_backfill(&self, account_id: &str, inserted: u32) {
        let at = chrono::Utc::now().timestamp();
        if let Err(error) = backfill_history::record(&self.config, account_id, at, inserted) {
            tracing::debug!(error = %error, "failed to record feed logger backfill");
        }
    }

    pub async fn sync_now(&self) -> Result<FeedLoggerSyncReport> {
        let current_user = self.signed_in_user()?;
        if !self.linked_to(&current_user) {
            return Err(FeedLoggerError::NotPresent);
        }
        if self.syncing.swap(true, Ordering::AcqRel) {
            return Err(FeedLoggerError::SyncInProgress);
        }
        let mut started = false;
        let result = self.sync(&current_user, &mut started).await;
        self.syncing.store(false, Ordering::Release);
        if let Ok(FeedLoggerSyncReport::Synced {
            inserted: inserted @ 1..,
            ..
        }) = result
        {
            self.record_backfill(&current_user, inserted);
        }
        if started {
            self.event_bus.emit(match &result {
                Ok(FeedLoggerSyncReport::Synced {
                    inserted,
                    frames_without_baseline,
                    ..
                }) => FeedLoggerSyncEvent::Finished {
                    inserted: *inserted,
                    skipped: *frames_without_baseline,
                },
                Ok(_) => FeedLoggerSyncEvent::Finished {
                    inserted: 0,
                    skipped: 0,
                },
                Err(error) => FeedLoggerSyncEvent::Failed {
                    message: error.to_string(),
                },
            });
        }
        result
    }

    async fn sync(&self, account_id: &str, started: &mut bool) -> Result<FeedLoggerSyncReport> {
        let status: StatusResponse = match self.call("/status", &OkResponse {}).await {
            Err(FeedLoggerError::NotConfigured) => return Ok(FeedLoggerSyncReport::NotConfigured),
            result => result?,
        };
        if status.account_id.as_deref() != Some(account_id) {
            return Ok(FeedLoggerSyncReport::AccountMismatch {
                logger_account_id: status.account_id,
            });
        }

        if status.unsynced_frames == 0 {
            return Ok(FeedLoggerSyncReport::Synced {
                frames: 0,
                inserted: 0,
                frames_without_baseline: 0,
            });
        }

        *started = true;
        self.event_bus
            .emit(FeedLoggerSyncEvent::Pulling { frames: 0 });
        let clock_offset_ms = self.client().await?.clock_offset_ms();
        let endpoint = self.auth_scope.snapshot().endpoint;
        let mut resolvers =
            ReplayResolvers::new(&self.world_cache, &self.file_cache, &self.web, &endpoint);
        let mut segments = SegmentBuffer::default();
        let mut totals = SyncTotals::default();
        let mut after = 0;
        loop {
            let page: FramesResponse = self
                .call(
                    "/frames",
                    &FramesRequest {
                        account_id: account_id.to_string(),
                        after,
                        limit: MAX_FRAMES_PAGE,
                    },
                )
                .await?;
            let has_more = page.has_more && !page.frames.is_empty();
            if let Some(last) = page.frames.last() {
                after = last.seq;
            }
            totals.pulled += page.frames.len();
            self.event_bus.emit(FeedLoggerSyncEvent::Pulling {
                frames: count(totals.pulled),
            });
            for frame in page.frames {
                if let Some(segment) = segments.push(frame) {
                    self.backfill_segment(
                        account_id,
                        clock_offset_ms,
                        segment,
                        &mut resolvers,
                        &mut totals,
                    )
                    .await?;
                }
            }
            if !has_more {
                break;
            }
        }
        if let Some(segment) = segments.finish() {
            self.backfill_segment(
                account_id,
                clock_offset_ms,
                segment,
                &mut resolvers,
                &mut totals,
            )
            .await?;
        }
        Ok(FeedLoggerSyncReport::Synced {
            frames: count(totals.pulled),
            inserted: count(totals.inserted),
            frames_without_baseline: count(totals.frames_without_baseline),
        })
    }

    async fn backfill_segment(
        &self,
        account_id: &str,
        clock_offset_ms: i64,
        segment: Vec<WireFrame>,
        resolvers: &mut ReplayResolvers<'_>,
        totals: &mut SyncTotals,
    ) -> Result<()> {
        let Some(up_to) = segment.last().map(|frame| frame.seq) else {
            return Ok(());
        };
        self.event_bus.emit(FeedLoggerSyncEvent::Writing {
            frames: count(segment.len()),
        });
        let outcome = replay_logger_frames(&segment, account_id, clock_offset_ms, resolvers).await;
        totals.inserted += self.write_backfill(account_id, &outcome, &mut totals.written)?;
        totals.frames_without_baseline += outcome.frames_without_baseline;
        self.call_ok(
            "/ack",
            &AckRequest {
                account_id: account_id.to_string(),
                up_to,
            },
        )
        .await
    }

    fn write_backfill(
        &self,
        account_id: &str,
        outcome: &ReplayOutcome,
        written: &mut BackfillWrites,
    ) -> Result<u64> {
        let disabled = self
            .config
            .get_bool("feedPersistenceDisabled", false)
            .unwrap_or(false);
        if disabled || (outcome.entries.is_empty() && outcome.profile_bios.is_empty()) {
            return Ok(0);
        }
        let owner = OwnerId::new(account_id);
        let inserted = vrcx_0_persistence::realtime::insert_backfilled_feed(
            &self.db,
            &owner,
            &outcome.entries,
            &outcome.profile_bios,
            written,
        )
        .map_err(storage)?;
        if inserted > 0 {
            vrcx_0_persistence::activity::activity_self_caches_invalidate(&self.db, &owner)
                .map_err(storage)?;
        }
        Ok(inserted)
    }

    pub fn start_presence_loop(
        self: &Arc<Self>,
        backend_runtime: BackendRuntime,
        auth_scope: RuntimeAuthScope,
        tasks: TaskSupervisor,
    ) {
        let generation = self.presence_generation.fetch_add(1, Ordering::AcqRel) + 1;
        let runtime = Arc::clone(self);
        let loop_tasks = tasks.clone();
        tasks.spawn_cancellable(move |stop_token| async move {
            let mut ticker = PresenceTicker::default();
            loop {
                if stop_token.is_stop_requested()
                    || runtime.presence_generation.load(Ordering::Acquire) != generation
                {
                    break;
                }
                let Some(session_account) = session_account(&backend_runtime, &auth_scope) else {
                    break;
                };
                let ws_connected =
                    backend_runtime.snapshot().ws_status == RealtimeWsStatus::Connected;
                runtime
                    .presence_tick(&mut ticker, session_account, ws_connected, &loop_tasks)
                    .await;
                tokio::time::sleep(PRESENCE_CHECK_INTERVAL).await;
            }
            if runtime.presence_generation.load(Ordering::Acquire) == generation {
                runtime.leave().await;
            }
        });
    }

    pub async fn presence_tick(
        self: &Arc<Self>,
        ticker: &mut PresenceTicker,
        session_account: String,
        ws_connected: bool,
        tasks: &TaskSupervisor,
    ) {
        if !self.configured.load(Ordering::Acquire) {
            *ticker = PresenceTicker::default();
            return;
        }
        if !ws_connected {
            ticker.heartbeat_at = None;
        } else {
            let due = ticker.heartbeat_at.as_ref().is_none_or(|(at, account)| {
                at.elapsed() >= PRESENCE_INTERVAL || *account != session_account
            });
            if due {
                if lock(&self.linked_account)
                    .as_ref()
                    .is_some_and(|(account, _)| *account != session_account)
                {
                    self.leave().await;
                }
                let sync = match self.heartbeat(session_account.clone()).await {
                    Heartbeat::Resumed => {
                        ticker.probed = None;
                        true
                    }
                    Heartbeat::Present => self.has_unsynced_for(&session_account),
                    Heartbeat::Failed => false,
                };
                if sync {
                    let runtime = Arc::clone(self);
                    tasks.spawn(async move {
                        if let Err(error) = runtime.sync_now().await {
                            tracing::debug!(error = %error, "feed logger sync skipped");
                        }
                    });
                }
                ticker.heartbeat_at = Some((Instant::now(), session_account));
            }
        }
        if ticker
            .probed
            .is_none_or(|at| at.elapsed() >= HEALTH_CHECK_INTERVAL)
        {
            if let Err(error) = self.probe().await {
                tracing::debug!(error = %error, "feed logger health check failed");
            }
            ticker.probed = Some(Instant::now());
        }
    }

    pub async fn leave(&self) {
        let Some((account_id, _)) = lock(&self.linked_account).take() else {
            return;
        };
        let profile_scan = self.profile_scan_enabled();
        let profile_checks = if profile_scan {
            self.profile_checks(&account_id)
        } else {
            Vec::new()
        };
        let request = PresenceRequest {
            account_id,
            leaving: true,
            profile_scan,
            profile_checks,
        };
        match tokio::time::timeout(LEAVE_TIMEOUT, self.presence(&request)).await {
            Ok(Ok(_)) => {}
            Ok(Err(error)) => tracing::debug!(error = %error, "feed logger leave failed"),
            Err(_) => tracing::debug!("feed logger leave timed out"),
        }
    }

    async fn heartbeat(&self, account_id: String) -> Heartbeat {
        let request = PresenceRequest {
            account_id: account_id.clone(),
            leaving: false,
            profile_scan: self.profile_scan_enabled(),
            profile_checks: Vec::new(),
        };
        let sent_at = Instant::now();
        match self.presence(&request).await {
            Ok(response) => {
                let rejoined = lock(&self.linked_account)
                    .replace((account_id, sent_at))
                    .is_none();
                if rejoined || response.resumed {
                    Heartbeat::Resumed
                } else {
                    Heartbeat::Present
                }
            }
            Err(FeedLoggerError::NotConfigured) => Heartbeat::Failed,
            Err(error) => {
                tracing::debug!(error = %error, "feed logger heartbeat failed");
                Heartbeat::Failed
            }
        }
    }

    async fn presence(&self, request: &PresenceRequest) -> Result<PresenceResponse> {
        let client = self.client().await?;
        self.drop_client_on_error(client.presence(request).await)
    }

    fn profile_scan_enabled(&self) -> bool {
        self.config
            .get_bool(PROFILE_BIO_SCAN_CONFIG_KEY, false)
            .unwrap_or(false)
    }

    fn profile_checks(&self, account_id: &str) -> Vec<ProfileCheck> {
        profile_bio_checked_at_list(&self.db, &OwnerId::new(account_id))
            .inspect_err(
                |error| tracing::debug!(error = %error, "failed to read profile bio checks"),
            )
            .unwrap_or_default()
            .into_iter()
            .filter_map(|(user_id, checked_at)| {
                Some(ProfileCheck {
                    checked_at: chrono::DateTime::parse_from_rfc3339(&checked_at)
                        .ok()?
                        .timestamp(),
                    user_id,
                })
            })
            .collect()
    }

    async fn call<Request, Response>(&self, path: &str, request: &Request) -> Result<Response>
    where
        Request: Serialize,
        Response: DeserializeOwned,
    {
        let client = self.client().await?;
        self.drop_client_on_error(call_transport(&*client, path, request).await)
    }

    fn drop_client_on_error<T>(
        &self,
        result: std::result::Result<T, FeedLoggerClientError>,
    ) -> Result<T> {
        if result.is_err() {
            *lock(&self.client) = None;
        }
        Ok(result?)
    }

    async fn call_ok<Request: Serialize>(&self, path: &str, request: &Request) -> Result<()> {
        self.call::<_, OkResponse>(path, request).await.map(|_| ())
    }

    async fn client(&self) -> Result<Arc<dyn RecorderTransport>> {
        if let Some(client) = lock(&self.client).clone() {
            return Ok(client);
        }
        let settings = self
            .load_settings()?
            .ok_or(FeedLoggerError::NotConfigured)?;
        let client = self.connect(&settings).await?;
        *lock(&self.client) = Some(Arc::clone(&client));
        Ok(client)
    }

    async fn connect(&self, settings: &PersistedSettings) -> Result<Arc<dyn RecorderTransport>> {
        let (client, hello) = self
            .connector
            .connect(&settings.address, &settings.password)
            .await?;
        check_compatibility(&hello, self.stable_app)?;
        Ok(client)
    }

    fn load_settings(&self) -> Result<Option<PersistedSettings>> {
        read_settings(&self.config)
    }
}

fn read_settings(config: &ConfigRepository) -> Result<Option<PersistedSettings>> {
    let Some(persisted) = config
        .get_raw(SETTINGS_KEY)
        .map_err(storage)?
        .and_then(|raw| serde_json::from_str::<PersistedSettings>(&raw).ok())
    else {
        return Ok(None);
    };
    if !secrets::is_sealed_secret(&persisted.password) {
        return Ok(Some(persisted));
    }
    let Some(password) = secrets::open_secret(&persisted.password) else {
        return Ok(None);
    };
    let settings = PersistedSettings {
        password,
        ..persisted
    };
    store_settings(config, &settings)?;
    Ok(Some(settings))
}

fn store_settings(config: &ConfigRepository, settings: &PersistedSettings) -> Result<()> {
    let json = serde_json::to_string(settings).map_err(storage)?;
    config.set_string(SETTINGS_KEY, &json).map_err(storage)
}

async fn call_transport<Request, Response>(
    client: &dyn RecorderTransport,
    path: &str,
    request: &Request,
) -> std::result::Result<Response, FeedLoggerClientError>
where
    Request: Serialize + ?Sized,
    Response: DeserializeOwned,
{
    let request = serde_json::to_value(request)
        .map_err(|error| FeedLoggerClientError::Malformed(error.to_string()))?;
    let response = client.call_value(path, request).await?;
    serde_json::from_value(response)
        .map_err(|error| FeedLoggerClientError::Malformed(error.to_string()))
}

fn check_compatibility(hello: &HelloResponse, stable_app: bool) -> Result<()> {
    if hello.protocol_version < MIN_LOGGER_PROTOCOL_VERSION
        || hello.capture_format_version < CAPTURE_FORMAT_VERSION
    {
        return Err(FeedLoggerError::LoggerTooOld);
    }
    if PROTOCOL_VERSION < hello.min_client_protocol_version
        || hello.capture_format_version > CAPTURE_FORMAT_VERSION
    {
        return Err(FeedLoggerClientError::ClientTooOld.into());
    }
    if stable_app && hello.logger_version.contains('-') {
        return Err(FeedLoggerError::BetaRecorder);
    }
    Ok(())
}

fn probe_from_error(error: FeedLoggerError) -> Result<FeedLoggerProbe> {
    match error {
        FeedLoggerError::NotConfigured => Ok(FeedLoggerProbe::NotConfigured),
        FeedLoggerError::LoggerTooOld => Ok(FeedLoggerProbe::LoggerTooOld),
        FeedLoggerError::BetaRecorder => Ok(FeedLoggerProbe::BetaRecorder),
        FeedLoggerError::Client(FeedLoggerClientError::Transport(message)) => {
            Ok(FeedLoggerProbe::Unreachable { message })
        }
        FeedLoggerError::Client(FeedLoggerClientError::Unauthorized) => {
            Ok(FeedLoggerProbe::Unauthorized)
        }
        FeedLoggerError::Client(FeedLoggerClientError::ClientTooOld) => {
            Ok(FeedLoggerProbe::ClientTooOld)
        }
        FeedLoggerError::Client(
            FeedLoggerClientError::Rejected(message) | FeedLoggerClientError::Malformed(message),
        ) => Ok(FeedLoggerProbe::BadResponse { message }),
        error => Err(error),
    }
}

fn session_account(
    backend_runtime: &BackendRuntime,
    auth_scope: &RuntimeAuthScope,
) -> Option<String> {
    let snapshot = backend_runtime.snapshot();
    if snapshot.phase != BackendRuntimePhase::Running
        || snapshot.auth_status != BackendRuntimeAuthStatus::Authenticated
    {
        return None;
    }
    let scope = auth_scope.snapshot();
    (scope.active && !scope.current_user_id.is_empty()).then_some(scope.current_user_id)
}

fn count(value: impl TryInto<u32>) -> u32 {
    value.try_into().unwrap_or(u32::MAX)
}

fn storage(error: impl std::fmt::Display) -> FeedLoggerError {
    FeedLoggerError::Storage(error.to_string())
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn recorded(seq: i64, kind: FrameKind) -> WireFrame {
        WireFrame {
            seq,
            kind,
            received_at: "2026-10-01T12:00:00+00:00".into(),
            account_id: "usr_self".into(),
            payload: String::new(),
        }
    }

    fn seqs(frames: &[WireFrame]) -> Vec<i64> {
        frames.iter().map(|frame| frame.seq).collect()
    }

    #[test]
    fn pulled_records_are_handed_over_one_recording_segment_at_a_time() {
        let mut segments = SegmentBuffer::default();
        let mut completed = Vec::new();
        for frame in [
            recorded(1, FrameKind::Message),
            recorded(2, FrameKind::Connect),
            recorded(3, FrameKind::Snapshot),
            recorded(4, FrameKind::Message),
            recorded(5, FrameKind::Connect),
            recorded(6, FrameKind::Message),
        ] {
            completed.extend(segments.push(frame));
        }
        completed.extend(segments.finish());

        assert_eq!(
            completed
                .iter()
                .map(|segment| seqs(segment))
                .collect::<Vec<_>>(),
            [vec![1], vec![2, 3, 4], vec![5, 6]]
        );
    }

    #[test]
    fn nothing_is_handed_over_when_nothing_was_pulled() {
        assert!(SegmentBuffer::default().finish().is_none());
    }

    fn hello(protocol_version: u32, min_client: u32, capture_format: u32) -> HelloResponse {
        recorder_release(protocol_version, min_client, capture_format, "2.32.0")
    }

    fn recorder_release(
        protocol_version: u32,
        min_client: u32,
        capture_format: u32,
        logger_version: &str,
    ) -> HelloResponse {
        HelloResponse {
            protocol_version,
            min_client_protocol_version: min_client,
            capture_format_version: capture_format,
            logger_version: logger_version.into(),
            server_time: 0,
        }
    }

    #[test]
    fn a_stable_desktop_only_accepts_a_stable_recorder() {
        let beta = recorder_release(PROTOCOL_VERSION, 1, CAPTURE_FORMAT_VERSION, "2.32.0-beta.1");

        assert!(matches!(
            check_compatibility(&beta, true),
            Err(FeedLoggerError::BetaRecorder)
        ));
        assert!(
            check_compatibility(&hello(PROTOCOL_VERSION, 1, CAPTURE_FORMAT_VERSION), true).is_ok()
        );
    }

    #[test]
    fn a_beta_desktop_accepts_stable_and_beta_recorders() {
        let beta = recorder_release(PROTOCOL_VERSION, 1, CAPTURE_FORMAT_VERSION, "2.32.0-beta.1");

        assert!(check_compatibility(&beta, false).is_ok());
        assert!(
            check_compatibility(&hello(PROTOCOL_VERSION, 1, CAPTURE_FORMAT_VERSION), false).is_ok()
        );
    }

    #[test]
    fn a_recorder_speaking_this_desktops_protocol_and_capture_format_is_accepted() {
        assert!(
            check_compatibility(&hello(PROTOCOL_VERSION, 1, CAPTURE_FORMAT_VERSION), true).is_ok()
        );
    }

    #[test]
    fn a_recorder_that_is_too_old_is_rejected_as_needing_an_update() {
        for too_old in [
            hello(MIN_LOGGER_PROTOCOL_VERSION - 1, 1, CAPTURE_FORMAT_VERSION),
            hello(PROTOCOL_VERSION, 1, CAPTURE_FORMAT_VERSION - 1),
        ] {
            assert!(matches!(
                check_compatibility(&too_old, false),
                Err(FeedLoggerError::LoggerTooOld)
            ));
        }
    }

    #[test]
    fn a_recorder_that_is_too_new_for_this_desktop_is_rejected_as_desktop_too_old() {
        for too_new in [
            hello(
                PROTOCOL_VERSION,
                PROTOCOL_VERSION + 1,
                CAPTURE_FORMAT_VERSION,
            ),
            hello(PROTOCOL_VERSION, 1, CAPTURE_FORMAT_VERSION + 1),
        ] {
            assert!(matches!(
                check_compatibility(&too_new, false),
                Err(FeedLoggerError::Client(FeedLoggerClientError::ClientTooOld))
            ));
        }
    }

    #[test]
    fn a_recorder_password_sealed_to_this_machine_is_resaved_so_any_machine_can_read_it() {
        secrets::init_secrets(Some([7; 32]), true);
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "vrcx-0-feed-logger-shared-password-{}-{nonce}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let config = ConfigRepository::new(Arc::new(
            DatabaseService::new(&dir.join("VRCX-0.sqlite3")).unwrap(),
        ));
        let sealed = secrets::seal_secret("password123");
        assert!(secrets::is_sealed_secret(&sealed));
        config
            .set_string(
                SETTINGS_KEY,
                &serde_json::json!({
                    "address": "http://192.168.1.10:8787",
                    "password": sealed,
                })
                .to_string(),
            )
            .unwrap();

        let settings = read_settings(&config).unwrap().unwrap();

        assert_eq!(settings.password, "password123");
        let resaved = config.get_raw(SETTINGS_KEY).unwrap().unwrap();
        assert_eq!(
            serde_json::from_str::<PersistedSettings>(&resaved)
                .unwrap()
                .password,
            "password123"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}
