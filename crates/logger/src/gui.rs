use std::cell::RefCell;
use std::io::Cursor;
use std::net::{IpAddr, Ipv4Addr, SocketAddr, UdpSocket};
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::rc::Rc;
use std::sync::Arc;
use std::time::Duration;

use slint::{ModelRc, SharedString, Timer, TimerMode, VecModel};
use tokio::runtime::Runtime;
use tokio::sync::oneshot;
use tray_icon::{Icon, MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use vrcx_0_logger_protocol::wire::{SessionState, StatusResponse};

use crate::app::{App, LOGGER_VERSION};
use crate::config::{
    Config, DATA_DIR_ENV, DEFAULT_HOST, DEFAULT_MAX_STORAGE_MB, DEFAULT_PORT, HOST_ENV,
    MAX_STORAGE_MB_ENV, PASSWORD_ENV, PORT_ENV, RETENTION_DAYS_ENV,
};

slint::slint! {
    import { Button, LineEdit, Palette, ScrollView, VerticalBox } from "std-widgets.slint";

    export struct Row { label: string, value: string }
    export struct Field { label: string, value: string, hint: string, secret: bool }

    export component LoggerWindow inherits Window {
        title: "VRCX-0 Self-hosted Recorder";
        preferred-width: 560px;
        preferred-height: 620px;
        in property <string> address;
        in property <[Row]> rows;
        in property <[string]> errors;
        in property <[Field]> fields;
        in property <bool> changed;
        in property <bool> password-changed;
        in property <bool> has-tray;
        in-out property <bool> show-password;
        callback edited(int, string);
        callback save();
        callback discard();
        callback minimize-to-tray();

        ScrollView {
            VerticalBox {
                alignment: start;
                HorizontalLayout {
                    Text { text: "Status"; font-size: 18px; font-weight: 600; horizontal-stretch: 1; vertical-alignment: center; }
                    if root.has-tray: Button { text: "Minimize to tray"; clicked => { root.minimize-to-tray(); } }
                }
                for row in root.rows: HorizontalLayout {
                    spacing: 16px;
                    Text { text: row.label; width: 150px; }
                    Text { text: row.value; wrap: word-wrap; horizontal-stretch: 1; }
                }
                if root.address != "": HorizontalLayout {
                    spacing: 16px;
                    Text { text: "Address for VRCX-0"; width: 150px; vertical-alignment: center; }
                    LineEdit { text: root.address; read-only: true; }
                }
                for error in root.errors: Text { text: error; color: #d13438; wrap: word-wrap; }
                Rectangle { height: 1px; background: Palette.border; }
                Text { text: "Settings"; font-size: 18px; font-weight: 600; }
                for field[index] in root.fields: HorizontalLayout {
                    spacing: 16px;
                    Text { text: field.label; width: 150px; vertical-alignment: center; }
                    LineEdit {
                        text: field.value;
                        placeholder-text: field.hint;
                        input-type: field.secret && !root.show-password ? InputType.password : InputType.text;
                        edited(text) => { root.edited(index, text); }
                    }
                    if field.secret: Button {
                        text: root.show-password ? "Hide" : "Show";
                        clicked => { root.show-password = !root.show-password; }
                    }
                }
                if root.password-changed: Text {
                    text: "Changing the password discards records VRCX-0 has not backfilled yet. Reconnect VRCX-0 with the new password afterwards.";
                    color: #c87800;
                    wrap: word-wrap;
                }
                HorizontalLayout {
                    alignment: start;
                    spacing: 8px;
                    Button { text: "Save and restart"; enabled: root.changed; clicked => { root.save(); } }
                    Button { text: "Discard changes"; enabled: root.changed; clicked => { root.discard(); } }
                }
                Text {
                    text: "Your VRChat account is set in VRCX-0 under Tools → Self-hosted Recorder.\nRecording stops when this window is closed.";
                    color: Palette.foreground.transparentize(40%);
                    wrap: word-wrap;
                }
            }
        }
    }
}

const APP_DIR: &str = "VRCX-0 Logger";
const SETTINGS_FILE: &str = "logger.env";
const TRAY_ICON_PNG: &[u8] = include_bytes!("../../../src-tauri/icons/32x32.png");
const POLL_INTERVAL: Duration = Duration::from_secs(2);
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(5);
const PASSWORD_LENGTH: usize = 20;
const PASSWORD_ALPHABET: &[u8; 64] =
    b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const FIELDS: [(&str, &str, &str); 6] = [
    (PASSWORD_ENV, "Password", ""),
    (HOST_ENV, "Listen address", ""),
    (PORT_ENV, "Port", ""),
    (DATA_DIR_ENV, "Data folder", ""),
    (RETENTION_DAYS_ENV, "Keep for (days)", "Unlimited"),
    (MAX_STORAGE_MB_ENV, "Storage limit (MB)", "0 = unlimited"),
];

struct Running {
    runtime: Runtime,
    app: Arc<App>,
    bind: SocketAddr,
    shutdown: oneshot::Sender<()>,
}

impl Running {
    fn start(config: &Config) -> Result<Self, String> {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .map_err(|error| error.to_string())?;
        let (app, listener) = runtime.block_on(crate::start(config))?;
        let (shutdown, stopped) = oneshot::channel::<()>();
        runtime.spawn(crate::serve(app.clone(), listener, async move {
            let _ = stopped.await;
        }));
        Ok(Self {
            runtime,
            app,
            bind: config.bind,
            shutdown,
        })
    }

    fn stop(self) {
        let _ = self.shutdown.send(());
        drop(self.app);
        self.runtime.shutdown_timeout(SHUTDOWN_TIMEOUT);
    }
}

struct State {
    path: PathBuf,
    values: Vec<String>,
    saved: Vec<String>,
    running: Option<Running>,
    error: Option<String>,
    lan_ip: Option<IpAddr>,
}

impl State {
    fn load() -> Self {
        let dir = std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_default()
            .join(APP_DIR);
        let mut state = Self {
            path: dir.join(SETTINGS_FILE),
            values: vec![String::new(); FIELDS.len()],
            saved: vec![String::new(); FIELDS.len()],
            running: None,
            error: None,
            lan_ip: lan_ip(),
        };
        let loaded = load_values(&state.path, &dir).and_then(|(values, fresh)| {
            if fresh {
                save_values(&state.path, &values)?;
            }
            Ok(values)
        });
        match loaded {
            Ok(values) => {
                state.values = values.clone();
                state.saved = values;
                state.restart();
            }
            Err(error) => state.error = Some(error),
        }
        state
    }

    fn restart(&mut self) {
        if let Some(running) = self.running.take() {
            running.stop();
        }
        match config_from(&self.values).and_then(|config| Running::start(&config)) {
            Ok(running) => {
                self.running = Some(running);
                self.error = None;
            }
            Err(error) => self.error = Some(error),
        }
    }

    fn save(&mut self) {
        if let Err(error) =
            config_from(&self.values).and_then(|_| save_values(&self.path, &self.values))
        {
            self.error = Some(error);
            return;
        }
        self.saved = self.values.clone();
        self.restart();
    }
}

fn config_from(values: &[String]) -> Result<Config, String> {
    Config::from_sources(
        |name| {
            FIELDS
                .iter()
                .position(|(key, _, _)| *key == name)
                .map(|index| values[index].clone())
        },
        |_| Err("unsupported".into()),
    )
}

fn show_fields(window: &LoggerWindow, state: &State) {
    let fields: Vec<Field> = FIELDS
        .iter()
        .zip(&state.values)
        .map(|((key, label, hint), value)| Field {
            label: (*label).into(),
            value: value.into(),
            hint: (*hint).into(),
            secret: *key == PASSWORD_ENV,
        })
        .collect();
    window.set_fields(ModelRc::new(VecModel::from(fields)));
    show_changes(window, state);
}

fn show_changes(window: &LoggerWindow, state: &State) {
    window.set_changed(state.values != state.saved);
    window.set_password_changed(state.values[0] != state.saved[0]);
}

fn show_status(window: &LoggerWindow, state: &State) {
    let status = state
        .running
        .as_ref()
        .map(|running| running.app.status().map_err(|error| error.to_string()));
    let address = state.running.as_ref().map(|running| {
        let ip = match running.bind.ip() {
            ip if ip.is_unspecified() => state.lan_ip.unwrap_or(ip),
            ip => ip,
        };
        format!("http://{ip}:{}", running.bind.port())
    });
    let ok = status.as_ref().and_then(|status| status.as_ref().ok());

    let mut rows = vec![Row {
        label: "Recorder".into(),
        value: match &state.running {
            Some(_) => format!("Running · v{LOGGER_VERSION}").into(),
            None => "Not running".into(),
        },
    }];
    if let Some(status) = ok {
        rows.extend(status_rows(status));
    }
    let errors: Vec<SharedString> = [
        state.error.clone(),
        status
            .as_ref()
            .and_then(|status| status.as_ref().err().cloned()),
        ok.and_then(|status| status.last_error.clone()),
        ok.and_then(|status| status.storage_error.clone()),
    ]
    .into_iter()
    .flatten()
    .map(SharedString::from)
    .collect();

    window.set_address(address.unwrap_or_default().into());
    window.set_rows(ModelRc::new(VecModel::from(rows)));
    window.set_errors(ModelRc::new(VecModel::from(errors)));
}

fn status_rows(status: &StatusResponse) -> Vec<Row> {
    let row = |label: &str, value: String| Row {
        label: label.into(),
        value: value.into(),
    };
    let mut rows = vec![
        row(
            "VRChat",
            match &status.session {
                SessionState::NoCredentials => "Not signed in. Sign in from VRCX-0.".into(),
                SessionState::LoggingIn => "Signing in…".into(),
                SessionState::Recording => "Recording".into(),
                SessionState::Reconnecting => "Reconnecting…".into(),
                SessionState::AwaitingTwoFactor { .. } => {
                    "Enter the two-factor code in VRCX-0".into()
                }
                SessionState::LoginFailed { reason } => format!("Sign-in failed: {reason}"),
            },
        ),
        row(
            "VRCX-0",
            if status.desktop_present {
                "Connected"
            } else {
                "Not connected"
            }
            .into(),
        ),
    ];
    if let Some(last_pull_at) = status.last_pull_at {
        rows.push(row("Last backfill", format_time(last_pull_at)));
    }
    rows.push(row(
        "Unsynced records",
        match (status.oldest_unsynced_at, status.newest_unsynced_at) {
            (Some(oldest), Some(newest)) => format!(
                "{} ({} – {})",
                status.unsynced_frames,
                format_time(oldest),
                format_time(newest)
            ),
            _ => status.unsynced_frames.to_string(),
        },
    ));
    rows.push(row(
        "Storage used",
        match status.retention_bytes {
            Some(limit) => format!(
                "{} / {}",
                format_bytes(status.database_bytes),
                format_bytes(limit)
            ),
            None => format_bytes(status.database_bytes),
        },
    ));
    if let Some(available) = status.available_bytes {
        rows.push(row("Free space", format_bytes(available)));
    }
    rows
}

pub fn run() -> ExitCode {
    let Ok(window) = LoggerWindow::new() else {
        return ExitCode::FAILURE;
    };
    let state = Rc::new(RefCell::new(State::load()));
    show_fields(&window, &state.borrow());
    show_status(&window, &state.borrow());

    window.on_edited({
        let state = state.clone();
        let window = window.as_weak();
        move |index, text| {
            let mut state = state.borrow_mut();
            if let Some(value) = usize::try_from(index)
                .ok()
                .and_then(|index| state.values.get_mut(index))
            {
                *value = text.into();
            }
            if let Some(window) = window.upgrade() {
                show_changes(&window, &state);
            }
        }
    });
    window.on_save({
        let state = state.clone();
        let window = window.as_weak();
        move || {
            let mut state = state.borrow_mut();
            state.save();
            if let Some(window) = window.upgrade() {
                show_fields(&window, &state);
                show_status(&window, &state);
            }
        }
    });
    window.on_discard({
        let state = state.clone();
        let window = window.as_weak();
        move || {
            let mut state = state.borrow_mut();
            state.values = state.saved.clone();
            if let Some(window) = window.upgrade() {
                show_fields(&window, &state);
            }
        }
    });

    let timer = Timer::default();
    timer.start(TimerMode::Repeated, POLL_INTERVAL, {
        let state = state.clone();
        let window = window.as_weak();
        move || {
            if let Some(window) = window.upgrade() {
                show_status(&window, &state.borrow());
            }
        }
    });

    window.on_minimize_to_tray({
        let window = window.as_weak();
        move || {
            if let Some(window) = window.upgrade() {
                let _ = window.hide();
            }
        }
    });
    let tray = tray_icon(window.as_weak());
    window.set_has_tray(tray.is_some());
    window.window().on_close_requested(|| {
        let _ = slint::quit_event_loop();
        slint::CloseRequestResponse::HideWindow
    });

    let result = window
        .show()
        .and_then(|()| slint::run_event_loop_until_quit());
    if let Some(running) = state.borrow_mut().running.take() {
        running.stop();
    }
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(_) => ExitCode::FAILURE,
    }
}

fn tray_icon(window: slint::Weak<LoggerWindow>) -> Option<TrayIcon> {
    TrayIconEvent::set_event_handler(Some(move |event| {
        if let TrayIconEvent::Click {
            button: MouseButton::Left,
            button_state: MouseButtonState::Up,
            ..
        } = event
        {
            let _ = window.upgrade_in_event_loop(|window| {
                let _ = window.show();
                window.window().set_minimized(false);
            });
        }
    }));
    let mut reader = png::Decoder::new(Cursor::new(TRAY_ICON_PNG))
        .read_info()
        .ok()?;
    let mut rgba = vec![0; reader.output_buffer_size()?];
    let frame = reader.next_frame(&mut rgba).ok()?;
    let icon = Icon::from_rgba(rgba, frame.width, frame.height).ok()?;
    TrayIconBuilder::new()
        .with_icon(icon)
        .with_tooltip("VRCX-0 Self-hosted Recorder")
        .build()
        .ok()
}

fn load_values(path: &Path, dir: &Path) -> Result<(Vec<String>, bool), String> {
    let content = match std::fs::read_to_string(path) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let values = FIELDS
                .iter()
                .map(|(key, _, _)| match *key {
                    PASSWORD_ENV => generate_password(),
                    HOST_ENV => Ok(DEFAULT_HOST.to_string()),
                    PORT_ENV => Ok(DEFAULT_PORT.to_string()),
                    DATA_DIR_ENV => Ok(dir.join("data").display().to_string()),
                    MAX_STORAGE_MB_ENV => Ok(DEFAULT_MAX_STORAGE_MB.to_string()),
                    _ => Ok(String::new()),
                })
                .collect::<Result<_, _>>()?;
            return Ok((values, true));
        }
        Err(error) => return Err(format!("read {}: {error}", path.display())),
    };
    let values = FIELDS
        .iter()
        .map(|(key, _, _)| {
            content
                .lines()
                .filter_map(|line| line.split_once('='))
                .filter(|(name, _)| name.trim() == *key)
                .map(|(_, value)| value.trim().to_string())
                .next_back()
                .unwrap_or_default()
        })
        .collect();
    Ok((values, false))
}

fn save_values(path: &Path, values: &[String]) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)
            .map_err(|error| format!("create {}: {error}", dir.display()))?;
    }
    let content: String = FIELDS
        .iter()
        .zip(values)
        .map(|((key, _, _), value)| format!("{key}={}\r\n", value.trim()))
        .collect();
    std::fs::write(path, content).map_err(|error| format!("write {}: {error}", path.display()))
}

fn generate_password() -> Result<String, String> {
    let mut bytes = [0u8; PASSWORD_LENGTH];
    getrandom::fill(&mut bytes).map_err(|error| error.to_string())?;
    Ok(bytes
        .iter()
        .map(|byte| char::from(PASSWORD_ALPHABET[usize::from(byte & 63)]))
        .collect())
}

fn lan_ip() -> Option<IpAddr> {
    let socket = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)).ok()?;
    socket.connect((Ipv4Addr::new(192, 0, 2, 1), 9)).ok()?;
    socket.local_addr().ok().map(|address| address.ip())
}

fn format_time(unix: i64) -> String {
    chrono::DateTime::from_timestamp(unix, 0)
        .map(|time| {
            time.with_timezone(&chrono::Local)
                .format("%Y-%m-%d %H:%M")
                .to_string()
        })
        .unwrap_or_default()
}

fn format_bytes(bytes: u64) -> String {
    let mib = bytes as f64 / (1024.0 * 1024.0);
    if mib >= 1024.0 {
        format!("{:.1} GB", mib / 1024.0)
    } else {
        format!("{mib:.1} MB")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{temp_dir, PASSWORD};

    #[test]
    fn a_stopped_recorder_can_reopen_its_data_folder() {
        let dir = temp_dir();
        let values = [
            PASSWORD.to_string(),
            "127.0.0.1".to_string(),
            "0".to_string(),
            dir.display().to_string(),
            String::new(),
            String::new(),
        ];
        let config = config_from(&values).unwrap();

        Running::start(&config).unwrap().stop();
        Running::start(&config).unwrap().stop();
    }

    #[test]
    fn settings_round_trip_through_the_settings_file() {
        let dir = temp_dir();
        let path = dir.join(SETTINGS_FILE);
        let (values, fresh) = load_values(&path, &dir).unwrap();
        assert!(fresh);
        assert_eq!(values[0].len(), PASSWORD_LENGTH);
        assert_eq!(values[3], dir.join("data").display().to_string());

        save_values(&path, &values).unwrap();
        assert_eq!(load_values(&path, &dir).unwrap(), (values, false));
    }
}
