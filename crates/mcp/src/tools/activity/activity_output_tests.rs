use super::*;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use rmcp::handler::server::wrapper::Parameters;
use vrcx_0_application::favorites::{FavoriteMutationCoordinator, FavoriteMutationRuntimeDeps};
use vrcx_0_application::social::MutualGraphFetchRuntime;
use vrcx_0_application_core::{
    HostSessionRuntime, NoopPrintCleanupInputSink, RuntimeAuthScope, RuntimeDiagnostics,
    RuntimeEventBus, RuntimeSyncEngine, TaskSupervisor, UnavailableLocalGameContextSource,
    WebClient, WorldCache,
};
use vrcx_0_application_realtime::{RealtimeHostRuntime, RealtimeHostRuntimeDeps};
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
        )),
        FavoriteMutationRuntimeDeps::new(
            diagnostics,
            sync.clone(),
            event_bus.clone(),
            auth_scope.clone(),
            Arc::clone(&remote_mutations),
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
        Arc::new(UnavailableLocalGameContextSource),
        None,
        None,
        world_cache,
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
    Ok((dir, VrcxMcpServer::new(runtime)))
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
