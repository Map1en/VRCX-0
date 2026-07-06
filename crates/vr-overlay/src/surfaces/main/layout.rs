use crate::{
    layout::{ellipsize_to_width, TextMeasurer},
    model::{FeedRelation, FeedSeverity, OverlaySurfaceId, Rect},
    scene::{DrawCommand, OverlayScene, TextStyle},
};

use super::{model::MainSurfaceModel, style};

pub fn build_main_scene(model: &MainSurfaceModel, text: &mut TextMeasurer) -> OverlayScene {
    let mut scene = OverlayScene::new(OverlaySurfaceId::new("main"), model.size);
    let width = model.size.width as f32;
    let height = model.size.height as f32;
    scene.push(DrawCommand::FillRect {
        rect: Rect::new(0.0, 0.0, width, height),
        color: style::BACKGROUND,
    });

    let card_width = style::CARD_WIDTH.min((width - style::MARGIN * 2.0).max(1.0));
    let x = (width - card_width) / 2.0;
    let mut y = height - style::MARGIN - style::CARD_HEIGHT;
    for toast in model.toasts.iter().rev().take(3).rev() {
        push_toast_card(&mut scene, text, model, x, y, card_width, toast);
        y -= style::CARD_HEIGHT + style::CARD_GAP;
        if y < 0.0 {
            break;
        }
    }
    scene
}

fn push_toast_card(
    scene: &mut OverlayScene,
    text: &mut TextMeasurer,
    model: &MainSurfaceModel,
    x: f32,
    y: f32,
    width: f32,
    toast: &super::model::ToastCard,
) {
    let card_color = if model.dark_background {
        style::CARD
    } else {
        style::LIGHT_CARD
    };
    scene.push(DrawCommand::FillRect {
        rect: Rect::new(x, y, width, style::CARD_HEIGHT),
        color: card_color,
    });
    scene.push(DrawCommand::FillRect {
        rect: Rect::new(x, y, style::STRIPE_WIDTH, style::CARD_HEIGHT),
        color: severity_color(toast.severity, model.accent),
    });

    let avatar_x = x + 24.0;
    let avatar_y = y + 24.0;
    if let Some(avatar) = &toast.avatar {
        scene.push(DrawCommand::Image {
            rect: Rect::new(avatar_x, avatar_y, style::AVATAR_SIZE, style::AVATAR_SIZE),
            rgba: avatar.rgba.clone(),
            width: avatar.width,
            height: avatar.height,
        });
    } else {
        scene.push(DrawCommand::Circle {
            center_x: avatar_x + style::AVATAR_SIZE / 2.0,
            center_y: avatar_y + style::AVATAR_SIZE / 2.0,
            radius: style::AVATAR_SIZE / 2.0,
            color: style::MUTED_TEXT,
        });
    }

    let text_x = avatar_x + style::AVATAR_SIZE + 22.0;
    let text_width = (x + width - 24.0 - text_x).max(1.0);
    let actor = actor_text(toast);
    scene.push(DrawCommand::Text {
        origin_x: text_x,
        origin_y: y + 22.0,
        max_width: text_width,
        text: ellipsize_to_width(text, &actor, text_width, 30.0),
        style: TextStyle::new(30.0, 36.0, relation_color(toast.relation)),
    });
    scene.push(DrawCommand::Text {
        origin_x: text_x,
        origin_y: y + 62.0,
        max_width: text_width,
        text: ellipsize_to_width(text, &toast.action, text_width, 23.0),
        style: TextStyle::new(23.0, 30.0, style::TEXT),
    });
    if let Some(context) = toast
        .context
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        scene.push(DrawCommand::Text {
            origin_x: text_x,
            origin_y: y + 96.0,
            max_width: text_width,
            text: ellipsize_to_width(text, context, text_width, 20.0),
            style: TextStyle::new(20.0, 26.0, style::MUTED_TEXT),
        });
    }
}

fn actor_text(toast: &super::model::ToastCard) -> String {
    let name = toast.actor_name.trim();
    if toast.relation == FeedRelation::Favorite && !name.is_empty() {
        format!("{name} ★")
    } else {
        name.to_string()
    }
}

fn relation_color(relation: FeedRelation) -> crate::model::Color {
    match relation {
        FeedRelation::Favorite => style::FAVORITE_TEXT,
        FeedRelation::Friend => style::FRIEND_TEXT,
        FeedRelation::None => style::TEXT,
    }
}

fn severity_color(severity: FeedSeverity, accent: crate::model::Color) -> crate::model::Color {
    match severity {
        FeedSeverity::Important => style::IMPORTANT,
        FeedSeverity::Warning => style::WARNING,
        FeedSeverity::Normal => accent,
    }
}
