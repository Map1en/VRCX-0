use std::sync::{
    mpsc::{self, RecvTimeoutError},
    Arc, Mutex,
};
use std::thread;
use std::time::Duration;

use vrcx_0_vr_overlay::{OverlaySurfaceId, RgbaFrame};

#[cfg(all(feature = "steamvr-overlay", any(windows, target_os = "linux")))]
use super::openvr_backend::OpenVrOverlayBackend;
use super::{
    command::{OverlayCommandError, OverlayServiceCommand},
    noop::NoopOverlayBackend,
    status::{OverlayServicePhase, OverlayServiceStatus},
    types::{OverlaySurfaceConfig, VrDeviceSnapshot},
};

const OVERLAY_TICK_INTERVAL: Duration = Duration::from_millis(100);

pub trait OverlayBackend: Send + 'static {
    fn start(&mut self) -> Result<(), String>;
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
    fn snapshot_devices(&mut self) -> Result<Vec<VrDeviceSnapshot>, String>;
    fn tick(&mut self) {}
    fn stop(&mut self);
}

#[derive(Clone)]
pub struct OverlayActorHandle {
    sender: mpsc::Sender<OverlayActorMessage>,
    status: Arc<Mutex<OverlayServiceStatus>>,
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
        let actor_status = Arc::clone(&status);
        thread::Builder::new()
            .name("vrcx-vr-overlay".to_string())
            .spawn(move || run_actor(backend, receiver, actor_status))
            .expect("spawn VR overlay actor thread");
        Self { sender, status }
    }

    pub fn send(&self, command: OverlayServiceCommand) -> Result<(), OverlayCommandError> {
        let (reply, result) = mpsc::channel();
        self.sender
            .send(OverlayActorMessage::Command(OverlayCommandEnvelope {
                command,
                reply,
            }))
            .map_err(|_| OverlayCommandError::Stopped)?;
        result.recv().map_err(|_| OverlayCommandError::Stopped)?
    }

    pub fn snapshot_devices(&self) -> Result<Vec<VrDeviceSnapshot>, OverlayCommandError> {
        let (reply, result) = mpsc::channel();
        self.sender
            .send(OverlayActorMessage::SnapshotDevices { reply })
            .map_err(|_| OverlayCommandError::Stopped)?;
        result.recv().map_err(|_| OverlayCommandError::Stopped)?
    }

    pub fn status(&self) -> OverlayServiceStatus {
        self.status
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }
}

fn run_actor<B>(
    mut backend: B,
    receiver: mpsc::Receiver<OverlayActorMessage>,
    status: Arc<Mutex<OverlayServiceStatus>>,
) where
    B: OverlayBackend,
{
    let mut stopped = false;
    loop {
        match receiver.recv_timeout(OVERLAY_TICK_INTERVAL) {
            Ok(message) => match message {
                OverlayActorMessage::Command(envelope) => {
                    let should_stop = matches!(envelope.command, OverlayServiceCommand::Stop);
                    let result = handle_command(&mut backend, envelope.command, &status);
                    let _ = envelope.reply.send(result);
                    if should_stop {
                        stopped = true;
                        break;
                    }
                }
                OverlayActorMessage::SnapshotDevices { reply } => {
                    let result = backend
                        .snapshot_devices()
                        .map_err(|error| record_backend_error(&status, error));
                    let _ = reply.send(result);
                }
            },
            Err(RecvTimeoutError::Timeout) => {
                if actor_is_running(&status) {
                    backend.tick();
                }
            }
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }

    if !stopped {
        backend.stop();
        update_status(&status, OverlayServicePhase::Stopped, None);
    }
}

fn actor_is_running(status: &Arc<Mutex<OverlayServiceStatus>>) -> bool {
    status
        .lock()
        .map(|status| status.phase == OverlayServicePhase::Running)
        .unwrap_or(false)
}

fn handle_command<B>(
    backend: &mut B,
    command: OverlayServiceCommand,
    status: &Arc<Mutex<OverlayServiceStatus>>,
) -> Result<(), OverlayCommandError>
where
    B: OverlayBackend,
{
    match command {
        OverlayServiceCommand::Start => {
            update_status(status, OverlayServicePhase::Starting, None);
            if let Err(error) = backend.start() {
                let command_error = record_backend_error(status, error);
                backend.stop();
                return Err(command_error);
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
        OverlayServiceCommand::Stop => {
            backend.stop();
            update_status(status, OverlayServicePhase::Stopped, None);
            Ok(())
        }
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
    status: &Arc<Mutex<OverlayServiceStatus>>,
    error: String,
) -> OverlayCommandError {
    update_status(status, OverlayServicePhase::Error, Some(error.clone()));
    OverlayCommandError::Backend(error)
}

fn update_status(
    status: &Arc<Mutex<OverlayServiceStatus>>,
    phase: OverlayServicePhase,
    last_error: Option<String>,
) {
    if let Ok(mut status) = status.lock() {
        status.phase = phase;
        status.last_error = last_error;
    }
}
