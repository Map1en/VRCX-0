use super::*;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use rmcp::handler::server::wrapper::Parameters;
use vrcx_0_application::favorites::{FavoriteMutationCoordinator, FavoriteMutationRuntimeDeps};
use vrcx_0_application::social::MutualGraphFetchRuntime;
use vrcx_0_application_core::{
    HostSessionRuntime, LocalGameContextSource, NoopPrintCleanupInputSink, RuntimeAuthScope,
    RuntimeDiagnostics, RuntimeEventBus, RuntimeSyncEngine, TaskSupervisor,
    UnavailableLocalGameContextSource, WebClient, WorldCache,
};
use vrcx_0_application_realtime::{RealtimeHostRuntime, RealtimeHostRuntimeDeps};
use vrcx_0_persistence::game_log::{
    write_batch, GameLogJoinLeaveEntry, GameLogLocationEntry, GameLogWriteBatch,
};
use vrcx_0_persistence::{
    config::ConfigRepository, game_log::ensure_game_log_tables, storage::StorageService,
    DatabaseService,
};

#[test]
fn activity_bucket_accepts_camel_case_aliases() {
    assert!(matches!(
        serde_json::from_str::<ActivityBucketParam>(r#""hourOfDay""#).unwrap(),
        ActivityBucketParam::HourOfDay
    ));
    assert!(matches!(
        serde_json::from_str::<ActivityBucketParam>(r#""dayOfWeek""#).unwrap(),
        ActivityBucketParam::DayOfWeek
    ));
    assert!(matches!(
        serde_json::from_str::<ActivityBucketParam>(r#""weekday""#).unwrap(),
        ActivityBucketParam::DayOfWeek
    ));
}

#[test]
fn copresence_friends_only_accepts_boolean_strings() {
    for (value, expected) in [("true", true), ("false", false)] {
        let input: CopresenceSummaryParams = serde_json::from_value(serde_json::json!({
            "friendsOnly": value
        }))
        .unwrap();

        assert_eq!(input.friends_only, Some(expected));
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
            std::env::temp_dir().join(format!("vrcx-0-mcp-{name}-{}-{nonce}", std::process::id()));
        std::fs::create_dir_all(&path).unwrap();
        Self { path }
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

fn test_server(
    name: &str,
    auth_scope_user_id: &str,
) -> Result<(TestDir, VrcxMcpServer), Box<dyn std::error::Error>> {
    let (dir, server, _) = test_server_with_game_context(
        name,
        auth_scope_user_id,
        Arc::new(UnavailableLocalGameContextSource),
    )?;
    Ok((dir, server))
}

type TestServerWithDatabase = (TestDir, VrcxMcpServer, Arc<DatabaseService>);

fn test_server_with_game_context(
    name: &str,
    auth_scope_user_id: &str,
    local_game_context: Arc<dyn LocalGameContextSource>,
) -> Result<TestServerWithDatabase, Box<dyn std::error::Error>> {
    let dir = TestDir::new(name);
    let db = Arc::new(DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?);
    ensure_game_log_tables(db.as_ref())?;
    let storage = StorageService::new(&dir.path.join("storage.json"))?;
    let web = Arc::new(WebClient::new(
        vrcx_0_outbound_adapters::LocalWebClientAdapter::new(
            &storage,
            Arc::clone(&db),
            "wss://pipeline.vrchat.cloud".into(),
            env!("CARGO_PKG_VERSION"),
        )?,
    ));
    let auth_scope = RuntimeAuthScope::new();
    if !auth_scope_user_id.trim().is_empty() {
        auth_scope.set(auth_scope_user_id, "https://api.vrchat.cloud/api/1");
    }
    let event_bus = RuntimeEventBus::new();
    let sync = RuntimeSyncEngine::new();
    let diagnostics = RuntimeDiagnostics::new();
    let tasks = TaskSupervisor::new();
    let session = HostSessionRuntime::new();
    let world_cache = Arc::new(WorldCache::new(
        vrcx_0_outbound_adapters::LocalWorldCacheAdapter::new(
            Arc::clone(&db),
            512,
            Duration::from_secs(30 * 60),
        ),
    ));
    let remote_mutations = Arc::new(vrcx_0_application_core::RemoteMutationGate::default());
    let favorite_mutations = FavoriteMutationCoordinator::new(
        Arc::new(vrcx_0_outbound_adapters::LocalFavoriteStore::new(
            Arc::clone(&db),
        )),
        Arc::new(vrcx_0_outbound_adapters::VrchatFavoriteRemote::new(
            Arc::clone(&web),
            diagnostics.clone(),
            sync.clone(),
            Arc::clone(&world_cache),
        )),
        FavoriteMutationRuntimeDeps::new(
            diagnostics,
            sync.clone(),
            event_bus.clone(),
            auth_scope.clone(),
            Arc::clone(&remote_mutations),
            Arc::clone(&world_cache),
        ),
    );
    let backend_status = vrcx_0_application_core::BackendRuntimeStatusPublisher::new(
        vrcx_0_application_core::BackendRuntime::new(
            vrcx_0_application_core::RuntimeHostProfile::Desktop,
        ),
        event_bus.clone(),
    );
    let realtime_store: Arc<dyn vrcx_0_application_realtime::RealtimeStore> = Arc::new(
        vrcx_0_outbound_adapters::PersistenceRealtimeStore::new(Arc::clone(&db)),
    );
    let realtime_transport: Arc<dyn vrcx_0_application_realtime::RealtimeTransport> =
        Arc::new(vrcx_0_outbound_adapters::VrchatRealtimeTransport::new(
            Arc::clone(&realtime_store),
            Arc::clone(&web),
            backend_status.clone(),
        ));
    let realtime_runtime = Arc::new(RealtimeHostRuntime::new(RealtimeHostRuntimeDeps::new(
        realtime_store,
        realtime_transport,
        Arc::new(vrcx_0_outbound_adapters::VrchatRealtimeRemoteRequests),
        Arc::clone(&web),
        event_bus.clone(),
        backend_status,
        vrcx_0_application_realtime::FriendProjectionSink::new(event_bus.clone(), None),
        sync,
        tasks.clone(),
        session,
        auth_scope.clone(),
        remote_mutations,
        local_game_context,
        None,
        None,
        world_cache,
        vrcx_0_application_core::FileCache::new(
            vrcx_0_application_core::MemoryFileCachePort::default(),
        ),
        Arc::new(vrcx_0_application_core::InstanceDwellRegistry::new()),
        Arc::new(NoopPrintCleanupInputSink),
        None,
    )));
    let runtime = crate::runtime::McpRuntime {
        realtime_runtime,
        auth_scope: auth_scope.clone(),
        config: Arc::new(crate::test_support::TestMcpConfigAdapter::new(
            ConfigRepository::new(Arc::clone(&db)),
        )),
        activity_queries: Arc::new(crate::test_support::TestMcpActivityQueryAdapter::new(
            Arc::clone(&db),
        )),
        social_history_queries: Arc::new(
            crate::test_support::TestMcpSocialHistoryQueryAdapter::new(Arc::clone(&db)),
        ),
        friend_local_data: Arc::new(crate::test_support::TestMcpFriendLocalDataAdapter::new(
            Arc::clone(&db),
        )),
        favorites_queries: Arc::new(crate::test_support::TestMcpFavoritesQueryAdapter::new(
            Arc::clone(&db),
        )),
        feed_queries: Arc::new(crate::test_support::TestMcpFeedQueryAdapter::new(
            Arc::clone(&db),
        )),
        mutual_graph: Arc::new(crate::test_support::TestMcpMutualGraphAdapter::new(
            MutualGraphFetchRuntime::new(),
            Arc::clone(&db),
            Arc::clone(&web),
            auth_scope.clone(),
            tasks.clone(),
        )),
        favorite_mutations,
        tasks,
        caller: crate::runtime::McpCaller::ExternalServer,
    };
    Ok((dir, VrcxMcpServer::new(runtime), db))
}

fn ms(value: &str) -> i64 {
    DateTime::parse_from_rfc3339(value)
        .unwrap()
        .timestamp_millis()
}

#[test]
fn timeline_output_echoes_bucket_and_keeps_histogram_rows() {
    let rows = activity_buckets::activity_timeline(
        &[(ms("2025-01-01T18:00:00Z"), ms("2025-01-01T20:00:00Z"))],
        ActivityTimeBucket::HourOfDay,
        540,
        None,
        None,
    );

    let output = activity_timeline_output(ActivityTimelineBucketParam::HourOfDay, 540, rows);

    assert_eq!(output.bucket, "hourOfDay");
    assert_eq!(output.rows.len(), 24);
    assert!(output.rows.iter().any(|row| row.minutes == 60));
    assert!(!output.summary.is_empty());
    assert!(output
        .caveats
        .iter()
        .any(|caveat| caveat.contains("UTC+09:00")));
}

#[test]
fn streaks_output_includes_summary_and_dates() {
    let streaks = activity_buckets::activity_streaks(
        &[(ms("2025-01-01T01:00:00Z"), ms("2025-01-01T02:00:00Z"))],
        ms("2025-01-04T01:00:00Z"),
        0,
    );

    let output = activity_streaks_output(0, streaks);

    assert_eq!(output.current_break_days, 3);
    assert_eq!(
        output.first_session_at.as_deref(),
        Some("2025-01-01T01:00:00Z")
    );
    assert!(!output.summary.is_empty());
    assert!(output.caveats.iter().any(|caveat| caveat.contains("UTC")));
}

#[tokio::test]
async fn copresence_summary_requires_auth_scope_owner() {
    let (_dir, server) =
        test_server("copresence-empty-owner", "").expect("test server should build");

    let error = server
        .get_copresence_summary(Parameters(CopresenceSummaryParams {
            time_window: TimeWindowParams::default(),
            group_by: CopresenceGroupByParam::Friend,
            min_minutes: None,
            limit: Some(5),
            friends_only: None,
        }))
        .await
        .expect_err("empty auth_scope owner must reject the tool call");

    assert!(
        error.contains("current user unknown"),
        "unexpected error: {error}"
    );
}

#[test]
fn timeline_bucket_accepts_camel_and_snake_case() {
    let camel: ActivityTimelineParams =
        serde_json::from_value(serde_json::json!({ "bucket": "dayOfWeek" })).unwrap();
    let snake: ActivityTimelineParams =
        serde_json::from_value(serde_json::json!({ "bucket": "hour_of_day" })).unwrap();

    assert_eq!(camel.bucket, ActivityTimelineBucketParam::DayOfWeek);
    assert_eq!(snake.bucket, ActivityTimelineBucketParam::HourOfDay);
}

fn world_visit(minute: usize, world_id: &str, created_on: &str, time: i64) -> GameLogLocationEntry {
    GameLogLocationEntry {
        created_at: format!("{created_on}T{:02}:{:02}:00.000Z", minute / 60, minute % 60),
        location: format!("{world_id}:1"),
        world_id: world_id.into(),
        world_name: world_id.into(),
        time,
        group_name: String::new(),
    }
}

fn seed_locations(db: &DatabaseService, locations: Vec<GameLogLocationEntry>) {
    write_batch(
        db,
        &OwnerId::new("usr_owner"),
        &GameLogWriteBatch {
            locations,
            ..GameLogWriteBatch::default()
        },
    )
    .unwrap();
}

#[test]
fn social_period_top_worlds_count_every_visit_in_the_window() {
    let (_dir, runtime, db) =
        crate::test_support::test_runtime_with_database("social-period-top-worlds", "usr_owner")
            .unwrap();
    let mut locations = (0..150)
        .map(|minute| world_visit(minute, "wrld_often", "2026-06-01", 60_000))
        .collect::<Vec<_>>();
    locations
        .extend((150..250).map(|minute| world_visit(minute, "wrld_recent", "2026-06-01", 60_000)));
    seed_locations(db.as_ref(), locations);
    let server = VrcxMcpServer::new(runtime);

    let output = server
        .summarize_social_period_output(
            OwnerId::new("usr_owner"),
            SummarizeSocialPeriodParams::default(),
        )
        .unwrap();

    assert_eq!(output.top_worlds[0].world_id, "wrld_often");
    assert_eq!(output.top_worlds[0].visits, 150);
}

#[test]
fn my_activity_buckets_weekdays_in_the_callers_timezone() {
    let (_dir, runtime, db) =
        crate::test_support::test_runtime_with_database("my-activity-local-weekday", "usr_owner")
            .unwrap();
    write_batch(
        db.as_ref(),
        &OwnerId::new("usr_owner"),
        &GameLogWriteBatch {
            join_leave: vec![closed_stay("2026-06-07T21:00:00.000Z", 60)],
            ..GameLogWriteBatch::default()
        },
    )
    .unwrap();
    let server = VrcxMcpServer::new(runtime);

    let output = server
        .get_my_activity_output(
            OwnerId::new("usr_owner"),
            MyActivityParams {
                time_window: None,
                utc_offset_minutes: Some(540),
            },
        )
        .unwrap();

    assert_eq!(output.by_weekday.get("Mon"), Some(&60));
    assert_eq!(output.by_weekday.get("Sun"), None);
    assert!(output
        .caveats
        .iter()
        .any(|caveat| caveat.contains("UTC+09:00")));
}

#[test]
fn my_activity_reads_a_calendar_day_window_in_the_callers_timezone() {
    let (_dir, runtime, db) =
        crate::test_support::test_runtime_with_database("my-activity-local-day", "usr_owner")
            .unwrap();
    write_batch(
        db.as_ref(),
        &OwnerId::new("usr_owner"),
        &GameLogWriteBatch {
            join_leave: vec![closed_stay("2026-06-07T21:00:00.000Z", 60)],
            ..GameLogWriteBatch::default()
        },
    )
    .unwrap();
    let server = VrcxMcpServer::new(runtime);

    let output = server
        .get_my_activity_output(
            OwnerId::new("usr_owner"),
            MyActivityParams {
                time_window: Some(serde_json::from_value(serde_json::json!("2026-06-08")).unwrap()),
                utc_offset_minutes: Some(540),
            },
        )
        .unwrap();

    assert_eq!(output.total_minutes, 60);
}

#[test]
fn my_activity_tolerates_an_out_of_range_utc_offset() {
    let (_dir, runtime, _db) =
        crate::test_support::test_runtime_with_database("my-activity-huge-offset", "usr_owner")
            .unwrap();
    let server = VrcxMcpServer::new(runtime);

    assert!(server
        .get_my_activity_output(
            OwnerId::new("usr_owner"),
            MyActivityParams {
                time_window: None,
                utc_offset_minutes: Some(i64::MAX),
            },
        )
        .is_ok());
}

#[test]
fn social_period_states_the_best_time_bucket_timezone() {
    let (_dir, runtime, _db) = crate::test_support::test_runtime_with_database(
        "social-period-best-time-timezone",
        "usr_owner",
    )
    .unwrap();
    let server = VrcxMcpServer::new(runtime);

    let output = server
        .summarize_social_period_output(
            OwnerId::new("usr_owner"),
            SummarizeSocialPeriodParams {
                time_window: None,
                utc_offset_minutes: Some(540),
            },
        )
        .unwrap();

    assert!(output
        .caveats
        .iter()
        .any(|caveat| caveat.contains("Best-time buckets are in UTC+09:00")));
}

fn closed_stay(left_at: &str, minutes: i64) -> GameLogJoinLeaveEntry {
    GameLogJoinLeaveEntry {
        created_at: left_at.into(),
        event_type: "OnPlayerLeft".into(),
        display_name: "Owner".into(),
        user_id: "usr_owner".into(),
        location: "wrld_stay:1".into(),
        world_name: "Stay".into(),
        time: minutes * 60_000,
    }
}

#[test]
fn my_activity_counts_only_closed_instance_stays() {
    let (_dir, runtime, db) =
        crate::test_support::test_runtime_with_database("my-activity-closed-stays", "usr_owner")
            .unwrap();
    write_batch(
        db.as_ref(),
        &OwnerId::new("usr_owner"),
        &GameLogWriteBatch {
            locations: vec![
                world_visit(0, "wrld_open", "2026-06-07", 0),
                world_visit(20 * 60, "wrld_stay", "2026-06-07", 0),
            ],
            join_leave: vec![closed_stay("2026-06-07T21:00:00.000Z", 60)],
            ..GameLogWriteBatch::default()
        },
    )
    .unwrap();
    let server = VrcxMcpServer::new(runtime);

    let output = server
        .get_my_activity_output(
            OwnerId::new("usr_owner"),
            MyActivityParams {
                time_window: None,
                utc_offset_minutes: Some(540),
            },
        )
        .unwrap();

    assert_eq!(output.total_minutes, 60);
    assert_eq!(output.session_count, 1);
    assert_eq!(output.by_weekday.get("Mon"), Some(&60));
}

struct FixedLocalGameContext(LocalGameContextSnapshot);

impl LocalGameContextSource for FixedLocalGameContext {
    fn snapshot(&self) -> LocalGameContextSnapshot {
        self.0.clone()
    }
}

#[test]
fn my_activity_counts_the_current_stay_while_the_game_is_running() {
    let (_dir, server, db) = test_server_with_game_context(
        "my-activity-open-stay",
        "usr_owner",
        Arc::new(FixedLocalGameContext(LocalGameContextSnapshot::Available {
            is_game_running: true,
            location: "wrld_open:1".into(),
            destination: String::new(),
            world_name: "Open".into(),
            player_user_ids: Vec::new(),
        })),
    )
    .unwrap();
    let started_at = Utc::now() - chrono::Duration::minutes(90);
    write_batch(
        db.as_ref(),
        &OwnerId::new("usr_owner"),
        &GameLogWriteBatch {
            locations: vec![GameLogLocationEntry {
                created_at: vrcx_0_core::time::iso_millis(started_at),
                location: "wrld_open:1".into(),
                world_id: "wrld_open".into(),
                world_name: "Open".into(),
                time: 0,
                group_name: String::new(),
            }],
            ..GameLogWriteBatch::default()
        },
    )
    .unwrap();

    let output = server
        .get_my_activity_output(
            OwnerId::new("usr_owner"),
            MyActivityParams {
                time_window: None,
                utc_offset_minutes: None,
            },
        )
        .unwrap();

    assert!(
        (89..=91).contains(&output.total_minutes),
        "{}",
        output.total_minutes
    );
    assert_eq!(output.session_count, 1);
}

#[test]
fn back_to_back_instance_stays_count_as_one_play_session() {
    let (_dir, runtime, db) =
        crate::test_support::test_runtime_with_database("my-activity-merged-stays", "usr_owner")
            .unwrap();
    write_batch(
        db.as_ref(),
        &OwnerId::new("usr_owner"),
        &GameLogWriteBatch {
            join_leave: vec![
                closed_stay("2026-06-07T21:30:00.000Z", 30),
                closed_stay("2026-06-07T22:00:20.000Z", 30),
            ],
            ..GameLogWriteBatch::default()
        },
    )
    .unwrap();
    let server = VrcxMcpServer::new(runtime);

    let output = server
        .get_my_activity_output(
            OwnerId::new("usr_owner"),
            MyActivityParams {
                time_window: None,
                utc_offset_minutes: None,
            },
        )
        .unwrap();

    assert_eq!(output.total_minutes, 60);
    assert_eq!(output.session_count, 1);
    assert_eq!(output.longest_session_minutes, 60);
}
