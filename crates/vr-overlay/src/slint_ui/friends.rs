use std::cell::RefCell;
use std::rc::Rc;
use std::time::{Duration, Instant};

use slint::{
    platform::{self, software_renderer::PremultipliedRgbaColor},
    ComponentHandle, ModelRc, PhysicalSize, SharedString, VecModel,
};

use crate::{
    Color, FavoriteFriendsPanelModel, FriendPanelCategory, FriendPanelRow,
    FriendPanelRowPrimaryAction, FriendPanelStatusTone, OverlaySize, RgbaFrame,
};

use super::platform::{
    cached_avatar_image, create_component_window, pixel_count, pixels_to_rgba,
    retain_avatar_images, to_slint_color, to_window_event, AvatarImageCache,
    SlintPanelPointerEvent,
};
use super::{FriendPanelCategoryItem, FriendPanelRowItem, FriendsPanel};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct SlintPanelRenderStats {
    pub elapsed: Duration,
    pub dirty_area: u64,
    pub dirty_rects: usize,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SlintPanelFrame {
    pub frame: RgbaFrame,
    pub stats: SlintPanelRenderStats,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SlintPanelEvent {
    CategorySelected(String),
    RowClicked(String),
    ActionClicked { user_id: String, kind: String },
    ActionHoverLost { user_id: String, kind: String },
}

pub struct SlintPanelHost {
    size: OverlaySize,
    window: Rc<slint::platform::software_renderer::MinimalSoftwareWindow>,
    component: FriendsPanel,
    buffer: Vec<PremultipliedRgbaColor>,
    events: Rc<RefCell<Vec<SlintPanelEvent>>>,
    last_model: Option<FavoriteFriendsPanelModel>,
    avatar_images: AvatarImageCache,
}

impl SlintPanelHost {
    pub fn new(size: OverlaySize) -> Result<Self, String> {
        let (component, window) = create_component_window(FriendsPanel::new)?;
        window.set_size(PhysicalSize::new(size.width, size.height));
        let events = Rc::new(RefCell::new(Vec::new()));
        let category_events = Rc::clone(&events);
        component.on_category_selected(move |key| {
            category_events
                .borrow_mut()
                .push(SlintPanelEvent::CategorySelected(key.to_string()));
        });
        let row_events = Rc::clone(&events);
        component.on_row_clicked(move |user_id| {
            row_events
                .borrow_mut()
                .push(SlintPanelEvent::RowClicked(user_id.to_string()));
        });
        let action_events = Rc::clone(&events);
        component.on_action_clicked(move |user_id, kind| {
            action_events
                .borrow_mut()
                .push(SlintPanelEvent::ActionClicked {
                    user_id: user_id.to_string(),
                    kind: kind.to_string(),
                });
        });
        let hover_lost_events = Rc::clone(&events);
        component.on_action_hover_lost(move |user_id, kind| {
            hover_lost_events
                .borrow_mut()
                .push(SlintPanelEvent::ActionHoverLost {
                    user_id: user_id.to_string(),
                    kind: kind.to_string(),
                });
        });
        component.show().map_err(|error| error.to_string())?;
        let buffer = vec![PremultipliedRgbaColor::default(); pixel_count(size)?];
        Ok(Self {
            size,
            window,
            component,
            buffer,
            events,
            last_model: None,
            avatar_images: AvatarImageCache::new(),
        })
    }

    pub fn size(&self) -> OverlaySize {
        self.size
    }

    pub fn set_model(&mut self, model: &FavoriteFriendsPanelModel) {
        if self.last_model.as_ref() == Some(model) {
            return;
        }
        retain_avatar_images(
            &mut self.avatar_images,
            model.rows.iter().map(|row| row.avatar.as_ref()),
        );
        self.component
            .set_panel_title(SharedString::from(model.strings.title.as_str()));
        self.component.set_status_message(SharedString::from(
            model.status_message.as_deref().unwrap_or(""),
        ));
        self.component
            .set_empty_label(SharedString::from(model.strings.empty_label.as_str()));
        self.component.set_categories(friend_category_model(model));
        self.component
            .set_rows(friend_row_model(model, &mut self.avatar_images));
        self.component.window().request_redraw();
        self.last_model = Some(model.clone());
    }

    pub fn dispatch(&mut self, event: SlintPanelPointerEvent) -> Result<(), String> {
        self.component
            .window()
            .try_dispatch_event(to_window_event(event))
            .map_err(|error| error.to_string())
    }

    pub fn drain_events(&mut self) -> Vec<SlintPanelEvent> {
        self.events.borrow_mut().drain(..).collect()
    }

    pub fn render_if_needed(&mut self) -> Result<Option<SlintPanelFrame>, String> {
        platform::update_timers_and_animations();
        let mut dirty_area = 0_u64;
        let mut dirty_rects = 0_usize;
        let start = Instant::now();
        let redrawn = self.window.draw_if_needed(|renderer| {
            let region = renderer.render(&mut self.buffer, self.size.width as usize);
            for (_, rect_size) in region.iter() {
                dirty_area += u64::from(rect_size.width) * u64::from(rect_size.height);
                dirty_rects += 1;
            }
        });
        let elapsed = start.elapsed();
        if !redrawn {
            return Ok(None);
        }
        Ok(Some(SlintPanelFrame {
            frame: RgbaFrame::new(self.size, pixels_to_rgba(&self.buffer)),
            stats: SlintPanelRenderStats {
                elapsed,
                dirty_area,
                dirty_rects,
            },
        }))
    }

    pub fn has_active_animations(&self) -> bool {
        self.component.window().has_active_animations()
    }
}

fn friend_category_model(model: &FavoriteFriendsPanelModel) -> ModelRc<FriendPanelCategoryItem> {
    ModelRc::new(VecModel::from(
        model
            .categories
            .iter()
            .map(|category| friend_category_item(category, &model.selected_category_key))
            .collect::<Vec<_>>(),
    ))
}

fn friend_category_item(
    category: &FriendPanelCategory,
    selected_key: &str,
) -> FriendPanelCategoryItem {
    FriendPanelCategoryItem {
        key: SharedString::from(category.key.as_str()),
        label: SharedString::from(category.label.as_str()),
        count: SharedString::from(category.count.to_string().as_str()),
        selected: category.key == selected_key,
    }
}

fn friend_row_model(
    model: &FavoriteFriendsPanelModel,
    cache: &mut AvatarImageCache,
) -> ModelRc<FriendPanelRowItem> {
    ModelRc::new(VecModel::from(
        model
            .rows
            .iter()
            .map(|row| friend_row_item(row, model, cache))
            .collect::<Vec<_>>(),
    ))
}

fn friend_row_item(
    row: &FriendPanelRow,
    model: &FavoriteFriendsPanelModel,
    cache: &mut AvatarImageCache,
) -> FriendPanelRowItem {
    let (has_avatar, avatar) = cached_avatar_image(cache, row.avatar.as_ref());
    let (primary_label, primary_kind, has_primary) = match row.actions.primary {
        Some(FriendPanelRowPrimaryAction::Open) => {
            (model.strings.open_label.as_str(), "open", true)
        }
        Some(FriendPanelRowPrimaryAction::Request) => {
            (model.strings.request_label.as_str(), "request", true)
        }
        None => ("", "", false),
    };
    let armed_primary = has_primary
        && model.armed_action_region_id.as_deref()
            == Some(friend_action_id(&row.user_id, primary_kind).as_str());
    let armed_invite = row.actions.invite
        && model.armed_action_region_id.as_deref()
            == Some(friend_action_id(&row.user_id, "invite").as_str());
    let note_text = labeled_optional_text(&model.strings.note_label, row.note.as_deref());
    let memo_text = labeled_optional_text(&model.strings.memo_label, row.memo.as_deref());
    let section_label = row.section_label.as_deref().unwrap_or_default();
    FriendPanelRowItem {
        section_label: SharedString::from(section_label),
        user_id: SharedString::from(row.user_id.as_str()),
        display_name: SharedString::from(row.display_name.as_str()),
        location_text: SharedString::from(row.location_text.as_str()),
        traveling_text: SharedString::from(
            row.traveling_text
                .as_deref()
                .unwrap_or(row.location_text.as_str()),
        ),
        note_text: SharedString::from(note_text.as_str()),
        memo_text: SharedString::from(memo_text.as_str()),
        avatar,
        has_avatar,
        status_color: to_slint_color(friend_status_color(row.status)),
        name_color: to_slint_color(friend_name_color(row.status)),
        primary_label: SharedString::from(primary_label),
        primary_kind: SharedString::from(primary_kind),
        has_primary,
        has_invite: row.actions.invite,
        invite_label: SharedString::from(model.strings.invite_label.as_str()),
        armed_primary,
        armed_invite,
        is_traveling: row.is_traveling,
        is_section: row.section_label.is_some(),
    }
}

fn labeled_optional_text(label: &str, value: Option<&str>) -> String {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return String::new();
    };
    format!("{label}: {value}")
}

fn friend_action_id(user_id: &str, kind: &str) -> String {
    format!("action:{user_id}:{kind}")
}

fn friend_status_color(status: FriendPanelStatusTone) -> Color {
    match status {
        FriendPanelStatusTone::Online => Color::rgba(34, 197, 94, 255),
        FriendPanelStatusTone::Active => Color::rgba(45, 212, 191, 255),
        FriendPanelStatusTone::Busy => Color::rgba(248, 113, 113, 255),
        FriendPanelStatusTone::AskMe => Color::rgba(251, 191, 36, 255),
        FriendPanelStatusTone::Offline => Color::rgba(100, 116, 139, 255),
    }
}

fn friend_name_color(status: FriendPanelStatusTone) -> Color {
    match status {
        FriendPanelStatusTone::Offline => Color::rgba(148, 163, 184, 255),
        _ => Color::rgba(250, 204, 21, 255),
    }
}
