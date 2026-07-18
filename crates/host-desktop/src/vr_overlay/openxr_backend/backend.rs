use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc::{self, Sender},
    Arc,
};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use openxr as xr;
use vrcx_0_vr_overlay::{OverlaySurfaceId, RgbaFrame};

use super::super::{
    actor::OverlayBackend,
    types::{BackendStartError, OverlaySurfaceConfig, VrDeviceSnapshot},
};
use super::session::{self, SessionCommand};

const REQUEST_REPLY_TIMEOUT: Duration = Duration::from_secs(15);
const INIT_TIMEOUT: Duration = Duration::from_secs(20);
const STOP_JOIN_TIMEOUT: Duration = Duration::from_secs(3);

pub fn probe_runtime() -> Result<(), String> {
    let entry = load_entry().map_err(|error| error.message)?;
    let extensions = entry
        .enumerate_extensions()
        .map_err(|error| format!("failed to enumerate OpenXR extensions: {error}"))?;
    if !extensions.extx_overlay {
        return Err("OpenXR runtime does not support XR_EXTX_overlay".to_string());
    }
    if !extensions.khr_vulkan_enable2 {
        return Err("OpenXR runtime does not support XR_KHR_vulkan_enable2".to_string());
    }
    Ok(())
}

pub(super) fn load_entry() -> Result<xr::Entry, BackendStartError> {
    unsafe { xr::Entry::load() }.map_err(|error| {
        BackendStartError::permanent(format!("OpenXR loader unavailable: {error}"))
    })
}

pub struct OpenXrOverlayBackend {
    worker: Option<Worker>,
    stale_worker: Option<Arc<AtomicBool>>,
}

struct Worker {
    commands: Sender<SessionCommand>,
    alive: Arc<AtomicBool>,
    join: Option<JoinHandle<()>>,
}

impl OpenXrOverlayBackend {
    pub fn new() -> Self {
        Self {
            worker: None,
            stale_worker: None,
        }
    }

    fn worker(&self) -> Result<&Worker, String> {
        let worker = self
            .worker
            .as_ref()
            .ok_or_else(|| "OpenXR overlay session is not started".to_string())?;
        if !worker.alive.load(Ordering::Acquire) {
            return Err("OpenXR overlay session has stopped".to_string());
        }
        Ok(worker)
    }

    fn request<T>(
        &self,
        build: impl FnOnce(Sender<Result<T, String>>) -> SessionCommand,
    ) -> Result<T, String> {
        let worker = self.worker()?;
        let (reply, response) = mpsc::channel();
        worker
            .commands
            .send(build(reply))
            .map_err(|_| "OpenXR overlay session has stopped".to_string())?;
        response
            .recv_timeout(REQUEST_REPLY_TIMEOUT)
            .map_err(|_| "OpenXR overlay session is not responding".to_string())?
    }

    fn post(&self, command: SessionCommand) -> Result<(), String> {
        let worker = self.worker()?;
        worker
            .commands
            .send(command)
            .map_err(|_| "OpenXR overlay session has stopped".to_string())
    }

    fn stop_worker(&mut self) {
        let Some(worker) = self.worker.take() else {
            return;
        };
        let Worker {
            commands,
            alive,
            join,
        } = worker;
        let _ = commands.send(SessionCommand::Stop);
        drop(commands);

        let deadline = Instant::now() + STOP_JOIN_TIMEOUT;
        while alive.load(Ordering::Acquire) && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(25));
        }
        if alive.load(Ordering::Acquire) {
            tracing::warn!("OpenXR overlay session thread did not stop in time; detaching it");
            self.stale_worker = Some(alive);
            return;
        }
        if let Some(join) = join {
            let _ = join.join();
        }
    }
}

impl Default for OpenXrOverlayBackend {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for OpenXrOverlayBackend {
    fn drop(&mut self) {
        self.stop_worker();
    }
}

impl OverlayBackend for OpenXrOverlayBackend {
    fn start(&mut self) -> Result<(), BackendStartError> {
        if let Some(worker) = &self.worker {
            if worker.alive.load(Ordering::Acquire) {
                return Ok(());
            }
        }
        self.stop_worker();
        if let Some(stale) = &self.stale_worker {
            if stale.load(Ordering::Acquire) {
                return Err(BackendStartError::transient(
                    "previous OpenXR overlay session is still shutting down".to_string(),
                ));
            }
            self.stale_worker = None;
        }

        let (command_sender, command_receiver) = mpsc::channel();
        let (init_sender, init_receiver) = mpsc::channel();
        let alive = Arc::new(AtomicBool::new(true));
        let thread_alive = Arc::clone(&alive);
        let join = thread::Builder::new()
            .name("vrcx-xr-overlay".to_string())
            .spawn(move || {
                session::run(command_receiver, init_sender);
                thread_alive.store(false, Ordering::Release);
            })
            .map_err(|error| {
                BackendStartError::transient(format!(
                    "failed to spawn OpenXR overlay session thread: {error}"
                ))
            })?;

        match init_receiver.recv_timeout(INIT_TIMEOUT) {
            Ok(Ok(())) => {
                self.worker = Some(Worker {
                    commands: command_sender,
                    alive,
                    join: Some(join),
                });
                Ok(())
            }
            Ok(Err(error)) => {
                let _ = join.join();
                Err(error)
            }
            Err(_) => {
                drop(command_sender);
                self.stale_worker = Some(alive);
                Err(BackendStartError::transient(
                    "OpenXR overlay session did not initialize in time".to_string(),
                ))
            }
        }
    }

    fn register_surface(&mut self, config: OverlaySurfaceConfig) -> Result<(), String> {
        self.request(|reply| SessionCommand::RegisterSurface { config, reply })
    }

    fn unregister_surface(&mut self, surface_id: &OverlaySurfaceId) -> Result<(), String> {
        let surface_id = surface_id.clone();
        self.request(|reply| SessionCommand::UnregisterSurface { surface_id, reply })
    }

    fn update_frame(
        &mut self,
        surface_id: &OverlaySurfaceId,
        frame: RgbaFrame,
    ) -> Result<(), String> {
        self.post(SessionCommand::UpdateFrame {
            surface_id: surface_id.clone(),
            frame,
        })
    }

    fn show(&mut self, surface_id: &OverlaySurfaceId) -> Result<(), String> {
        self.post(SessionCommand::Show {
            surface_id: surface_id.clone(),
        })
    }

    fn hide(&mut self, surface_id: &OverlaySurfaceId) -> Result<(), String> {
        self.post(SessionCommand::Hide {
            surface_id: surface_id.clone(),
        })
    }

    fn snapshot_devices(&mut self) -> Result<Vec<VrDeviceSnapshot>, String> {
        self.request(|reply| SessionCommand::SnapshotDevices { reply })
    }

    fn stop(&mut self) {
        self.stop_worker();
    }
}
