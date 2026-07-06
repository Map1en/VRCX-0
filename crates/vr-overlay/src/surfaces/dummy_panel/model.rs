use crate::{
    model::{OverlaySize, UvPoint},
    scene::HitRegion,
};

use super::layout::dummy_panel_hit_regions;

pub const INTERACTIVE_DUMMY_SURFACE_ID: &str = "interactive-dummy";

#[derive(Clone, Debug, PartialEq)]
pub enum DummyPanelAction {
    Hover,
    ClickDown,
    ClickUp,
    Scroll { delta: f32 },
}

#[derive(Clone, Debug, PartialEq)]
pub struct DummyPanelModel {
    pub size: OverlaySize,
    pub hovered_region_id: Option<String>,
    pub pressed_region_id: Option<String>,
    pub scroll_offset_rows: usize,
    pub primary_click_count: u32,
    pub secondary_click_count: u32,
    pub rows: Vec<String>,
}

impl Default for DummyPanelModel {
    fn default() -> Self {
        Self {
            size: OverlaySize::new(768, 576),
            hovered_region_id: None,
            pressed_region_id: None,
            scroll_offset_rows: 0,
            primary_click_count: 0,
            secondary_click_count: 0,
            rows: vec![
                "Input ray hover".to_string(),
                "Trigger click edge".to_string(),
                "Joystick scroll".to_string(),
                "Grip drag transform".to_string(),
                "Dynamic refresh".to_string(),
                "Stable hit region IDs".to_string(),
                "Runtime-owned visibility".to_string(),
                "VRChat input stays free".to_string(),
                "OpenXR no-op fallback".to_string(),
            ],
        }
    }
}

impl DummyPanelModel {
    pub fn apply_uv_action(&mut self, uv: UvPoint, action: DummyPanelAction) -> Option<String> {
        match action {
            DummyPanelAction::Hover => {
                let hit = self.hit_region_at(uv).map(|region| region.id);
                self.hovered_region_id = hit.clone();
                hit
            }
            DummyPanelAction::ClickDown => {
                let hit = self.hit_region_at(uv).map(|region| region.id);
                self.pressed_region_id = hit.clone();
                hit
            }
            DummyPanelAction::ClickUp => {
                let hit = self.hit_region_at(uv).map(|region| region.id);
                if self.pressed_region_id == hit {
                    match hit.as_deref() {
                        Some("button:primary") => {
                            self.primary_click_count = self.primary_click_count.saturating_add(1);
                        }
                        Some("button:secondary") => {
                            self.secondary_click_count =
                                self.secondary_click_count.saturating_add(1);
                        }
                        _ => {}
                    }
                }
                self.pressed_region_id = None;
                hit
            }
            DummyPanelAction::Scroll { delta } => {
                let max = self.max_scroll_offset_rows() as i32;
                let next = self.scroll_offset_rows as i32 + delta.round() as i32;
                self.scroll_offset_rows = next.clamp(0, max) as usize;
                self.hit_region_at(uv).map(|region| region.id)
            }
        }
    }

    pub fn max_scroll_offset_rows(&self) -> usize {
        self.rows.len().saturating_sub(visible_row_count())
    }

    fn hit_region_at(&self, uv: UvPoint) -> Option<HitRegion> {
        dummy_panel_hit_regions(self.size)
            .into_iter()
            .find(|region| region.contains_uv(self.size, uv))
    }
}

pub fn visible_row_count() -> usize {
    5
}
