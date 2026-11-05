use std::sync::{
    mpsc::{self, RecvTimeoutError},
    Arc, Mutex,
};
use std::thread;
use std::time::{Duration, Instant};

use vrcx_0_vr_overlay::{OverlaySurfaceId, RgbaFrame};

#[cfg(all(feature = "steamvr-overlay", any(windows, target_os = "linux")))]
use super::openvr_backend::OpenVrOverlayBackend;
#[cfg(all(feature = "openxr-overlay", any(windows, target_os = "linux")))]
use super::openxr_backend::OpenXrOverlayBackend;
use super::{
    command::{OverlayCommandError, OverlayServiceCommand},
    noop::NoopOverlayBackend,
    status::{OverlayServicePhase, OverlayServiceStatus},
    types::{BackendStartError, BackendStartErrorReason, OverlaySurfaceConfig, VrDeviceSnapshot},
};

const IDLE_OVERLAY_TICK_INTERVAL: Duration = Duration::from_millis(100);
const HIGH_FREQUENCY_OVERLAY_TICK_INTERVAL: Duration = Duration::from_millis(16);
const START_COMMAND_TIMEOUT: Duration = Duration::from_secs(30);
const SURFACE_COMMAND_TIMEOUT: Duration = Duration::from_secs(10);
const OVERLAY_COMMAND_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TickOutcome {
    Continue,
    RuntimeQuit,
}

pub trait OverlayBackend: Send + 'static {
    fn needs_high_frequency_tick(&self) -> bool {
        false
    }
    fn start(&mut self) -> Result<(), BackendStartError>;
    fn register_surface(&mut self, config: OverlaySurfaceConfig) -> Result<(), String>;
    fn unregister_surface(&mut self, surface_id: &OverlaySurfaceId) -> Result<(), String> {
        self.hide(surface_id)
    }
    fn update_frame(
        &mut self,
        surface_id: &OverlaySurfaceId,
        frame: RgbaFrame,
    ) -> Result<(), String>;
    fn show(&mut self, surface_id: &OverlaySurfaceId) -> Result<(), String>;
    fn hide(&mut self, surface_id: &OverlaySurfaceId) -> Result<(), String>;
    fn set_alpha(&mut self, _surface_id: &OverlaySurfaceId, _alpha: f32) -> Result<(), String> {
        Ok(())
    }
    fn visible_surface_ids(&self) -> Vec<OverlaySurfaceId> {
        Vec::new()
    }
    fn hmd_user_present(&self) -> Option<bool> {
        None
    }
    fn snapshot_devices(&mut self) -> Result<Vec<VrDeviceSnapshot>, String>;
    fn tick(&mut self) -> TickOutcome {
        TickOutcome::Continue
    }
    fn stop(&mut self);
}

#[derive(Clone)]
pub struct OverlayActorHandle {
    sender: mpsc::Sender<OverlayActorMessage>,
    status: Arc<Mutex<OverlayServiceStatus>>,
    runtime_quit_at: Arc<Mutex<Option<Instant>>>,
    visible_surfaces: Arc<Mutex<Vec<OverlaySurfaceId>>>,
    hmd_user_present: Arc<Mutex<Option<bool>>>,
}

enum OverlayActorMessage {
    Command(OverlayCommandEnvelope),
    SnapshotDevices {
        reply: mpsc::Sender<Result<Vec<VrDeviceSnapshot>, OverlayCommandError>>,
    },
}

struct OverlayCommandEnvelope {
    command: OverlayServiceCommand,
    reply: mpsc::Sender<Result<(), OverlayCommandError>>,
}

impl OverlayActorHandle {
    pub fn spawn_noop() -> Self {
        Self::spawn_with_backend(NoopOverlayBackend)
    }

    #[cfg(all(feature = "steamvr-overlay", any(windows, target_os = "linux")))]
    pub fn spawn_openvr() -> Self {
        Self::spawn_with_backend(OpenVrOverlayBackend::new())
    }

    #[cfg(all(feature = "openxr-overlay", any(windows, target_os = "linux")))]
    pub fn spawn_openxr() -> Self {
        Self::spawn_with_backend(OpenXrOverlayBackend::new())
    }

    #[cfg(test)]
    pub fn spawn_for_test<B>(backend: B) -> Self
    where
        B: OverlayBackend,
    {
        Self::spawn_with_backend(backend)
    }

    pub fn spawn_with_backend<B>(backend: B) -> Self
    where
        B: OverlayBackend,
    {
        let (sender, receiver) = mpsc::channel::<OverlayActorMessage>();
        let status = Arc::new(Mutex::new(OverlayServiceStatus::default()));
        let runtime_quit_at = Arc::new(Mutex::new(None));
        let visible_surfaces = Arc::new(Mutex::new(Vec::new()));
        let hmd_user_present = Arc::new(Mutex::new(None));
        let actor_status = Arc::clone(&status);
        let actor_runtime_quit_at = Arc::clone(&runtime_quit_at);
        let actor_visible_surfaces = Arc::clone(&visible_surfaces);
        let actor_hmd_user_present = Arc::clone(&hmd_user_present);
        thread::Builder::new()
            .name("vrcx-vr-overlay".to_string())
            .spawn(move || {
                run_actor(
                    backend,
                    receiver,
                    actor_status,
                    actor_runtime_quit_at,
                    actor_visible_surfaces,
                    actor_hmd_user_present,
                )
            })
            .expect("spawn VR overlay actor thread");
        Self {
            sender,
            status,
            runtime_quit_at,
            visible_surfaces,
            hmd_user_present,
        }
    }

    pub fn send(&self, command: OverlayServiceCommand) -> Result<(), OverlayCommandError> {
        let timeout = command_timeout(&command);
        self.send_with_timeout(command, timeout)
    }

    pub fn send_detached(&self, command: OverlayServiceCommand) {
        let (reply, _result) = mpsc::channel();
        let _ = self
            .sender
            .send(OverlayActorMessage::Command(OverlayCommandEnvelope {
                command,
                reply,
            }));
    }

    fn send_with_timeout(
        &self,
        command: OverlayServiceCommand,
        timeout: Duration,
    ) -> Result<(), OverlayCommandError> {
        let command_name = command_name(&command);
        let (reply, result) = mpsc::channel();
        self.sender
            .send(OverlayActorMessage::Command(OverlayCommandEnvelope {
                command,
                reply,
            }))
            .map_err(|_| OverlayCommandError::Stopped)?;
        receive_with_timeout(result, command_name, timeout)
    }

    #[cfg(test)]
    fn send_with_timeout_for_test(
        &self,
        command: OverlayServiceCommand,
        timeout: Duration,
    ) -> Result<(), OverlayCommandError> {
        self.send_with_timeout(command, timeout)
    }

    pub fn snapshot_devices(&self) -> Result<Vec<VrDeviceSnapshot>, OverlayCommandError> {
        let (reply, result) = mpsc::channel();
        self.sender
            .send(OverlayActorMessage::SnapshotDevices { reply })
            .map_err(|_| OverlayCommandError::Stopped)?;
        receive_with_timeout(result, "snapshot_devices", OVERLAY_COMMAND_TIMEOUT)
    }

    pub fn status(&self) -> OverlayServiceStatus {
        self.status
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    pub fn hmd_user_present(&self) -> Option<bool> {
        self.hmd_user_present
            .lock()
            .map(|slot| *slot)
            .unwrap_or(None)
    }

    pub fn runtime_quit_at(&self) -> Option<Instant> {
        self.runtime_quit_at
            .lock()
            .map(|slot| *slot)
            .unwrap_or(None)
    }

    pub fn is_surface_visible(&self, surface_id: &OverlaySurfaceId) -> bool {
        self.visible_surfaces
            .lock()
            .is_ok_and(|visible| visible.contains(surface_id))
    }
}

fn receive_with_timeout<T>(
    result: mpsc::Receiver<Result<T, OverlayCommandError>>,
    command: &'static str,
    timeout: Duration,
) -> Result<T, OverlayCommandError> {
    match result.recv_timeout(timeout) {
        Ok(outcome) => outcome,
        Err(RecvTimeoutError::Timeout) => Err(OverlayCommandError::Timeout {
            command,
            waited: timeout,
        }),
        Err(RecvTimeoutError::Disconnected) => Err(OverlayCommandError::Stopped),
    }
}

fn command_name(command: &OverlayServiceCommand) -> &'static str {
    match command {
        OverlayServiceCommand::Start => "start",
        OverlayServiceCommand::RegisterSurface(_) => "register_surface",
        OverlayServiceCommand::RegisterOptionalSurface(_) => "register_optional_surface",
        OverlayServiceCommand::UnregisterSurface(_) => "unregister_surface",
        OverlayServiceCommand::UpdateFrame { .. } => "update_frame",
        OverlayServiceCommand::Show(_) => "show",
        OverlayServiceCommand::Hide(_) => "hide",
        OverlayServiceCommand::SetAlpha { .. } => "set_alpha",
        OverlayServiceCommand::Stop => "stop",
    }
}

fn command_timeout(command: &OverlayServiceCommand) -> Duration {
    match command {
        OverlayServiceCommand::Start => START_COMMAND_TIMEOUT,
        OverlayServiceCommand::RegisterSurface(_)
        | OverlayServiceCommand::RegisterOptionalSurface(_)
        | OverlayServiceCommand::UnregisterSurface(_) => SURFACE_COMMAND_TIMEOUT,
        OverlayServiceCommand::UpdateFrame { .. }
        | OverlayServiceCommand::Show(_)
        | OverlayServiceCommand::Hide(_)
        | OverlayServiceCommand::SetAlpha { .. }
        | OverlayServiceCommand::Stop => OVERLAY_COMMAND_TIMEOUT,
    }
}

fn run_actor<B>(
    mut backend: B,
    receiver: mpsc::Receiver<OverlayActorMessage>,
    status: Arc<Mutex<OverlayServiceStatus>>,
    runtime_quit_at: Arc<Mutex<Option<Instant>>>,
    visible_surfaces: Arc<Mutex<Vec<OverlaySurfaceId>>>,
    hmd_user_present: Arc<Mutex<Option<bool>>>,
) where
    B: OverlayBackend,
{
    let mut skip_backend_stop = false;
    let mut last_tick_at = Instant::now();
    loop {
        publish_visible_surfaces(&backend, &visible_surfaces);
        publish_hmd_user_present(backend.hmd_user_present(), &hmd_user_present);
        let tick_interval = overlay_tick_interval(backend.needs_high_frequency_tick());
        match receiver.recv_timeout(tick_interval) {
            Ok(message) => {
                match message {
                    OverlayActorMessage::Command(envelope) => {
                        let should_stop = matches!(envelope.command, OverlayServiceCommand::Stop);
                        let result = handle_command(&mut backend, envelope.command, &status);
                        let _ = envelope.reply.send(result);
                        if should_stop {
                            skip_backend_stop = true;
                            break;
                        }
                    }
                    OverlayActorMessage::SnapshotDevices { reply } => {
                        let result = backend
                            .snapshot_devices()
                            .map_err(|error| record_backend_error(&status, error));
                        let _ = reply.send(result);
                    }
                }
                if run_tick_if_due(
                    &mut backend,
                    &status,
                    &runtime_quit_at,
                    &mut last_tick_at,
                    tick_interval,
                ) {
                    skip_backend_stop = true;
                    break;
                }
            }
            Err(RecvTimeoutError::Timeout) => {
                if run_tick_if_due(
                    &mut backend,
                    &status,
                    &runtime_quit_at,
                    &mut last_tick_at,
                    tick_interval,
                ) {
                    skip_backend_stop = true;
                    break;
                }
            }
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }

    if !skip_backend_stop {
        backend.stop();
        update_status(&status, OverlayServicePhase::Stopped, None);
    }
    publish_hmd_user_present(None, &hmd_user_present);
}

fn publish_hmd_user_present(next: Option<bool>, hmd_user_present: &Mutex<Option<bool>>) {
    if let Ok(mut slot) = hmd_user_present.lock() {
        *slot = next;
    }
}

fn publish_visible_surfaces<B>(backend: &B, visible_surfaces: &Mutex<Vec<OverlaySurfaceId>>)
where
    B: OverlayBackend,
{
    let next = backend.visible_surface_ids();
    if let Ok(mut visible) = visible_surfaces.lock() {
        *visible = next;
    }
}

fn run_tick_if_due<B>(
    backend: &mut B,
    status: &Mutex<OverlayServiceStatus>,
    runtime_quit_at: &Mutex<Option<Instant>>,
    last_tick_at: &mut Instant,
    tick_interval: Duration,
) -> bool
where
    B: OverlayBackend,
{
    if last_tick_at.elapsed() < tick_interval {
        return false;
    }
    *last_tick_at = Instant::now();
    run_tick(backend, status, runtime_quit_at)
}

fn run_tick<B>(
    backend: &mut B,
    status: &Mutex<OverlayServiceStatus>,
    runtime_quit_at: &Mutex<Option<Instant>>,
) -> bool
where
    B: OverlayBackend,
{
    if !actor_is_running(status) {
        return false;
    }
    match backend.tick() {
        TickOutcome::Continue => false,
        TickOutcome::RuntimeQuit => {
            if let Ok(mut slot) = runtime_quit_at.lock() {
                *slot = Some(Instant::now());
            }
            update_status(
                status,
                OverlayServicePhase::Stopped,
                Some("VR runtime requested quit".to_string()),
            );
            true
        }
    }
}

fn actor_is_running(status: &Mutex<OverlayServiceStatus>) -> bool {
    status
        .lock()
        .map(|status| status.phase == OverlayServicePhase::Running)
        .unwrap_or(false)
}

fn handle_command<B>(
    backend: &mut B,
    command: OverlayServiceCommand,
    status: &Mutex<OverlayServiceStatus>,
) -> Result<(), OverlayCommandError>
where
    B: OverlayBackend,
{
    match command {
        OverlayServiceCommand::Start => {
            update_status(status, OverlayServicePhase::Starting, None);
            if let Err(error) = backend.start() {
                update_status(
                    status,
                    OverlayServicePhase::Error,
                    Some(error.message.clone()),
                );
                backend.stop();
                return Err(match error.reason {
                    BackendStartErrorReason::Other => OverlayCommandError::Backend(error.message),
                    BackendStartErrorReason::RuntimeUnavailable => {
                        OverlayCommandError::BackendUnavailable(error.message)
                    }
                    BackendStartErrorReason::Unsupported => {
                        OverlayCommandError::BackendUnsupported(error.message)
                    }
                });
            }
            update_status(status, OverlayServicePhase::Running, None);
            Ok(())
        }
        OverlayServiceCommand::RegisterSurface(config) => backend
            .register_surface(config)
            .map_err(|error| record_backend_error(status, error)),
        OverlayServiceCommand::RegisterOptionalSurface(config) => backend
            .register_surface(config)
            .map_err(OverlayCommandError::Backend),
        OverlayServiceCommand::UnregisterSurface(surface_id) => backend
            .unregister_surface(&surface_id)
            .map_err(|error| record_backend_error(status, error)),
        OverlayServiceCommand::UpdateFrame { surface_id, frame } => {
            validate_frame(&frame).inspect_err(|error| {
                update_status(status, OverlayServicePhase::Error, Some(error.to_string()));
            })?;
            backend
                .update_frame(&surface_id, frame)
                .map_err(|error| record_backend_error(status, error))
        }
        OverlayServiceCommand::Show(surface_id) => backend
            .show(&surface_id)
            .map_err(|error| record_backend_error(status, error)),
        OverlayServiceCommand::Hide(surface_id) => backend
            .hide(&surface_id)
            .map_err(|error| record_backend_error(status, error)),
        OverlayServiceCommand::SetAlpha { surface_id, alpha } => backend
            .set_alpha(&surface_id, alpha)
            .map_err(|error| record_backend_error(status, error)),
        OverlayServiceCommand::Stop => {
            backend.stop();
            update_status(status, OverlayServicePhase::Stopped, None);
            Ok(())
        }
    }
}

fn overlay_tick_interval(needs_high_frequency_tick: bool) -> Duration {
    if needs_high_frequency_tick {
        HIGH_FREQUENCY_OVERLAY_TICK_INTERVAL
    } else {
        IDLE_OVERLAY_TICK_INTERVAL
    }
}

fn validate_frame(frame: &RgbaFrame) -> Result<(), OverlayCommandError> {
    let expected = RgbaFrame::expected_byte_len(frame.size)
        .ok_or(OverlayCommandError::InvalidFrameDimensions)?;
    if frame.data.len() != expected {
        return Err(OverlayCommandError::InvalidFrameLength {
            expected,
            actual: frame.data.len(),
        });
    }
    Ok(())
}

fn record_backend_error(
    status: &Mutex<OverlayServiceStatus>,
    error: String,
) -> OverlayCommandError {
    update_status(status, OverlayServicePhase::Error, Some(error.clone()));
    OverlayCommandError::Backend(error)
}

fn update_status(
    status: &Mutex<OverlayServiceStatus>,
    phase: OverlayServicePhase,
    last_error: Option<String>,
) {
    if let Ok(mut status) = status.lock() {
        status.phase = phase;
        status.last_error = last_error;
    }
}

#[cfg(test)]
mod tests;
