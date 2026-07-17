use vrcx_0_vr_overlay::{FeedRelation, FeedSeverity, MainSurfaceModel, OverlaySize, ToastCard};

use super::{accent, avatar, ScenarioInfo};

const DEFAULT_SCENARIO: &str = "mixed";
const SCENARIOS: &[ScenarioInfo] = &[
    ScenarioInfo {
        key: "mixed",
        label: "Mixed toasts",
    },
    ScenarioInfo {
        key: "favorite",
        label: "Favorite highlight",
    },
    ScenarioInfo {
        key: "warning",
        label: "Warning severity",
    },
    ScenarioInfo {
        key: "merged",
        label: "Merged join text",
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

pub fn build(scenario: &str) -> MainSurfaceModel {
    let scenario = normalize_scenario(scenario);
    MainSurfaceModel {
        size: OverlaySize::new(960, 528),
        dark_background: scenario != "light",
        accent: accent(),
        toasts: toasts_for_scenario(scenario),
    }
}

pub fn append_mock_toast(model: &mut MainSurfaceModel, index: usize) {
    let relation = if index.is_multiple_of(2) {
        FeedRelation::Favorite
    } else {
        FeedRelation::Friend
    };
    model.toasts.push(card(
        format!("Injected Friend {}", index + 1),
        relation,
        "joined your instance",
        FeedSeverity::Normal,
        index as u8,
    ));
    if model.toasts.len() > 6 {
        model.toasts.remove(0);
    }
}

pub fn normalize_scenario(scenario: &str) -> &str {
    super::normalize_scenario(SCENARIOS, scenario, DEFAULT_SCENARIO)
}

fn toasts_for_scenario(scenario: &str) -> Vec<ToastCard> {
    match scenario {
        "favorite" => vec![card(
            "Favorite Friend",
            FeedRelation::Favorite,
            "came online",
            FeedSeverity::Normal,
            1,
        )],
        "warning" => vec![card(
            "Video Player",
            FeedRelation::None,
            "reported a playback error",
            FeedSeverity::Warning,
            2,
        )],
        "merged" => vec![card(
            "Luna and 3 others",
            FeedRelation::Friend,
            "joined the instance",
            FeedSeverity::Important,
            3,
        )],
        "light" => vec![
            card(
                "Light Mode Friend",
                FeedRelation::Friend,
                "sent an invite",
                FeedSeverity::Normal,
                4,
            ),
            card(
                "Favorite Light",
                FeedRelation::Favorite,
                "requested an invite",
                FeedSeverity::Important,
                5,
            ),
        ],
        "i18n" => vec![
            card(
                "简体中文好友",
                FeedRelation::Favorite,
                "加入了你的实例 🎧",
                FeedSeverity::Normal,
                1,
            ),
            card(
                "繁體中文好友",
                FeedRelation::Friend,
                "傳送了邀請",
                FeedSeverity::Important,
                2,
            ),
            card(
                "日本語ユーザー",
                FeedRelation::Friend,
                "オンラインになりました",
                FeedSeverity::Normal,
                3,
            ),
            card(
                "한국어 친구",
                FeedRelation::Friend,
                "인스턴스에 참가했습니다",
                FeedSeverity::Normal,
                4,
            ),
            card(
                "Русский друг",
                FeedRelation::Friend,
                "отправил приглашение",
                FeedSeverity::Important,
                5,
            ),
            card(
                "صديق عربي",
                FeedRelation::None,
                "أرسل طلب دعوة",
                FeedSeverity::Warning,
                0,
            ),
        ],
        _ => vec![
            card(
                "Favorite Friend",
                FeedRelation::Favorite,
                "joined your instance",
                FeedSeverity::Normal,
                1,
            ),
            card_placeholder(
                "Avatar Loading",
                FeedRelation::Friend,
                "came online",
                FeedSeverity::Normal,
            ),
            card(
                "Media",
                FeedRelation::None,
                "failed to load video",
                FeedSeverity::Warning,
                3,
            ),
        ],
    }
}

fn card(
    actor_name: impl Into<String>,
    relation: FeedRelation,
    action: impl Into<String>,
    severity: FeedSeverity,
    avatar_seed: u8,
) -> ToastCard {
    ToastCard {
        actor_name: actor_name.into(),
        relation,
        action: action.into(),
        severity,
        avatar: Some(avatar(avatar_seed)),
        show_avatar: true,
    }
}

fn card_placeholder(
    actor_name: impl Into<String>,
    relation: FeedRelation,
    action: impl Into<String>,
    severity: FeedSeverity,
) -> ToastCard {
    ToastCard {
        actor_name: actor_name.into(),
        relation,
        action: action.into(),
        severity,
        avatar: None,
        show_avatar: true,
    }
}
