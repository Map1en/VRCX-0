mod eligibility;
mod localization;
mod manager;

pub(crate) use localization::{
    discord_embed_kind, discord_title_key, DiscordEmbedKind, OverlayLocale, OverlayLocalizer,
};
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
pub use service::{
    HostVrOverlayService, OverlayBackendPreference, OverlayServiceStartError,
    VrOverlayServiceControl,
};
pub use surfaces::wrist::{
    build_wrist_surface_model, WristOverlayFrameInput, WristOverlayRenderOptions,
    WristOverlaySizePreset, WristRuntimeFooter,
};
