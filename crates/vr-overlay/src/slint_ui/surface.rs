use crate::{OverlaySize, RgbaFrame};

pub trait SlintSurfaceHost: Sized {
    type Model: Clone + PartialEq;
    const LABEL: &'static str;

    fn new(size: OverlaySize) -> Result<Self, String>;
    fn size(&self) -> OverlaySize;
    fn model_size(model: &Self::Model) -> OverlaySize;
    fn window(&self) -> &slint::Window;
    fn write_model(&mut self, model: &Self::Model);
    fn render_if_needed(&mut self) -> Option<RgbaFrame>;

    fn apply_model(&mut self, model: &Self::Model) {
        self.write_model(model);
        self.window().request_redraw();
    }
}

pub struct SlintSurfaceRenderer<H: SlintSurfaceHost> {
    host: Option<H>,
    last_model: Option<H::Model>,
    last_frame: Option<RgbaFrame>,
    render_count: usize,
}

impl<H: SlintSurfaceHost> SlintSurfaceRenderer<H> {
    pub fn new() -> Self {
        Self {
            host: None,
            last_model: None,
            last_frame: None,
            render_count: 0,
        }
    }

    pub fn render(&mut self, model: &H::Model) -> Result<RgbaFrame, String> {
        if self.last_model.as_ref() == Some(model) {
            if let Some(frame) = self.last_frame.as_ref() {
                return Ok(frame.clone());
            }
        }
        let host = self.host_for_size(H::model_size(model))?;
        host.apply_model(model);
        let rendered = host.render_if_needed();
        self.last_model = Some(model.clone());
        let Some(frame) = rendered else {
            return self.last_frame.clone().ok_or_else(|| {
                format!(
                    "Slint {} renderer did not produce an initial frame",
                    H::LABEL
                )
            });
        };
        self.render_count += 1;
        self.last_frame = Some(frame.clone());
        Ok(frame)
    }

    #[cfg(test)]
    pub(super) fn render_count(&self) -> usize {
        self.render_count
    }

    fn host_for_size(&mut self, size: OverlaySize) -> Result<&mut H, String> {
        let needs_new = self
            .host
            .as_ref()
            .map(|host| host.size() != size)
            .unwrap_or(true);
        if needs_new {
            self.host = Some(H::new(size)?);
            self.last_model = None;
            self.last_frame = None;
        }
        self.host
            .as_mut()
            .ok_or_else(|| format!("Slint {} host is unavailable", H::LABEL))
    }
}

impl<H: SlintSurfaceHost> Default for SlintSurfaceRenderer<H> {
    fn default() -> Self {
        Self::new()
    }
}

pub type SlintWristRenderer = SlintSurfaceRenderer<super::wrist::SlintWristHost>;
pub type SlintHmdRenderer = SlintSurfaceRenderer<super::hmd::SlintHmdHost>;
