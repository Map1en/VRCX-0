use vrcx_0_vr_overlay::{
    FavoriteFriendsPanelModel, FriendPanelCategory, FriendPanelRow, FriendPanelRowActions,
    FriendPanelRowPrimaryAction, FriendPanelStatusTone, FriendPanelStrings, OverlaySize,
};

use super::{avatar, ScenarioInfo};

const DEFAULT_SCENARIO: &str = "many";
const MANY_GROUP_MOCK_GROUP_COUNT: usize = 42;

const SCENARIOS: &[ScenarioInfo] = &[
    ScenarioInfo {
        key: "many",
        label: "Many friends",
    },
    ScenarioInfo {
        key: "sameInstance",
        label: "Same instance",
    },
    ScenarioInfo {
        key: "manyGroups",
        label: "Many groups",
    },
    ScenarioInfo {
        key: "empty",
        label: "Empty group",
    },
    ScenarioInfo {
        key: "traveling",
        label: "Traveling spinner",
    },
    ScenarioInfo {
        key: "notes",
        label: "Notes and memos",
    },
    ScenarioInfo {
        key: "long",
        label: "Long text",
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

pub fn build(scenario: &str) -> FavoriteFriendsPanelModel {
    let scenario = normalize_scenario(scenario);
    let selected_category_key = if scenario == "sameInstance" {
        "sameInstance"
    } else {
        "all"
    }
    .to_string();
    FavoriteFriendsPanelModel {
        size: OverlaySize::new(1080, 720),
        categories: categories_for_scenario(scenario),
        selected_category_key: selected_category_key.clone(),
        rows: rows_for_category(scenario, &selected_category_key),
        spinner_phase: 0.0,
        strings: FriendPanelStrings {
            title: "Overlay Devtool Friends".to_string(),
            all_label: "All".to_string(),
            empty_label: "No friends in this mock category".to_string(),
            note_label: "Note".to_string(),
            memo_label: "Local Note".to_string(),
            open_label: "Open".to_string(),
            request_label: "Request".to_string(),
            invite_label: "Invite".to_string(),
        },
        ..FavoriteFriendsPanelModel::default()
    }
}

pub fn rows_for_category(scenario: &str, category_key: &str) -> Vec<FriendPanelRow> {
    let scenario = normalize_scenario(scenario);
    let mut rows = scenario_rows(scenario);
    match category_key {
        "favOnline" => rows.retain(|row| row.status != FriendPanelStatusTone::Offline),
        "sameInstance" => rows = same_instance_sectioned_rows(rows),
        "favLocal" => rows.retain(|row| row.user_id.ends_with('0') || row.user_id.ends_with('2')),
        "group:local:Best" => {
            rows.retain(|row| row.user_id.ends_with('1') || row.user_id.ends_with('4'))
        }
        "group:remote:Travelers" => rows.retain(|row| row.is_traveling),
        "group:remote:Quiet" => rows.retain(|row| row.memo.is_some() || row.note.is_some()),
        key if key.starts_with("group:") => match mock_favorite_group_index(key) {
            Some(group_index) => rows.retain(|row| mock_group_contains(row, group_index)),
            None => rows.clear(),
        },
        "all" => {}
        _ => rows.clear(),
    }
    rows
}

pub fn normalize_scenario(scenario: &str) -> &str {
    super::normalize_scenario(SCENARIOS, scenario, DEFAULT_SCENARIO)
}

fn categories_for_scenario(scenario: &str) -> Vec<FriendPanelCategory> {
    category_defs(scenario)
        .into_iter()
        .map(|(key, label)| FriendPanelCategory {
            count: rows_for_category(scenario, &key)
                .iter()
                .filter(|row| !row.user_id.is_empty())
                .count(),
            key,
            label,
        })
        .collect()
}

fn category_defs(scenario: &str) -> Vec<(String, String)> {
    let mut defs = vec![
        ("all".to_string(), "All".to_string()),
        ("sameInstance".to_string(), "Same Instance".to_string()),
        ("favOnline".to_string(), "Favorites Online".to_string()),
        ("favLocal".to_string(), "Local Favorites".to_string()),
    ];
    if scenario == "manyGroups" {
        defs.extend((0..MANY_GROUP_MOCK_GROUP_COUNT).map(|index| mock_favorite_group_def(index)));
    } else {
        defs.extend([
            ("group:local:Best".to_string(), "Best".to_string()),
            (
                "group:remote:Travelers".to_string(),
                "Travelers".to_string(),
            ),
            ("group:remote:Quiet".to_string(), "Quiet".to_string()),
        ]);
    }
    defs
}

fn scenario_rows(scenario: &str) -> Vec<FriendPanelRow> {
    match scenario {
        "empty" => Vec::new(),
        "traveling" => traveling_rows(),
        "notes" => note_rows(),
        "long" => long_text_rows(),
        "i18n" => i18n_rows(),
        "manyGroups" => many_groups_rows(),
        "sameInstance" => same_instance_rows(),
        _ => many_rows(),
    }
}

fn many_rows() -> Vec<FriendPanelRow> {
    (0..18)
        .map(|index| {
            let status = match index % 4 {
                0 => FriendPanelStatusTone::Active,
                1 => FriendPanelStatusTone::Online,
                2 => FriendPanelStatusTone::AskMe,
                _ => FriendPanelStatusTone::Busy,
            };
            let spec = RowSpec::new(
                format!("usr_mock_{index:02}"),
                format!("Mock Friend {index:02}"),
                status,
                match index % 3 {
                    0 => "The Black Cat",
                    1 => "Japan Shrine",
                    _ => "Private",
                },
                index as u8,
            );
            let spec = if index % 5 == 0 {
                spec.memo("Local memo from VRCX-0")
            } else {
                spec
            };
            row(if index % 7 == 0 {
                spec.traveling()
            } else {
                spec
            })
        })
        .collect()
}

fn many_groups_rows() -> Vec<FriendPanelRow> {
    (0..36)
        .map(|index| {
            let status = match index % 5 {
                0 => FriendPanelStatusTone::Online,
                1 => FriendPanelStatusTone::Active,
                2 => FriendPanelStatusTone::Busy,
                3 => FriendPanelStatusTone::AskMe,
                _ => FriendPanelStatusTone::Online,
            };
            let spec = RowSpec::new(
                format!("usr_group_mock_{index:02}"),
                format!("Grouped Friend {index:02}"),
                status,
                match index % 4 {
                    0 => "The Black Cat",
                    1 => "Japan Shrine",
                    2 => "Group Public",
                    _ => "Private",
                },
                index as u8,
            );
            let spec = if index % 6 == 0 {
                spec.note("Visible in several mock groups")
            } else {
                spec
            };
            row(if index % 13 == 0 {
                spec.traveling()
            } else {
                spec
            })
        })
        .collect()
}

fn same_instance_rows() -> Vec<FriendPanelRow> {
    (0..14)
        .map(|index| {
            let status = match index % 4 {
                0 => FriendPanelStatusTone::Active,
                1 => FriendPanelStatusTone::Online,
                2 => FriendPanelStatusTone::AskMe,
                _ => FriendPanelStatusTone::Busy,
            };
            let location = match index {
                0..=2 => "The Black Cat",
                3..=5 => "Japan Shrine",
                6..=8 => "Midnight Rooftop",
                9..=10 => "Group Public",
                11 => "Private",
                _ => "Traveling",
            };
            let spec = RowSpec::new(
                format!("usr_same_instance_{index:02}"),
                format!("Same Instance Friend {index:02}"),
                status,
                location,
                (index + 12) as u8,
            );
            let spec = match index {
                2 => spec.note("Visible in your current instance"),
                5 => spec.memo("Same-instance local note"),
                _ => spec,
            };
            row(if index >= 12 { spec.traveling() } else { spec })
        })
        .collect()
}

fn same_instance_sectioned_rows(rows: Vec<FriendPanelRow>) -> Vec<FriendPanelRow> {
    let mut sections: Vec<(String, Vec<FriendPanelRow>)> = Vec::new();
    for row in rows {
        if row.is_traveling || row.location_text == "Private" {
            continue;
        }
        if let Some((_, section_rows)) = sections
            .iter_mut()
            .find(|(location, _)| location == &row.location_text)
        {
            section_rows.push(row);
        } else {
            sections.push((row.location_text.clone(), vec![row]));
        }
    }

    let mut output = Vec::new();
    for (location, section_rows) in sections {
        if section_rows.len() < 2 {
            continue;
        }
        output.push(section_row(location));
        output.extend(section_rows);
    }
    output
}

fn section_row(label: String) -> FriendPanelRow {
    FriendPanelRow {
        section_label: Some(label),
        user_id: String::new(),
        display_name: String::new(),
        status: FriendPanelStatusTone::Offline,
        location_text: String::new(),
        is_traveling: false,
        traveling_text: None,
        note: None,
        memo: None,
        avatar: None,
        actions: FriendPanelRowActions::default(),
    }
}

fn mock_favorite_group_def(index: usize) -> (String, String) {
    if index % 5 == 0 {
        (
            format!("group:local:mock_local_{index:02}"),
            format!("Local Favorite Group {index:02}"),
        )
    } else {
        (
            format!("group:friend:mock_group_{index:02}"),
            format!("Favorite Group {index:02}"),
        )
    }
}

fn mock_favorite_group_index(category_key: &str) -> Option<usize> {
    category_key
        .strip_prefix("group:friend:mock_group_")
        .or_else(|| category_key.strip_prefix("group:local:mock_local_"))
        .and_then(|value| value.parse::<usize>().ok())
}

fn mock_group_contains(row: &FriendPanelRow, group_index: usize) -> bool {
    let row_index = row
        .user_id
        .rsplit('_')
        .next()
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or_default();
    row_index % 6 == group_index % 6 || (row_index + group_index).is_multiple_of(11)
}

fn traveling_rows() -> Vec<FriendPanelRow> {
    (0..8)
        .map(|index| {
            row(RowSpec::new(
                format!("usr_travel_{index}"),
                format!("Traveler {index}"),
                FriendPanelStatusTone::Active,
                "Traveling",
                (index + 2) as u8,
            )
            .traveling())
        })
        .collect()
}

fn note_rows() -> Vec<FriendPanelRow> {
    vec![
        row(RowSpec::new(
            "usr_note_0",
            "VRChat Note Friend",
            FriendPanelStatusTone::Online,
            "Friends+ Instance",
            1,
        )
        .note("VRChat profile note stays separate")
        .memo("Local memo stays separate")),
        row(RowSpec::new(
            "usr_note_1",
            "Memo Only",
            FriendPanelStatusTone::Active,
            "Group Public",
            2,
        )
        .memo("Met at the weekend event")),
        row(RowSpec::new(
            "usr_note_2",
            "Note Only",
            FriendPanelStatusTone::AskMe,
            "Private",
            3,
        )
        .note("Prefers invite requests")),
    ]
}

fn long_text_rows() -> Vec<FriendPanelRow> {
    vec![
        row(RowSpec::new(
            "usr_long_0",
            "A Very Long Display Name That Should Ellipsize Cleanly In The Row",
            FriendPanelStatusTone::Online,
            "A World With A Very Long Name That Should Not Break The Layout",
            4,
        )
        .note("This VRChat note is intentionally long enough to exercise row text clipping")
        .memo("This local memo is also intentionally long enough to stay inside the row")),
        row(RowSpec::new(
            "usr_long_1",
            "Short Name",
            FriendPanelStatusTone::Busy,
            "Private",
            5,
        )),
    ]
}

fn i18n_rows() -> Vec<FriendPanelRow> {
    vec![
        row(RowSpec::new(
            "usr_i18n_0",
            "简体中文好友 🎧",
            FriendPanelStatusTone::Active,
            "测试世界",
            0,
        )
        .note("VRChat 资料备注：喜欢跳舞和拍照")
        .memo("本地备注：周末活动认识")),
        row(RowSpec::new(
            "usr_i18n_1",
            "繁體中文好友",
            FriendPanelStatusTone::Online,
            "朋友+ 實例",
            1,
        )
        .memo("本地備註保持可讀")),
        row(RowSpec::new(
            "usr_i18n_2",
            "日本語ユーザー",
            FriendPanelStatusTone::AskMe,
            "東京ナイト",
            2,
        )
        .traveling()),
        row(RowSpec::new(
            "usr_i18n_3",
            "한국어 친구",
            FriendPanelStatusTone::Busy,
            "서울 테스트 월드",
            3,
        )
        .note("프로필 메모가 긴 행에서도 잘립니다")),
        row(RowSpec::new(
            "usr_i18n_4",
            "Русский друг",
            FriendPanelStatusTone::Online,
            "Длинное название мира",
            4,
        )),
        row(RowSpec::new(
            "usr_i18n_5",
            "صديق عربي",
            FriendPanelStatusTone::Active,
            "اختبار طويل للنص",
            5,
        )
        .memo("ملاحظة محلية طويلة")),
    ]
}

struct RowSpec {
    user_id: String,
    display_name: String,
    status: FriendPanelStatusTone,
    location_text: String,
    note: Option<&'static str>,
    memo: Option<&'static str>,
    is_traveling: bool,
    avatar_seed: u8,
}

impl RowSpec {
    fn new(
        user_id: impl Into<String>,
        display_name: impl Into<String>,
        status: FriendPanelStatusTone,
        location_text: impl Into<String>,
        avatar_seed: u8,
    ) -> Self {
        Self {
            user_id: user_id.into(),
            display_name: display_name.into(),
            status,
            location_text: location_text.into(),
            note: None,
            memo: None,
            is_traveling: false,
            avatar_seed,
        }
    }

    fn note(mut self, note: &'static str) -> Self {
        self.note = Some(note);
        self
    }

    fn memo(mut self, memo: &'static str) -> Self {
        self.memo = Some(memo);
        self
    }

    fn traveling(mut self) -> Self {
        self.is_traveling = true;
        self
    }
}

fn row(spec: RowSpec) -> FriendPanelRow {
    let actions = FriendPanelRowActions {
        primary: mock_primary_action(&spec),
        invite: spec.status != FriendPanelStatusTone::Offline,
    };
    FriendPanelRow {
        section_label: None,
        user_id: spec.user_id,
        display_name: spec.display_name,
        status: spec.status,
        location_text: spec.location_text,
        is_traveling: spec.is_traveling,
        traveling_text: spec.is_traveling.then(|| "Traveling".to_string()),
        note: spec.note.map(str::to_string),
        memo: spec.memo.map(str::to_string),
        avatar: Some(avatar(spec.avatar_seed)),
        actions,
    }
}

fn mock_primary_action(spec: &RowSpec) -> Option<FriendPanelRowPrimaryAction> {
    if spec.is_traveling {
        return None;
    }
    if spec.location_text == "Private" {
        return Some(FriendPanelRowPrimaryAction::Request);
    }
    Some(FriendPanelRowPrimaryAction::Open)
}
