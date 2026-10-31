use std::{cmp::Ordering, rc::Rc};

use slint::{
    platform::software_renderer::{MinimalSoftwareWindow, PremultipliedRgbaColor},
    ComponentHandle, ModelRc, PhysicalSize, SharedString, VecModel,
};

use crate::{
    Color, DeviceChip, DeviceRole, DeviceStatus, FeedAccent, FeedKind, FeedLine, FeedRelation,
    FeedSeverity, OverlaySize, RgbaFrame, WristSurfaceModel,
};

use super::platform::{
    create_component_window, pixel_count, render_window_if_needed, to_slint_color,
};
use super::surface::SlintSurfaceHost;
use super::{WristDeviceItem, WristFeedItem, WristPanel};

const WRIST_TEXT: Color = Color::rgba(238, 238, 238, 255);
const WRIST_FRIEND_TEXT: Color = Color::rgba(246, 246, 246, 255);
const WRIST_FAVORITE_TEXT: Color = Color::rgba(245, 205, 84, 255);
const WRIST_MUTED_TEXT: Color = Color::rgba(168, 168, 168, 255);
const WRIST_MUTED_TEXT_ON_TRANSPARENT: Color = Color::rgba(205, 205, 205, 255);
const WRIST_LOW: Color = Color::rgba(245, 158, 11, 255);
const WRIST_CRITICAL: Color = Color::rgba(239, 68, 68, 255);
const WRIST_NORMAL: Color = Color::rgba(34, 197, 94, 255);
const WRIST_CHARGING: Color = Color::rgba(56, 189, 248, 255);
const WRIST_WARNING: Color = Color::rgba(251, 191, 36, 255);
const WRIST_FEED_ONLINE: Color = Color::rgba(46, 211, 25, 255);
const WRIST_FEED_LOCATION: Color = Color::rgba(14, 165, 233, 255);
const WRIST_FEED_OFFLINE: Color = Color::rgba(148, 163, 184, 255);

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
        self.write_devices(model);
        self.component
            .set_feed_lines(wrist_feed_model(&model.feed_rows, model.dark_background));
        let now_playing = model.now_playing.as_ref();
        self.component.set_now_playing_title(SharedString::from(
            now_playing.map_or("", |value| value.title.as_str()),
        ));
        self.component.set_now_playing_time(SharedString::from(
            now_playing.map_or("", |value| value.time_text.as_str()),
        ));
        let progress = now_playing.and_then(|value| value.progress_permille);
        self.component
            .set_now_playing_has_progress(progress.is_some());
        self.component.set_now_playing_progress(
            progress.map_or(0.0, |permille| f32::from(permille) / 1000.0),
        );
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

impl SlintWristHost {
    fn write_devices(&self, model: &WristSurfaceModel) {
        let tracker_count = model
            .devices
            .iter()
            .filter(|device| device.role == DeviceRole::Tracker)
            .count();
        let items = (1..=tracker_count)
            .rev()
            .map(|shown_trackers| wrist_device_items(model, shown_trackers))
            .find(|items| self.devices_fit(items))
            .unwrap_or_else(|| wrist_device_items(model, 0));
        self.component
            .set_devices(ModelRc::new(VecModel::from(items)));
    }

    fn devices_fit(&self, items: &[WristDeviceItem]) -> bool {
        let spacing = self.component.get_device_spacing();
        let width = items
            .iter()
            .map(|item| {
                self.component.set_device_probe(item.clone());
                self.component.get_device_probe_width()
            })
            .sum::<f32>()
            + spacing * items.len().saturating_sub(1) as f32;
        width <= self.component.get_device_room()
    }

    #[cfg(test)]
    pub(super) fn device_labels(&self) -> Vec<String> {
        use slint::Model;

        self.component
            .get_devices()
            .iter()
            .map(|item| item.label.to_string())
            .collect()
    }
}

#[derive(Clone, Debug)]
pub(super) struct WristDeviceToken {
    pub(super) label: String,
    status: DeviceStatus,
    battery_percent: Option<u8>,
    collapsed: bool,
    draw_battery: bool,
}

impl WristDeviceToken {
    fn specific(device: &DeviceChip, label: String) -> Self {
        Self {
            label,
            status: device.status,
            battery_percent: device.battery_percent,
            collapsed: false,
            draw_battery: device.battery_percent.is_some(),
        }
    }

    fn collapsed_trackers(trackers: &[&DeviceChip]) -> Self {
        let status = match trackers.first() {
            Some(device) if is_abnormal_device_status(device.status) => device.status,
            _ => DeviceStatus::Normal,
        };
        let battery_percent = trackers
            .iter()
            .filter_map(|device| device.battery_percent)
            .min();
        Self {
            label: format!("T×{}", trackers.len()),
            status,
            battery_percent,
            collapsed: true,
            draw_battery: battery_percent.is_some(),
        }
    }

    fn percent_text(&self, show_percent: bool) -> Option<String> {
        if !show_percent {
            return None;
        }
        self.battery_percent.map(|percent| {
            if self.status == DeviceStatus::Charging {
                format!("{percent}% ⚡")
            } else {
                format!("{percent}%")
            }
        })
    }
}

fn wrist_device_items(model: &WristSurfaceModel, shown_trackers: usize) -> Vec<WristDeviceItem> {
    wrist_device_tokens(&model.devices, shown_trackers)
        .iter()
        .map(|token| wrist_device_item(token, model.show_battery_percent, model.dark_background))
        .collect()
}

pub(super) fn wrist_muted_text(dark_background: bool) -> Color {
    if dark_background {
        WRIST_MUTED_TEXT
    } else {
        WRIST_MUTED_TEXT_ON_TRANSPARENT
    }
}

pub(super) fn wrist_device_tokens(
    devices: &[DeviceChip],
    shown_trackers: usize,
) -> Vec<WristDeviceToken> {
    let mut tokens = Vec::new();
    push_wrist_role_token(&mut tokens, devices, DeviceRole::Hmd, "HMD");
    push_wrist_role_token(&mut tokens, devices, DeviceRole::LeftController, "L");
    push_wrist_role_token(&mut tokens, devices, DeviceRole::RightController, "R");

    let mut trackers = devices
        .iter()
        .filter(|device| device.role == DeviceRole::Tracker)
        .collect::<Vec<_>>();
    trackers.sort_by(|left, right| {
        let left_abnormal = is_abnormal_device_status(left.status);
        let right_abnormal = is_abnormal_device_status(right.status);
        right_abnormal
            .cmp(&left_abnormal)
            .then_with(|| {
                if left_abnormal {
                    right.priority.cmp(&left.priority)
                } else {
                    Ordering::Equal
                }
            })
            .then_with(|| tracker_index(&left.label).cmp(&tracker_index(&right.label)))
    });
    let shown_trackers = shown_trackers.min(trackers.len());
    for device in &trackers[..shown_trackers] {
        tokens.push(WristDeviceToken::specific(device, device.label.clone()));
    }
    if shown_trackers < trackers.len() {
        tokens.push(WristDeviceToken::collapsed_trackers(
            &trackers[shown_trackers..],
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

pub(super) fn wrist_device_item(
    token: &WristDeviceToken,
    show_percent: bool,
    dark_background: bool,
) -> WristDeviceItem {
    let percent = token.percent_text(show_percent).unwrap_or_default();
    let muted = wrist_muted_text(dark_background);
    let label_color = if token.collapsed && is_abnormal_device_status(token.status) {
        wrist_status_color(token.status)
    } else {
        muted
    };
    let percent_color = if is_abnormal_device_status(token.status) {
        wrist_status_color(token.status)
    } else {
        muted
    };
    WristDeviceItem {
        label: SharedString::from(token.label.as_str()),
        percent: SharedString::from(percent.as_str()),
        label_color: to_slint_color(label_color),
        percent_color: to_slint_color(percent_color),
        battery_color: to_slint_color(wrist_status_color(token.status)),
        battery_fill: battery_fill_ratio(token.battery_percent),
        show_percent: !percent.is_empty(),
        show_battery: token.draw_battery
            && (percent.is_empty() || is_abnormal_device_status(token.status)),
    }
}

fn tracker_index(label: &str) -> u32 {
    label
        .trim()
        .strip_prefix('T')
        .and_then(|value| value.parse::<u32>().ok())
        .unwrap_or(u32::MAX)
}

fn battery_fill_ratio(battery_percent: Option<u8>) -> f32 {
    battery_percent
        .map(|percent| (percent as f32 / 100.0).clamp(0.0, 1.0))
        .unwrap_or(0.0)
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
        DeviceStatus::Normal => WRIST_NORMAL,
        DeviceStatus::Charging => WRIST_CHARGING,
        DeviceStatus::LowBattery => WRIST_LOW,
        DeviceStatus::CriticalBattery | DeviceStatus::Disconnected => WRIST_CRITICAL,
        DeviceStatus::TrackingWarning => WRIST_WARNING,
    }
}

fn wrist_feed_model(rows: &[FeedLine], dark_background: bool) -> ModelRc<WristFeedItem> {
    ModelRc::new(VecModel::from(
        rows.iter()
            .map(|row| wrist_feed_item(row, dark_background))
            .collect::<Vec<_>>(),
    ))
}

pub(super) fn wrist_feed_item(row: &FeedLine, dark_background: bool) -> WristFeedItem {
    let actor = row.actor_text.trim();
    let (actor, detail, has_actor) = if actor.is_empty() || row.relation == FeedRelation::None {
        ("", row.detail.trim().to_string(), false)
    } else {
        (actor, detail_without_actor(row.detail.trim(), actor), true)
    };
    let (accent_color, show_accent) = wrist_feed_accent(row, dark_background);
    WristFeedItem {
        time: SharedString::from(row.time_text.trim()),
        actor: SharedString::from(actor),
        detail: SharedString::from(detail.as_str()),
        actor_color: to_slint_color(wrist_relation_color(row.relation)),
        detail_color: to_slint_color(wrist_detail_color(row, dark_background)),
        accent_color: to_slint_color(accent_color),
        has_actor,
        show_accent,
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

fn wrist_detail_color(row: &FeedLine, dark_background: bool) -> Color {
    match row.kind {
        FeedKind::Media => wrist_muted_text(dark_background),
        _ => WRIST_TEXT,
    }
}

fn wrist_feed_accent(row: &FeedLine, dark_background: bool) -> (Color, bool) {
    match row.severity {
        FeedSeverity::Important => (WRIST_LOW, true),
        FeedSeverity::Warning => (WRIST_CRITICAL, true),
        FeedSeverity::Normal => match row.accent {
            FeedAccent::Online => (WRIST_FEED_ONLINE, true),
            FeedAccent::Location => (WRIST_FEED_LOCATION, true),
            FeedAccent::Offline => (WRIST_FEED_OFFLINE, true),
            FeedAccent::Muted => (wrist_muted_text(dark_background), true),
            FeedAccent::None => (WRIST_NORMAL, false),
        },
    }
}
