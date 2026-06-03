use crate::{
    layout::ellipsize_to_width,
    model::{
        Color, DeviceChip, DeviceRole, DeviceStatus, FeedLine, FeedRelation, OverlaySurfaceId, Rect,
    },
    scene::{DrawCommand, OverlayScene, TextStyle},
};

use super::{model::WristSurfaceModel, style};

pub fn build_wrist_scene(model: &WristSurfaceModel) -> OverlayScene {
    let mut scene = OverlayScene::new(OverlaySurfaceId::new("wrist"), model.size);
    let width = model.size.width as f32;
    let height = model.size.height as f32;
    let background = if model.dark_background {
        style::BACKGROUND
    } else {
        style::LIGHT_BACKGROUND
    };
    let panel = if model.dark_background {
        style::PANEL
    } else {
        style::LIGHT_PANEL
    };

    scene.push(DrawCommand::FillRect {
        rect: Rect::new(0.0, 0.0, width, height),
        color: background,
    });
    scene.push(DrawCommand::FillRect {
        rect: Rect::new(0.0, 0.0, width, style::TOP_BAR_HEIGHT),
        color: panel,
    });
    scene.push(DrawCommand::FillRect {
        rect: Rect::new(
            0.0,
            height - style::FOOTER_HEIGHT,
            width,
            style::FOOTER_HEIGHT,
        ),
        color: panel,
    });
    scene.push(DrawCommand::FillRect {
        rect: Rect::new(0.0, style::TOP_BAR_HEIGHT, width, 1.0),
        color: style::PANEL_DIVIDER,
    });
    scene.push(DrawCommand::FillRect {
        rect: Rect::new(0.0, height - style::FOOTER_HEIGHT, width, 1.0),
        color: style::PANEL_DIVIDER,
    });

    push_device_bar(&mut scene, model);
    push_feed_rows(&mut scene, model);
    push_footer(&mut scene, model);

    scene
}

fn push_device_bar(scene: &mut OverlayScene, model: &WristSurfaceModel) {
    let tokens = device_tokens(&model.devices, model.size.width as f32);
    let mut x = style::MARGIN;
    let y = 8.0;
    for token in tokens {
        let chip_width = device_token_width(&token, model.show_battery_percent);
        if x + chip_width > model.size.width as f32 - style::MARGIN {
            break;
        }
        let label_width = device_label_width(&token.label);
        scene.push(DrawCommand::Text {
            origin_x: x,
            origin_y: y + 2.0,
            max_width: label_width,
            text: ellipsize_to_width(&token.label, label_width, 14.0),
            style: TextStyle::new(14.0, 18.0, token_label_color(&token)),
        });
        let mut next_x = x + label_width + 5.0;
        if let Some(percent_text) = token.percent_text(model.show_battery_percent) {
            let percent_width = device_percent_width(&percent_text);
            scene.push(DrawCommand::Text {
                origin_x: next_x,
                origin_y: y + 2.0,
                max_width: percent_width,
                text: percent_text,
                style: TextStyle::new(13.0, 17.0, token_percent_color(&token)),
            });
            next_x += percent_width + 5.0;
        }
        if token.draw_battery {
            push_battery_icon(scene, next_x, y + 4.0, &token);
        }
        x += chip_width + 8.0;
    }
}

#[derive(Clone, Debug)]
struct DeviceToken {
    label: String,
    status: DeviceStatus,
    battery_percent: Option<u8>,
    aggregate_count: Option<usize>,
    abnormal: bool,
    draw_battery: bool,
}

impl DeviceToken {
    fn specific(device: &DeviceChip, label: String) -> Self {
        Self {
            label,
            status: device.status,
            battery_percent: device.battery_percent,
            aggregate_count: None,
            abnormal: is_abnormal_status(device.status),
            draw_battery: true,
        }
    }

    fn aggregate(label: String, count: usize, abnormal: bool) -> Self {
        Self {
            label,
            status: if abnormal {
                DeviceStatus::TrackingWarning
            } else {
                DeviceStatus::Normal
            },
            battery_percent: None,
            aggregate_count: Some(count),
            abnormal,
            draw_battery: false,
        }
    }

    fn percent_text(&self, show_percent: bool) -> Option<String> {
        if self.aggregate_count.is_some() || !show_percent {
            return None;
        }
        self.battery_percent.map(|percent| format!("{percent}%"))
    }
}

fn device_tokens(devices: &[DeviceChip], width: f32) -> Vec<DeviceToken> {
    let mut tokens = Vec::new();
    push_first_role_token(&mut tokens, devices, DeviceRole::Hmd, "HMD");
    push_first_role_token(&mut tokens, devices, DeviceRole::LeftController, "L");
    push_first_role_token(&mut tokens, devices, DeviceRole::RightController, "R");
    let abnormal_tracker_limit = abnormal_tracker_display_limit(width);

    let mut abnormal_trackers = devices
        .iter()
        .filter(|device| device.role == DeviceRole::Tracker && is_abnormal_status(device.status))
        .collect::<Vec<_>>();
    abnormal_trackers.sort_by(|left, right| {
        right
            .priority
            .cmp(&left.priority)
            .then_with(|| tracker_index(&left.label).cmp(&tracker_index(&right.label)))
    });
    for device in abnormal_trackers.iter().take(abnormal_tracker_limit) {
        tokens.push(DeviceToken::specific(device, device.label.clone()));
    }
    if abnormal_trackers.len() > abnormal_tracker_limit {
        tokens.push(DeviceToken::aggregate(
            format!("+{}", abnormal_trackers.len() - abnormal_tracker_limit),
            abnormal_trackers.len() - abnormal_tracker_limit,
            true,
        ));
    }

    let normal_tracker_count = devices
        .iter()
        .filter(|device| device.role == DeviceRole::Tracker && !is_abnormal_status(device.status))
        .count();
    if normal_tracker_count > 0 {
        tokens.push(DeviceToken::aggregate(
            format!("T×{normal_tracker_count}"),
            normal_tracker_count,
            false,
        ));
    }

    for device in devices
        .iter()
        .filter(|device| device.role == DeviceRole::Other && is_abnormal_status(device.status))
        .take(2)
    {
        tokens.push(DeviceToken::specific(device, device.label.clone()));
    }
    tokens
}

fn abnormal_tracker_display_limit(width: f32) -> usize {
    if width >= 600.0 {
        4
    } else if width >= 540.0 {
        3
    } else {
        2
    }
}

fn push_first_role_token(
    tokens: &mut Vec<DeviceToken>,
    devices: &[DeviceChip],
    role: DeviceRole,
    label: &str,
) {
    if let Some(device) = devices.iter().find(|device| device.role == role) {
        tokens.push(DeviceToken::specific(device, label.to_string()));
    }
}

fn tracker_index(label: &str) -> u32 {
    label
        .trim()
        .strip_prefix('T')
        .and_then(|value| value.parse::<u32>().ok())
        .unwrap_or(u32::MAX)
}

fn device_label_width(label: &str) -> f32 {
    let padding = if label == "HMD" { 12.0 } else { 4.0 };
    (estimated_text_width(label, 14.0) + padding).clamp(12.0, 48.0)
}

fn device_percent_width(text: &str) -> f32 {
    (estimated_text_width(text, 13.0) + 1.0).clamp(22.0, 34.0)
}

fn device_token_width(token: &DeviceToken, show_percent: bool) -> f32 {
    let label_width = device_label_width(&token.label);
    let percent_width = token
        .percent_text(show_percent)
        .map(|text| device_percent_width(&text) + 5.0)
        .unwrap_or_default();
    let battery_width = if token.draw_battery { 28.0 } else { 0.0 };
    label_width + percent_width + battery_width
}

fn push_battery_icon(scene: &mut OverlayScene, x: f32, y: f32, token: &DeviceToken) {
    let color = status_color(token.status);
    let body = Rect::new(x, y, 20.0, 11.0);
    scene.push(DrawCommand::StrokeRect {
        rect: body,
        color,
        width: 1.5,
    });
    scene.push(DrawCommand::FillRect {
        rect: Rect::new(x + 21.0, y + 3.5, 3.0, 4.0),
        color,
    });
    let fill_width = 15.0 * battery_fill_ratio(token.status, token.battery_percent);
    if fill_width > 0.0 {
        scene.push(DrawCommand::FillRect {
            rect: Rect::new(x + 2.5, y + 2.5, fill_width, 6.0),
            color,
        });
    }
}

fn battery_fill_ratio(status: DeviceStatus, battery_percent: Option<u8>) -> f32 {
    if let Some(percent) = battery_percent {
        return (percent as f32 / 100.0).clamp(0.0, 1.0);
    }
    match status {
        DeviceStatus::Normal | DeviceStatus::Charging => 1.0,
        DeviceStatus::LowBattery => 0.3,
        DeviceStatus::CriticalBattery => 0.15,
        DeviceStatus::TrackingWarning => 0.5,
        DeviceStatus::Disconnected => 0.0,
    }
}

fn push_feed_rows(scene: &mut OverlayScene, model: &WristSurfaceModel) {
    let top = style::TOP_BAR_HEIGHT + 6.0;
    let bottom = model.size.height as f32 - style::FOOTER_HEIGHT - 4.0;
    let max_rows = ((bottom - top) / style::FEED_ROW_HEIGHT).floor().max(0.0) as usize;
    let available_width = model.size.width as f32 - style::MARGIN * 2.0;
    for (index, row) in model.feed_rows.iter().take(max_rows).enumerate() {
        let y = top + index as f32 * style::FEED_ROW_HEIGHT;
        scene.push(DrawCommand::Text {
            origin_x: style::MARGIN,
            origin_y: y + 2.0,
            max_width: 52.0,
            text: row.time_text.clone(),
            style: TextStyle::new(14.0, 18.0, style::MUTED_TEXT),
        });
        push_feed_detail(
            scene,
            row,
            style::MARGIN + 58.0,
            y + 1.0,
            available_width - 58.0,
        );
        scene.push(DrawCommand::FillRect {
            rect: Rect::new(
                style::MARGIN,
                y + style::FEED_ROW_HEIGHT - 3.0,
                available_width,
                1.0,
            ),
            color: style::ROW_DIVIDER,
        });
    }
}

fn push_feed_detail(scene: &mut OverlayScene, row: &FeedLine, x: f32, y: f32, max_width: f32) {
    let actor = row.actor_text.trim();
    if actor.is_empty() || row.relation == FeedRelation::None {
        scene.push(DrawCommand::Text {
            origin_x: x,
            origin_y: y,
            max_width,
            text: ellipsize_to_width(&row.detail, max_width, 17.0),
            style: TextStyle::new(17.0, 21.0, detail_color(row)),
        });
        return;
    }

    let actor_max_width = max_width.min(actor_display_width_limit(max_width));
    let actor_text = ellipsize_to_width(actor, actor_max_width, 17.0);
    let actor_width = estimated_text_width(&actor_text, 17.0).min(actor_max_width);
    scene.push(DrawCommand::Text {
        origin_x: x,
        origin_y: y,
        max_width: actor_max_width,
        text: actor_text,
        style: TextStyle::new(17.0, 21.0, relation_color(row.relation)),
    });

    let rest = detail_without_actor(row.detail.trim(), actor);
    if rest.is_empty() {
        return;
    }
    let rest_x = x + actor_width + 8.0;
    let rest_width = (max_width - actor_width - 8.0).max(0.0);
    if rest_width <= 1.0 {
        return;
    }
    scene.push(DrawCommand::Text {
        origin_x: rest_x,
        origin_y: y,
        max_width: rest_width,
        text: ellipsize_to_width(&rest, rest_width, 17.0),
        style: TextStyle::new(17.0, 21.0, detail_color(row)),
    });
}

fn detail_without_actor(detail: &str, actor: &str) -> String {
    detail
        .strip_prefix(actor)
        .map(str::trim_start)
        .unwrap_or(detail)
        .to_string()
}

fn actor_display_width_limit(available_width: f32) -> f32 {
    if available_width >= 520.0 {
        230.0
    } else if available_width >= 440.0 {
        200.0
    } else {
        178.0
    }
}

fn push_footer(scene: &mut OverlayScene, model: &WristSurfaceModel) {
    let y = model.size.height as f32 - style::FOOTER_HEIGHT + 8.0;
    let width = model.size.width as f32;
    scene.push(DrawCommand::Text {
        origin_x: style::MARGIN,
        origin_y: y,
        max_width: 128.0,
        text: model.footer.left.clone(),
        style: TextStyle::new(13.0, 17.0, style::MUTED_TEXT),
    });
    scene.push(DrawCommand::Text {
        origin_x: width * 0.5 - 90.0,
        origin_y: y,
        max_width: 180.0,
        text: model.footer.center.clone(),
        style: TextStyle::new(13.0, 17.0, style::MUTED_TEXT),
    });
    scene.push(DrawCommand::Text {
        origin_x: width - style::MARGIN - 80.0,
        origin_y: y,
        max_width: 80.0,
        text: model.footer.right.clone(),
        style: TextStyle::new(13.0, 17.0, style::MUTED_TEXT),
    });
}

fn is_abnormal_status(status: DeviceStatus) -> bool {
    matches!(
        status,
        DeviceStatus::LowBattery
            | DeviceStatus::CriticalBattery
            | DeviceStatus::TrackingWarning
            | DeviceStatus::Disconnected
    )
}

fn token_label_color(token: &DeviceToken) -> Color {
    if token.aggregate_count.is_some() && token.abnormal {
        status_color(token.status)
    } else {
        style::MUTED_TEXT
    }
}

fn token_percent_color(token: &DeviceToken) -> Color {
    if is_abnormal_status(token.status) {
        status_color(token.status)
    } else {
        style::MUTED_TEXT
    }
}

fn status_color(status: DeviceStatus) -> Color {
    match status {
        DeviceStatus::Normal | DeviceStatus::Charging => style::NORMAL,
        DeviceStatus::LowBattery => style::LOW,
        DeviceStatus::CriticalBattery | DeviceStatus::Disconnected => style::CRITICAL,
        DeviceStatus::TrackingWarning => style::WARNING,
    }
}

fn relation_color(relation: FeedRelation) -> Color {
    match relation {
        FeedRelation::Favorite => style::FAVORITE_TEXT,
        FeedRelation::Friend => style::FRIEND_TEXT,
        FeedRelation::None => style::TEXT,
    }
}

fn detail_color(row: &FeedLine) -> Color {
    match row.kind {
        crate::model::FeedKind::Media => style::MUTED_TEXT,
        _ => style::TEXT,
    }
}

fn estimated_text_width(text: &str, font_size: f32) -> f32 {
    text.chars()
        .map(|ch| {
            let factor = if ch.is_ascii() { 0.55 } else { 1.0 };
            (font_size * factor).max(1.0)
        })
        .sum()
}
