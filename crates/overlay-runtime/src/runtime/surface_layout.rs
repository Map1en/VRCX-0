use vrcx_0_vr_overlay::{OverlaySize, OverlaySurfaceId, MAIN_SURFACE_ID};
use vrcx_0_vr_overlay_backend::{OverlayActivationButton, OverlayPlacement, OverlaySurfaceConfig};

use crate::config::{
    HmdNotificationPosition, HmdNotificationStyle, VrOverlayRuntimeConfig, WristOverlayHand,
};
use crate::eligibility::WristOverlayStartMode;
use crate::WristOverlaySizePreset;

use super::{ActiveOverlaySurfaces, VrOverlayRuntime};

fn start_mode_allows(start_mode: WristOverlayStartMode, game_running: bool) -> bool {
    match start_mode {
        WristOverlayStartMode::SteamVr => true,
        WristOverlayStartMode::Vrchat => game_running,
    }
}

pub(super) fn surface_active_for_start_mode(
    enabled: bool,
    start_mode: WristOverlayStartMode,
    backend_available: bool,
    steamvr_running: bool,
    game_running: bool,
) -> bool {
    enabled && backend_available && steamvr_running && start_mode_allows(start_mode, game_running)
}

pub(super) fn overlay_surface_configs(
    active_surfaces: ActiveOverlaySurfaces,
    config: VrOverlayRuntimeConfig,
    runtime: &VrOverlayRuntime,
) -> Vec<OverlaySurfaceConfig> {
    let force_visible = runtime.is_test_mode();
    let mut configs = Vec::new();
    if active_surfaces.wrist {
        configs.extend(wrist_surface_configs(config, force_visible));
    }
    if active_surfaces.hmd {
        configs.push(hmd_surface_config(config.hmd.position, config.hmd.style));
    }
    configs
}

fn wrist_surface_configs(
    config: VrOverlayRuntimeConfig,
    force_visible: bool,
) -> Vec<OverlaySurfaceConfig> {
    wrist_surface_ids(config.hand)
        .into_iter()
        .map(|surface_id| {
            let device_hint = if surface_id.as_str() == "wrist-right" {
                "right-hand"
            } else {
                "left-hand"
            };
            wrist_surface_config(
                surface_id.as_str(),
                device_hint,
                config.render.size,
                config.button,
                force_visible,
            )
        })
        .collect()
}

pub(super) fn wrist_surface_ids(hand: WristOverlayHand) -> Vec<OverlaySurfaceId> {
    let mut surface_ids = Vec::new();
    if matches!(hand, WristOverlayHand::Left | WristOverlayHand::Both) {
        surface_ids.push(OverlaySurfaceId::new("wrist-left"));
    }
    if matches!(hand, WristOverlayHand::Right | WristOverlayHand::Both) {
        surface_ids.push(OverlaySurfaceId::new("wrist-right"));
    }
    surface_ids
}

fn wrist_surface_config(
    surface_id: &str,
    device_hint: &str,
    size: WristOverlaySizePreset,
    button: OverlayActivationButton,
    force_visible: bool,
) -> OverlaySurfaceConfig {
    OverlaySurfaceConfig {
        surface_id: OverlaySurfaceId::new(surface_id),
        size: size.overlay_size(),
        physical_width_meters: size.physical_width_meters(),
        placement: OverlayPlacement::TrackedDeviceRelative {
            device_hint: device_hint.to_string(),
        },
        activation_button: button,
        force_visible,
    }
}

pub(super) const HMD_SURFACE_SIZE: OverlaySize = OverlaySize::new(960, 528);
const HMD_SURFACE_DISTANCE_METERS: f32 = 1.2;
pub(super) const HMD_SURFACE_WIDTH_METERS: f32 = 0.991;
pub(super) const HMD_STACK_INSET_PX: f32 = 20.0;

pub(super) fn hmd_surface_config(
    position: HmdNotificationPosition,
    style: HmdNotificationStyle,
) -> OverlaySurfaceConfig {
    let meters_per_px = HMD_SURFACE_WIDTH_METERS / HMD_SURFACE_SIZE.width as f32;
    let newest_card_y =
        HMD_SURFACE_DISTANCE_METERS * position.newest_card_angle_degrees().to_radians().tan();
    let newest_card_inset = (HMD_SURFACE_SIZE.height as f32 / 2.0
        - HMD_STACK_INSET_PX
        - style.single_card_height_px() / 2.0)
        * meters_per_px;
    let offset_y_meters = if position.stacks_upward() {
        newest_card_y + newest_card_inset
    } else {
        newest_card_y - newest_card_inset
    };
    OverlaySurfaceConfig {
        surface_id: OverlaySurfaceId::new(MAIN_SURFACE_ID),
        size: HMD_SURFACE_SIZE,
        physical_width_meters: HMD_SURFACE_WIDTH_METERS,
        placement: OverlayPlacement::HeadLocked {
            offset_y_meters,
            distance_meters: HMD_SURFACE_DISTANCE_METERS,
        },
        activation_button: OverlayActivationButton::Grip,
        force_visible: false,
    }
}
