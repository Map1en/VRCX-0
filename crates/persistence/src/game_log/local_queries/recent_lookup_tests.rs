use serde_json::json;

use super::test_support::*;
use super::*;

#[test]
fn rejects_unknown_game_log_entry_kind() {
    let parsed = serde_json::from_value::<GameLogWriteKind>(json!("UnknownKind"));

    assert!(parsed.is_err());
}

#[test]
fn recent_database_sorts_across_tables_and_clamps_page_size() -> Result<(), crate::Error> {
    let test_db = test_db("local-query-recent")?;
    seed_fixture(&test_db.db)?;

    let recent = rows(query(
        &test_db.db,
        "recentDatabase",
        json!({
            "dateOffset": "2026-05-14",
            "maxTableSize": 2
        }),
    )?);

    assert_eq!(
        row_texts(&recent, "created_at"),
        vec![
            "2026-05-14T10:00:00Z".to_string(),
            "2026-05-14T10:05:00Z".to_string(),
        ]
    );

    let empty_page = rows(query(
        &test_db.db,
        "recentDatabase",
        json!({
            "dateOffset": "2026-05-14",
            "maxTableSize": -1
        }),
    )?);
    assert!(empty_page.is_empty());
    Ok(())
}

#[test]
fn lookup_rows_respects_filters_vip_and_limit() -> Result<(), crate::Error> {
    let test_db = test_db("local-query-lookup")?;
    seed_fixture(&test_db.db)?;

    let result = rows(query(
        &test_db.db,
        "lookupRows",
        json!({
            "filters": ["OnPlayerJoined", "PortalSpawn", "External", "VideoPlay"],
            "vipList": ["usr_vip"],
            "maxEntries": 10
        }),
    )?);
    let types = row_texts(&result, "type");
    let user_ids = row_texts(&result, "userId");

    assert_eq!(
        types,
        vec![
            "External".to_string(),
            "VideoPlay".to_string(),
            "PortalSpawn".to_string(),
            "OnPlayerJoined".to_string(),
        ]
    );
    assert!(user_ids.iter().all(|user_id| user_id == "usr_vip"));

    let resources_with_vip = rows(query(
        &test_db.db,
        "lookupRows",
        json!({
            "filters": ["ImageLoad", "StringLoad"],
            "vipList": ["usr_vip"],
            "maxEntries": 10
        }),
    )?);
    assert!(resources_with_vip.is_empty());

    let limited = rows(query(
        &test_db.db,
        "lookupRows",
        json!({
            "filters": ["OnPlayerJoined", "OnPlayerLeft"],
            "maxEntries": 1
        }),
    )?);
    assert_eq!(limited.len(), 1);
    assert_eq!(limited[0]["created_at"], "2026-05-14T10:05:00Z");
    Ok(())
}

#[test]
fn lookup_rows_limits_results_after_preserving_per_table_candidates() -> Result<(), crate::Error> {
    let test_db = test_db("local-query-result-limit")?;
    write_game_log_batch(
        &test_db.db,
        "usr_test",
        &GameLogWriteBatch {
            events: vec![
                GameLogEventEntry {
                    created_at: "2030-01-01T00:00:00Z".into(),
                    data: "newest-created-at".into(),
                },
                GameLogEventEntry {
                    created_at: "2020-01-01T00:00:00Z".into(),
                    data: "older-created-at".into(),
                },
                GameLogEventEntry {
                    created_at: "2021-01-01T00:00:00Z".into(),
                    data: "latest-id".into(),
                },
            ],
            ..Default::default()
        },
    )?;

    let result = rows(query(
        &test_db.db,
        "lookupRows",
        json!({
            "filters": ["Event"],
            "maxEntries": 3,
            "maxRows": 1
        }),
    )?);

    assert_eq!(result.len(), 1);
    assert_eq!(result[0]["data"], "newest-created-at");
    Ok(())
}

#[test]
fn rows_by_location_filters_current_user_resource_kind_and_empty_filters(
) -> Result<(), crate::Error> {
    let test_db = test_db("local-query-location")?;
    seed_fixture(&test_db.db)?;
    write_game_log_batch(
        &test_db.db,
        "usr_test",
        &GameLogWriteBatch {
            resource_loads: vec![GameLogResourceLoadEntry {
                created_at: "2026-05-14T08:08:30Z".into(),
                resource_url: "https://assets.example/generic.bin".into(),
                resource_type: "ResourceLoad".into(),
                location: "wrld_alpha:inst-a~group(grp_alpha)".into(),
            }],
            ..Default::default()
        },
    )?;

    let result = rows(query(
        &test_db.db,
        "rowsByLocation",
        json!({
            "instanceId": "inst-a",
            "currentUserId": "usr_self",
            "filters": ["OnPlayerJoined", "ImageLoad"],
            "maxEntries": 20
        }),
    )?);
    let types = row_texts(&result, "type");
    let user_ids = row_texts(&result, "userId");

    assert_eq!(
        types,
        vec![
            "ImageLoad".to_string(),
            "OnPlayerJoined".to_string(),
            "OnPlayerJoined".to_string(),
        ]
    );
    assert!(!user_ids.contains(&"usr_self".to_string()));
    assert!(!types.contains(&"StringLoad".to_string()));
    assert!(!types.contains(&"ResourceLoad".to_string()));

    let empty = rows(query(
        &test_db.db,
        "rowsByLocation",
        json!({
            "instanceId": "inst-a",
            "filters": ["Event"]
        }),
    )?);
    assert!(empty.is_empty());
    Ok(())
}

#[test]
fn rows_by_location_scopes_world_ids_by_prefix_and_group_ids_by_substring(
) -> Result<(), crate::Error> {
    let test_db = test_db("local-query-location-scope")?;
    seed_fixture(&test_db.db)?;

    let locations_for = |instance_id: &str| -> Result<Vec<String>, crate::Error> {
        let result = query(
            &test_db.db,
            "rowsByLocation",
            json!({
                "instanceId": instance_id,
                "filters": ["Location"],
                "maxEntries": 20
            }),
        )?;
        Ok(row_texts(&rows(result), "location"))
    };

    let alpha_locations = vec![
        "wrld_alpha:inst-c~group(grp_alpha)".to_string(),
        "wrld_alpha:inst-a~group(grp_alpha)".to_string(),
    ];
    assert_eq!(locations_for("wrld_alpha")?, alpha_locations);
    assert_eq!(locations_for("wrld_alph")?, alpha_locations);
    assert_eq!(locations_for("grp_alpha")?, alpha_locations);
    assert_eq!(locations_for("WRLD_alpha")?, alpha_locations);
    assert_eq!(locations_for("wrld_ALPHA")?, alpha_locations);
    assert_eq!(
        locations_for("wrld_alpha:inst-a~group(grp_alpha)")?,
        vec!["wrld_alpha:inst-a~group(grp_alpha)"]
    );
    assert!(locations_for("wrld_gamma")?.is_empty());
    Ok(())
}

#[test]
fn rows_by_location_matches_every_event_family_through_both_filter_forms(
) -> Result<(), crate::Error> {
    let test_db = test_db("local-query-location-families")?;
    seed_fixture(&test_db.db)?;

    let types_for = |instance_id: &str| -> Result<Vec<String>, crate::Error> {
        let result = query(
            &test_db.db,
            "rowsByLocation",
            json!({
                "instanceId": instance_id,
                "currentUserId": "usr_self",
                "filters": [
                    "Location",
                    "OnPlayerJoined",
                    "OnPlayerLeft",
                    "PortalSpawn",
                    "VideoPlay",
                    "StringLoad",
                    "ImageLoad"
                ],
                "maxEntries": 50
            }),
        )?;
        Ok(row_texts(&rows(result), "type"))
    };

    let by_prefix = types_for("wrld_alpha")?;
    for family in ["Location", "OnPlayerJoined", "PortalSpawn"] {
        assert!(
            by_prefix.iter().any(|kind| kind == family),
            "{family} missing from {by_prefix:?}"
        );
    }
    assert!(by_prefix
        .iter()
        .any(|kind| kind == "StringLoad" || kind == "ImageLoad"));
    assert_eq!(by_prefix, types_for("grp_alpha")?);
    Ok(())
}

#[test]
fn search_rows_matches_all_searchable_event_families() -> Result<(), crate::Error> {
    let test_db = test_db("local-query-search")?;
    seed_fixture(&test_db.db)?;

    let result = rows(query(
        &test_db.db,
        "searchRows",
        json!({
            "search": "Needle",
            "currentUserId": "usr_self",
            "filters": ["Location", "Event", "External", "VideoPlay", "ImageLoad"],
            "maxEntries": 20
        }),
    )?);
    let types = row_texts(&result, "type");

    assert_eq!(
        types,
        vec![
            "External".to_string(),
            "Event".to_string(),
            "ImageLoad".to_string(),
            "VideoPlay".to_string(),
        ]
    );
    assert_eq!(result[0]["message"], "Needle External");
    assert_eq!(result[1]["data"], "Needle Event");
    assert_eq!(
        result[2]["resourceUrl"],
        "https://assets.example/needle.png"
    );
    assert_eq!(result[3]["videoName"], "Needle Video");
    Ok(())
}
