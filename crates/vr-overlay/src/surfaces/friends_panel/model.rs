use crate::{
    model::{OverlaySize, UvPoint},
    scene::HitRegion,
};

use super::{layout::friends_panel_hit_regions, style};
use crate::surfaces::main::AvatarBitmap;

pub const FRIENDS_PANEL_ID: &str = "friends";
pub const LEGACY_DUMMY_PANEL_ID: &str = "dummy";
pub const FRIENDS_PANEL_SURFACE_ID: &str = "friends-panel";
pub const FRIENDS_PANEL_LASER_LEFT_SURFACE_ID: &str = "friends-panel-laser-left";
pub const FRIENDS_PANEL_LASER_RIGHT_SURFACE_ID: &str = "friends-panel-laser-right";

#[derive(Clone, Debug, PartialEq)]
pub enum FriendPanelAction {
    Hover,
    ClickDown,
    ClickUp,
    Scroll { delta: f32 },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FriendPanelStatusTone {
    Online,
    Active,
    Busy,
    AskMe,
    Offline,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FriendPanelCategory {
    pub key: String,
    pub label: String,
    pub count: usize,
}

#[derive(Clone, Debug, PartialEq)]
pub struct FriendPanelRow {
    pub user_id: String,
    pub display_name: String,
    pub status: FriendPanelStatusTone,
    pub location_text: String,
    pub is_traveling: bool,
    pub traveling_text: Option<String>,
    pub note: Option<String>,
    pub memo: Option<String>,
    pub avatar: Option<AvatarBitmap>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FriendPanelStrings {
    pub title: String,
    pub all_label: String,
    pub empty_label: String,
    pub note_label: String,
    pub memo_label: String,
}

impl Default for FriendPanelStrings {
    fn default() -> Self {
        Self {
            title: "Favorite Friends".to_string(),
            all_label: "All".to_string(),
            empty_label: "No favorite friends online".to_string(),
            note_label: "Note".to_string(),
            memo_label: "Memo".to_string(),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct FavoriteFriendsPanelModel {
    pub size: OverlaySize,
    pub categories: Vec<FriendPanelCategory>,
    pub selected_category_key: String,
    pub rows: Vec<FriendPanelRow>,
    pub hovered_region_id: Option<String>,
    pub pressed_region_id: Option<String>,
    pub pointer_uv: Option<UvPoint>,
    pub category_scroll_offset: usize,
    pub row_scroll_offset: usize,
    pub spinner_phase: f32,
    pub strings: FriendPanelStrings,
}

impl Default for FavoriteFriendsPanelModel {
    fn default() -> Self {
        let strings = FriendPanelStrings::default();
        Self {
            size: OverlaySize::new(1080, 720),
            categories: vec![FriendPanelCategory {
                key: "all".to_string(),
                label: strings.all_label.clone(),
                count: 0,
            }],
            selected_category_key: "all".to_string(),
            rows: Vec::new(),
            hovered_region_id: None,
            pressed_region_id: None,
            pointer_uv: None,
            category_scroll_offset: 0,
            row_scroll_offset: 0,
            spinner_phase: 0.0,
            strings,
        }
    }
}

impl FavoriteFriendsPanelModel {
    pub fn apply_uv_action(&mut self, uv: UvPoint, action: FriendPanelAction) -> Option<String> {
        match action {
            FriendPanelAction::Hover => {
                let hit = self.hit_region_at(uv).map(|region| region.id);
                self.pointer_uv = hit.as_ref().map(|_| uv);
                self.hovered_region_id = hit.clone();
                hit
            }
            FriendPanelAction::ClickDown => {
                let hit = self.hit_region_at(uv).map(|region| region.id);
                self.pressed_region_id = hit.clone();
                hit
            }
            FriendPanelAction::ClickUp => {
                let hit = self.hit_region_at(uv).map(|region| region.id);
                if self.pressed_region_id == hit {
                    if let Some(category_key) = hit
                        .as_deref()
                        .and_then(|id| id.strip_prefix("cat:"))
                        .map(str::to_string)
                    {
                        if self
                            .categories
                            .iter()
                            .any(|category| category.key == category_key)
                        {
                            self.selected_category_key = category_key;
                            self.row_scroll_offset = 0;
                        }
                    }
                }
                self.pressed_region_id = None;
                hit
            }
            FriendPanelAction::Scroll { delta } => {
                let hit = self.hit_region_at(uv).map(|region| region.id);
                if hit.as_deref().is_some_and(is_category_region) {
                    let max = self.max_category_scroll_offset() as i32;
                    let next = self.category_scroll_offset as i32 + delta.round() as i32;
                    self.category_scroll_offset = next.clamp(0, max) as usize;
                } else if hit.as_deref().is_some_and(is_row_region) {
                    let max = self.max_row_scroll_offset() as i32;
                    let next = self.row_scroll_offset as i32 + delta.round() as i32;
                    self.row_scroll_offset = next.clamp(0, max) as usize;
                }
                hit
            }
        }
    }

    pub fn max_row_scroll_offset(&self) -> usize {
        self.rows.len().saturating_sub(visible_row_count())
    }

    pub fn max_scroll_offset_rows(&self) -> usize {
        self.max_row_scroll_offset()
    }

    pub fn max_category_scroll_offset(&self) -> usize {
        self.categories
            .len()
            .saturating_sub(visible_category_count())
    }

    pub fn visible_categories(&self) -> impl Iterator<Item = (usize, &FriendPanelCategory)> {
        let start = self.category_scroll_offset.min(self.categories.len());
        self.categories
            .iter()
            .enumerate()
            .skip(start)
            .take(visible_category_count())
    }

    pub fn visible_rows(&self) -> impl Iterator<Item = (usize, &FriendPanelRow)> {
        let start = self.row_scroll_offset.min(self.rows.len());
        self.rows
            .iter()
            .enumerate()
            .skip(start)
            .take(visible_row_count())
    }

    pub fn has_visible_traveling_row(&self) -> bool {
        self.visible_rows().any(|(_, row)| row.is_traveling)
    }

    fn hit_region_at(&self, uv: UvPoint) -> Option<HitRegion> {
        friends_panel_hit_regions(self)
            .into_iter()
            .find(|region| region.contains_uv(self.size, uv))
    }
}

pub const fn visible_row_count() -> usize {
    style::VISIBLE_ROWS
}

pub const fn visible_category_count() -> usize {
    style::VISIBLE_CATEGORIES
}

fn is_category_region(id: &str) -> bool {
    id == "category-list" || id.starts_with("cat:")
}

fn is_row_region(id: &str) -> bool {
    id == "list" || id.starts_with("row:")
}
