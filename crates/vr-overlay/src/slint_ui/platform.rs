use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::{
    cell::{Cell, RefCell},
    rc::Rc,
    sync::{Mutex, OnceLock},
};

use slint::{
    platform::{
        self,
        software_renderer::{MinimalSoftwareWindow, PremultipliedRgbaColor, RepaintBufferType},
        Platform, PlatformError, WindowAdapter,
    },
    ComponentHandle, Image, Rgba8Pixel, SharedPixelBuffer,
};
#[cfg(feature = "friends-panel")]
use slint::{
    platform::{PointerEventButton, WindowEvent},
    LogicalPosition,
};

use crate::{AvatarBitmap, OverlaySize, RgbaFrame};

thread_local! {
    static LAST_CREATED_WINDOW: RefCell<Option<Rc<MinimalSoftwareWindow>>> = const { RefCell::new(None) };
}

thread_local! {
    static PLATFORM_SET: Cell<bool> = const { Cell::new(false) };
}

static PLATFORM_INIT_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

struct OverlaySlintPlatform;

impl Platform for OverlaySlintPlatform {
    fn create_window_adapter(&self) -> Result<Rc<dyn WindowAdapter>, PlatformError> {
        let window = MinimalSoftwareWindow::new(RepaintBufferType::ReusedBuffer);
        LAST_CREATED_WINDOW.with(|slot| {
            *slot.borrow_mut() = Some(Rc::clone(&window));
        });
        Ok(window)
    }
}

#[cfg(feature = "friends-panel")]
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum SlintPanelPointerEvent {
    Moved {
        x: f32,
        y: f32,
    },
    Pressed {
        x: f32,
        y: f32,
    },
    Released {
        x: f32,
        y: f32,
    },
    Scrolled {
        x: f32,
        y: f32,
        delta_x: f32,
        delta_y: f32,
    },
    Exited,
}

pub(super) type AvatarImageCache = HashMap<usize, (Arc<[u8]>, Image)>;

pub(super) fn cached_avatar_image(
    cache: &mut AvatarImageCache,
    avatar: Option<&AvatarBitmap>,
) -> (bool, Image) {
    let Some(avatar) = avatar else {
        return (false, Image::default());
    };
    let key = avatar_cache_key(avatar);
    if let Some((held, image)) = cache.get(&key) {
        if Arc::ptr_eq(held, &avatar.rgba) {
            return (true, image.clone());
        }
    }
    let (has_avatar, image) = avatar_image(Some(avatar));
    if has_avatar {
        cache.insert(key, (Arc::clone(&avatar.rgba), image.clone()));
    }
    (has_avatar, image)
}

pub(super) fn retain_avatar_images<'a>(
    cache: &mut AvatarImageCache,
    live: impl Iterator<Item = Option<&'a AvatarBitmap>>,
) {
    let live: HashSet<usize> = live.flatten().map(avatar_cache_key).collect();
    cache.retain(|key, _| live.contains(key));
}

pub(super) fn render_window_if_needed(
    window: &MinimalSoftwareWindow,
    buffer: &mut [PremultipliedRgbaColor],
    size: OverlaySize,
) -> Option<RgbaFrame> {
    platform::update_timers_and_animations();
    let redrawn = window.draw_if_needed(|renderer| {
        renderer.render(buffer, size.width as usize);
    });
    redrawn.then(|| RgbaFrame::new(size, pixels_to_rgba(buffer)))
}

pub(super) fn ensure_platform() -> Result<(), String> {
    PLATFORM_SET.with(|set| {
        if set.get() {
            return Ok(());
        }
        let _guard = PLATFORM_INIT_LOCK
            .get_or_init(|| Mutex::new(()))
            .lock()
            .map_err(|error| error.to_string())?;
        if set.get() {
            return Ok(());
        }
        let result = platform::set_platform(Box::new(OverlaySlintPlatform))
            .map_err(|error| error.to_string());
        if result.is_ok() {
            set.set(true);
        }
        result
    })
}

pub(super) fn create_component_window<C>(
    create: impl FnOnce() -> Result<C, PlatformError>,
) -> Result<(C, Rc<MinimalSoftwareWindow>), String>
where
    C: ComponentHandle,
{
    ensure_platform()?;
    take_last_created_window();
    let component = create().map_err(|error| error.to_string())?;
    let window = take_last_created_window()
        .ok_or_else(|| "Slint platform did not create a software window".to_string())?;
    Ok((component, window))
}

#[cfg(feature = "friends-panel")]
pub(super) fn to_window_event(event: SlintPanelPointerEvent) -> WindowEvent {
    match event {
        SlintPanelPointerEvent::Moved { x, y } => WindowEvent::PointerMoved {
            position: LogicalPosition::new(x, y),
        },
        SlintPanelPointerEvent::Pressed { x, y } => WindowEvent::PointerPressed {
            position: LogicalPosition::new(x, y),
            button: PointerEventButton::Left,
        },
        SlintPanelPointerEvent::Released { x, y } => WindowEvent::PointerReleased {
            position: LogicalPosition::new(x, y),
            button: PointerEventButton::Left,
        },
        SlintPanelPointerEvent::Scrolled {
            x,
            y,
            delta_x,
            delta_y,
        } => WindowEvent::PointerScrolled {
            position: LogicalPosition::new(x, y),
            delta_x,
            delta_y,
        },
        SlintPanelPointerEvent::Exited => WindowEvent::PointerExited,
    }
}

pub(super) fn pixel_count(size: OverlaySize) -> Result<usize, String> {
    RgbaFrame::expected_byte_len(size)
        .map(|bytes| bytes / 4)
        .ok_or_else(|| format!("invalid Slint panel size {}x{}", size.width, size.height))
}

pub(super) fn pixels_to_rgba(pixels: &[PremultipliedRgbaColor]) -> Vec<u8> {
    let mut rgba = Vec::with_capacity(pixels.len() * 4);
    for pixel in pixels {
        rgba.push(pixel.red);
        rgba.push(pixel.green);
        rgba.push(pixel.blue);
        rgba.push(pixel.alpha);
    }
    rgba
}

pub(super) fn to_slint_color(color: crate::Color) -> slint::Color {
    slint::Color::from_argb_u8(color.a, color.r, color.g, color.b)
}

fn take_last_created_window() -> Option<Rc<MinimalSoftwareWindow>> {
    LAST_CREATED_WINDOW.with(|slot| slot.borrow_mut().take())
}

fn avatar_cache_key(avatar: &AvatarBitmap) -> usize {
    Arc::as_ptr(&avatar.rgba) as *const u8 as usize
}

fn avatar_image(avatar: Option<&AvatarBitmap>) -> (bool, Image) {
    let Some(avatar) = avatar else {
        return (false, Image::default());
    };
    let expected_len = avatar
        .width
        .checked_mul(avatar.height)
        .and_then(|pixels| pixels.checked_mul(4))
        .map(|bytes| bytes as usize);
    if expected_len != Some(avatar.rgba.len()) {
        return (false, Image::default());
    }
    let buffer = SharedPixelBuffer::<Rgba8Pixel>::clone_from_slice(
        &avatar.rgba,
        avatar.width,
        avatar.height,
    );
    (true, Image::from_rgba8(buffer))
}
