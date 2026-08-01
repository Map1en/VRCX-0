mod avatar_cache;
mod config;
mod eligibility;
mod localization;
mod manager;

mod runtime;
mod service;
mod services;
pub mod surfaces;

pub use eligibility::{VrOverlayEligibility, WristOverlayStartMode};
pub use manager::VrOverlayManager;
pub use runtime::{
    VrOverlayActivitySink, VrOverlayRuntime, VrOverlayRuntimeSnapshot,
    VR_OVERLAY_ENABLED_CONFIG_KEY,
};
pub use service::{
    HostVrOverlayService, OverlayBackendPreference, OverlayServiceStartError,
    VrOverlayServiceControl,
};
pub use services::VrOverlayRuntimeServices;
pub use surfaces::wrist::{
    build_wrist_surface_model, WristOverlayFrameInput, WristOverlayRenderOptions,
    WristOverlaySizePreset, WristRuntimeFooter,
};
