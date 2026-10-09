use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::Duration;

use serde_json::Value;
use tokio::sync::mpsc;
use tracing_subscriber::filter::LevelFilter;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::Layer;
mod database_api;

use database_api::DatabaseApi;
use vrcx_0_application::profile::{run_database_upgrade, DatabaseUpgradeRunStatus};
use vrcx_0_application_core::{
    format_runtime_output_event, recommended_tokio_max_blocking_threads,
    recommended_tokio_worker_threads, BackendRuntimeTelemetry, BackendRuntimeTelemetryKind,
    RuntimeEventPayload, RuntimeEventSink, RuntimeOutputLevel, RuntimeOutputLine,
    RuntimeOutputMode, RuntimeTask, RuntimeTaskExecutor, RuntimeTaskHandle,
    RuntimeVrchatAuthFailurePayload,
};
use vrcx_0_composition::{
    CliLoginPrompt, CliTwoFactorChoice, RuntimeHostOptions, RuntimeHostProfile, RuntimeHostState,
};
use vrcx_0_outbound_adapters::LocalDatabaseUpgradeStore;
use vrcx_0_platform::app_paths::resolve_app_data_dir;
use vrcx_0_platform::error_log::{
    append_headless_error_log, default_app_data_dir, ErrorLogWriter, HEADLESS_ERROR_LOG_FILE,
};

fn main() -> ExitCode {
    build_adaptive_tokio_runtime().block_on(async_main())
}

fn build_adaptive_tokio_runtime() -> tokio::runtime::Runtime {
    let worker_threads = recommended_tokio_worker_threads();
    let max_blocking_threads = recommended_tokio_max_blocking_threads();
    tokio::runtime::Builder::new_multi_thread()
        .worker_threads(worker_threads)
        .max_blocking_threads(max_blocking_threads)
        .thread_name("vrcx-0-headless")
        .enable_all()
        .build()
        .expect("failed to build headless async runtime")
}

async fn async_main() -> ExitCode {
    init_tls_crypto_provider();

    let args: Vec<String> = std::env::args().collect();
    let force_login = args.iter().any(|arg| arg == "--login" || arg == "-l");
    let cli_login_prompt: Option<Arc<dyn CliLoginPrompt>> =
        force_login.then(|| Arc::new(StdinLoginPrompt) as Arc<dyn CliLoginPrompt>);

    let app_data_dir = match resolve_app_data_dir() {
        Ok(resolution) => {
            init_tracing(Some(resolution.current_dir.clone()));
            resolution
        }
        Err(error) => {
            let fallback_app_data = default_app_data_dir();
            init_tracing(fallback_app_data.clone());
            report_headless_error(
                fallback_app_data.as_deref(),
                "headless:data-dir",
                format!("headless data directory setup failed: {error}"),
            );
            return ExitCode::from(1);
        }
    };

    let state = match RuntimeHostState::new(RuntimeHostOptions {
        realtime_origin: "http://localhost:9000".into(),
        launched_from_autostart: false,
        app_data_dir: app_data_dir.clone(),
        app_version: product_app_version(),
        profile: RuntimeHostProfile::HeadlessData,
        database_maintenance_cache_dir: None,
        task_executor: Some(Arc::new(TokioRuntimeTaskExecutor)),
    }) {
        Ok(state) => Arc::new(state),
        Err(error) => {
            report_headless_error(
                Some(&app_data_dir.current_dir),
                "headless:startup",
                format!("headless startup failed: {error}"),
            );
            return ExitCode::from(1);
        }
    };

    let db_for_upgrade = Arc::clone(state.database());
    let upgrade = match tokio::task::spawn_blocking(move || {
        let store = LocalDatabaseUpgradeStore::new(db_for_upgrade);
        run_database_upgrade(&store)
    })
    .await
    {
        Ok(result) => result,
        Err(error) => {
            report_headless_error(
                Some(&app_data_dir.current_dir),
                "headless:database-upgrade",
                format!("database upgrade worker failed: {error}"),
            );
            return ExitCode::from(1);
        }
    };
    if !matches!(
        upgrade.status,
        DatabaseUpgradeRunStatus::Current | DatabaseUpgradeRunStatus::Upgraded
    ) {
        let detail = upgrade
            .error
            .as_deref()
            .unwrap_or("the database schema is not ready for serving");
        report_headless_error(
            Some(&app_data_dir.current_dir),
            "headless:database-upgrade",
            format!(
                "database upgrade did not complete ({:?}): {detail}",
                upgrade.status
            ),
        );
        return ExitCode::from(1);
    }

    let (auth_failure_tx, mut auth_failure_rx) = mpsc::unbounded_channel();
    let console_sink =
        ConsoleRuntimeEventSink::new(auth_failure_tx, app_data_dir.current_dir.clone());
    state.set_event_sink(console_sink.clone());

    if force_login {
        return match state.start_headless_backend_runtime(cli_login_prompt).await {
            Ok(_) => {
                println!("VRChat login saved. Start the headless service to begin collection.");
                shutdown_runtime(&state, "login-complete");
                ExitCode::SUCCESS
            }
            Err(error) => {
                report_headless_error(
                    Some(&app_data_dir.current_dir),
                    "headless:login",
                    format!("headless login failed: {error}"),
                );
                shutdown_runtime(&state, "login-failed");
                ExitCode::from(1)
            }
        };
    }

    let (database_api, database_api_address) = match DatabaseApi::bind(
        Arc::clone(state.database()),
        app_data_dir.current_dir.clone(),
        Arc::clone(&state),
    )
    .await
    {
        Ok(api) => api,
        Err(error) => {
            report_headless_error(
                Some(&app_data_dir.current_dir),
                "headless:database-api",
                format!("database API startup failed: {error}"),
            );
            return ExitCode::from(1);
        }
    };
    let (shutdown_tx, shutdown_rx) = tokio::sync::watch::channel(false);
    let auth_retry_pause = database_api.auth_retry_pause();
    let auth_retry_lock = database_api.auth_retry_lock();
    let _startup_auth_guard = auth_retry_lock.lock().await;
    auth_retry_pause.store(true, std::sync::atomic::Ordering::Release);
    let mut database_api_task = tokio::spawn(database_api.serve(shutdown_rx));
    println!("authenticated database API listening at http://{database_api_address}/api/database");

    let initial_login = state.start_headless_backend_runtime(None).await;
    auth_retry_pause.store(false, std::sync::atomic::Ordering::Release);
    drop(_startup_auth_guard);
    let login_retry_task = Some(spawn_login_retry(
        Arc::clone(&state),
        Arc::clone(&auth_retry_pause),
        Arc::clone(&auth_retry_lock),
    ));
    if initial_login.is_err() {
        tracing::info!("waiting for a VRChat account login; the database API is ready");
        eprintln!("No active VRChat login yet. Use the desktop app's collector login or run `vrcx-0-headless --login`; collection will start automatically after the server session is authenticated.");
    }
    println!("headless service is running. Press Ctrl+C to stop.");
    let exit_code = loop {
        tokio::select! {
            signal = shutdown_signal() => break match signal {
                Ok(reason) => {
                    console_sink.begin_shutdown();
                    shutdown_runtime(&state, reason);
                    ExitCode::SUCCESS
                }
                Err(error) => {
                    report_headless_error(
                        Some(&app_data_dir.current_dir),
                        "headless:signal",
                        format!("failed to wait for shutdown signal: {error}"),
                    );
                    console_sink.begin_shutdown();
                    shutdown_runtime(&state, "signal-error");
                    ExitCode::from(1)
                }
            },
            auth_failure = auth_failure_rx.recv() => {
                let Some(failure) = auth_failure else {
                    tracing::error!("headless auth-failure event channel closed");
                    break ExitCode::from(1);
                };
                let _auth_guard = auth_retry_lock.lock().await;
                if auth_retry_pause.load(std::sync::atomic::Ordering::Acquire) {
                    continue;
                }
                let session = state.authenticated_session_projection().session;
                let is_current_session = session.as_ref().is_some_and(|session| {
                    session.user_id == failure.owner_user_id.as_str()
                        && session.auth_scope_generation == failure.auth_scope_generation
                });
                if is_current_session {
                    auth_retry_pause.store(true, std::sync::atomic::Ordering::Release);
                    tracing::warn!("VRChat rejected the headless collector session; checking saved server auth");
                    let snapshot = state.recover_background_auth_after_failure(failure.reason).await;
                    let still_needs_login = snapshot.auth_status
                        != vrcx_0_application_core::BackendRuntimeAuthStatus::Authenticated;
                    auth_retry_pause.store(false, std::sync::atomic::Ordering::Release);
                    if still_needs_login {
                        tracing::info!("headless collector needs a new VRChat login; database API remains available");
                    }
                }
            }
            server = &mut database_api_task => {
                report_headless_error(
                    Some(&app_data_dir.current_dir),
                    "headless:database-api",
                    format!("database API stopped unexpectedly: {server:?}"),
                );
                console_sink.begin_shutdown();
                shutdown_runtime(&state, "database-api-stopped");
                break ExitCode::from(1)
            }
        }
    };

    let _ = shutdown_tx.send(true);
    if let Some(task) = login_retry_task {
        task.abort();
    }
    let _ = tokio::time::timeout(Duration::from_secs(5), &mut database_api_task).await;
    exit_code
}

fn spawn_login_retry(
    state: Arc<RuntimeHostState>,
    auth_retry_pause: Arc<std::sync::atomic::AtomicBool>,
    auth_retry_lock: Arc<tokio::sync::Mutex<()>>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(30)).await;
            let _guard = auth_retry_lock.lock().await;
            if auth_retry_pause.load(std::sync::atomic::Ordering::Acquire) {
                continue;
            }
            let snapshot = state.backend_runtime().snapshot();
            if snapshot.phase == vrcx_0_application_core::BackendRuntimePhase::Running
                && snapshot.auth_status
                    == vrcx_0_application_core::BackendRuntimeAuthStatus::Authenticated
            {
                continue;
            }
            auth_retry_pause.store(true, std::sync::atomic::Ordering::Release);
            match state.start_headless_backend_runtime(None).await {
                Ok(_) => {
                    tracing::info!("headless collector authenticated and started");
                    println!(
                        "VRChat credentials are available; friend activity collection started."
                    );
                }
                Err(_) => tracing::debug!("VRChat login is not ready; retrying in 30 seconds"),
            }
            auth_retry_pause.store(false, std::sync::atomic::Ordering::Release);
        }
    })
}

async fn shutdown_signal() -> Result<&'static str, std::io::Error> {
    #[cfg(unix)]
    {
        let mut terminate =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?;
        tokio::select! {
            result = tokio::signal::ctrl_c() => result.map(|()| "ctrl-c"),
            _ = terminate.recv() => Ok("sigterm"),
        }
    }
    #[cfg(not(unix))]
    {
        tokio::signal::ctrl_c().await.map(|()| "ctrl-c")
    }
}

fn shutdown_runtime(state: &RuntimeHostState, reason: &str) {
    state.stop_backend_runtime(reason);
    state.stop_runtime_tasks();
}

fn product_app_version() -> String {
    const TAURI_CONFIG: &str = include_str!("../../../src-tauri/tauri.conf.json");
    serde_json::from_str::<Value>(TAURI_CONFIG)
        .ok()
        .and_then(|value| {
            value
                .get("version")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|version| !version.is_empty())
                .map(ToOwned::to_owned)
        })
        .unwrap_or_else(|| env!("CARGO_PKG_VERSION").into())
}

struct StdinLoginPrompt;

impl CliLoginPrompt for StdinLoginPrompt {
    fn prompt_username(&self) -> std::io::Result<String> {
        print!("Username/Email: ");
        std::io::Write::flush(&mut std::io::stdout())?;
        let mut username = String::new();
        std::io::stdin().read_line(&mut username)?;
        Ok(username.trim().to_string())
    }

    fn prompt_password(&self) -> std::io::Result<String> {
        rpassword::prompt_password("Password: ")
    }

    fn prompt_two_factor(&self, methods: &[String]) -> std::io::Result<CliTwoFactorChoice> {
        println!("2FA is required. Select an authentication method:");
        for (index, method) in methods.iter().enumerate() {
            println!("{}: {}", index + 1, method);
        }
        print!("Selection [1]: ");
        std::io::Write::flush(&mut std::io::stdout())?;

        let mut selection = String::new();
        std::io::stdin().read_line(&mut selection)?;
        let selection = selection.trim();
        let method_index = if selection.is_empty() {
            0
        } else {
            selection.parse::<usize>().unwrap_or(1).saturating_sub(1)
        };

        let method = methods
            .get(method_index)
            .or_else(|| methods.first())
            .cloned()
            .unwrap_or_default();
        let code = rpassword::prompt_password(format!("Enter {method} code: "))?;
        Ok(CliTwoFactorChoice { method, code })
    }
}

fn init_tls_crypto_provider() {
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
}

fn init_tracing(app_data: Option<PathBuf>) {
    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| "vrcx_0=info".into());
    let Some(app_data) = app_data else {
        tracing_subscriber::fmt()
            .with_env_filter(filter)
            .with_target(false)
            .init();
        return;
    };

    let tracing_app_data = app_data;
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::fmt::layer()
                .with_target(false)
                .with_filter(filter),
        )
        .with(
            tracing_subscriber::fmt::layer()
                .with_ansi(false)
                .with_writer(move || {
                    ErrorLogWriter::with_file_name(
                        tracing_app_data.clone(),
                        HEADLESS_ERROR_LOG_FILE,
                    )
                })
                .with_filter(LevelFilter::ERROR),
        )
        .init();
}

fn report_headless_error(app_data: Option<&Path>, source: &str, message: impl AsRef<str>) {
    let message = message.as_ref();
    eprintln!("{message}");
    if let Some(app_data) = app_data {
        append_headless_error_log(app_data, source, message);
    }
}

#[derive(Clone)]
struct ConsoleRuntimeEventSink {
    auth_failure_tx: mpsc::UnboundedSender<RuntimeVrchatAuthFailurePayload>,
    app_data: PathBuf,
    shutdown_started: Arc<AtomicBool>,
    output_lock: Arc<Mutex<()>>,
}

impl ConsoleRuntimeEventSink {
    fn new(
        auth_failure_tx: mpsc::UnboundedSender<RuntimeVrchatAuthFailurePayload>,
        app_data: PathBuf,
    ) -> Self {
        Self {
            auth_failure_tx,
            app_data,
            shutdown_started: Arc::new(AtomicBool::new(false)),
            output_lock: Arc::new(Mutex::new(())),
        }
    }

    fn begin_shutdown(&self) {
        self.shutdown_started.store(true, Ordering::Release);
        let _guard = self
            .output_lock
            .lock()
            .unwrap_or_else(|error| error.into_inner());
    }
}

impl RuntimeEventSink for ConsoleRuntimeEventSink {
    fn emit(&self, event: &str, payload: Value) {
        if event == RuntimeVrchatAuthFailurePayload::EVENT_NAME {
            if let Ok(failure) =
                serde_json::from_value::<RuntimeVrchatAuthFailurePayload>(payload.clone())
            {
                let _ = self.auth_failure_tx.send(failure);
            }
        }
        let allow_during_shutdown = is_runtime_stopped_event(event, &payload);
        let _guard = self
            .output_lock
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if self.shutdown_started.load(Ordering::Acquire) && !allow_during_shutdown {
            return;
        }

        let Some(output) =
            format_runtime_output_event(RuntimeOutputMode::Headless, event, &payload)
        else {
            return;
        };
        self.print_output(allow_during_shutdown, output);
    }
}

impl ConsoleRuntimeEventSink {
    fn print_output(&self, allow_during_shutdown: bool, output: RuntimeOutputLine) {
        if self.shutdown_started.load(Ordering::Acquire) && !allow_during_shutdown {
            return;
        }
        match output.level {
            RuntimeOutputLevel::Info => println!("{}", output.message),
            RuntimeOutputLevel::Warn => eprintln!("{}", output.message),
            RuntimeOutputLevel::Error => {
                eprintln!("{}", output.message);
                self.append_headless_error_log("headless:event", &output.message);
            }
        }
    }

    fn append_headless_error_log(&self, source: &str, message: &str) {
        append_headless_error_log(&self.app_data, source, message);
    }
}

#[derive(Clone)]
struct TokioRuntimeTaskExecutor;

struct TokioRuntimeTaskHandle(tokio::task::JoinHandle<()>);

impl RuntimeTaskExecutor for TokioRuntimeTaskExecutor {
    fn spawn(&self, task: RuntimeTask) -> Box<dyn RuntimeTaskHandle> {
        Box::new(TokioRuntimeTaskHandle(tokio::spawn(task)))
    }
}

impl RuntimeTaskHandle for TokioRuntimeTaskHandle {
    fn abort(&self) {
        self.0.abort();
    }

    fn is_finished(&self) -> bool {
        self.0.is_finished()
    }

    fn join_or_abort(&mut self, timeout: Duration) {
        if self.is_finished() {
            let _ = block_on_runtime_task(&mut self.0);
            return;
        }

        let Some(joined) =
            block_on_runtime_task(async { tokio::time::timeout(timeout, &mut self.0).await })
        else {
            self.0.abort();
            return;
        };
        if joined.is_ok() {
            return;
        }

        self.0.abort();
        let _ = block_on_runtime_task(async {
            tokio::time::timeout(Duration::from_millis(50), &mut self.0).await
        });
    }
}

fn block_on_runtime_task<F>(future: F) -> Option<F::Output>
where
    F: std::future::Future,
{
    match tokio::runtime::Handle::try_current() {
        Ok(handle) if handle.runtime_flavor() == tokio::runtime::RuntimeFlavor::MultiThread => {
            Some(tokio::task::block_in_place(|| handle.block_on(future)))
        }
        Ok(_) => None,
        Err(_) => None,
    }
}

fn is_runtime_stopped_event(event: &str, payload: &Value) -> bool {
    if event != BackendRuntimeTelemetry::EVENT_NAME {
        return false;
    }
    serde_json::from_value::<BackendRuntimeTelemetry>(payload.clone())
        .ok()
        .is_some_and(|telemetry| telemetry.kind == BackendRuntimeTelemetryKind::RuntimeStopped)
}
