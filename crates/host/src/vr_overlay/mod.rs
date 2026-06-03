mod actor;
mod command;
mod noop;
#[cfg(all(feature = "steamvr-overlay", any(windows, target_os = "linux")))]
mod openvr_backend;
mod status;
mod types;

pub use actor::{OverlayActorHandle, OverlayBackend};
pub use command::{OverlayCommandError, OverlayServiceCommand};
pub use noop::NoopOverlayBackend;
#[cfg(all(feature = "steamvr-overlay", any(windows, target_os = "linux")))]
pub use openvr_backend::OpenVrOverlayBackend;
pub use status::{OverlayServicePhase, OverlayServiceStatus};
pub use types::{
    OverlayActivationButton, OverlayPlacement, OverlaySurfaceConfig, VrDeviceSnapshot,
    VrDeviceStatus,
};
