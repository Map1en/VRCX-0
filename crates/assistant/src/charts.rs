use std::collections::BTreeMap;

use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;
use specta::Type;
use vrcx_0_core::activity_buckets::weekday_label;

const RANKING_LIMIT: usize = 10;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Type)]
#[serde(rename_all = "camelCase")]
pub enum AssistantChartKind {
    MyPlaytime,
    BestTimes,
    FriendPattern,
    TopCompanions,
    TopWorlds,
    SharedWorlds,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Type)]
#[serde(rename_all = "camelCase")]
pub enum AssistantChartAxis {
    HourOfDay,
    DayOfWeek,
    Label,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Type)]
#[serde(rename_all = "camelCase")]
pub struct AssistantChartPoint {
    pub key: String,
    pub value: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Type)]
#[serde(rename_all = "camelCase")]
pub struct AssistantChart {
    pub kind: AssistantChartKind,
    pub axis: AssistantChartAxis,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subject: Option<String>,
    pub points: Vec<AssistantChartPoint>,
}

pub fn tool_charts(tool: &str, structured: &Value) -> Vec<AssistantChart> {
    let charts = match tool {
        "get_activity_timeline" => parse(structured).map(playtime_chart).into_iter().collect(),
        "get_best_time_to_play" => parse(structured)
            .map(best_times_chart)
            .into_iter()
            .collect(),
        "get_friend_activity_pattern" => parse::<RowsOf<PatternRow>>(structured)
            .and_then(|output| <[PatternRow; 1]>::try_from(output.rows).ok())
            .and_then(|[row]| friend_pattern_chart(row))
            .into_iter()
            .collect(),
        "get_friend_profile" => parse(structured).map(profile_charts).unwrap_or_default(),
        "get_copresence_summary" => parse::<RowsOf<CompanionRow>>(structured)
            .map(|output| companions_chart(&output.rows))
            .into_iter()
            .collect(),
        "summarize_social_period" => parse::<SocialPeriod>(structured)
            .map(|output| {
                vec![
                    companions_chart(&output.top_companions),
                    worlds_chart(&output.top_worlds, AssistantChartKind::TopWorlds, None),
                ]
            })
            .unwrap_or_default(),
        _ => Vec::new(),
    };
    charts
        .into_iter()
        .filter(|chart| chart.points.iter().any(|point| point.value > 0))
        .collect()
}

fn parse<T: DeserializeOwned>(value: &Value) -> Option<T> {
    T::deserialize(value).ok()
}

#[derive(Deserialize)]
struct RowsOf<T> {
    rows: Vec<T>,
}

#[derive(Deserialize)]
struct PlaytimeOutput {
    bucket: String,
    rows: Vec<PlaytimeRow>,
}

#[derive(Deserialize)]
struct PlaytimeRow {
    label: String,
    minutes: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BestTimeRow {
    bucket: String,
    label: String,
    distinct_friends: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PatternRow {
    display_name: String,
    buckets: BTreeMap<String, i64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CompanionRow {
    display_name: String,
    world_name: Option<String>,
    total_minutes: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorldRow {
    world_name: String,
    total_minutes: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NamedRow {
    display_name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProfileOutput {
    current: Option<NamedRow>,
    encounter: Option<NamedRow>,
    activity_pattern: Option<PatternRow>,
    #[serde(default)]
    shared_worlds: Vec<WorldRow>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SocialPeriod {
    top_companions: Vec<CompanionRow>,
    top_worlds: Vec<WorldRow>,
}

fn point(key: impl Into<String>, value: i64) -> AssistantChartPoint {
    AssistantChartPoint {
        key: key.into(),
        value,
    }
}

fn weekday_key(label: &str) -> Option<String> {
    (0..7)
        .map(|day: u8| day.to_string())
        .find(|key| weekday_label(key) == Some(label))
}

fn hour_key(text: &str) -> Option<String> {
    text.get(..2)
        .unwrap_or(text)
        .parse::<u8>()
        .ok()
        .filter(|hour| *hour < 24)
        .map(|hour| hour.to_string())
}

fn playtime_chart(output: PlaytimeOutput) -> AssistantChart {
    let axis = match output.bucket.as_str() {
        "hourOfDay" => AssistantChartAxis::HourOfDay,
        "dayOfWeek" => AssistantChartAxis::DayOfWeek,
        _ => AssistantChartAxis::Label,
    };
    let mut points: Vec<_> = output
        .rows
        .into_iter()
        .map(|row| {
            let key = match axis {
                AssistantChartAxis::HourOfDay => hour_key(&row.label),
                AssistantChartAxis::DayOfWeek => weekday_key(&row.label),
                AssistantChartAxis::Label => None,
            };
            point(key.unwrap_or(row.label), row.minutes)
        })
        .collect();
    if axis != AssistantChartAxis::Label {
        points.sort_by_cached_key(|point| point.key.parse::<u8>().unwrap_or(u8::MAX));
    }
    AssistantChart {
        kind: AssistantChartKind::MyPlaytime,
        axis,
        subject: None,
        points,
    }
}

fn best_times_chart(output: RowsOf<BestTimeRow>) -> AssistantChart {
    let weekday = output
        .rows
        .iter()
        .all(|row| weekday_label(&row.bucket) == Some(row.label.as_str()));
    let points = output
        .rows
        .into_iter()
        .filter_map(|row| {
            let key = if weekday {
                Some(row.bucket)
            } else {
                hour_key(&row.bucket)
            };
            key.map(|key| point(key, row.distinct_friends))
        })
        .collect();
    AssistantChart {
        kind: AssistantChartKind::BestTimes,
        axis: if weekday {
            AssistantChartAxis::DayOfWeek
        } else {
            AssistantChartAxis::HourOfDay
        },
        subject: None,
        points,
    }
}

fn profile_charts(output: ProfileOutput) -> Vec<AssistantChart> {
    let name = output
        .current
        .or(output.encounter)
        .map(|row| row.display_name);
    let shared = worlds_chart(
        &output.shared_worlds,
        AssistantChartKind::SharedWorlds,
        name,
    );
    std::iter::once(shared)
        .chain(output.activity_pattern.and_then(friend_pattern_chart))
        .collect()
}

fn friend_pattern_chart(row: PatternRow) -> Option<AssistantChart> {
    let hourly = row.buckets.keys().any(|key| key.len() == 2);
    let (axis, slots) = if hourly {
        (AssistantChartAxis::HourOfDay, 24)
    } else {
        (AssistantChartAxis::DayOfWeek, 7)
    };
    let mut counts = vec![0; slots];
    for (key, count) in &row.buckets {
        let slot = key.parse::<usize>().ok().filter(|slot| *slot < slots)?;
        counts[slot] += count;
    }
    Some(AssistantChart {
        kind: AssistantChartKind::FriendPattern,
        axis,
        subject: Some(row.display_name),
        points: counts
            .into_iter()
            .enumerate()
            .map(|(slot, count)| point(slot.to_string(), count))
            .collect(),
    })
}

fn companions_chart(rows: &[CompanionRow]) -> AssistantChart {
    AssistantChart {
        kind: AssistantChartKind::TopCompanions,
        axis: AssistantChartAxis::Label,
        subject: None,
        points: rows
            .iter()
            .take(RANKING_LIMIT)
            .map(|row| {
                let label = match &row.world_name {
                    Some(world) => format!("{} · {world}", row.display_name),
                    None => row.display_name.clone(),
                };
                point(label, row.total_minutes)
            })
            .collect(),
    }
}

fn worlds_chart(
    rows: &[WorldRow],
    kind: AssistantChartKind,
    subject: Option<String>,
) -> AssistantChart {
    AssistantChart {
        kind,
        axis: AssistantChartAxis::Label,
        subject,
        points: rows
            .iter()
            .take(RANKING_LIMIT)
            .map(|row| point(row.world_name.clone(), row.total_minutes))
            .collect(),
    }
}

#[cfg(test)]
mod tests;
