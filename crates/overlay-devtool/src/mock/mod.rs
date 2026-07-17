use std::sync::Arc;

use vrcx_0_vr_overlay::{AvatarBitmap, Color};

pub mod friends;
pub mod toast;
pub mod wrist;

#[derive(Clone, Copy)]
pub struct ScenarioInfo {
    pub key: &'static str,
    pub label: &'static str,
}

pub fn normalize_scenario(
    scenarios: &'static [ScenarioInfo],
    scenario: &str,
    default: &'static str,
) -> &'static str {
    scenarios
        .iter()
        .find(|info| info.key == scenario)
        .map(|info| info.key)
        .unwrap_or(default)
}

pub fn accent() -> Color {
    Color::rgba(45, 212, 191, 255)
}

pub fn avatar(seed: u8) -> AvatarBitmap {
    let size = 64;
    let mut rgba = Vec::with_capacity(size * size * 4);
    let colors = [
        (45, 212, 191),
        (250, 204, 21),
        (96, 165, 250),
        (248, 113, 113),
        (167, 139, 250),
        (34, 197, 94),
    ];
    let (r, g, b) = colors[seed as usize % colors.len()];
    let center = size as f32 * 0.5 - 0.5;
    let radius = size as f32 * 0.44;
    for y in 0..size {
        for x in 0..size {
            let dx = x as f32 - center;
            let dy = y as f32 - center;
            let distance = (dx * dx + dy * dy).sqrt();
            let alpha = if distance <= radius { 255 } else { 0 };
            rgba.extend_from_slice(&[r, g, b, alpha]);
        }
    }
    AvatarBitmap {
        width: size as u32,
        height: size as u32,
        rgba: Arc::from(rgba),
    }
}
