use image::{codecs::png::PngEncoder, ColorType, ImageEncoder};
use vrcx_0_vr_overlay::{
    default_slint_spike_size, FavoriteFriendsPanelModel, MainSurfaceModel, RgbaFrame,
    SlintHmdRenderer, SlintPanelHost, SlintPanelPointerEvent, SlintPanelRenderStats,
    SlintWristRenderer, WristSurfaceModel,
};

pub struct RenderedPng {
    pub bytes: Vec<u8>,
    pub stats: Option<SlintPanelRenderStats>,
}

pub struct DevtoolRenderer {
    wrist: SlintWristRenderer,
    hmd: SlintHmdRenderer,
    panel: Option<SlintPanelHost>,
    panel_frame: Option<RgbaFrame>,
    panel_stats: Option<SlintPanelRenderStats>,
}

impl DevtoolRenderer {
    pub fn new() -> Self {
        Self {
            wrist: SlintWristRenderer::new(),
            hmd: SlintHmdRenderer::new(),
            panel: None,
            panel_frame: None,
            panel_stats: None,
        }
    }

    pub fn friends_png(
        &mut self,
        _model: &FavoriteFriendsPanelModel,
    ) -> Result<RenderedPng, String> {
        self.panel_png()
    }

    pub fn main_png(&mut self, model: &MainSurfaceModel) -> Result<RenderedPng, String> {
        let frame = self.hmd.render(model)?;
        frame_png(frame).map(RenderedPng::without_stats)
    }

    pub fn wrist_png(&mut self, model: &WristSurfaceModel) -> Result<RenderedPng, String> {
        let frame = self.wrist.render(model)?;
        frame_png(frame).map(RenderedPng::without_stats)
    }

    pub fn dispatch_panel_input(&mut self, event: SlintPanelPointerEvent) -> Result<(), String> {
        self.panel_host()?.dispatch(event)
    }

    pub fn reset_panel(&mut self) {
        self.panel = None;
        self.panel_frame = None;
        self.panel_stats = None;
    }

    fn panel_png(&mut self) -> Result<RenderedPng, String> {
        let rendered = {
            let host = self.panel_host()?;
            host.render_if_needed()?
        };
        if let Some(rendered) = rendered {
            self.panel_stats = Some(rendered.stats);
            self.panel_frame = Some(rendered.frame);
        }
        let frame = self
            .panel_frame
            .clone()
            .ok_or_else(|| "Slint panel did not produce a frame".to_string())?;
        Ok(RenderedPng {
            bytes: frame_png(frame)?,
            stats: self.panel_stats,
        })
    }

    fn panel_host(&mut self) -> Result<&mut SlintPanelHost, String> {
        if self.panel.is_none() {
            self.panel = Some(SlintPanelHost::new(default_slint_spike_size())?);
        }
        self.panel
            .as_mut()
            .ok_or_else(|| "Slint panel host is unavailable".to_string())
    }
}

impl RenderedPng {
    fn without_stats(bytes: Vec<u8>) -> Self {
        Self { bytes, stats: None }
    }
}

impl Default for DevtoolRenderer {
    fn default() -> Self {
        Self::new()
    }
}

pub fn frame_png(frame: RgbaFrame) -> Result<Vec<u8>, String> {
    if !frame.is_valid_len() {
        return Err(format!(
            "invalid frame length for {}x{}",
            frame.size.width, frame.size.height
        ));
    }
    let mut png = Vec::new();
    PngEncoder::new(&mut png)
        .write_image(
            &frame.data,
            frame.size.width,
            frame.size.height,
            ColorType::Rgba8.into(),
        )
        .map_err(|error| format!("encode PNG failed: {error}"))?;
    Ok(png)
}
