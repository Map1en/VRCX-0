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
use vrcx_0_application_core::{
    format_runtime_output_event, recommended_tokio_max_blocking_threads,
    recommended_tokio_worker_threads, BackendRuntimeMode, RuntimeEventSink, RuntimeOutputLevel,
    RuntimeOutputLine, RuntimeOutputMode, RuntimeTask, RuntimeTaskExecutor, RuntimeTaskHandle,
};
use vrcx_0_host::app_paths::resolve_app_data_dir;
use vrcx_0_host::error_log::{
    append_headless_error_log, default_app_data_dir, ErrorLogWriter, HEADLESS_ERROR_LOG_FILE,
};
use vrcx_0_runtime_host::{
    CliLoginPrompt, CliTwoFactorChoice, RuntimeHostOptions, RuntimeHostProfile, RuntimeHostState,
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
    }) {
        Ok(state) => state,
        Err(error) => {
            report_headless_error(
                Some(&app_data_dir.current_dir),
                "headless:startup",
                format!("headless startup failed: {error}"),
            );
            return ExitCode::from(1);
        }
    };

    let (fatal_tx, mut fatal_rx) = mpsc::unbounded_channel();
    let console_sink = ConsoleRuntimeEventSink::new(fatal_tx, app_data_dir.current_dir.clone());
    state.set_event_sink(console_sink.clone());
    state
        .runtime_context
        .tasks
        .set_executor(TokioRuntimeTaskExecutor);

    match state
        .start_backend_runtime(BackendRuntimeMode::Headless, cli_login_prompt)
        .await
    {
        Ok(_) => {}
        Err(error) => {
            report_headless_error(
                Some(&app_data_dir.current_dir),
                "headless:login",
                format!("headless login failed: {error}"),
            );
            return ExitCode::from(1);
        }
    }
    println!("headless runtime is running. Press Ctrl+C to stop.");
    tokio::select! {
        signal = tokio::signal::ctrl_c() => {
            if let Err(error) = signal {
                report_headless_error(
                    Some(&app_data_dir.current_dir),
                    "headless:signal",
                    format!("failed to wait for Ctrl+C: {error}"),
                );
                console_sink.begin_shutdown();
                shutdown_runtime(&state, "signal-error");
                return ExitCode::from(1);
            }
            console_sink.begin_shutdown();
            shutdown_runtime(&state, "ctrl-c");
            ExitCode::SUCCESS
        }
        fatal = fatal_rx.recv() => {
            let reason = fatal.unwrap_or_else(|| "fatal runtime error".into());
            report_headless_error(
                Some(&app_data_dir.current_dir),
                "headless:fatal",
                format!("headless runtime fatal error: {reason}"),
            );
            console_sink.begin_shutdown();
            shutdown_runtime(&state, "fatal-error");
            ExitCode::from(1)
        }
    }
}

fn shutdown_runtime(state: &RuntimeHostState, reason: &str) {
    state.stop_backend_runtime(reason);
    state.runtime_context.tasks.stop_all();
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
    fatal_tx: mpsc::UnboundedSender<String>,
    app_data: PathBuf,
    shutdown_started: Arc<AtomicBool>,
    output_lock: Arc<Mutex<()>>,
}

impl ConsoleRuntimeEventSink {
    fn new(fatal_tx: mpsc::UnboundedSender<String>, app_data: PathBuf) -> Self {
        Self {
            fatal_tx,
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
        let fatal_reason = output.fatal_reason.clone();
        self.print_output(allow_during_shutdown, output);
        if let Some(reason) = fatal_reason {
            let _ = self.fatal_tx.send(reason);
        }
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

fn string_field(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn is_runtime_stopped_event(event: &str, payload: &Value) -> bool {
    event == "backendRuntimeTelemetry" && string_field(payload, "kind") == "runtimeStopped"
}
