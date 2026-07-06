use crate::{
    model::{Color, OverlaySize, OverlaySurfaceId, Rect},
    scene::{DrawCommand, HitRegion, OverlayScene, TextStyle},
};

use super::model::{visible_row_count, DummyPanelModel, INTERACTIVE_DUMMY_SURFACE_ID};

const BACKGROUND: Color = Color::rgba(9, 15, 23, 235);
const PANEL: Color = Color::rgba(20, 28, 38, 245);
const PANEL_ALT: Color = Color::rgba(30, 41, 59, 245);
const PANEL_HOVER: Color = Color::rgba(51, 65, 85, 245);
const PANEL_PRESSED: Color = Color::rgba(14, 116, 144, 255);
const PANEL_SECONDARY_ACTIVE: Color = Color::rgba(91, 33, 182, 255);
const TEXT: Color = Color::rgba(248, 250, 252, 255);
const MUTED: Color = Color::rgba(148, 163, 184, 255);
const ACCENT: Color = Color::rgba(45, 212, 191, 255);
const DIVIDER: Color = Color::rgba(71, 85, 105, 255);

pub fn build_dummy_panel_scene(model: &DummyPanelModel) -> OverlayScene {
    let mut scene = OverlayScene::new(
        OverlaySurfaceId::new(INTERACTIVE_DUMMY_SURFACE_ID),
        model.size,
    );
    let width = model.size.width as f32;
    let height = model.size.height as f32;

    scene.push(DrawCommand::FillRect {
        rect: Rect::new(0.0, 0.0, width, height),
        color: BACKGROUND,
    });
    scene.push(DrawCommand::FillRect {
        rect: Rect::new(24.0, 24.0, width - 48.0, height - 48.0),
        color: PANEL,
    });
    scene.push(DrawCommand::Text {
        origin_x: 48.0,
        origin_y: 48.0,
        max_width: width - 96.0,
        text: "P0 Interactive Dummy".to_string(),
        style: TextStyle::new(32.0, 38.0, TEXT),
    });
    scene.push(DrawCommand::Text {
        origin_x: 48.0,
        origin_y: 92.0,
        max_width: width - 96.0,
        text: "hover / click / scroll / grab".to_string(),
        style: TextStyle::new(20.0, 26.0, MUTED),
    });

    push_button(
        &mut scene,
        Rect::new(48.0, 144.0, 300.0, 88.0),
        "button:primary",
        &format!("Primary {}", model.primary_click_count),
        model,
        if model.primary_click_count > 0 {
            PANEL_PRESSED
        } else {
            PANEL_ALT
        },
    );
    push_button(
        &mut scene,
        Rect::new(372.0, 144.0, 300.0, 88.0),
        "button:secondary",
        &format!("Secondary {}", model.secondary_click_count),
        model,
        if model.secondary_click_count > 0 {
            PANEL_SECONDARY_ACTIVE
        } else {
            PANEL_ALT
        },
    );

    let list_rect = Rect::new(48.0, 264.0, width - 96.0, 240.0);
    scene.push(DrawCommand::FillRect {
        rect: list_rect,
        color: PANEL_ALT,
    });
    scene.push(DrawCommand::StrokeRect {
        rect: list_rect,
        color: if model.hovered_region_id.as_deref() == Some("list") {
            ACCENT
        } else {
            DIVIDER
        },
        width: 2.0,
    });
    push_rows(&mut scene, model, list_rect);

    scene.hit_regions = dummy_panel_hit_regions(model.size);
    scene
}

pub fn dummy_panel_hit_regions(size: OverlaySize) -> Vec<HitRegion> {
    let width = size.width as f32;
    vec![
        HitRegion {
            id: "button:primary".to_string(),
            rect: Rect::new(48.0, 144.0, 300.0, 88.0),
        },
        HitRegion {
            id: "button:secondary".to_string(),
            rect: Rect::new(372.0, 144.0, 300.0, 88.0),
        },
        HitRegion {
            id: "list".to_string(),
            rect: Rect::new(48.0, 264.0, width - 96.0, 240.0),
        },
    ]
}

fn push_button(
    scene: &mut OverlayScene,
    rect: Rect,
    id: &str,
    label: &str,
    model: &DummyPanelModel,
    base_color: Color,
) {
    let is_pressed = model.pressed_region_id.as_deref() == Some(id);
    let is_hovered = model.hovered_region_id.as_deref() == Some(id);
    let color = if is_pressed {
        PANEL_PRESSED
    } else if base_color == PANEL_PRESSED || base_color == PANEL_SECONDARY_ACTIVE {
        base_color
    } else if is_hovered {
        PANEL_HOVER
    } else {
        base_color
    };
    let stroke_color = if is_pressed || is_hovered {
        ACCENT
    } else {
        DIVIDER
    };
    scene.push(DrawCommand::FillRect { rect, color });
    scene.push(DrawCommand::StrokeRect {
        rect,
        color: stroke_color,
        width: 2.0,
    });
    scene.push(DrawCommand::Text {
        origin_x: rect.x + 24.0,
        origin_y: rect.y + 26.0,
        max_width: rect.width - 48.0,
        text: label.to_string(),
        style: TextStyle::new(24.0, 30.0, TEXT),
    });
}

fn push_rows(scene: &mut OverlayScene, model: &DummyPanelModel, rect: Rect) {
    let row_height = 42.0;
    let start = model.scroll_offset_rows.min(model.rows.len());
    let visible = visible_row_count();
    for (index, row) in model.rows.iter().skip(start).take(visible).enumerate() {
        let y = rect.y + 18.0 + index as f32 * row_height;
        scene.push(DrawCommand::Text {
            origin_x: rect.x + 24.0,
            origin_y: y,
            max_width: rect.width - 48.0,
            text: row.clone(),
            style: TextStyle::new(20.0, 26.0, if index == 0 { TEXT } else { MUTED }),
        });
        if index + 1 < visible {
            scene.push(DrawCommand::FillRect {
                rect: Rect::new(rect.x + 16.0, y + 32.0, rect.width - 32.0, 1.0),
                color: DIVIDER,
            });
        }
    }
}
