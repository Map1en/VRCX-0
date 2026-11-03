use std::collections::BTreeMap;

use serde_json::json;
use vrcx_0_contracts::social_aggregates::{
    BestTimeBucketRow, BestTimeToPlayOutput, CopresenceSummaryOutput, CopresenceSummaryRow,
    FriendActivityPatternOutput, FriendActivityPatternRow,
};
use vrcx_0_core::activity_buckets::{activity_timeline, ActivityTimeBucket};

use super::*;

fn values(chart: &AssistantChart) -> Vec<(&str, i64)> {
    chart
        .points
        .iter()
        .map(|point| (point.key.as_str(), point.value))
        .collect()
}

fn companion(name: &str, minutes: i64) -> CopresenceSummaryRow {
    CopresenceSummaryRow {
        user_id: format!("usr_{name}"),
        display_name: name.into(),
        is_friend: true,
        world_id: None,
        world_name: None,
        total_minutes: minutes,
        co_days: 1,
        instances: 1,
        last_seen_together: "2026-10-01T00:00:00Z".into(),
        minutes_by_access: BTreeMap::new(),
    }
}

fn pattern(buckets: &[(&str, i64)]) -> FriendActivityPatternRow {
    FriendActivityPatternRow {
        user_id: "usr_a".into(),
        display_name: "Alice".into(),
        buckets: buckets
            .iter()
            .map(|(key, count)| (key.to_string(), *count))
            .collect(),
        typical_online_window: String::new(),
    }
}

#[test]
fn playtime_by_hour_keys_points_by_hour() {
    let hour = 3_600_000;
    let rows = activity_timeline(
        &[(21 * hour, 22 * hour + hour / 2)],
        ActivityTimeBucket::HourOfDay,
        0,
        None,
        None,
    );
    let rows: Vec<_> = rows
        .into_iter()
        .map(|row| json!({ "label": row.label, "minutes": row.minutes, "sessionCount": 1 }))
        .collect();

    let charts = tool_charts(
        "get_activity_timeline",
        &json!({ "bucket": "hourOfDay", "rows": rows, "summary": "", "caveats": [] }),
    );

    assert_eq!(charts.len(), 1);
    assert_eq!(charts[0].kind, AssistantChartKind::MyPlaytime);
    assert_eq!(charts[0].axis, AssistantChartAxis::HourOfDay);
    assert_eq!(charts[0].points.len(), 24);
    assert_eq!(charts[0].points[21], point("21", 60));
    assert_eq!(charts[0].points[22], point("22", 30));
}

#[test]
fn playtime_by_month_keeps_labels_and_skips_empty_windows() {
    let chart = &tool_charts(
        "get_activity_timeline",
        &json!({ "bucket": "month", "rows": [
            { "label": "2026-09", "minutes": 90 },
            { "label": "2026-10", "minutes": 0 }
        ] }),
    )[0];
    assert_eq!(chart.axis, AssistantChartAxis::Label);
    assert_eq!(values(chart), [("2026-09", 90), ("2026-10", 0)]);

    assert!(tool_charts(
        "get_activity_timeline",
        &json!({ "bucket": "month", "rows": [{ "label": "2026-10", "minutes": 0 }] }),
    )
    .is_empty());
}

#[test]
fn best_times_keep_the_ranking_and_detect_weekdays() {
    let row = |bucket: &str, label: &str, friends: usize| BestTimeBucketRow {
        bucket: bucket.into(),
        label: label.into(),
        distinct_friends: friends,
        online_events: 1,
        top_friends: Vec::new(),
    };
    let hourly = serde_json::to_value(BestTimeToPlayOutput {
        rows: vec![row("21", "21:00-22:00", 9), row("08", "08:00-09:00", 4)],
        caveats: Vec::new(),
    })
    .unwrap();
    let weekly = serde_json::to_value(BestTimeToPlayOutput {
        rows: vec![row("5", "Saturday", 7), row("0", "Monday", 2)],
        caveats: Vec::new(),
    })
    .unwrap();

    let hourly = &tool_charts("get_best_time_to_play", &hourly)[0];
    assert_eq!(hourly.axis, AssistantChartAxis::HourOfDay);
    assert_eq!(values(hourly), [("21", 9), ("8", 4)]);

    let weekly = &tool_charts("get_best_time_to_play", &weekly)[0];
    assert_eq!(weekly.axis, AssistantChartAxis::DayOfWeek);
    assert_eq!(values(weekly), [("5", 7), ("0", 2)]);
}

#[test]
fn friend_pattern_fills_every_slot_for_one_friend_only() {
    let one = serde_json::to_value(FriendActivityPatternOutput {
        rows: vec![pattern(&[("1", 3), ("6", 5)])],
        caveats: Vec::new(),
    })
    .unwrap();
    let chart = &tool_charts("get_friend_activity_pattern", &one)[0];
    assert_eq!(chart.axis, AssistantChartAxis::DayOfWeek);
    assert_eq!(chart.subject.as_deref(), Some("Alice"));
    assert_eq!(
        values(chart),
        [
            ("0", 0),
            ("1", 3),
            ("2", 0),
            ("3", 0),
            ("4", 0),
            ("5", 0),
            ("6", 5)
        ]
    );

    let hourly = serde_json::to_value(FriendActivityPatternOutput {
        rows: vec![pattern(&[("23", 2)])],
        caveats: Vec::new(),
    })
    .unwrap();
    let chart = &tool_charts("get_friend_activity_pattern", &hourly)[0];
    assert_eq!(chart.axis, AssistantChartAxis::HourOfDay);
    assert_eq!(chart.points.len(), 24);

    let many = serde_json::to_value(FriendActivityPatternOutput {
        rows: vec![pattern(&[("1", 3)]), pattern(&[("2", 1)])],
        caveats: Vec::new(),
    })
    .unwrap();
    assert!(tool_charts("get_friend_activity_pattern", &many).is_empty());
}

#[test]
fn companions_rank_the_top_ten_with_world_pairs() {
    let mut rows: Vec<_> = (0..12)
        .map(|index| companion(&format!("p{index}"), 100 - index))
        .collect();
    rows[0].world_name = Some("Home".into());
    let output = serde_json::to_value(CopresenceSummaryOutput {
        returned_rows: rows.len(),
        total_rows: rows.len(),
        rows,
        truncated: false,
        summary: String::new(),
        caveats: Vec::new(),
    })
    .unwrap();

    let chart = &tool_charts("get_copresence_summary", &output)[0];
    assert_eq!(chart.kind, AssistantChartKind::TopCompanions);
    assert_eq!(chart.points.len(), 10);
    assert_eq!(chart.points[0], point("p0 · Home", 100));
}

#[test]
fn social_period_charts_companions_and_worlds() {
    let charts = tool_charts(
        "summarize_social_period",
        &json!({
            "topCompanions": [serde_json::to_value(companion("Hana", 865)).unwrap()],
            "topWorlds": [{ "worldId": "wrld_p", "worldName": "Papa's home", "visits": 618, "totalMinutes": 41640, "lastVisitedAt": "" }],
            "bestTimes": []
        }),
    );

    let kinds: Vec<_> = charts.iter().map(|chart| chart.kind).collect();
    assert_eq!(
        kinds,
        [
            AssistantChartKind::TopCompanions,
            AssistantChartKind::TopWorlds
        ]
    );
    assert_eq!(values(&charts[1]), [("Papa's home", 41640)]);
}

#[test]
fn other_tools_and_error_payloads_have_no_charts() {
    assert!(tool_charts("get_friend_profile", &json!({ "rows": [] })).is_empty());
    assert!(tool_charts("get_copresence_summary", &json!({ "error": "x" })).is_empty());
}

#[test]
fn friend_profile_charts_shared_worlds_then_the_hourly_pattern() {
    let charts = tool_charts(
        "get_friend_profile",
        &json!({
            "current": null,
            "encounter": { "displayName": "Stranger" },
            "sharedWorlds": [
                { "worldId": "wrld_l", "worldName": "Cozy Loft", "totalMinutes": 60, "lastSeenTogether": "" },
                { "worldId": "wrld_p", "worldName": "Night Pier", "totalMinutes": 30, "lastSeenTogether": "" }
            ],
            "activityPattern": { "displayName": "Stranger", "buckets": { "21": 4 } }
        }),
    );

    assert_eq!(charts.len(), 2);
    assert_eq!(charts[0].kind, AssistantChartKind::SharedWorlds);
    assert_eq!(charts[0].subject.as_deref(), Some("Stranger"));
    assert_eq!(values(&charts[0]), [("Cozy Loft", 60), ("Night Pier", 30)]);
    assert_eq!(charts[1].kind, AssistantChartKind::FriendPattern);

    assert!(tool_charts(
        "get_friend_profile",
        &json!({ "current": null, "encounter": null, "activityPattern": null })
    )
    .is_empty());
}
