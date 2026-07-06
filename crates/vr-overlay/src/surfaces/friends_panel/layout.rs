use crate::{
    model::{Color, OverlaySize, OverlaySurfaceId, Rect},
    scene::{DrawCommand, HitRegion, OverlayScene, TextStyle},
};

use super::{
    model::{
        visible_category_count, visible_row_count, FavoriteFriendsPanelModel, FriendPanelRow,
        FriendPanelStatusTone, FRIENDS_PANEL_SURFACE_ID,
    },
    style,
};

pub fn build_friends_panel_scene(model: &FavoriteFriendsPanelModel) -> OverlayScene {
    let mut scene = OverlayScene::new(OverlaySurfaceId::new(FRIENDS_PANEL_SURFACE_ID), model.size);
    let width = model.size.width as f32;
    let height = model.size.height as f32;

    scene.push(DrawCommand::FillRect {
        rect: Rect::new(0.0, 0.0, width, height),
        color: style::BACKGROUND,
    });
    scene.push(DrawCommand::FillRect {
        rect: Rect::new(
            style::MARGIN,
            style::MARGIN,
            width - style::MARGIN * 2.0,
            height - style::MARGIN * 2.0,
        ),
        color: style::PANEL,
    });
    scene.push(DrawCommand::Text {
        origin_x: style::MARGIN + 22.0,
        origin_y: style::HEADER_Y,
        max_width: width - style::MARGIN * 2.0 - 44.0,
        text: model.strings.title.clone(),
        style: TextStyle::new(32.0, 38.0, style::TEXT),
    });

    let categories_rect = category_list_rect();
    let list_rect = list_rect(model.size);
    push_panel_list_frame(&mut scene, categories_rect, "category-list", model);
    push_panel_list_frame(&mut scene, list_rect, "list", model);
    push_categories(&mut scene, model, categories_rect);

    if model.rows.is_empty() {
        scene.push(DrawCommand::Text {
            origin_x: list_rect.x + 28.0,
            origin_y: list_rect.y + 42.0,
            max_width: list_rect.width - 56.0,
            text: model.strings.empty_label.clone(),
            style: TextStyle::new(24.0, 30.0, style::MUTED),
        });
    } else {
        push_rows(&mut scene, model, list_rect);
    }
    push_pointer_reticle(&mut scene, model);

    scene.hit_regions = friends_panel_hit_regions(model);
    scene
}

pub fn friends_panel_hit_regions(model: &FavoriteFriendsPanelModel) -> Vec<HitRegion> {
    let mut regions = Vec::new();
    let category_list = category_list_rect();
    for (visible_index, (_, category)) in model.visible_categories().enumerate() {
        regions.push(HitRegion {
            id: format!("cat:{}", category.key),
            rect: Rect::new(
                category_list.x,
                category_list.y + visible_index as f32 * style::CATEGORY_HEIGHT,
                category_list.width,
                style::CATEGORY_HEIGHT,
            ),
        });
    }
    regions.push(HitRegion {
        id: "category-list".to_string(),
        rect: category_list,
    });
    let list = list_rect(model.size);
    for (visible_index, (_, row)) in model.visible_rows().enumerate() {
        regions.push(HitRegion {
            id: format!("row:{}", row.user_id),
            rect: Rect::new(
                list.x,
                list.y + visible_index as f32 * style::ROW_HEIGHT,
                list.width,
                style::ROW_HEIGHT,
            ),
        });
    }
    regions.push(HitRegion {
        id: "list".to_string(),
        rect: list,
    });
    regions
}

fn push_panel_list_frame(
    scene: &mut OverlayScene,
    rect: Rect,
    hover_region_id: &str,
    model: &FavoriteFriendsPanelModel,
) {
    scene.push(DrawCommand::FillRect {
        rect,
        color: style::PANEL_ALT,
    });
    scene.push(DrawCommand::StrokeRect {
        rect,
        color: if model.hovered_region_id.as_deref() == Some(hover_region_id) {
            style::ACCENT
        } else {
            style::DIVIDER
        },
        width: 2.0,
    });
}

fn push_categories(scene: &mut OverlayScene, model: &FavoriteFriendsPanelModel, list_rect: Rect) {
    for (visible_index, (_, category)) in model.visible_categories().enumerate() {
        let rect = Rect::new(
            list_rect.x,
            list_rect.y + visible_index as f32 * style::CATEGORY_HEIGHT,
            list_rect.width,
            style::CATEGORY_HEIGHT,
        );
        let id = format!("cat:{}", category.key);
        let selected = model.selected_category_key == category.key;
        let hovered = model.hovered_region_id.as_deref() == Some(id.as_str());
        let pressed = model.pressed_region_id.as_deref() == Some(id.as_str());
        let fill = if pressed {
            style::PANEL_PRESSED
        } else if selected {
            Color::rgba(37, 99, 110, 255)
        } else if hovered {
            style::PANEL_HOVER
        } else {
            style::PANEL_ALT
        };
        scene.push(DrawCommand::FillRect { rect, color: fill });
        scene.push(DrawCommand::StrokeRect {
            rect,
            color: if selected || hovered || pressed {
                style::ACCENT
            } else {
                style::DIVIDER
            },
            width: 2.0,
        });
        scene.push(DrawCommand::Text {
            origin_x: rect.x + 16.0,
            origin_y: rect.y + 14.0,
            max_width: rect.width - 32.0,
            text: format!("{} {}", category.label, category.count),
            style: TextStyle::new(
                19.0,
                24.0,
                if selected { style::TEXT } else { style::MUTED },
            ),
        });
    }
}

fn push_rows(scene: &mut OverlayScene, model: &FavoriteFriendsPanelModel, list_rect: Rect) {
    for (visible_index, (_, row)) in model.visible_rows().enumerate() {
        let rect = Rect::new(
            list_rect.x,
            list_rect.y + visible_index as f32 * style::ROW_HEIGHT,
            list_rect.width,
            style::ROW_HEIGHT,
        );
        let id = format!("row:{}", row.user_id);
        let hovered = model.hovered_region_id.as_deref() == Some(id.as_str());
        let pressed = model.pressed_region_id.as_deref() == Some(id.as_str());
        let fill = if pressed {
            Color::rgba(23, 93, 112, 255)
        } else if hovered {
            style::PANEL_HOVER
        } else if visible_index % 2 == 0 {
            style::PANEL_ALT
        } else {
            Color::rgba(21, 31, 43, 248)
        };
        scene.push(DrawCommand::FillRect { rect, color: fill });
        push_row_contents(scene, model, row, rect);
        if visible_index + 1 < visible_row_count() {
            scene.push(DrawCommand::FillRect {
                rect: Rect::new(
                    rect.x + 18.0,
                    rect.y + rect.height - 1.0,
                    rect.width - 36.0,
                    1.0,
                ),
                color: style::DIVIDER,
            });
        }
    }
}

fn push_pointer_reticle(scene: &mut OverlayScene, model: &FavoriteFriendsPanelModel) {
    let Some(pointer) = model.pointer_uv else {
        return;
    };
    let center_x = pointer.x * model.size.width as f32;
    let center_y = pointer.y * model.size.height as f32;
    scene.push(DrawCommand::Circle {
        center_x,
        center_y,
        radius: 13.0,
        color: Color::rgba(style::ACCENT.r, style::ACCENT.g, style::ACCENT.b, 92),
    });
    scene.push(DrawCommand::Circle {
        center_x,
        center_y,
        radius: 5.0,
        color: style::ACCENT,
    });
}

fn push_row_contents(
    scene: &mut OverlayScene,
    model: &FavoriteFriendsPanelModel,
    row: &FriendPanelRow,
    rect: Rect,
) {
    let avatar_x = rect.x + 22.0;
    let avatar_y = rect.y + 17.0;
    if let Some(avatar) = &row.avatar {
        scene.push(DrawCommand::Image {
            rect: Rect::new(avatar_x, avatar_y, style::AVATAR_SIZE, style::AVATAR_SIZE),
            rgba: avatar.rgba.clone(),
            width: avatar.width,
            height: avatar.height,
        });
    } else {
        scene.push(DrawCommand::Circle {
            center_x: avatar_x + style::AVATAR_SIZE * 0.5,
            center_y: avatar_y + style::AVATAR_SIZE * 0.5,
            radius: style::AVATAR_SIZE * 0.5,
            color: Color::rgba(51, 65, 85, 255),
        });
    }

    scene.push(DrawCommand::Circle {
        center_x: avatar_x + style::AVATAR_SIZE - 8.0,
        center_y: avatar_y + style::AVATAR_SIZE - 8.0,
        radius: 8.0,
        color: status_color(row.status),
    });

    let text_x = avatar_x + style::AVATAR_SIZE + 22.0;
    let right_reserved = if row.is_traveling { 92.0 } else { 28.0 };
    let text_width = (rect.x + rect.width - right_reserved - text_x).max(1.0);
    scene.push(DrawCommand::Text {
        origin_x: text_x,
        origin_y: rect.y + 12.0,
        max_width: text_width,
        text: row.display_name.clone(),
        style: TextStyle::new(26.0, 32.0, style::FAVORITE),
    });
    scene.push(DrawCommand::Text {
        origin_x: text_x,
        origin_y: rect.y + 43.0,
        max_width: text_width,
        text: location_line(row),
        style: TextStyle::new(20.0, 26.0, style::TEXT),
    });
    if let Some(note) = row.note.as_deref().filter(|value| !value.trim().is_empty()) {
        scene.push(DrawCommand::Text {
            origin_x: text_x,
            origin_y: rect.y + 68.0,
            max_width: text_width * 0.49,
            text: format!("{}: {note}", model.strings.note_label),
            style: TextStyle::new(16.0, 22.0, style::MUTED),
        });
    }
    if let Some(memo) = row.memo.as_deref().filter(|value| !value.trim().is_empty()) {
        scene.push(DrawCommand::Text {
            origin_x: text_x + text_width * 0.51,
            origin_y: rect.y + 68.0,
            max_width: text_width * 0.49,
            text: format!("{}: {memo}", model.strings.memo_label),
            style: TextStyle::new(16.0, 22.0, style::SUBTLE),
        });
    }

    if row.is_traveling {
        push_spinner(
            scene,
            rect.x + rect.width - 48.0,
            rect.y + rect.height * 0.5,
            model.spinner_phase,
        );
    }
}

fn location_line(row: &FriendPanelRow) -> String {
    if row.is_traveling {
        return row
            .traveling_text
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .map(|target| format!("{} -> {target}", row.location_text))
            .unwrap_or_else(|| row.location_text.clone());
    }
    row.location_text.clone()
}

fn push_spinner(scene: &mut OverlayScene, center_x: f32, center_y: f32, phase: f32) {
    let phase = phase.rem_euclid(1.0);
    for index in 0..8 {
        let angle = (index as f32 / 8.0 + phase) * std::f32::consts::TAU;
        let alpha = 70 + ((index as f32 / 7.0) * 185.0).round() as u8;
        scene.push(DrawCommand::Circle {
            center_x: center_x + angle.cos() * 16.0,
            center_y: center_y + angle.sin() * 16.0,
            radius: 4.0,
            color: Color::rgba(style::ACCENT.r, style::ACCENT.g, style::ACCENT.b, alpha),
        });
    }
}

fn status_color(status: FriendPanelStatusTone) -> Color {
    match status {
        FriendPanelStatusTone::Online => style::ONLINE,
        FriendPanelStatusTone::Active => style::ACTIVE,
        FriendPanelStatusTone::Busy => style::BUSY,
        FriendPanelStatusTone::AskMe => style::ASK_ME,
        FriendPanelStatusTone::Offline => style::OFFLINE,
    }
}

fn list_rect(size: OverlaySize) -> Rect {
    let width = size.width as f32;
    let categories = category_list_rect();
    let x = categories.x + categories.width + style::CATEGORY_GAP;
    Rect::new(
        x,
        style::LIST_Y,
        width - x - style::MARGIN - 22.0,
        style::ROW_HEIGHT * visible_row_count() as f32,
    )
}

fn category_list_rect() -> Rect {
    Rect::new(
        style::MARGIN + 22.0,
        style::LIST_Y,
        style::CATEGORY_WIDTH,
        style::CATEGORY_HEIGHT * visible_category_count() as f32,
    )
}
