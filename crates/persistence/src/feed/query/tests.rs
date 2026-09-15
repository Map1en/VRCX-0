use std::path::PathBuf;

use vrcx_0_contracts::feed_live::FeedLiveEntry;

use super::{
    feed_latest_query, feed_rows_query, feed_rows_query_interruptible, merge_feed_rows_with_live,
    FeedCursorInput, FeedFilter, FeedLatestQueryInput, FeedLiveEntryInput,
    FeedLiveRowsMergeContext, FeedQueryMode, FeedReadModelOutput, FeedRowOutput,
    FeedRowsQueryInput,
};
use crate::database::DatabaseService;
use crate::feed::test_support::seed_feed_gps_rows;
use crate::ownership::OwnerId;
use crate::realtime::{write_realtime_batch, RealtimePersistenceBatch};

fn gps_entry(created_at: &str, user_id: &str, display_name: &str, location: &str) -> FeedLiveEntry {
    FeedLiveEntry::Gps {
        created_at: created_at.into(),
        user_id: user_id.into(),
        display_name: display_name.into(),
        location: location.into(),
        world_name: String::new(),
        previous_location: String::new(),
        time: 0,
        group_name: String::new(),
        world_id: None,
        display_location: None,
        owner_user_id: String::new(),
    }
}

fn gps_world_entry(
    created_at: &str,
    user_id: &str,
    display_name: &str,
    location: &str,
    world_name: &str,
) -> FeedLiveEntry {
    let mut entry = gps_entry(created_at, user_id, display_name, location);
    entry.set_world_name(world_name.into());
    entry
}

fn avatar_entry(
    created_at: &str,
    user_id: &str,
    display_name: &str,
    owner_id: &str,
    avatar_name: &str,
) -> FeedLiveEntry {
    FeedLiveEntry::Avatar {
        created_at: created_at.into(),
        user_id: user_id.into(),
        display_name: display_name.into(),
        owner_id: owner_id.into(),
        previous_owner_id: String::new(),
        avatar_name: avatar_name.into(),
        previous_avatar_name: String::new(),
        current_avatar_image_url: String::new(),
        current_avatar_thumbnail_image_url: String::new(),
        previous_current_avatar_image_url: String::new(),
        previous_current_avatar_thumbnail_image_url: String::new(),
        current_avatar_tags: None,
        previous_current_avatar_tags: None,
        owner_user_id: String::new(),
    }
}

fn status_entry(
    created_at: &str,
    user_id: &str,
    display_name: &str,
    status: &str,
) -> FeedLiveEntry {
    FeedLiveEntry::Status {
        created_at: created_at.into(),
        user_id: user_id.into(),
        display_name: display_name.into(),
        status: status.into(),
        status_description: String::new(),
        previous_status: String::new(),
        previous_status_description: String::new(),
        owner_user_id: String::new(),
    }
}

fn bio_entry(
    created_at: &str,
    user_id: &str,
    display_name: &str,
    bio: &str,
    previous_bio: &str,
) -> FeedLiveEntry {
    FeedLiveEntry::Bio {
        created_at: created_at.into(),
        user_id: user_id.into(),
        display_name: display_name.into(),
        bio: bio.into(),
        previous_bio: previous_bio.into(),
        owner_user_id: String::new(),
    }
}

fn friend_entry(created_at: &str, user_id: &str, display_name: &str) -> FeedLiveEntry {
    FeedLiveEntry::Friend {
        created_at: created_at.into(),
        user_id: user_id.into(),
        display_name: display_name.into(),
        owner_user_id: String::new(),
    }
}

fn live(sequence: i64, entry: FeedLiveEntry) -> FeedLiveEntryInput {
    FeedLiveEntryInput { sequence, entry }
}

fn persisted_row(row_id: i64, source_rank: i64, entry: FeedLiveEntry) -> FeedRowOutput {
    FeedRowOutput {
        row_id: Some(row_id),
        source_rank: Some(source_rank),
        ..FeedRowOutput::from(&entry)
    }
}

struct TestDir {
    path: PathBuf,
}

impl TestDir {
    fn new(name: &str) -> Self {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path =
            std::env::temp_dir().join(format!("vrcx-0-{name}-{}-{nonce}", std::process::id()));
        std::fs::create_dir_all(&path).unwrap();
        Self { path }
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

#[derive(Default)]
struct MergeCase {
    rows: Vec<FeedRowOutput>,
    current_user_id: String,
    filters: Vec<FeedFilter>,
    search: String,
    date_from: String,
    date_to: String,
    favorites_only: bool,
    favorite_user_ids: Vec<String>,
    scoped_user_ids: Vec<String>,
    excluded_user_ids: Vec<String>,
    live_entries: Vec<FeedLiveEntryInput>,
    min_live_sequence: i64,
    max_rows: i64,
}

fn merge_case(input: MergeCase) -> FeedReadModelOutput {
    let context = FeedLiveRowsMergeContext {
        current_user_id: &input.current_user_id,
        filters: &input.filters,
        search: &input.search,
        date_from: &input.date_from,
        date_to: &input.date_to,
        favorites_only: input.favorites_only,
        favorite_user_ids: &input.favorite_user_ids,
        scoped_user_ids: &input.scoped_user_ids,
        excluded_user_ids: &input.excluded_user_ids,
        max_rows: input.max_rows,
    };
    merge_feed_rows_with_live(
        input.rows,
        &input.live_entries,
        input.min_live_sequence,
        context,
    )
}

#[test]
fn live_feed_ignores_friend_relationship_events_without_active_filters() {
    let output = merge_case(MergeCase {
        rows: Vec::new(),
        current_user_id: "usr_self".into(),
        filters: Vec::new(),
        search: String::new(),
        date_from: String::new(),
        date_to: String::new(),
        favorites_only: false,
        favorite_user_ids: Vec::new(),
        scoped_user_ids: Vec::new(),
        excluded_user_ids: Vec::new(),
        live_entries: vec![
            live(
                1,
                friend_entry("2026-05-15T00:00:00Z", "usr_friend", "Friend"),
            ),
            live(
                2,
                gps_entry(
                    "2026-05-15T00:00:01Z",
                    "usr_friend",
                    "Friend",
                    "wrld_1:instance",
                ),
            ),
        ],
        min_live_sequence: 0,
        max_rows: 10,
    });

    assert_eq!(output.max_sequence, 2);
    assert_eq!(output.rows.len(), 1);
    assert_eq!(output.rows[0].r#type.as_deref(), Some("GPS"));
}

#[test]
fn user_scope_drops_live_entries_and_existing_rows_outside_the_scope() {
    let output = merge_case(MergeCase {
        rows: vec![
            FeedRowOutput::from(&gps_entry(
                "2026-05-15T00:00:00Z",
                "usr_scoped",
                "Scoped",
                "wrld_1:instance",
            )),
            FeedRowOutput::from(&gps_entry(
                "2026-05-15T00:00:01Z",
                "usr_other",
                "Other",
                "wrld_2:instance",
            )),
        ],
        current_user_id: "usr_self".into(),
        filters: Vec::new(),
        search: String::new(),
        date_from: String::new(),
        date_to: String::new(),
        favorites_only: false,
        favorite_user_ids: Vec::new(),
        scoped_user_ids: vec!["usr_scoped".into()],
        excluded_user_ids: Vec::new(),
        live_entries: vec![
            live(
                1,
                gps_entry(
                    "2026-05-15T00:00:02Z",
                    "usr_other",
                    "Other",
                    "wrld_3:instance",
                ),
            ),
            live(
                2,
                gps_entry(
                    "2026-05-15T00:00:03Z",
                    "usr_scoped",
                    "Scoped",
                    "wrld_4:instance",
                ),
            ),
        ],
        min_live_sequence: 0,
        max_rows: 10,
    });

    assert_eq!(output.max_sequence, 2);
    let user_ids = output
        .rows
        .iter()
        .map(|row| row.user_id.as_deref().unwrap_or_default())
        .collect::<Vec<_>>();
    assert_eq!(user_ids, vec!["usr_scoped", "usr_scoped"]);
}

#[test]
fn live_feed_rows_keep_avatar_fields_that_only_exist_on_live_entries() {
    let output = merge_case(MergeCase {
        rows: Vec::new(),
        current_user_id: "usr_self".into(),
        filters: Vec::new(),
        search: String::new(),
        date_from: String::new(),
        date_to: String::new(),
        favorites_only: false,
        favorite_user_ids: Vec::new(),
        scoped_user_ids: Vec::new(),
        excluded_user_ids: Vec::new(),
        live_entries: vec![live(
            1,
            FeedLiveEntry::Avatar {
                created_at: "2026-05-15T00:00:00Z".into(),
                user_id: "usr_friend".into(),
                display_name: "Friend".into(),
                owner_id: "usr_owner".into(),
                previous_owner_id: "usr_previous_owner".into(),
                avatar_name: "Current".into(),
                previous_avatar_name: "Previous".into(),
                current_avatar_image_url: String::new(),
                current_avatar_thumbnail_image_url: String::new(),
                previous_current_avatar_image_url: String::new(),
                previous_current_avatar_thumbnail_image_url: String::new(),
                current_avatar_tags: Some(vec!["content_horror".into()]),
                previous_current_avatar_tags: Some(Vec::new()),
                owner_user_id: String::new(),
            },
        )],
        min_live_sequence: 0,
        max_rows: 10,
    });

    assert_eq!(output.rows.len(), 1);
    let row = &output.rows[0];
    assert_eq!(row.previous_avatar_name.as_deref(), Some("Previous"));
    assert_eq!(row.previous_owner_id.as_deref(), Some("usr_previous_owner"));
    assert_eq!(
        row.current_avatar_tags.as_deref(),
        Some(["content_horror".to_string()].as_slice())
    );
    assert_eq!(
        row.previous_current_avatar_tags.as_deref(),
        Some([].as_slice())
    );
    assert_eq!(row.row_id, None);
}

#[test]
fn live_avatar_search_matches_private_and_public_with_dates_and_filters() {
    let live_entries = vec![
        live(
            1,
            avatar_entry("2026-05-01T00:00:00Z", "usr_old", "", "usr_old", "Old"),
        ),
        live(
            2,
            avatar_entry(
                "2026-05-20T00:00:00Z",
                "usr_private",
                "",
                "usr_private",
                "Owned Avatar",
            ),
        ),
        live(
            3,
            avatar_entry(
                "2026-05-21T00:00:00Z",
                "usr_public",
                "",
                "usr_author",
                "Shared Avatar",
            ),
        ),
        live(
            4,
            avatar_entry(
                "2026-05-21T00:00:00Z",
                "usr_missing_owner",
                "",
                "",
                "Missing Owner",
            ),
        ),
        live(5, gps_entry("2026-05-20T00:00:00Z", "usr_gps", "", "")),
    ];

    let private_output = merge_case(MergeCase {
        filters: vec![FeedFilter::Avatar],
        search: "private".into(),
        date_from: "2026-05-10T00:00:00Z".into(),
        date_to: "2026-05-20T00:00:00Z".into(),
        live_entries: live_entries.clone(),
        max_rows: 10,
        ..MergeCase::default()
    });
    assert_eq!(private_output.rows.len(), 1);
    assert_eq!(
        private_output.rows[0].user_id.as_deref(),
        Some("usr_private")
    );

    let public_output = merge_case(MergeCase {
        filters: vec![FeedFilter::Avatar],
        search: "public".into(),
        date_from: "2026-05-21T00:00:00Z".into(),
        date_to: "2026-05-21T00:00:00Z".into(),
        live_entries,
        max_rows: 10,
        ..MergeCase::default()
    });
    assert_eq!(public_output.rows.len(), 1);
    assert_eq!(public_output.rows[0].user_id.as_deref(), Some("usr_public"));
}

#[test]
fn merged_rows_carry_every_live_entry_field() {
    let output = merge_case(MergeCase {
        rows: Vec::new(),
        current_user_id: "usr_self".into(),
        filters: Vec::new(),
        search: String::new(),
        date_from: String::new(),
        date_to: String::new(),
        favorites_only: false,
        favorite_user_ids: Vec::new(),
        scoped_user_ids: Vec::new(),
        excluded_user_ids: Vec::new(),
        live_entries: vec![live(
            1,
            FeedLiveEntry::Gps {
                created_at: "2026-05-15T00:00:00Z".into(),
                user_id: "usr_friend".into(),
                display_name: "Friend".into(),
                location: "wrld_1:instance".into(),
                world_name: "World".into(),
                previous_location: String::new(),
                time: 1500,
                group_name: String::new(),
                world_id: None,
                display_location: None,
                owner_user_id: String::new(),
            },
        )],
        min_live_sequence: 0,
        max_rows: 10,
    });

    assert_eq!(output.rows.len(), 1);
    let row = &output.rows[0];
    assert_eq!(row.user_id.as_deref(), Some("usr_friend"));
    assert_eq!(row.display_name.as_deref(), Some("Friend"));
    assert_eq!(row.created_at.as_deref(), Some("2026-05-15T00:00:00Z"));
    assert_eq!(row.world_name.as_deref(), Some("World"));
    assert_eq!(row.time, Some(1500));
}

#[test]
fn persisted_rows_with_matching_content_identity_remain_distinct() {
    let output = merge_case(MergeCase {
        rows: vec![
            persisted_row(
                1,
                40,
                status_entry("2026-05-15T00:00:00Z", "usr_friend", "", "active"),
            ),
            persisted_row(
                2,
                40,
                status_entry("2026-05-15T00:00:00Z", "usr_friend", "", "join me"),
            ),
        ],
        current_user_id: "usr_self".into(),
        max_rows: 10,
        ..MergeCase::default()
    });

    assert_eq!(output.rows.len(), 2);
    assert_eq!(output.rows[0].row_id, Some(1));
    assert_eq!(output.rows[1].row_id, Some(2));
}

#[test]
fn live_row_replaces_the_same_persisted_feed_entry() {
    let output = merge_case(MergeCase {
        rows: vec![persisted_row(
            1,
            60,
            gps_entry("2026-05-15T00:00:00Z", "usr_friend", "", "wrld_1:instance"),
        )],
        current_user_id: "usr_self".into(),
        live_entries: vec![live(
            1,
            gps_entry("2026-05-15T00:00:00Z", "usr_friend", "", "wrld_1:instance"),
        )],
        max_rows: 10,
        ..MergeCase::default()
    });

    assert_eq!(output.rows.len(), 1);
    assert_eq!(output.rows[0].row_id, None);
    assert_eq!(output.max_sequence, 1);
}

#[test]
fn latest_query_keeps_the_persisted_cursor_when_live_rows_fill_the_result(
) -> Result<(), crate::Error> {
    let dir = TestDir::new("feed-latest-persisted-cursor");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    write_realtime_batch(
        &db,
        &OwnerId::new("usr_self"),
        &RealtimePersistenceBatch {
            feed_entries: vec![gps_world_entry(
                "2026-05-15T00:00:00Z",
                "usr_persisted",
                "Persisted",
                "wrld_1:persisted",
                "Persisted World",
            )],
            ..RealtimePersistenceBatch::default()
        },
    )?;

    let output = feed_latest_query(
        &db,
        FeedLatestQueryInput {
            user_id: "usr_self".into(),
            filters: vec![FeedFilter::Gps],
            favorite_user_ids: Vec::new(),
            scoped_user_ids: Vec::new(),
            excluded_user_ids: Vec::new(),
            favorites_only: false,
            max_rows: 1,
        },
        vec![live(
            1,
            gps_entry("2026-05-15T00:01:00Z", "usr_live", "", "wrld_1:live"),
        )],
        1,
        true,
    )?;

    assert_eq!(output.rows.len(), 1);
    assert_eq!(output.rows[0].user_id.as_deref(), Some("usr_live"));
    assert_eq!(output.rows[0].row_id, None);
    assert!(output.persisted_has_more);
    assert!(output.persisted_cursor.is_some());
    Ok(())
}

#[test]
fn lookup_feed_pagination_uses_the_same_date_order_as_its_cursor() -> Result<(), crate::Error> {
    let dir = TestDir::new("feed-lookup-rowid");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;

    write_realtime_batch(
        &db,
        &OwnerId::new("usr_self"),
        &RealtimePersistenceBatch {
            feed_entries: vec![
                gps_world_entry(
                    "2026-05-15T00:10:00Z",
                    "usr_newer_created",
                    "newer-created",
                    "wrld_1:newer",
                    "Newer Created",
                ),
                gps_world_entry(
                    "2026-05-15T00:00:00Z",
                    "usr_later_inserted",
                    "later-inserted",
                    "wrld_1:later",
                    "Later Inserted",
                ),
            ],
            ..RealtimePersistenceBatch::default()
        },
    )?;

    let first_page = feed_rows_query(
        &db,
        FeedRowsQueryInput {
            user_id: "usr_self".into(),
            mode: FeedQueryMode::Lookup,
            search: String::new(),
            filters: vec![FeedFilter::Gps],
            vip_list: Vec::new(),
            scoped_user_ids: Vec::new(),
            excluded_user_ids: Vec::new(),
            max_entries: 1,
            date_from: String::new(),
            date_to: String::new(),
            cursor: None,
        },
    )?;

    assert_eq!(first_page.len(), 1);
    assert_eq!(first_page[0].display_name.as_deref(), Some("newer-created"));

    let second_page = feed_rows_query(
        &db,
        FeedRowsQueryInput {
            user_id: "usr_self".into(),
            mode: FeedQueryMode::Lookup,
            search: String::new(),
            filters: vec![FeedFilter::Gps],
            vip_list: Vec::new(),
            scoped_user_ids: Vec::new(),
            excluded_user_ids: Vec::new(),
            max_entries: 1,
            date_from: String::new(),
            date_to: String::new(),
            cursor: Some(FeedCursorInput {
                created_at: first_page[0].created_at.clone().unwrap(),
                source_rank: first_page[0].source_rank.unwrap(),
                row_id: first_page[0].row_id.unwrap(),
            }),
        },
    )?;

    assert_eq!(second_page.len(), 1);
    assert_eq!(
        second_page[0].display_name.as_deref(),
        Some("later-inserted")
    );
    Ok(())
}

#[test]
fn world_id_search_honors_the_date_window() -> Result<(), crate::Error> {
    let dir = TestDir::new("feed-search-world-date-window");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    write_realtime_batch(
        &db,
        &OwnerId::new("usr_self"),
        &RealtimePersistenceBatch {
            feed_entries: vec![
                gps_world_entry(
                    "2026-05-01T00:00:00Z",
                    "usr_old",
                    "Old",
                    "wrld_target:old",
                    "Target",
                ),
                gps_world_entry(
                    "2026-05-20T00:00:00Z",
                    "usr_new",
                    "New",
                    "wrld_target:new",
                    "Target",
                ),
            ],
            ..RealtimePersistenceBatch::default()
        },
    )?;

    let rows = feed_rows_query_interruptible(
        &db,
        FeedRowsQueryInput {
            user_id: "usr_self".into(),
            mode: FeedQueryMode::Search,
            search: "wrld_target".into(),
            filters: vec![FeedFilter::Gps],
            vip_list: Vec::new(),
            scoped_user_ids: Vec::new(),
            excluded_user_ids: Vec::new(),
            max_entries: 10,
            date_from: "2026-05-10T00:00:00Z".into(),
            date_to: String::new(),
            cursor: None,
        },
        || false,
    )?;

    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].user_id.as_deref(), Some("usr_new"));
    Ok(())
}

#[test]
fn private_avatar_search_applies_dates_to_every_match_branch() -> Result<(), crate::Error> {
    let dir = TestDir::new("feed-search-private-avatar-date-window");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    write_realtime_batch(
        &db,
        &OwnerId::new("usr_self"),
        &RealtimePersistenceBatch {
            feed_entries: vec![
                avatar_entry(
                    "2026-05-01T00:00:00Z",
                    "usr_old",
                    "Private Collector",
                    "usr_old",
                    "Old Avatar",
                ),
                avatar_entry(
                    "2026-05-20T00:00:00Z",
                    "usr_new",
                    "New",
                    "usr_new",
                    "New Avatar",
                ),
            ],
            ..RealtimePersistenceBatch::default()
        },
    )?;

    let rows = feed_rows_query_interruptible(
        &db,
        FeedRowsQueryInput {
            user_id: "usr_self".into(),
            mode: FeedQueryMode::Search,
            search: "private".into(),
            filters: vec![FeedFilter::Avatar],
            vip_list: Vec::new(),
            scoped_user_ids: Vec::new(),
            excluded_user_ids: Vec::new(),
            max_entries: 10,
            date_from: "2026-05-10T00:00:00Z".into(),
            date_to: String::new(),
            cursor: None,
        },
        || false,
    )?;

    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].user_id.as_deref(), Some("usr_new"));
    Ok(())
}

#[test]
fn date_window_preserves_millisecond_boundaries() -> Result<(), crate::Error> {
    let dir = TestDir::new("feed-millisecond-date-window");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    write_realtime_batch(
        &db,
        &OwnerId::new("usr_self"),
        &RealtimePersistenceBatch {
            feed_entries: vec![
                status_entry(
                    "2026-05-20T00:00:00.000Z",
                    "usr_milliseconds",
                    "Milliseconds",
                    "active",
                ),
                status_entry("2026-05-20T00:00:00Z", "usr_seconds", "Seconds", "active"),
                status_entry(
                    "2026-05-20T00:00:00+00:00",
                    "usr_offset",
                    "Offset",
                    "active",
                ),
                status_entry("2026-05-20T00:00:00.500Z", "usr_later", "Later", "active"),
            ],
            ..RealtimePersistenceBatch::default()
        },
    )?;

    let rows = feed_rows_query_interruptible(
        &db,
        FeedRowsQueryInput {
            user_id: "usr_self".into(),
            mode: FeedQueryMode::Lookup,
            search: String::new(),
            filters: vec![FeedFilter::Status],
            vip_list: Vec::new(),
            scoped_user_ids: Vec::new(),
            excluded_user_ids: Vec::new(),
            max_entries: 10,
            date_from: "2026-05-20T00:00:00.000Z".into(),
            date_to: "2026-05-20T00:00:00.000Z".into(),
            cursor: None,
        },
        || false,
    )?;

    assert_eq!(rows.len(), 3);
    assert!(rows
        .iter()
        .all(|row| row.user_id.as_deref() != Some("usr_later")));

    let newest = feed_rows_query_interruptible(
        &db,
        FeedRowsQueryInput {
            user_id: "usr_self".into(),
            mode: FeedQueryMode::Lookup,
            search: String::new(),
            filters: vec![FeedFilter::Status],
            vip_list: Vec::new(),
            scoped_user_ids: Vec::new(),
            excluded_user_ids: Vec::new(),
            max_entries: 1,
            date_from: String::new(),
            date_to: String::new(),
            cursor: None,
        },
        || false,
    )?;
    assert_eq!(newest[0].user_id.as_deref(), Some("usr_later"));
    Ok(())
}

#[test]
fn search_matches_previous_values_and_escapes_like_wildcards() -> Result<(), crate::Error> {
    let dir = TestDir::new("feed-search-previous-literal");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    write_realtime_batch(
        &db,
        &OwnerId::new("usr_self"),
        &RealtimePersistenceBatch {
            feed_entries: vec![
                bio_entry(
                    "2026-05-20T00:00:00.000Z",
                    "usr_previous",
                    "Previous",
                    "new value",
                    "removed needle",
                ),
                bio_entry(
                    "2026-05-19T00:00:00.000Z",
                    "usr_percent",
                    "Percent",
                    "100% literal",
                    "old",
                ),
                bio_entry(
                    "2026-05-18T00:00:00.000Z",
                    "usr_other",
                    "Other",
                    "ordinary text",
                    "old",
                ),
            ],
            ..RealtimePersistenceBatch::default()
        },
    )?;

    let search = |text: &str| {
        feed_rows_query(
            &db,
            FeedRowsQueryInput {
                user_id: "usr_self".into(),
                mode: FeedQueryMode::Search,
                search: text.into(),
                filters: vec![FeedFilter::Bio],
                vip_list: Vec::new(),
                scoped_user_ids: Vec::new(),
                excluded_user_ids: Vec::new(),
                max_entries: 10,
                date_from: String::new(),
                date_to: String::new(),
                cursor: None,
            },
        )
    };

    let previous = search("removed needle")?;
    assert_eq!(previous.len(), 1);
    assert_eq!(previous[0].user_id.as_deref(), Some("usr_previous"));

    let literal_percent = search("%")?;
    assert_eq!(literal_percent.len(), 1);
    assert_eq!(literal_percent[0].user_id.as_deref(), Some("usr_percent"));
    Ok(())
}

fn lookup_page(
    db: &DatabaseService,
    max_entries: i64,
    cursor: Option<FeedCursorInput>,
) -> Result<Vec<FeedRowOutput>, crate::Error> {
    feed_rows_query(
        db,
        FeedRowsQueryInput {
            user_id: "usr_self".into(),
            mode: FeedQueryMode::Lookup,
            search: String::new(),
            filters: Vec::new(),
            vip_list: Vec::new(),
            scoped_user_ids: Vec::new(),
            excluded_user_ids: Vec::new(),
            max_entries,
            date_from: String::new(),
            date_to: String::new(),
            cursor,
        },
    )
}

fn cursor_after(row: &FeedRowOutput) -> FeedCursorInput {
    FeedCursorInput {
        created_at: row.created_at.clone().unwrap(),
        source_rank: row.source_rank.unwrap(),
        row_id: row.row_id.unwrap(),
    }
}

#[test]
fn cursor_pagination_walks_same_timestamp_rows_across_tables_in_full_page_order(
) -> Result<(), crate::Error> {
    let dir = TestDir::new("feed-cursor-ties");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    let tie = "2026-05-15T00:10:00Z";
    write_realtime_batch(
        &db,
        &OwnerId::new("usr_self"),
        &RealtimePersistenceBatch {
            feed_entries: vec![
                bio_entry(tie, "usr_bio", "bio-20", "new bio", "old bio"),
                avatar_entry(tie, "usr_avatar", "avatar-30", "usr_owner", "Avatar"),
                status_entry(tie, "usr_status", "status-40", "join me"),
                gps_entry(tie, "usr_gps_a", "gps-60-a", "wrld_1:a"),
                gps_entry(tie, "usr_gps_b", "gps-60-b", "wrld_1:b"),
                gps_entry("2026-05-15T00:00:00Z", "usr_older", "older", "wrld_1:c"),
            ],
            ..RealtimePersistenceBatch::default()
        },
    )?;

    let full_page: Vec<String> = lookup_page(&db, 10, None)?
        .into_iter()
        .filter_map(|row| row.display_name)
        .collect();
    assert_eq!(
        full_page,
        [
            "gps-60-b",
            "gps-60-a",
            "status-40",
            "avatar-30",
            "bio-20",
            "older"
        ]
    );

    let mut walked = Vec::new();
    let mut cursor = None;
    loop {
        let page = lookup_page(&db, 1, cursor.take())?;
        let Some(row) = page.into_iter().next() else {
            break;
        };
        cursor = Some(cursor_after(&row));
        walked.push(row.display_name.unwrap());
    }
    assert_eq!(walked, full_page);
    Ok(())
}

#[test]
#[ignore = "500k-row feed baseline fixture; run with --ignored --nocapture"]
fn deep_cursor_page_costs_the_same_as_the_first_page_on_the_baseline_fixture(
) -> Result<(), crate::Error> {
    let dir = TestDir::new("feed-baseline");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?;
    seed_feed_gps_rows(&db, "usr_self", 500_000)?;
    let deep_row = db.execute(
        "SELECT created_at FROM usrself_feed_gps WHERE id = 1000",
        &Default::default(),
    )?;
    let deep_cursor = FeedCursorInput {
        created_at: deep_row[0][0].as_str().unwrap().to_string(),
        source_rank: 60,
        row_id: 1000,
    };

    let started = std::time::Instant::now();
    let first_page = lookup_page(&db, 100, None)?;
    let first_page_elapsed = started.elapsed();
    let started = std::time::Instant::now();
    let deep_page = lookup_page(&db, 100, Some(deep_cursor))?;
    let deep_page_elapsed = started.elapsed();
    println!("first page {first_page_elapsed:?}, deep page {deep_page_elapsed:?}");

    assert_eq!(first_page.len(), 100);
    assert_eq!(deep_page.len(), 100);
    assert_eq!(deep_page[0].row_id, Some(999));
    assert!(deep_page_elapsed < std::time::Duration::from_millis(20));
    Ok(())
}
