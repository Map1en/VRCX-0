mod eligibility;
mod localization;
mod manager;
mod preview_bridge;
mod runtime;
mod service;
pub mod surfaces;

pub use eligibility::{VrOverlayEligibility, WristOverlayStartMode};
pub use manager::VrOverlayManager;
pub use preview_bridge::{
    default_preview_snapshot_path, start_preview_bridge_if_enabled, WristOverlayPreviewSnapshot,
};
pub use runtime::{
    VrOverlayActivitySink, VrOverlayRuntime, VrOverlayRuntimeSnapshot,
    VR_OVERLAY_ENABLED_CONFIG_KEY,
};
pub use service::{HostVrOverlayService, VrOverlayServiceControl};
pub use surfaces::wrist::{
    build_wrist_surface_model, WristOverlayFrameInput, WristOverlayRenderOptions,
    WristOverlaySizePreset, WristRuntimeFooter,
};
