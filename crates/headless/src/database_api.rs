use std::fs::{self, OpenOptions};
use std::io;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use axum::extract::{DefaultBodyLimit, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::{body::Body, Json, Router};
use futures_util::StreamExt;
use rusqlite::{Connection, OpenFlags};
use sha2::{Digest, Sha256};
use tokio::io::AsyncWriteExt;
use tokio::net::TcpListener;
use tokio::sync::{watch, Mutex};
use uuid::Uuid;
use vrcx_0_application::auth::{
    LoginFailureKind, LoginSessionRespondInput, LoginSessionStartInput, LoginSessionState,
};
use vrcx_0_application::profile::{run_database_upgrade, DatabaseUpgradeRunStatus};
use vrcx_0_composition::RuntimeHostState;
use vrcx_0_contracts::{CollectorAuthStatus, CollectorAuthStatusKind};
use vrcx_0_local_server::tokens_match;
use vrcx_0_outbound_adapters::LocalDatabaseUpgradeStore;
use vrcx_0_persistence::{
    merge_remote_legacy, DatabaseRpcRequest, DatabaseService, RemoteLegacyImportCounts,
};

const MAX_REQUEST_BYTES: usize = 1024 * 1024;
const MAX_IMPORT_BYTES: u64 = 8 * 1024 * 1024 * 1024;
const MAX_UPSTREAM_SCHEMA_VERSION: i64 = 18;
const REMOTE_LEGACY_IMPORT_COMPLETE_KEY: &str = "remoteLegacyImportComplete";

#[derive(Clone)]
struct ApiState {
    database: Arc<DatabaseService>,
    runtime: Arc<RuntimeHostState>,
    bearer_token: Arc<str>,
    data_dir: PathBuf,
    import_lock: Arc<Mutex<()>>,
    auth_state: Arc<std::sync::Mutex<Option<CollectorAuthStatus>>>,
    auth_lock: Arc<Mutex<()>>,
    auth_in_progress: Arc<AtomicBool>,
}

pub struct DatabaseApi {
    listener: TcpListener,
    state: ApiState,
}

impl DatabaseApi {
    pub async fn bind(
        database: Arc<DatabaseService>,
        data_dir: PathBuf,
        runtime: Arc<RuntimeHostState>,
    ) -> Result<(Self, SocketAddr), String> {
        let bind_address =
            std::env::var("VRCX_DATABASE_BIND").unwrap_or_else(|_| "0.0.0.0:9001".to_owned());
        let address = bind_address.parse::<SocketAddr>().map_err(|_| {
            "VRCX_DATABASE_BIND must be a socket address such as 0.0.0.0:9001".to_owned()
        })?;

        let token = std::env::var("VRCX_DATABASE_TOKEN").map_err(|_| {
            "VRCX_DATABASE_TOKEN must be set to a random secret of at least 32 characters"
                .to_owned()
        })?;
        let token = token.trim();
        if token.len() < 32
            || !token.bytes().all(is_bearer_token_byte)
            || is_placeholder_token(token)
        {
            return Err(
                "VRCX_DATABASE_TOKEN must be a random secret of at least 32 characters".into(),
            );
        }

        let listener = TcpListener::bind(address)
            .await
            .map_err(|_| format!("could not bind database API listener at {address}"))?;
        let local_address = listener
            .local_addr()
            .map_err(|_| "could not inspect database API listener address".to_owned())?;
        Ok((
            Self {
                listener,
                state: ApiState {
                    database,
                    runtime,
                    bearer_token: Arc::from(token),
                    data_dir,
                    import_lock: Arc::new(Mutex::new(())),
                    auth_state: Arc::new(std::sync::Mutex::new(None)),
                    auth_lock: Arc::new(Mutex::new(())),
                    auth_in_progress: Arc::new(AtomicBool::new(false)),
                },
            },
            local_address,
        ))
    }

    pub fn auth_retry_pause(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.state.auth_in_progress)
    }

    pub fn auth_retry_lock(&self) -> Arc<Mutex<()>> {
        Arc::clone(&self.state.auth_lock)
    }

    pub async fn serve(self, shutdown: watch::Receiver<bool>) -> Result<(), std::io::Error> {
        let app = Router::new()
            .route("/api/auth/status", axum::routing::get(auth_status))
            .route(
                "/api/auth/login",
                post(auth_login).layer(DefaultBodyLimit::max(MAX_REQUEST_BYTES)),
            )
            .route(
                "/api/auth/verify",
                post(auth_verify).layer(DefaultBodyLimit::max(MAX_REQUEST_BYTES)),
            )
            .route(
                "/api/auth/cancel",
                post(auth_cancel).layer(DefaultBodyLimit::max(MAX_REQUEST_BYTES)),
            )
            .route(
                "/api/database",
                post(database_rpc).layer(DefaultBodyLimit::max(MAX_REQUEST_BYTES)),
            )
            .route(
                "/api/import-vrcx",
                post(import_vrcx).layer(DefaultBodyLimit::disable()),
            )
            .with_state(self.state);
        axum::serve(self.listener, app)
            .with_graceful_shutdown(wait_for_shutdown(shutdown))
            .await
    }
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct AuthLoginRequest {
    username: String,
    password: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct AuthVerifyRequest {
    attempt_id: String,
    method: vrcx_0_application::auth::TwoFactorMethod,
    code: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct AuthCancelRequest {
    attempt_id: String,
}

async fn auth_status(State(state): State<ApiState>, headers: HeaderMap) -> Response {
    if !has_valid_bearer(&headers, &state.bearer_token) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    Json(current_auth_status(&state)).into_response()
}

async fn auth_login(
    State(state): State<ApiState>,
    headers: HeaderMap,
    request: Result<Json<AuthLoginRequest>, axum::extract::rejection::JsonRejection>,
) -> Response {
    if !has_valid_bearer(&headers, &state.bearer_token) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let Ok(Json(request)) = request else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let _guard = state.auth_lock.lock().await;
    state.auth_in_progress.store(true, Ordering::Release);
    let login = state
        .runtime
        .start_login_session(LoginSessionStartInput::Basic {
            username: request.username,
            password: request.password,
            save_credentials: false,
        })
        .await;
    let response = status_from_login_state(&state, login);
    state.auth_in_progress.store(
        response.status == CollectorAuthStatusKind::AwaitingTwoFactor,
        Ordering::Release,
    );
    *state
        .auth_state
        .lock()
        .unwrap_or_else(|error| error.into_inner()) =
        (response.status == CollectorAuthStatusKind::AwaitingTwoFactor).then(|| response.clone());
    Json(response).into_response()
}

async fn auth_verify(
    State(state): State<ApiState>,
    headers: HeaderMap,
    request: Result<Json<AuthVerifyRequest>, axum::extract::rejection::JsonRejection>,
) -> Response {
    if !has_valid_bearer(&headers, &state.bearer_token) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let Ok(Json(request)) = request else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    if !matches!(request.method.as_str(), "emailOtp" | "otp" | "totp")
        || request.attempt_id.is_empty()
        || request.code.is_empty()
    {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let _guard = state.auth_lock.lock().await;
    state.auth_in_progress.store(true, Ordering::Release);
    let result = state
        .runtime
        .respond_login_session(LoginSessionRespondInput {
            attempt_id: request.attempt_id,
            method: request.method,
            code: request.code,
        })
        .await;
    let response = status_from_login_state(&state, result);
    state.auth_in_progress.store(
        response.status == CollectorAuthStatusKind::AwaitingTwoFactor,
        Ordering::Release,
    );
    *state
        .auth_state
        .lock()
        .unwrap_or_else(|error| error.into_inner()) =
        (response.status == CollectorAuthStatusKind::AwaitingTwoFactor).then(|| response.clone());
    Json(response).into_response()
}

async fn auth_cancel(
    State(state): State<ApiState>,
    headers: HeaderMap,
    request: Result<Json<AuthCancelRequest>, axum::extract::rejection::JsonRejection>,
) -> Response {
    if !has_valid_bearer(&headers, &state.bearer_token) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let Ok(Json(request)) = request else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    if request.attempt_id.is_empty() {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let _guard = state.auth_lock.lock().await;
    state.auth_in_progress.store(true, Ordering::Release);
    let result = state
        .runtime
        .cancel_login_session(vrcx_0_application::auth::LoginSessionCancelInput {
            attempt_id: request.attempt_id,
        })
        .await;
    let response = status_from_login_state(&state, result);
    state.auth_in_progress.store(false, Ordering::Release);
    *state
        .auth_state
        .lock()
        .unwrap_or_else(|error| error.into_inner()) = None;
    Json(response).into_response()
}

fn current_auth_status(state: &ApiState) -> CollectorAuthStatus {
    let snapshot = state.runtime.backend_runtime().snapshot();
    let collector_ready = snapshot.phase == vrcx_0_application_core::BackendRuntimePhase::Running
        && snapshot.auth_status == vrcx_0_application_core::BackendRuntimeAuthStatus::Authenticated;
    if collector_ready {
        return CollectorAuthStatus {
            status: CollectorAuthStatusKind::Ready,
            user_id: nonempty(snapshot.auth_user_id),
            display_name: nonempty(snapshot.auth_display_name),
            methods: Vec::new(),
            attempt_id: None,
            mode: None,
            error: None,
            collector_ready: true,
        };
    }
    let challenge = state
        .auth_state
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .clone();
    if let Some(challenge) = challenge {
        return challenge;
    }
    let (status, error) = match snapshot.auth_status {
        vrcx_0_application_core::BackendRuntimeAuthStatus::Authenticating => {
            (CollectorAuthStatusKind::Authenticating, None)
        }
        vrcx_0_application_core::BackendRuntimeAuthStatus::InteractionRequired
        | vrcx_0_application_core::BackendRuntimeAuthStatus::SignedOut
        | vrcx_0_application_core::BackendRuntimeAuthStatus::Unknown
        | vrcx_0_application_core::BackendRuntimeAuthStatus::Error => {
            (CollectorAuthStatusKind::NeedsLogin, None)
        }
        vrcx_0_application_core::BackendRuntimeAuthStatus::Authenticated => {
            (CollectorAuthStatusKind::Authenticating, None)
        }
    };
    CollectorAuthStatus {
        status,
        user_id: nonempty(snapshot.auth_user_id),
        display_name: nonempty(snapshot.auth_display_name),
        methods: Vec::new(),
        attempt_id: None,
        mode: None,
        error,
        collector_ready: false,
    }
}

fn status_from_login_state(state: &ApiState, login: LoginSessionState) -> CollectorAuthStatus {
    match login {
        LoginSessionState::Authenticated { session, .. } => {
            let mut status = current_auth_status(state);
            status.status = CollectorAuthStatusKind::Ready;
            status.user_id = nonempty(session.user_id);
            status.display_name = nonempty(session.display_name);
            status.collector_ready = true;
            status
        }
        LoginSessionState::Challenge {
            attempt_id,
            methods,
            mode,
            error,
        } => CollectorAuthStatus {
            status: CollectorAuthStatusKind::AwaitingTwoFactor,
            user_id: None,
            display_name: None,
            methods: methods
                .iter()
                .map(|method| method.as_str().to_owned())
                .collect(),
            attempt_id: Some(attempt_id),
            mode: Some(mode.as_str().to_owned()),
            error: error.map(|_| "Verification failed. Try again.".to_owned()),
            collector_ready: false,
        },
        LoginSessionState::Failed { kind, .. } => CollectorAuthStatus {
            status: CollectorAuthStatusKind::Error,
            user_id: None,
            display_name: None,
            methods: Vec::new(),
            attempt_id: None,
            mode: None,
            error: Some(safe_login_error(kind).to_owned()),
            collector_ready: false,
        },
        LoginSessionState::Cancelled => current_auth_status(state),
    }
}

fn safe_login_error(kind: LoginFailureKind) -> &'static str {
    match kind {
        LoginFailureKind::InvalidCredentials => "The username or password was rejected.",
        LoginFailureKind::MissingCredentials => "Enter a username and password.",
        LoginFailureKind::SessionInvalidated => "The VRChat session is no longer valid.",
        LoginFailureKind::TwoFactorUnavailable => {
            "The requested verification method is unavailable."
        }
        LoginFailureKind::Network => "Could not reach VRChat to complete sign-in.",
        LoginFailureKind::Other => "VRChat sign-in failed. Check the server logs for details.",
    }
}

fn nonempty(value: String) -> Option<String> {
    (!value.is_empty()).then_some(value)
}

async fn import_vrcx(State(state): State<ApiState>, headers: HeaderMap, body: Body) -> Response {
    if !has_valid_bearer(&headers, &state.bearer_token) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let Some(owner_user_id) = request_user_id(&headers) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let Some(content_type) = headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
    else {
        return StatusCode::UNSUPPORTED_MEDIA_TYPE.into_response();
    };
    if !content_type.split(';').next().is_some_and(|media_type| {
        media_type
            .trim()
            .eq_ignore_ascii_case("application/vnd.sqlite3")
    }) {
        return StatusCode::UNSUPPORTED_MEDIA_TYPE.into_response();
    }
    if headers
        .get(header::CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
        .is_some_and(|length| length > MAX_IMPORT_BYTES)
    {
        return StatusCode::PAYLOAD_TOO_LARGE.into_response();
    }

    let Ok(import_guard) = Arc::clone(&state.import_lock).try_lock_owned() else {
        return StatusCode::CONFLICT.into_response();
    };
    let work_dir = state.data_dir.join(format!(".import-{}", Uuid::new_v4()));
    if let Err(error) = create_private_dir(&work_dir) {
        tracing::error!(error = %error, "could not create remote import work directory");
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    }
    let workspace = ImportWorkspace::new(work_dir.clone());
    let snapshot_path = work_dir.join("snapshot.sqlite");
    let digest = match write_import_body(body, &snapshot_path).await {
        Ok(digest) => digest,
        Err(UploadError::TooLarge) => return StatusCode::PAYLOAD_TOO_LARGE.into_response(),
        Err(UploadError::Invalid) => return StatusCode::BAD_REQUEST.into_response(),
        Err(UploadError::Io(error)) => {
            tracing::error!(error = %error, "could not store remote database import");
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    };

    let database = Arc::clone(&state.database);
    let work = tokio::spawn(async move {
        let _guard = import_guard;
        tokio::task::spawn_blocking(move || {
            let result =
                validate_normalize_and_merge(database, &snapshot_path, &digest, &owner_user_id);
            drop(workspace);
            result
        })
        .await
    });
    match work.await {
        Ok(Ok(Ok(counts))) => Json(counts).into_response(),
        Ok(Ok(Err(ImportFailure::Invalid(_error)))) => {
            tracing::warn!("remote VRCX database import was rejected");
            StatusCode::UNPROCESSABLE_ENTITY.into_response()
        }
        Ok(Ok(Err(ImportFailure::Failed(_error)))) => {
            tracing::error!("remote VRCX database import failed");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
        Ok(Err(_error)) => {
            tracing::error!("remote VRCX database import worker failed");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
        Err(_error) => {
            tracing::error!("remote VRCX database import task failed");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

#[derive(Debug)]
enum UploadError {
    TooLarge,
    Invalid,
    Io(io::Error),
}

async fn write_import_body(body: Body, path: &Path) -> Result<String, UploadError> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let file = options.open(path).map_err(UploadError::Io)?;
    let mut file = tokio::fs::File::from_std(file);
    let mut stream = body.into_data_stream();
    let mut hasher = Sha256::new();
    let mut bytes_written = 0_u64;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| UploadError::Invalid)?;
        bytes_written = bytes_written
            .checked_add(chunk.len() as u64)
            .ok_or(UploadError::TooLarge)?;
        if bytes_written > MAX_IMPORT_BYTES {
            return Err(UploadError::TooLarge);
        }
        hasher.update(&chunk);
        file.write_all(&chunk).await.map_err(UploadError::Io)?;
    }
    if bytes_written == 0 {
        return Err(UploadError::Invalid);
    }
    file.sync_all().await.map_err(UploadError::Io)?;
    let digest = hasher.finalize();
    Ok(hex_digest(&digest))
}

fn validate_normalize_and_merge(
    target_database: Arc<DatabaseService>,
    snapshot_path: &Path,
    original_snapshot_sha256: &str,
    owner_user_id: &str,
) -> Result<RemoteLegacyImportCounts, ImportFailure> {
    validate_legacy_snapshot(snapshot_path).map_err(ImportFailure::Invalid)?;
    let imported_database = Arc::new(
        DatabaseService::new(snapshot_path)
            .map_err(|error| ImportFailure::Invalid(error.to_string()))?,
    );
    let upgrade_store = LocalDatabaseUpgradeStore::new(Arc::clone(&imported_database));
    let upgrade = run_database_upgrade(&upgrade_store);
    if !matches!(
        upgrade.status,
        DatabaseUpgradeRunStatus::Current | DatabaseUpgradeRunStatus::Upgraded
    ) {
        let detail = upgrade
            .error
            .unwrap_or_else(|| format!("normalization stopped at {:?}", upgrade.status));
        return Err(ImportFailure::Invalid(detail));
    }
    drop(upgrade_store);
    drop(imported_database);

    let counts = merge_remote_legacy(
        &target_database,
        snapshot_path,
        original_snapshot_sha256,
        owner_user_id,
    )
    .map_err(|error| ImportFailure::Failed(error.to_string()))?;
    vrcx_0_persistence::config::set_bool(&target_database, REMOTE_LEGACY_IMPORT_COMPLETE_KEY, true)
        .map_err(|error| ImportFailure::Failed(error.to_string()))?;
    Ok(counts)
}

fn validate_legacy_snapshot(path: &Path) -> Result<(), String> {
    let connection = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|error| format!("uploaded file is not a readable SQLite database: {error}"))?;
    let mut check = connection
        .prepare("PRAGMA quick_check")
        .map_err(|error| format!("SQLite integrity check failed: {error}"))?;
    let rows = check
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| format!("SQLite integrity check failed: {error}"))?;
    let mut found_result = false;
    for row in rows {
        let row = row.map_err(|error| format!("SQLite integrity check failed: {error}"))?;
        if row != "ok" {
            return Err("uploaded database failed SQLite integrity check".into());
        }
        found_result = true;
    }
    if !found_result {
        return Err("uploaded database returned no SQLite integrity result".into());
    }

    let has_configs: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'configs')",
            [],
            |row| row.get(0),
        )
        .map_err(|error| format!("uploaded file is not a VRCX database: {error}"))?;
    if !has_configs {
        return Err("uploaded file is not a VRCX database".into());
    }
    let version_values = connection
        .prepare(
            "SELECT value FROM configs
             WHERE lower(key) IN (
                 'config:databaseversion',
                 'config:vrcx_databaseversion',
                 'databaseversion'
             )",
        )
        .map_err(|error| format!("could not read uploaded database schema version: {error}"))?
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| format!("could not read uploaded database schema version: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("could not read uploaded database schema version: {error}"))?;
    for value in version_values {
        let version = value
            .trim()
            .parse::<i64>()
            .map_err(|_| "uploaded VRCX schema version is invalid".to_owned())?;
        if !(0..=MAX_UPSTREAM_SCHEMA_VERSION).contains(&version) {
            return Err(format!(
                "uploaded VRCX schema version {version} is not supported (maximum {MAX_UPSTREAM_SCHEMA_VERSION})"
            ));
        }
    }
    Ok(())
}

fn create_private_dir(path: &Path) -> io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        let mut builder = fs::DirBuilder::new();
        builder.mode(0o700).create(path)
    }
    #[cfg(not(unix))]
    {
        fs::create_dir(path)
    }
}

struct ImportWorkspace(PathBuf);

impl ImportWorkspace {
    fn new(path: PathBuf) -> Self {
        Self(path)
    }
}

impl Drop for ImportWorkspace {
    fn drop(&mut self) {
        if let Err(error) = fs::remove_dir_all(&self.0) {
            if error.kind() != io::ErrorKind::NotFound {
                tracing::warn!(error = %error, "could not clean remote database import workspace");
            }
        }
    }
}

enum ImportFailure {
    Invalid(String),
    Failed(String),
}

fn hex_digest(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut digest = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        digest.push(HEX[(byte >> 4) as usize] as char);
        digest.push(HEX[(byte & 0x0f) as usize] as char);
    }
    digest
}

async fn wait_for_shutdown(mut shutdown: watch::Receiver<bool>) {
    if *shutdown.borrow() {
        return;
    }
    let _ = shutdown.changed().await;
}

async fn database_rpc(
    State(state): State<ApiState>,
    headers: HeaderMap,
    request: Result<Json<DatabaseRpcRequest>, axum::extract::rejection::JsonRejection>,
) -> Response {
    if !has_valid_bearer(&headers, &state.bearer_token) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let Ok(Json(request)) = request else {
        return StatusCode::BAD_REQUEST.into_response();
    };

    let database = Arc::clone(&state.database);
    match tokio::task::spawn_blocking(move || database.handle_remote_request(request)).await {
        Ok(Ok(response)) => Json(response).into_response(),
        Ok(Err(_error)) => {
            tracing::warn!("database RPC request failed");
            StatusCode::BAD_REQUEST.into_response()
        }
        Err(_error) => {
            tracing::error!("database RPC worker failed");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

fn has_valid_bearer(headers: &HeaderMap, expected: &str) -> bool {
    let mut authorization_values = headers.get_all(header::AUTHORIZATION).iter();
    let Some(value) = authorization_values
        .next()
        .and_then(|value| value.to_str().ok())
    else {
        return false;
    };
    if authorization_values.next().is_some() {
        return false;
    }
    let Some(token) = value.strip_prefix("Bearer ") else {
        return false;
    };
    tokens_match(token, expected)
}

fn request_user_id(headers: &HeaderMap) -> Option<String> {
    let mut values = headers.get_all("x-vrcx-user-id").iter();
    let value = values.next()?.to_str().ok()?;
    if values.next().is_some() || value.trim() != value || !value.starts_with("usr_") {
        return None;
    }
    let suffix = value.strip_prefix("usr_")?;
    if suffix.is_empty()
        || !suffix
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        || vrcx_0_persistence::realtime::normalize_user_table_prefix(value).is_err()
    {
        return None;
    }
    Some(value.to_owned())
}

fn is_bearer_token_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || b"-._~+/=".contains(&byte)
}

fn is_placeholder_token(token: &str) -> bool {
    let normalized = token.to_ascii_lowercase();
    matches!(
        normalized.as_str(),
        "change-me"
            | "changeme"
            | "replace-me"
            | "replace-with-a-long-random-secret"
            | "your-token"
            | "token"
    )
}
