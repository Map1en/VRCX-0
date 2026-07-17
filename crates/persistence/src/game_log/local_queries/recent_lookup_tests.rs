use serde_json::json;

use super::test_support::*;
use super::*;

#[test]
fn rejects_unknown_game_log_entry_kind() {
    let error = game_log_batch_for_kind(
        "UnknownKind",
        vec![json!({
            "created_at": "2026-05-15T00:00:00Z"
        })],
    )
    .unwrap_err();

    assert!(matches!(error, crate::Error::InvalidData(_)));
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
fn rows_by_location_filters_current_user_resource_kind_and_empty_filters(
) -> Result<(), crate::Error> {
    let test_db = test_db("local-query-location")?;
    seed_fixture(&test_db.db)?;

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
