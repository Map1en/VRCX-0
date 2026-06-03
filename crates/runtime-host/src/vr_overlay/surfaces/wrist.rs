use vrcx_0_application::{
    OverlayActivityActorRelation, OverlayActivityCategory, OverlayActivityEntry,
    OverlayActivitySnapshot, OverlayActivityText,
};
use vrcx_0_host::vr_overlay::{VrDeviceSnapshot, VrDeviceStatus};
use vrcx_0_vr_overlay::{
    Color, DeviceChip, DeviceRole, DeviceStatus, FeedKind, FeedLine, FeedRelation, FeedSeverity,
    OverlayFooter, OverlaySize, WristSurfaceModel,
};

use super::super::localization::{OverlayLocale, OverlayLocalizer};

const MAX_FEED_ROWS: usize = 24;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WristOverlaySizePreset {
    Compact,
    #[default]
    Normal,
    Large,
}

impl WristOverlaySizePreset {
    pub fn from_config(value: &str) -> Self {
        match value.trim() {
            "compact" => Self::Compact,
            "large" => Self::Large,
            _ => Self::Normal,
        }
    }

    pub fn as_config(self) -> &'static str {
        match self {
            Self::Compact => "compact",
            Self::Normal => "normal",
            Self::Large => "large",
        }
    }

    pub fn overlay_size(self) -> OverlaySize {
        match self {
            Self::Compact => OverlaySize::new(448, 448),
            Self::Normal => OverlaySize::new(512, 512),
            Self::Large => OverlaySize::new(640, 640),
        }
    }

    pub fn physical_width_meters(self) -> f32 {
        match self {
            Self::Compact => 0.16,
            Self::Normal => 0.20,
            Self::Large => 0.24,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WristOverlayRenderOptions {
    pub size: WristOverlaySizePreset,
    pub hide_private_worlds: bool,
    pub dark_background: bool,
    pub show_devices: bool,
    pub show_battery_percent: bool,
}

impl Default for WristOverlayRenderOptions {
    fn default() -> Self {
        Self {
            size: WristOverlaySizePreset::Normal,
            hide_private_worlds: false,
            dark_background: true,
            show_devices: true,
            show_battery_percent: false,
        }
    }
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WristOverlayFrameInput {
    pub activity: OverlayActivitySnapshot,
    pub devices: Vec<VrDeviceSnapshot>,
    pub footer: WristRuntimeFooter,
    pub options: WristOverlayRenderOptions,
    pub locale: String,
    pub captured_at_ms: i64,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WristRuntimeFooter {
    pub player_count: u32,
    pub instance_duration: String,
    pub local_time: String,
}

pub fn build_wrist_surface_model(input: WristOverlayFrameInput) -> WristSurfaceModel {
    let localizer = OverlayLocalizer::new(OverlayLocale::from_config(&input.locale));
    let feed_rows = input
        .activity
        .entries
        .iter()
        .rev()
        .filter(|entry| !should_hide_private_world(entry, input.options.hide_private_worlds))
        .take(MAX_FEED_ROWS)
        .map(|entry| feed_line_from_activity(entry, &localizer))
        .collect();
    WristSurfaceModel {
        size: input.options.size.overlay_size(),
        dark_background: input.options.dark_background,
        show_battery_percent: input.options.show_battery_percent,
        devices: if input.options.show_devices {
            input
                .devices
                .into_iter()
                .map(device_chip_from_snapshot)
                .collect()
        } else {
            Vec::new()
        },
        feed_rows,
        footer: OverlayFooter {
            left: localizer.text(&OverlayActivityText {
                key: "overlay.footer.players".to_string(),
                fallback: format!("{} players", input.footer.player_count),
                params: serde_json::json!({ "count": input.footer.player_count }),
            }),
            center: localized_instance_duration(&localizer, &input.footer.instance_duration),
            right: input.footer.local_time,
        },
        accent: Color::rgba(94, 234, 212, 255),
        captured_at_ms: input.captured_at_ms,
    }
}

fn localized_instance_duration(localizer: &OverlayLocalizer, duration: &str) -> String {
    let duration = duration.trim();
    if duration.is_empty() {
        return String::new();
    }
    localizer.text(&OverlayActivityText {
        key: "overlay.footer.instance_duration".to_string(),
        fallback: format!("Instance {duration}"),
        params: serde_json::json!({ "duration": duration }),
    })
}

fn device_chip_from_snapshot(snapshot: VrDeviceSnapshot) -> DeviceChip {
    let status = match snapshot.status {
        VrDeviceStatus::Normal => DeviceStatus::Normal,
        VrDeviceStatus::LowBattery => DeviceStatus::LowBattery,
        VrDeviceStatus::CriticalBattery => DeviceStatus::CriticalBattery,
        VrDeviceStatus::Charging => DeviceStatus::Charging,
        VrDeviceStatus::TrackingWarning => DeviceStatus::TrackingWarning,
        VrDeviceStatus::Disconnected => DeviceStatus::Disconnected,
    };
    let text = match (snapshot.battery_percent, snapshot.status) {
        (Some(percent), VrDeviceStatus::LowBattery) => format!("{percent} low"),
        (Some(percent), VrDeviceStatus::CriticalBattery) => format!("{percent} crit"),
        (Some(percent), VrDeviceStatus::Charging) => format!("{percent} chg"),
        (Some(percent), VrDeviceStatus::TrackingWarning) => format!("{percent} warn"),
        (Some(percent), VrDeviceStatus::Disconnected) => format!("{percent} off"),
        (Some(percent), VrDeviceStatus::Normal) => percent.to_string(),
        (None, VrDeviceStatus::TrackingWarning) => "warn".to_string(),
        (None, VrDeviceStatus::Disconnected) => "off".to_string(),
        (None, VrDeviceStatus::Charging) => "chg".to_string(),
        (None, _) => String::new(),
    };
    let priority = match snapshot.status {
        VrDeviceStatus::CriticalBattery | VrDeviceStatus::Disconnected => 40,
        VrDeviceStatus::LowBattery | VrDeviceStatus::TrackingWarning => 30,
        VrDeviceStatus::Charging => 20,
        VrDeviceStatus::Normal => 10,
    };
    DeviceChip {
        role: device_role(&snapshot.label),
        label: snapshot.label,
        status,
        battery_percent: snapshot.battery_percent,
        text,
        priority,
    }
}

fn device_role(label: &str) -> DeviceRole {
    match label.trim() {
        "HMD" => DeviceRole::Hmd,
        "L" => DeviceRole::LeftController,
        "R" => DeviceRole::RightController,
        value if value.starts_with('T') && value[1..].parse::<u32>().is_ok() => DeviceRole::Tracker,
        _ => DeviceRole::Other,
    }
}

fn feed_line_from_activity(entry: &OverlayActivityEntry, localizer: &OverlayLocalizer) -> FeedLine {
    FeedLine {
        time_text: time_text(&entry.created_at),
        kind: feed_kind(entry),
        actor_text: feed_actor(entry, localizer),
        detail: feed_detail(entry, localizer),
        relation: feed_relation(entry.actor_relation),
        severity: feed_severity(entry),
    }
}

fn feed_actor(entry: &OverlayActivityEntry, localizer: &OverlayLocalizer) -> String {
    let localized_title = localizer.text(&entry.content.title);
    first_non_empty([
        localized_title.as_str(),
        entry.content.title.fallback.as_str(),
        entry.actor_display_name.as_str(),
    ])
}

fn feed_relation(relation: OverlayActivityActorRelation) -> FeedRelation {
    match relation {
        OverlayActivityActorRelation::Favorite => FeedRelation::Favorite,
        OverlayActivityActorRelation::Friend => FeedRelation::Friend,
        OverlayActivityActorRelation::None => FeedRelation::None,
    }
}

fn feed_detail(entry: &OverlayActivityEntry, localizer: &OverlayLocalizer) -> String {
    let localized_summary = localized_activity_summary(entry, localizer);
    let localized_body = localizer.text(&entry.content.body);
    let localized_title = localizer.text(&entry.content.title);
    let summary = entry.content.summary.trim();
    let detail = entry.content.detail.trim();
    let body = entry.content.body.fallback.trim();
    let title = entry.content.title.fallback.trim();
    let actor = entry.actor_display_name.trim();
    let world_name = meaningful_world_name(entry);

    if let Some(world_name) = world_name {
        for value in [
            localized_summary.as_str(),
            detail,
            localized_body.as_str(),
            summary,
            body,
        ] {
            let replaced = replace_location_ids(value, entry, world_name);
            if !replaced.trim().is_empty() {
                return replaced;
            }
        }
    }

    let candidate = first_non_empty([
        localized_summary.as_str(),
        detail,
        localized_body.as_str(),
        summary,
        body,
        localized_title.as_str(),
        title,
        actor,
    ]);
    if contains_location_id(&candidate) {
        location_id_free_detail(entry, localized_title.as_str(), title, actor, localizer)
    } else {
        candidate
    }
}

fn localized_activity_summary(
    entry: &OverlayActivityEntry,
    localizer: &OverlayLocalizer,
) -> String {
    let title = localizer.text(&entry.content.title);
    let body = localizer.text(&entry.content.body);
    if !body.trim().is_empty() {
        return join_non_empty([title.as_str(), body.as_str()]);
    }
    if !entry.content.title.key.trim().is_empty() {
        return title;
    }
    String::new()
}

fn meaningful_world_name(entry: &OverlayActivityEntry) -> Option<&str> {
    let world_name = entry.content.world_name.trim();
    if world_name.is_empty() || is_location_id_like(world_name) {
        None
    } else {
        Some(world_name)
    }
}

fn replace_location_ids(value: &str, entry: &OverlayActivityEntry, world_name: &str) -> String {
    let mut output = value.trim().to_string();
    let location_world_id = world_id_from_location(entry.content.location.trim());
    for location in [
        entry.content.world_name.trim(),
        entry.content.location.trim(),
        location_world_id.as_str(),
    ] {
        if is_location_id_like(location) {
            output = output.replace(location, world_name);
        }
    }
    output
}

fn location_id_free_detail(
    entry: &OverlayActivityEntry,
    localized_title: &str,
    fallback_title: &str,
    actor: &str,
    localizer: &OverlayLocalizer,
) -> String {
    let subject = first_non_empty([localized_title, fallback_title, actor]);
    match entry.activity_type.as_str() {
        "GPS" if !subject.is_empty() => {
            let action = localizer.text(&notification_text(
                "notifications.gps",
                "is in an instance",
                serde_json::json!({ "location": localizer.generic_instance_location() }),
            ));
            join_non_empty([subject.as_str(), action.as_str()])
        }
        "Online" if !subject.is_empty() => {
            let action = localizer.text(&notification_text(
                "notifications.online",
                "online",
                serde_json::json!({}),
            ));
            join_non_empty([subject.as_str(), action.as_str()])
        }
        "invite" if !subject.is_empty() => {
            let action = localizer.text(&notification_text(
                "notifications.invite",
                "invite",
                serde_json::json!({
                    "location": localizer.generic_instance_location(),
                    "message": "",
                }),
            ));
            join_non_empty([subject.as_str(), action.as_str()])
        }
        _ => subject,
    }
}

fn notification_text(key: &str, fallback: &str, params: serde_json::Value) -> OverlayActivityText {
    OverlayActivityText {
        key: key.to_string(),
        fallback: fallback.to_string(),
        params,
    }
}

pub fn should_hide_private_world(entry: &OverlayActivityEntry, enabled: bool) -> bool {
    if !enabled || !is_private_filtered_activity_type(&entry.activity_type) {
        return false;
    }
    let has_visible_location =
        !entry.content.location.trim().is_empty() || !entry.content.world_name.trim().is_empty();
    has_visible_location && is_private_location(&entry.content.location)
}

fn is_private_filtered_activity_type(activity_type: &str) -> bool {
    matches!(activity_type, "GPS" | "Online" | "invite")
}

fn is_private_location(location: &str) -> bool {
    let normalized = location.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return false;
    }
    if normalized == "private" || normalized == "private:private" {
        return true;
    }
    normalized.contains("~private(")
        || normalized.contains("~hidden(")
        || normalized.contains("~friends(")
        || normalized.contains("~group(")
}

fn contains_location_id(value: &str) -> bool {
    value
        .split_whitespace()
        .any(|part| is_location_id_like(part.trim_matches(|ch: char| ch.is_ascii_punctuation())))
}

fn is_location_id_like(value: &str) -> bool {
    let trimmed = value.trim();
    if trimmed == "private" || trimmed == "private:private" {
        return true;
    }
    trimmed.starts_with("wrld_")
}

fn world_id_from_location(location: &str) -> String {
    let trimmed = location.trim();
    if !trimmed.starts_with("wrld_") {
        return String::new();
    }
    trimmed
        .split([':', '~'])
        .next()
        .unwrap_or_default()
        .to_string()
}

fn feed_kind(entry: &OverlayActivityEntry) -> FeedKind {
    match entry.category {
        OverlayActivityCategory::ActionRequired => FeedKind::Invite,
        OverlayActivityCategory::CurrentInstance => FeedKind::Instance,
        OverlayActivityCategory::FavoriteMovement => FeedKind::Friend,
        OverlayActivityCategory::ProfileChange => FeedKind::Profile,
        OverlayActivityCategory::GroupSocial => FeedKind::Group,
        OverlayActivityCategory::SystemSafety => FeedKind::System,
        OverlayActivityCategory::Media => FeedKind::Media,
    }
}

fn feed_severity(entry: &OverlayActivityEntry) -> FeedSeverity {
    match entry.category {
        OverlayActivityCategory::ActionRequired => FeedSeverity::Important,
        OverlayActivityCategory::SystemSafety => FeedSeverity::Warning,
        _ => FeedSeverity::Normal,
    }
}

fn time_text(value: &str) -> String {
    let Some(time_start) = value.find('T').map(|index| index + 1) else {
        return String::new();
    };
    value
        .get(time_start..time_start + 5)
        .unwrap_or_default()
        .to_string()
}

fn first_non_empty<'a, I>(values: I) -> String
where
    I: IntoIterator<Item = &'a str>,
{
    values
        .into_iter()
        .map(str::trim)
        .find(|value| !value.is_empty())
        .unwrap_or_default()
        .to_string()
}

fn join_non_empty<'a, I>(values: I) -> String
where
    I: IntoIterator<Item = &'a str>,
{
    values
        .into_iter()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use serde_json::{json, Value};
    use vrcx_0_application::{
        OverlayActivityActorRelation, OverlayActivityCategory, OverlayActivityContent,
        OverlayActivityEntry, OverlayActivityText,
    };

    use super::*;

    #[test]
    fn hide_private_worlds_only_filters_location_bearing_gps_online_and_invites() {
        assert!(should_hide_private_world(
            &entry("GPS", "private", "Private World"),
            true
        ));
        assert!(should_hide_private_world(
            &entry("Online", "wrld_1:123~friends(usr_1)", "Friends World"),
            true
        ));
        assert!(should_hide_private_world(
            &entry("invite", "wrld_1:123~group(grp_1)", "Group World"),
            true
        ));
        assert!(!should_hide_private_world(
            &entry(
                "OnPlayerJoined",
                "wrld_1:123~friends(usr_1)",
                "Friends World"
            ),
            true
        ));
        assert!(!should_hide_private_world(
            &entry("VideoPlay", "private", "Private World"),
            true
        ));
        assert!(!should_hide_private_world(
            &entry("Online", "public", "Public World"),
            true
        ));
        assert!(!should_hide_private_world(
            &entry("invite", "private", "Private World"),
            false
        ));
    }

    #[test]
    fn feed_detail_replaces_world_id_with_meaningful_world_name() {
        let mut entry = entry("Online", "wrld_1:123", "Test World");
        entry.content.title.fallback = "Ada".to_string();
        entry.content.summary = "Ada online in wrld_1".to_string();

        assert_eq!(feed_line(&entry, "en").detail, "Ada online in Test World");
    }

    #[test]
    fn feed_detail_does_not_render_raw_world_id_when_world_name_is_unknown() {
        let mut entry = entry("Online", "wrld_1:123", "wrld_1");
        entry.actor_display_name = "Ada".to_string();
        entry.content.title.fallback = "Ada".to_string();
        entry.content.summary = "Ada online in wrld_1".to_string();

        assert_eq!(feed_line(&entry, "en").detail, "Ada has logged in");
    }

    #[test]
    fn feed_detail_uses_runtime_locale_for_notification_body() {
        let mut entry = entry("OnPlayerJoined", "", "");
        entry.category = OverlayActivityCategory::CurrentInstance;
        entry.content.title.fallback = "Ada".to_string();
        entry.content.body = OverlayActivityText {
            key: "notifications.has_joined".to_string(),
            fallback: "has joined".to_string(),
            params: json!({}),
        };

        assert_eq!(feed_line(&entry, "zh-CN").detail, "Ada 加入了房间");
    }

    #[test]
    fn feed_detail_replaces_world_id_after_localization() {
        let mut entry = entry("Online", "wrld_1:123", "Test World");
        entry.content.title.fallback = "Ada".to_string();
        entry.content.body = OverlayActivityText {
            key: "notifications.online_location".to_string(),
            fallback: "online in wrld_1".to_string(),
            params: json!({ "location": "wrld_1" }),
        };

        assert_eq!(
            feed_line(&entry, "zh-CN").detail,
            "Ada 在 Test World 上线了"
        );
    }

    #[test]
    fn feed_detail_uses_localized_generic_location_when_world_name_is_unknown() {
        let mut entry = entry("GPS", "wrld_1:123", "wrld_1");
        entry.content.title.fallback = "Ada".to_string();
        entry.content.body = OverlayActivityText {
            key: "notifications.gps".to_string(),
            fallback: "is in wrld_1".to_string(),
            params: json!({ "location": "wrld_1" }),
        };

        assert_eq!(feed_line(&entry, "zh-CN").detail, "Ada 现在位于 某个房间");
    }

    fn entry(activity_type: &str, location: &str, world_name: &str) -> OverlayActivityEntry {
        OverlayActivityEntry {
            sequence: 1,
            source_id: format!("source:{activity_type}"),
            activity_type: activity_type.to_string(),
            category: OverlayActivityCategory::FavoriteMovement,
            created_at: "2026-06-01T12:34:56.000Z".to_string(),
            actor_user_id: "usr_1".to_string(),
            actor_display_name: "User".to_string(),
            content: OverlayActivityContent {
                location: location.to_string(),
                world_name: world_name.to_string(),
                title: text(),
                body: text(),
                ..OverlayActivityContent::default()
            },
            actor_relation: OverlayActivityActorRelation::None,
            payload: Value::Null,
        }
    }

    fn text() -> OverlayActivityText {
        OverlayActivityText {
            key: String::new(),
            fallback: String::new(),
            params: Value::Null,
        }
    }

    fn feed_line(entry: &OverlayActivityEntry, locale: &str) -> FeedLine {
        let localizer = OverlayLocalizer::new(OverlayLocale::from_config(locale));
        feed_line_from_activity(entry, &localizer)
    }
}
