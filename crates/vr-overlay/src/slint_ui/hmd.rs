use std::rc::Rc;

use slint::{
    platform::software_renderer::{MinimalSoftwareWindow, PremultipliedRgbaColor},
    ComponentHandle, ModelRc, PhysicalSize, SharedString, VecModel,
};

use crate::{FeedRelation, FeedSeverity, MainSurfaceModel, OverlaySize, RgbaFrame, ToastCard};

use super::platform::{
    cached_avatar_image, create_component_window, pixel_count, render_window_if_needed,
    retain_avatar_images, to_slint_color, AvatarImageCache,
};
use super::surface::SlintSurfaceHost;
use super::{HmdToastItem, HmdToastPanel};

pub struct SlintHmdHost {
    size: OverlaySize,
    window: Rc<MinimalSoftwareWindow>,
    component: HmdToastPanel,
    buffer: Vec<PremultipliedRgbaColor>,
    avatar_images: AvatarImageCache,
}

impl SlintSurfaceHost for SlintHmdHost {
    type Model = MainSurfaceModel;
    const LABEL: &'static str = "HMD";

    fn new(size: OverlaySize) -> Result<Self, String> {
        let (component, window) = create_component_window(HmdToastPanel::new)?;
        window.set_size(PhysicalSize::new(size.width, size.height));
        component.show().map_err(|error| error.to_string())?;
        Ok(Self {
            size,
            window,
            component,
            buffer: vec![PremultipliedRgbaColor::default(); pixel_count(size)?],
            avatar_images: AvatarImageCache::new(),
        })
    }

    fn size(&self) -> OverlaySize {
        self.size
    }

    fn model_size(model: &MainSurfaceModel) -> OverlaySize {
        model.size
    }

    fn window(&self) -> &slint::Window {
        self.component.window()
    }

    fn write_model(&mut self, model: &MainSurfaceModel) {
        retain_avatar_images(
            &mut self.avatar_images,
            model.toasts.iter().map(visible_toast_avatar),
        );
        self.component.set_dark_background(model.dark_background);
        self.component
            .set_toasts(hmd_toast_model(model, &mut self.avatar_images));
    }

    fn render_if_needed(&mut self) -> Option<RgbaFrame> {
        render_window_if_needed(&self.window, &mut self.buffer, self.size)
    }
}

fn visible_toast_avatar(toast: &ToastCard) -> Option<&crate::AvatarBitmap> {
    if toast.show_avatar {
        toast.avatar.as_ref()
    } else {
        None
    }
}

fn hmd_toast_model(
    model: &MainSurfaceModel,
    cache: &mut AvatarImageCache,
) -> ModelRc<HmdToastItem> {
    ModelRc::new(VecModel::from(
        model
            .toasts
            .iter()
            .rev()
            .take(3)
            .rev()
            .map(|toast| hmd_toast_item(toast, model.accent, cache))
            .collect::<Vec<_>>(),
    ))
}

fn hmd_toast_item(
    toast: &ToastCard,
    accent: crate::Color,
    cache: &mut AvatarImageCache,
) -> HmdToastItem {
    let (has_avatar, avatar) = cached_avatar_image(cache, visible_toast_avatar(toast));
    HmdToastItem {
        actor: SharedString::from(hmd_actor_text(toast)),
        action: SharedString::from(toast.action.as_str()),
        avatar,
        has_avatar,
        show_avatar: toast.show_avatar,
        relation_color: hmd_relation_color(toast.relation),
        severity_color: hmd_severity_color(toast.severity, accent),
    }
}

fn hmd_actor_text(toast: &ToastCard) -> String {
    let name = toast.actor_name.trim();
    if toast.relation == FeedRelation::Favorite && !name.is_empty() {
        format!("{name} ★")
    } else {
        name.to_string()
    }
}

fn hmd_relation_color(relation: FeedRelation) -> slint::Color {
    match relation {
        FeedRelation::Favorite => slint::Color::from_rgb_u8(245, 205, 84),
        FeedRelation::Friend => slint::Color::from_rgb_u8(246, 246, 246),
        FeedRelation::None => slint::Color::from_rgb_u8(238, 238, 238),
    }
}

fn hmd_severity_color(severity: FeedSeverity, accent: crate::Color) -> slint::Color {
    match severity {
        FeedSeverity::Important => slint::Color::from_rgb_u8(245, 158, 11),
        FeedSeverity::Warning => slint::Color::from_rgb_u8(239, 68, 68),
        FeedSeverity::Normal => to_slint_color(accent),
    }
}
