use vrcx_0_vr_overlay::{
    DeviceChip, DeviceRole, DeviceStatus, FeedKind, FeedLine, FeedRelation, FeedSeverity,
    OverlayFooter, OverlaySize, WristSurfaceModel,
};

use super::{accent, ScenarioInfo};

const DEFAULT_SCENARIO: &str = "feed";
const SCENARIOS: &[ScenarioInfo] = &[
    ScenarioInfo {
        key: "feed",
        label: "Feed and devices",
    },
    ScenarioInfo {
        key: "dense",
        label: "Dense feed",
    },
    ScenarioInfo {
        key: "devices",
        label: "Device warnings",
    },
    ScenarioInfo {
        key: "light",
        label: "Light background",
    },
    ScenarioInfo {
        key: "i18n",
        label: "CJK and emoji",
    },
];

pub fn scenario_infos() -> &'static [ScenarioInfo] {
    SCENARIOS
}

pub fn default_scenario_key() -> &'static str {
    DEFAULT_SCENARIO
}

pub fn build(scenario: &str) -> WristSurfaceModel {
    let scenario = normalize_scenario(scenario);
    WristSurfaceModel {
        size: if matches!(scenario, "dense" | "i18n") {
            OverlaySize::new(640, 640)
        } else {
            OverlaySize::new(512, 512)
        },
        dark_background: scenario != "light",
        show_battery_percent: true,
        devices: devices_for_scenario(scenario),
        feed_rows: feed_for_scenario(scenario),
        footer: OverlayFooter {
            left: if scenario == "i18n" {
                "叠加层工具".to_string()
            } else {
                "Overlay devtool".to_string()
            },
            center: if scenario == "i18n" {
                "東京テスト 00:42".to_string()
            } else {
                "Mock session 00:42".to_string()
            },
            right: if scenario == "i18n" {
                "VRなし".to_string()
            } else {
                "No VR".to_string()
            },
        },
        accent: accent(),
    }
}

pub fn normalize_scenario(scenario: &str) -> &str {
    super::normalize_scenario(SCENARIOS, scenario, DEFAULT_SCENARIO)
}

fn devices_for_scenario(scenario: &str) -> Vec<DeviceChip> {
    let mut devices = vec![
        device(
            "Index HMD",
            DeviceRole::Hmd,
            DeviceStatus::Normal,
            Some(100),
            1,
        ),
        device(
            "Left",
            DeviceRole::LeftController,
            DeviceStatus::Normal,
            Some(82),
            2,
        ),
        device(
            "Right",
            DeviceRole::RightController,
            DeviceStatus::Charging,
            Some(91),
            2,
        ),
        device("T1", DeviceRole::Tracker, DeviceStatus::Normal, Some(78), 1),
        device("T2", DeviceRole::Tracker, DeviceStatus::Normal, Some(74), 1),
    ];
    if matches!(scenario, "devices" | "dense") {
        devices.extend([
            device(
                "T3",
                DeviceRole::Tracker,
                DeviceStatus::LowBattery,
                Some(18),
                8,
            ),
            device(
                "T4",
                DeviceRole::Tracker,
                DeviceStatus::TrackingWarning,
                Some(42),
                7,
            ),
            device(
                "T5",
                DeviceRole::Tracker,
                DeviceStatus::Disconnected,
                None,
                9,
            ),
        ]);
    }
    devices
}

fn feed_for_scenario(scenario: &str) -> Vec<FeedLine> {
    if scenario == "i18n" {
        return vec![
            line(
                "12:30",
                FeedKind::Friend,
                "简体中文好友",
                "简体中文好友 加入了 测试世界 🎧",
                FeedRelation::Favorite,
                FeedSeverity::Normal,
            ),
            line(
                "12:31",
                FeedKind::Invite,
                "繁體中文好友",
                "繁體中文好友 傳送了邀請",
                FeedRelation::Friend,
                FeedSeverity::Important,
            ),
            line(
                "12:32",
                FeedKind::Instance,
                "日本語ユーザー",
                "日本語ユーザー が 東京ナイト に移動しました",
                FeedRelation::Friend,
                FeedSeverity::Normal,
            ),
            line(
                "12:33",
                FeedKind::System,
                "한국어 친구",
                "한국어 친구 온라인 상태",
                FeedRelation::Friend,
                FeedSeverity::Normal,
            ),
            line(
                "12:34",
                FeedKind::Profile,
                "Русский друг",
                "Русский друг отправил запрос",
                FeedRelation::Friend,
                FeedSeverity::Important,
            ),
            line(
                "12:35",
                FeedKind::Media,
                "صديق عربي",
                "صديق عربي يشاهد فيديو طويل العنوان",
                FeedRelation::None,
                FeedSeverity::Warning,
            ),
        ];
    }
    let mut rows = vec![
        line(
            "12:30",
            FeedKind::Friend,
            "Favorite Friend",
            "Favorite Friend joined The Black Cat",
            FeedRelation::Favorite,
            FeedSeverity::Normal,
        ),
        line(
            "12:31",
            FeedKind::Invite,
            "Group Member",
            "Group Member sent an invite",
            FeedRelation::Friend,
            FeedSeverity::Important,
        ),
        line(
            "12:33",
            FeedKind::System,
            "",
            "World changed to Japan Shrine",
            FeedRelation::None,
            FeedSeverity::Normal,
        ),
        line(
            "12:35",
            FeedKind::Media,
            "",
            "Video failed to load: timeout",
            FeedRelation::None,
            FeedSeverity::Warning,
        ),
    ];
    if matches!(scenario, "dense" | "devices") {
        for index in 0..12 {
            rows.push(line(
                format!("12:{:02}", 36 + index),
                if index % 2 == 0 {
                    FeedKind::Friend
                } else {
                    FeedKind::Instance
                },
                format!("Friend {index}"),
                format!("Friend {index} moved to Mock World {index}"),
                if index % 3 == 0 {
                    FeedRelation::Favorite
                } else {
                    FeedRelation::Friend
                },
                FeedSeverity::Normal,
            ));
        }
    }
    if scenario == "light" {
        rows.push(line(
            "12:50",
            FeedKind::Profile,
            "Light Mode",
            "Light Mode came online",
            FeedRelation::Friend,
            FeedSeverity::Normal,
        ));
    }
    rows
}

fn device(
    label: impl Into<String>,
    role: DeviceRole,
    status: DeviceStatus,
    battery_percent: Option<u8>,
    priority: u8,
) -> DeviceChip {
    let label = label.into();
    DeviceChip {
        text: label.clone(),
        label,
        role,
        status,
        battery_percent,
        priority,
    }
}

fn line(
    time_text: impl Into<String>,
    kind: FeedKind,
    actor_text: impl Into<String>,
    detail: impl Into<String>,
    relation: FeedRelation,
    severity: FeedSeverity,
) -> FeedLine {
    FeedLine {
        time_text: time_text.into(),
        kind,
        actor_text: actor_text.into(),
        detail: detail.into(),
        relation,
        severity,
    }
}
