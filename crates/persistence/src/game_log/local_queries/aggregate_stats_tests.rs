use serde_json::json;

use super::test_support::*;

#[test]
fn world_and_user_stat_queries_return_defaults_and_skip_current_matches() -> Result<(), crate::Error>
{
    let test_db = test_db("local-query-stats")?;
    seed_fixture(&test_db.db)?;

    assert_eq!(
        query(
            &test_db.db,
            "lastVisit",
            json!({
                "worldId": "wrld_alpha",
                "currentWorldMatch": true
            }),
        )?["created_at"],
        "2026-05-14T08:00:00Z"
    );
    assert_eq!(
        query(
            &test_db.db,
            "visitCount",
            json!({ "worldId": "wrld_alpha" })
        )?["visitCount"],
        2
    );
    assert_eq!(
        query(
            &test_db.db,
            "timeSpentInWorld",
            json!({ "worldId": "wrld_alpha" }),
        )?["timeSpent"],
        150_000
    );
    assert_eq!(
        query(
            &test_db.db,
            "lastGroupVisit",
            json!({ "groupId": "grp_alpha" })
        )?["created_at"],
        "2026-05-14T10:00:00Z"
    );
    assert_eq!(
        query(
            &test_db.db,
            "lastSeen",
            json!({
                "userId": "usr_vip",
                "displayName": "Vip Friend",
                "inCurrentWorld": true
            }),
        )?["created_at"],
        "2026-05-14T08:01:00Z"
    );
    assert_eq!(
        query(
            &test_db.db,
            "joinCount",
            json!({
                "userId": "usr_vip",
                "displayName": "Vip Friend"
            }),
        )?["joinCount"],
        1
    );
    assert_eq!(
        query(
            &test_db.db,
            "timeSpent",
            json!({
                "userId": "usr_vip",
                "displayName": "Vip Friend"
            }),
        )?["timeSpent"],
        1_800_000
    );

    let stats = query(
        &test_db.db,
        "userStats",
        json!({
            "userId": "usr_target",
            "displayName": "New Target"
        }),
    )?;
    assert_eq!(stats["joinCount"], 1);
    assert_eq!(stats["timeSpent"], 900_000);
    assert_eq!(
        stats["previousDisplayNames"][0]["displayName"],
        "Old Target"
    );

    assert_eq!(
        query(
            &test_db.db,
            "lastVisit",
            json!({ "worldId": "wrld_missing" })
        )?,
        json!({ "created_at": "", "worldId": "" })
    );
    Ok(())
}

#[test]
fn aggregate_and_lookup_queries_cover_group_world_player_and_dates() -> Result<(), crate::Error> {
    let test_db = test_db("local-query-aggregates")?;
    seed_fixture(&test_db.db)?;

    let group_rows = rows(query(
        &test_db.db,
        "previousInstancesByGroupId",
        json!({ "groupId": "grp_alpha" }),
    )?);
    assert_eq!(group_rows.len(), 2);
    assert_eq!(
        group_rows[0]["location"],
        "wrld_alpha:inst-c~group(grp_alpha)"
    );

    let all_stats = rows(query(
        &test_db.db,
        "allUserStats",
        json!({
            "userIds": ["usr_vip"],
            "displayNames": ["New Target"]
        }),
    )?);
    assert_eq!(all_stats.len(), 2);

    assert_eq!(
        query(&test_db.db, "lastDate", json!({}))?,
        json!("2026-05-14T10:05:00Z")
    );

    let previous_by_user = rows(query(
        &test_db.db,
        "previousInstancesByUserIdRows",
        json!({
            "userId": "usr_vip",
            "dateFrom": "2026-05-14T08:00:00Z",
            "dateTo": "2026-05-14T08:10:00Z"
        }),
    )?);
    assert_eq!(previous_by_user.len(), 1);
    assert_eq!(previous_by_user[0]["worldName"], "Alpha World");

    let world_rows = rows(query(
        &test_db.db,
        "previousInstancesByWorldId",
        json!({ "worldId": "wrld_alpha" }),
    )?);
    assert_eq!(world_rows.len(), 2);

    let players = rows(query(
        &test_db.db,
        "playersFromInstanceRows",
        json!({ "location": "wrld_alpha:inst-a~group(grp_alpha)" }),
    )?);
    assert_eq!(players.len(), 4);

    assert_eq!(
        query(
            &test_db.db,
            "locationBeforeOrAt",
            json!({ "createdAt": "2026-05-14T09:30:00Z" }),
        )?["worldId"],
        "wrld_beta"
    );

    let range = rows(query(
        &test_db.db,
        "joinLeaveRange",
        json!({
            "location": "wrld_alpha:inst-a~group(grp_alpha)",
            "afterDate": "2026-05-14T08:00:00Z",
            "beforeDate": "2026-05-14T08:02:00Z"
        }),
    )?);
    assert_eq!(range.len(), 2);

    let detail = rows(query(
        &test_db.db,
        "playerDetailFromInstance",
        json!({ "location": "wrld_alpha:inst-a~group(grp_alpha)" }),
    )?);
    assert_eq!(detail[0]["display_name"], "Vip Friend");

    let names = rows(query(
        &test_db.db,
        "previousDisplayNamesByUserId",
        json!({ "userId": "usr_target" }),
    )?);
    assert_eq!(
        row_texts(&names, "displayName"),
        vec!["New Target".to_string(), "Old Target".to_string(),]
    );

    let instance_times = rows(query(&test_db.db, "instanceTimes", json!({}))?);
    assert_eq!(instance_times.len(), 3);

    let online = rows(query(
        &test_db.db,
        "onlineSessions",
        json!({
            "fromDate": "2026-05-14T09:30:00Z",
            "toDate": "2026-05-14T10:30:00Z"
        }),
    )?);
    assert_eq!(
        row_texts(&online, "created_at"),
        vec![
            "2026-05-14T09:00:00Z".to_string(),
            "2026-05-14T10:00:00Z".to_string(),
        ]
    );

    let after = rows(query(
        &test_db.db,
        "onlineSessionsAfter",
        json!({
            "afterCreatedAt": "2026-05-14T09:00:00Z",
            "inclusive": false
        }),
    )?);
    assert_eq!(
        row_texts(&after, "created_at"),
        vec!["2026-05-14T10:00:00Z".to_string(),]
    );

    let top = rows(query(
        &test_db.db,
        "topWorlds",
        json!({
            "limit": 1,
            "sortBy": "count",
            "excludeWorldId": "wrld_beta"
        }),
    )?);
    assert_eq!(top[0]["worldId"], "wrld_alpha");
    Ok(())
}

#[test]
fn activity_and_session_queries_cover_empty_and_cursor_edges() -> Result<(), crate::Error> {
    let test_db = test_db("local-query-sessions")?;
    seed_fixture(&test_db.db)?;

    let activity = rows(query(
        &test_db.db,
        "instanceActivityRows",
        json!({
            "startDate": "2026-05-14T08:00:00Z",
            "endDate": "2026-05-14T08:10:00Z"
        }),
    )?);
    assert_eq!(activity[0]["display_name"], "Vip Friend");

    assert_eq!(
        rows(query(
            &test_db.db,
            "dateOfInstanceActivity",
            json!({ "userId": "usr_vip" }),
        )?),
        vec![json!("2026-05-14T08:01:00Z"), json!("2026-05-14T08:30:00Z")]
    );

    let join_history = rows(query(
        &test_db.db,
        "instanceJoinHistory",
        json!({
            "userId": "usr_vip",
            "createdAt": "2026-05-14T08:00:00Z"
        }),
    )?);
    assert_eq!(
        join_history[0]["location"],
        "wrld_alpha:inst-a~group(grp_alpha)"
    );

    assert_eq!(
        query(
            &test_db.db,
            "worldNameByWorldId",
            json!({ "worldId": "wrld_alpha" }),
        )?,
        json!("Alpha World")
    );
    assert_eq!(
        query(
            &test_db.db,
            "userIdFromDisplayName",
            json!({ "displayName": "Vip Friend" }),
        )?,
        json!("usr_vip")
    );

    Ok(())
}
