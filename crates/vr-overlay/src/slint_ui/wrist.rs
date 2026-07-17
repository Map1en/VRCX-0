use std::rc::Rc;

use slint::{
    platform::software_renderer::{MinimalSoftwareWindow, PremultipliedRgbaColor},
    ComponentHandle, ModelRc, PhysicalSize, SharedString, VecModel,
};

use crate::{
    Color, DeviceChip, DeviceRole, DeviceStatus, FeedKind, FeedLine, FeedRelation, FeedSeverity,
    OverlaySize, RgbaFrame, WristSurfaceModel,
};

use super::platform::{
    create_component_window, pixel_count, render_window_if_needed, to_slint_color,
};
use super::surface::SlintSurfaceHost;
use super::{WristDeviceItem, WristFeedItem, WristPanel};

const WRIST_TEXT: Color = Color::rgba(238, 238, 238, 255);
const WRIST_FRIEND_TEXT: Color = Color::rgba(246, 246, 246, 255);
const WRIST_FAVORITE_TEXT: Color = Color::rgba(245, 205, 84, 255);
pub(super) const WRIST_MUTED_TEXT: Color = Color::rgba(168, 168, 168, 255);
const WRIST_LOW: Color = Color::rgba(245, 158, 11, 255);
const WRIST_CRITICAL: Color = Color::rgba(239, 68, 68, 255);
const WRIST_NORMAL: Color = Color::rgba(34, 197, 94, 255);
const WRIST_WARNING: Color = Color::rgba(251, 191, 36, 255);

pub struct SlintWristHost {
    size: OverlaySize,
    window: Rc<MinimalSoftwareWindow>,
    component: WristPanel,
    buffer: Vec<PremultipliedRgbaColor>,
}

impl SlintSurfaceHost for SlintWristHost {
    type Model = WristSurfaceModel;
    const LABEL: &'static str = "wrist";

    fn new(size: OverlaySize) -> Result<Self, String> {
        let (component, window) = create_component_window(WristPanel::new)?;
        window.set_size(PhysicalSize::new(size.width, size.height));
        component.show().map_err(|error| error.to_string())?;
        Ok(Self {
            size,
            window,
            component,
            buffer: vec![PremultipliedRgbaColor::default(); pixel_count(size)?],
        })
    }

    fn size(&self) -> OverlaySize {
        self.size
    }

    fn model_size(model: &WristSurfaceModel) -> OverlaySize {
        model.size
    }

    fn window(&self) -> &slint::Window {
        self.component.window()
    }

    fn write_model(&mut self, model: &WristSurfaceModel) {
        self.component.set_dark_background(model.dark_background);
        self.component
            .set_accent_color(to_slint_color(model.accent));
        self.component.set_devices(wrist_device_model(model));
        self.component
            .set_feed_lines(wrist_feed_model(&model.feed_rows));
        self.component
            .set_footer_left(SharedString::from(model.footer.left.as_str()));
        self.component
            .set_footer_center(SharedString::from(model.footer.center.as_str()));
        self.component
            .set_footer_right(SharedString::from(model.footer.right.as_str()));
    }

    fn render_if_needed(&mut self) -> Option<RgbaFrame> {
        render_window_if_needed(&self.window, &mut self.buffer, self.size)
    }
}

#[derive(Clone, Debug)]
pub(super) struct WristDeviceToken {
    pub(super) label: String,
    status: DeviceStatus,
    battery_percent: Option<u8>,
    aggregate_count: Option<usize>,
    abnormal: bool,
    draw_battery: bool,
}

impl WristDeviceToken {
    fn specific(device: &DeviceChip, label: String) -> Self {
        Self {
            label,
            status: device.status,
            battery_percent: device.battery_percent,
            aggregate_count: None,
            abnormal: is_abnormal_device_status(device.status),
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

fn wrist_device_model(model: &WristSurfaceModel) -> ModelRc<WristDeviceItem> {
    ModelRc::new(VecModel::from(
        wrist_device_tokens(&model.devices, model.size.width as f32)
            .into_iter()
            .map(|token| wrist_device_item(&token, model.show_battery_percent))
            .collect::<Vec<_>>(),
    ))
}

pub(super) fn wrist_device_tokens(devices: &[DeviceChip], width: f32) -> Vec<WristDeviceToken> {
    let mut tokens = Vec::new();
    push_wrist_role_token(&mut tokens, devices, DeviceRole::Hmd, "HMD");
    push_wrist_role_token(&mut tokens, devices, DeviceRole::LeftController, "L");
    push_wrist_role_token(&mut tokens, devices, DeviceRole::RightController, "R");

    let abnormal_tracker_limit = abnormal_tracker_display_limit(width);
    let mut abnormal_trackers = devices
        .iter()
        .filter(|device| {
            device.role == DeviceRole::Tracker && is_abnormal_device_status(device.status)
        })
        .collect::<Vec<_>>();
    abnormal_trackers.sort_by(|left, right| {
        right
            .priority
            .cmp(&left.priority)
            .then_with(|| tracker_index(&left.label).cmp(&tracker_index(&right.label)))
    });
    for device in abnormal_trackers.iter().take(abnormal_tracker_limit) {
        tokens.push(WristDeviceToken::specific(device, device.label.clone()));
    }
    if abnormal_trackers.len() > abnormal_tracker_limit {
        tokens.push(WristDeviceToken::aggregate(
            format!("+{}", abnormal_trackers.len() - abnormal_tracker_limit),
            abnormal_trackers.len() - abnormal_tracker_limit,
            true,
        ));
    }

    let normal_tracker_count = devices
        .iter()
        .filter(|device| {
            device.role == DeviceRole::Tracker && !is_abnormal_device_status(device.status)
        })
        .count();
    if normal_tracker_count > 0 {
        tokens.push(WristDeviceToken::aggregate(
            format!("T×{normal_tracker_count}"),
            normal_tracker_count,
            false,
        ));
    }

    for device in devices
        .iter()
        .filter(|device| {
            device.role == DeviceRole::Other && is_abnormal_device_status(device.status)
        })
        .take(2)
    {
        tokens.push(WristDeviceToken::specific(device, device.label.clone()));
    }
    tokens
}

fn push_wrist_role_token(
    tokens: &mut Vec<WristDeviceToken>,
    devices: &[DeviceChip],
    role: DeviceRole,
    label: &str,
) {
    if let Some(device) = devices.iter().find(|device| device.role == role) {
        tokens.push(WristDeviceToken::specific(device, label.to_string()));
    }
}

fn wrist_device_item(token: &WristDeviceToken, show_percent: bool) -> WristDeviceItem {
    let percent = token.percent_text(show_percent).unwrap_or_default();
    let label_color = if token.aggregate_count.is_some() && token.abnormal {
        wrist_status_color(token.status)
    } else {
        WRIST_MUTED_TEXT
    };
    let percent_color = if is_abnormal_device_status(token.status) {
        wrist_status_color(token.status)
    } else {
        WRIST_MUTED_TEXT
    };
    WristDeviceItem {
        label: SharedString::from(token.label.as_str()),
        percent: SharedString::from(percent.as_str()),
        label_color: to_slint_color(label_color),
        percent_color: to_slint_color(percent_color),
        battery_color: to_slint_color(wrist_status_color(token.status)),
        battery_fill: battery_fill_ratio(token.status, token.battery_percent),
        show_percent: !percent.is_empty(),
        show_battery: token.draw_battery,
    }
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

fn tracker_index(label: &str) -> u32 {
    label
        .trim()
        .strip_prefix('T')
        .and_then(|value| value.parse::<u32>().ok())
        .unwrap_or(u32::MAX)
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

fn is_abnormal_device_status(status: DeviceStatus) -> bool {
    matches!(
        status,
        DeviceStatus::LowBattery
            | DeviceStatus::CriticalBattery
            | DeviceStatus::TrackingWarning
            | DeviceStatus::Disconnected
    )
}

fn wrist_status_color(status: DeviceStatus) -> Color {
    match status {
        DeviceStatus::Normal | DeviceStatus::Charging => WRIST_NORMAL,
        DeviceStatus::LowBattery => WRIST_LOW,
        DeviceStatus::CriticalBattery | DeviceStatus::Disconnected => WRIST_CRITICAL,
        DeviceStatus::TrackingWarning => WRIST_WARNING,
    }
}

fn wrist_feed_model(rows: &[FeedLine]) -> ModelRc<WristFeedItem> {
    ModelRc::new(VecModel::from(
        rows.iter().map(wrist_feed_item).collect::<Vec<_>>(),
    ))
}

pub(super) fn wrist_feed_item(row: &FeedLine) -> WristFeedItem {
    let actor = row.actor_text.trim();
    let (actor, detail, has_actor) = if actor.is_empty() || row.relation == FeedRelation::None {
        ("", row.detail.trim().to_string(), false)
    } else {
        (actor, detail_without_actor(row.detail.trim(), actor), true)
    };
    WristFeedItem {
        time: SharedString::from(row.time_text.trim()),
        actor: SharedString::from(actor),
        detail: SharedString::from(detail.as_str()),
        actor_color: to_slint_color(wrist_relation_color(row.relation)),
        detail_color: to_slint_color(wrist_detail_color(row)),
        severity_color: to_slint_color(wrist_severity_color(row.severity)),
        has_actor,
        show_severity: row.severity != FeedSeverity::Normal,
    }
}

fn detail_without_actor(detail: &str, actor: &str) -> String {
    detail
        .strip_prefix(actor)
        .map(str::trim_start)
        .unwrap_or(detail)
        .to_string()
}

fn wrist_relation_color(relation: FeedRelation) -> Color {
    match relation {
        FeedRelation::Favorite => WRIST_FAVORITE_TEXT,
        FeedRelation::Friend => WRIST_FRIEND_TEXT,
        FeedRelation::None => WRIST_TEXT,
    }
}

fn wrist_detail_color(row: &FeedLine) -> Color {
    match row.kind {
        FeedKind::Media => WRIST_MUTED_TEXT,
        _ => WRIST_TEXT,
    }
}

fn wrist_severity_color(severity: FeedSeverity) -> Color {
    match severity {
        FeedSeverity::Important => WRIST_LOW,
        FeedSeverity::Warning => WRIST_CRITICAL,
        FeedSeverity::Normal => WRIST_NORMAL,
    }
}
