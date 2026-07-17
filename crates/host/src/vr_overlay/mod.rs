mod actor;
mod command;
#[cfg(all(feature = "steamvr-overlay", windows))]
mod gpu_presenter;
mod noop;
#[cfg(all(feature = "steamvr-overlay", any(windows, target_os = "linux")))]
mod openvr_backend;
#[cfg(all(feature = "steamvr-overlay", any(windows, target_os = "linux")))]
mod openvr_helpers;
#[cfg(all(feature = "openxr-overlay", any(windows, target_os = "linux")))]
mod openxr_backend;
#[cfg(all(
    any(feature = "steamvr-overlay", feature = "openxr-overlay"),
    any(windows, target_os = "linux")
))]
mod policy;
mod status;
mod types;

pub use actor::{OverlayActorHandle, OverlayBackend, TickOutcome};
pub use command::{OverlayCommandError, OverlayServiceCommand};
pub use noop::NoopOverlayBackend;
#[cfg(all(feature = "steamvr-overlay", any(windows, target_os = "linux")))]
pub use openvr_backend::OpenVrOverlayBackend;
#[cfg(all(feature = "openxr-overlay", any(windows, target_os = "linux")))]
pub use openxr_backend::{probe_runtime as probe_openxr_runtime, OpenXrOverlayBackend};
pub use status::{OverlayServicePhase, OverlayServiceStatus};
pub use types::{
    BackendStartError, OverlayActivationButton, OverlayHand, OverlayInputEvent,
    OverlayInputEventSink, OverlayInputKind, OverlayPlacement, OverlaySurfaceConfig,
    VrDeviceSnapshot, VrDeviceStatus,
};
