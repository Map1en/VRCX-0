use std::cell::RefCell;
use std::sync::Arc;

use vrcx_0_core::text::first_non_empty_owned;
use vrcx_0_vr_overlay::{
    MainSurfaceModel, OverlaySize, RgbaFrame, SlintHmdRenderer, SlintWristRenderer,
    WristSurfaceModel,
};
use vrcx_0_vr_overlay_backend::VrDeviceSnapshot;

use crate::config::VrOverlayRuntimeConfig;
use crate::surfaces::hmd_toast::refresh_cached_location_names;
use crate::test_preview::test_wrist_frame_input;
use crate::{
    build_wrist_surface_model, VrOverlayRuntimeServices, WristOverlayFrameInput,
    WristRuntimeFooter, WristRuntimeNowPlaying,
};

use super::text::{elapsed_minutes_text, instance_duration_text, local_time_text, now_ms};
use super::VrOverlayFrameInput;

pub(super) trait VrOverlayFrameProducer: Send {
    fn next_frame(&mut self, input: VrOverlayFrameInput) -> Result<RgbaFrame, String>;
}

pub(super) type VrOverlayFrameProducerFactory =
    Box<dyn Fn() -> Box<dyn VrOverlayFrameProducer> + Send + Sync>;

thread_local! {
    static SLINT_WRIST_RENDERER: RefCell<Option<SlintWristRenderer>> = const { RefCell::new(None) };
    static SLINT_HMD_RENDERER: RefCell<Option<SlintHmdRenderer>> = const { RefCell::new(None) };
}

pub(super) struct RuntimeWristFrameProducer {
    services: Arc<dyn VrOverlayRuntimeServices>,
}

impl RuntimeWristFrameProducer {
    pub(super) fn new(services: Arc<dyn VrOverlayRuntimeServices>) -> Self {
        Self { services }
    }
}

impl VrOverlayFrameProducer for RuntimeWristFrameProducer {
    fn next_frame(&mut self, input: VrOverlayFrameInput) -> Result<RgbaFrame, String> {
        let frame_input = if input.test_mode {
            test_wrist_frame_input(
                input.config,
                input.devices,
                local_time_text(input.config.dt_hour12),
                now_ms(),
            )
        } else {
            build_wrist_frame_input(
                self.services.as_ref(),
                input.config,
                input.devices,
                input.wrist_visible,
            )
        };
        let model = build_wrist_surface_model(frame_input);
        render_slint_wrist_frame(&model)
    }
}

fn render_slint_wrist_frame(model: &WristSurfaceModel) -> Result<RgbaFrame, String> {
    SLINT_WRIST_RENDERER.with(|renderer| {
        renderer
            .borrow_mut()
            .get_or_insert_with(SlintWristRenderer::new)
            .render(model)
    })
}

pub(super) fn clear_slint_wrist_renderer() {
    SLINT_WRIST_RENDERER.with(|renderer| {
        renderer.borrow_mut().take();
    });
}

pub(crate) fn render_slint_hmd_frame(model: &MainSurfaceModel) -> Result<RgbaFrame, String> {
    SLINT_HMD_RENDERER.with(|renderer| {
        renderer
            .borrow_mut()
            .get_or_insert_with(SlintHmdRenderer::new)
            .render(model)
    })
}

pub(super) fn clear_slint_hmd_renderer() {
    SLINT_HMD_RENDERER.with(|renderer| {
        renderer.borrow_mut().take();
    });
}

#[derive(Default)]
pub(super) struct StaticWristFrameProducer;

impl VrOverlayFrameProducer for StaticWristFrameProducer {
    fn next_frame(&mut self, _input: VrOverlayFrameInput) -> Result<RgbaFrame, String> {
        Ok(RgbaFrame::new(OverlaySize::new(16, 8), vec![0; 16 * 8 * 4]))
    }
}

fn build_wrist_frame_input(
    services: &dyn VrOverlayRuntimeServices,
    config: VrOverlayRuntimeConfig,
    devices: Vec<VrDeviceSnapshot>,
    live_now_playing: bool,
) -> WristOverlayFrameInput {
    let game_log = services.game_log_snapshot();
    let now_playing = services.now_playing();
    let captured_at_ms = now_ms();
    let mut activity = services.activity_router().snapshot();
    for entry in &mut activity.entries {
        refresh_cached_location_names(services, entry);
    }
    WristOverlayFrameInput {
        activity,
        devices,
        now_playing: (!now_playing.url.trim().is_empty()).then(|| WristRuntimeNowPlaying {
            title: first_non_empty_owned([now_playing.name.as_str(), now_playing.url.as_str()]),
            length_seconds: now_playing.length,
            position_seconds: now_playing.position,
            started_at: now_playing.started_at.clone().unwrap_or_default(),
        }),
        live_now_playing,
        footer: WristRuntimeFooter {
            player_count: game_log.players.len() as u32,
            instance_duration: instance_duration_text(
                &game_log.location,
                &game_log.started_at,
                captured_at_ms,
            ),
            online_duration: services
                .game_started_at()
                .map(|started_at| elapsed_minutes_text(&started_at, captured_at_ms))
                .unwrap_or_default(),
            local_time: local_time_text(config.dt_hour12),
        },
        options: config.render,
        locale: config.locale.as_str().to_string(),
        show_instance_id_in_location: config.show_instance_id_in_location,
        captured_at_ms,
    }
}
