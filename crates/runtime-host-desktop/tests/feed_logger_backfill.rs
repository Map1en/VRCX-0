use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use chrono::{DateTime, SecondsFormat, TimeDelta, TimeZone, Utc};
use serde_json::{json, Value};
use vrcx_0_application_core::{
    FileCache, MemoryFileCachePort, MemoryWorldCachePort, NoopWebClientPort, Result, WebClient,
    WebClientPort, WorldCache, WorldCachePort,
};
use vrcx_0_application_realtime::{
    replay_logger_frames, ReplayOutcome, ReplayResolvers, PENDING_OFFLINE_DELAY_MS,
};
use vrcx_0_contracts::external_api::{
    ExternalApiExecuteResponse, ExternalApiScope, ExternalHttpRequestInput,
    ExternalWebExecuteRequest,
};
use vrcx_0_contracts::feed::{FeedQueryMode, FeedRowOutput, FeedRowsQueryInput};
use vrcx_0_contracts::feed_live::FeedLiveEntry;
use vrcx_0_contracts::profile_bio::ProfileBioRecord;
use vrcx_0_contracts::{
    FileMetadataOutput, RealtimeAuthTokenFetch, RealtimeConnectionOptions, VrchatRequest,
    VrchatResponse, VrchatScope, WebExecuteRequest, WorldSummaryOutput,
};
use vrcx_0_core::OwnerId;
use vrcx_0_logger_protocol::wire::{FrameKind, SnapshotPayload, WireFrame};
use vrcx_0_outbound_adapters::LocalWorldCacheAdapter;
use vrcx_0_persistence::feed::feed_rows_query;
use vrcx_0_persistence::profile_bio::{profile_bio_get, profile_bio_upsert};
use vrcx_0_persistence::realtime::{
    insert_backfilled_feed, write_realtime_batch, BackfillWrites, RealtimePersistenceBatch,
};
use vrcx_0_persistence::DatabaseService;

const SELF: &str = "usr_self";
const ENDPOINT: &str = "https://api.vrchat.cloud/api/1";
const BASE_SECS: i64 = 1_791_500_000;
const OFFLINE_CONFIRMATION_DELAY_SECS: i64 = PENDING_OFFLINE_DELAY_MS / 1000;

fn time(seconds: i64) -> DateTime<Utc> {
    Utc.timestamp_opt(BASE_SECS + seconds, 0).unwrap()
}

fn at(seconds: i64) -> String {
    time(seconds).to_rfc3339()
}

fn at_nanos(seconds: i64) -> String {
    time(seconds).to_rfc3339_opts(SecondsFormat::Nanos, false)
}

fn at_millis(seconds: i64) -> String {
    time(seconds).to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn frame(seq: i64, kind: FrameKind, seconds: i64, payload: Value) -> WireFrame {
    WireFrame {
        seq,
        kind,
        received_at: at(seconds),
        account_id: SELF.into(),
        payload: payload.to_string(),
    }
}

fn connect(seq: i64, seconds: i64) -> WireFrame {
    frame(seq, FrameKind::Connect, seconds, json!({}))
}

fn icon_url(file_id: &str) -> String {
    format!("{ENDPOINT}/image/{file_id}/1/256")
}

fn friend_snapshot(seq: i64, after_seq: i64, seconds: i64) -> WireFrame {
    friend_snapshot_at(seq, after_seq, seconds, "wrld_x:1")
}

fn friend_snapshot_at(seq: i64, after_seq: i64, seconds: i64, location: &str) -> WireFrame {
    frame(
        seq,
        FrameKind::Snapshot,
        seconds,
        serde_json::to_value(SnapshotPayload {
            after_seq: Some(after_seq),
            current_user: json!({
                "id": SELF,
                "friends": ["usr_a", "usr_b"],
                "onlineFriends": ["usr_a"],
                "offlineFriends": ["usr_b"],
            }),
            online_friends: vec![json!({
                "id": "usr_a",
                "displayName": "A",
                "location": location,
                "status": "active",
                "iconUrl": icon_url("file_old"),
            })],
            offline_friends: vec![
                json!({ "id": "usr_b", "displayName": "B", "location": "offline" }),
            ],
        })
        .unwrap(),
    )
}

fn message(seq: i64, seconds: i64, kind: &str, content: Value) -> WireFrame {
    frame(
        seq,
        FrameKind::Message,
        seconds,
        json!({ "type": kind, "content": content }),
    )
}

fn still_recording(seq: i64, seconds: i64) -> WireFrame {
    message(seq, seconds, "notification", json!({}))
}

fn friend_moved(seq: i64, seconds: i64, location: &str) -> WireFrame {
    message(
        seq,
        seconds,
        "friend-location",
        json!({
            "userId": "usr_a",
            "location": location,
            "user": { "id": "usr_a", "displayName": "A", "location": location }
        }),
    )
}

fn friend_traveling(seq: i64, seconds: i64, destination: &str) -> WireFrame {
    message(
        seq,
        seconds,
        "friend-location",
        json!({
            "userId": "usr_a",
            "location": "traveling",
            "travelingToLocation": destination,
            "user": { "id": "usr_a", "displayName": "A", "location": "traveling" }
        }),
    )
}

fn friend_came_online(seq: i64, seconds: i64, location: &str) -> WireFrame {
    message(
        seq,
        seconds,
        "friend-online",
        json!({
            "userId": "usr_b",
            "location": location,
            "user": { "id": "usr_b", "displayName": "B", "location": location }
        }),
    )
}

fn friend_went_offline(seq: i64, seconds: i64) -> WireFrame {
    message(seq, seconds, "friend-offline", json!({ "userId": "usr_a" }))
}

fn friend_changed_status(seq: i64, seconds: i64, status: &str, description: &str) -> WireFrame {
    message(
        seq,
        seconds,
        "friend-update",
        json!({
            "userId": "usr_a",
            "user": {
                "id": "usr_a",
                "displayName": "A",
                "status": status,
                "statusDescription": description,
            }
        }),
    )
}

fn friend_changed_avatar(seq: i64, seconds: i64, file_id: &str) -> WireFrame {
    message(
        seq,
        seconds,
        "friend-update",
        json!({
            "userId": "usr_a",
            "user": { "id": "usr_a", "displayName": "A", "iconUrl": icon_url(file_id) }
        }),
    )
}

fn profile_seen(seq: i64, seconds: i64, profile: Value) -> WireFrame {
    frame(seq, FrameKind::Profile, seconds, profile)
}

fn avatar_image(file_id: &str, avatar_name: &str) -> FileMetadataOutput {
    FileMetadataOutput::new(
        file_id.into(),
        format!("Avatar - {avatar_name} - Image - 2022.3.22f1_1_standalonewindows_Release"),
        "usr_author".into(),
    )
}

fn live_location(seconds: i64, location: &str) -> FeedLiveEntry {
    FeedLiveEntry::Gps {
        created_at: at(seconds),
        user_id: "usr_a".into(),
        display_name: "A".into(),
        location: location.into(),
        world_name: String::new(),
        previous_location: "wrld_x:1".into(),
        time: 0,
        group_name: String::new(),
        world_id: None,
        display_location: None,
        owner_user_id: String::new(),
    }
}

fn live_online(seconds: i64, location: &str) -> FeedLiveEntry {
    FeedLiveEntry::Online {
        created_at: at(seconds),
        user_id: "usr_b".into(),
        display_name: "B".into(),
        location: location.into(),
        world_name: String::new(),
        group_name: String::new(),
        time: None,
        world_id: None,
        display_location: None,
        owner_user_id: String::new(),
    }
}

fn live_avatar(seconds: i64, file_id: &str) -> FeedLiveEntry {
    FeedLiveEntry::Avatar {
        created_at: at(seconds),
        user_id: "usr_a".into(),
        display_name: "A".into(),
        owner_id: "usr_author".into(),
        previous_owner_id: String::new(),
        avatar_name: "New Look".into(),
        previous_avatar_name: String::new(),
        current_avatar_image_url: icon_url(file_id),
        previous_current_avatar_image_url: String::new(),
        owner_user_id: String::new(),
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

struct Desktop {
    db: DatabaseService,
    world_cache: WorldCache,
    file_cache: FileCache,
    web: WebClient,
    _dir: TestDir,
}

struct Synced {
    outcome: ReplayOutcome,
    inserted: u64,
}

impl Desktop {
    fn new(name: &str) -> Self {
        Self::with_caches(
            name,
            MemoryWorldCachePort::default(),
            MemoryFileCachePort::default(),
        )
    }

    fn with_caches(
        name: &str,
        worlds: impl WorldCachePort + 'static,
        files: MemoryFileCachePort,
    ) -> Self {
        let dir = TestDir::new(name);
        Self {
            db: DatabaseService::new(&dir.path.join("VRCX-0.sqlite3")).unwrap(),
            world_cache: WorldCache::new(worlds),
            file_cache: FileCache::new(files),
            web: WebClient::new(NoopWebClientPort),
            _dir: dir,
        }
    }

    fn with_world_api(name: &str, api: impl WebClientPort + 'static) -> Self {
        let dir = TestDir::new(name);
        let database = dir.path.join("VRCX-0.sqlite3");
        let world_cache_db = Arc::new(DatabaseService::new(&database).unwrap());
        Self {
            db: DatabaseService::new(&database).unwrap(),
            world_cache: WorldCache::new(LocalWorldCacheAdapter::new(
                world_cache_db,
                64,
                Duration::from_secs(600),
            )),
            file_cache: FileCache::new(MemoryFileCachePort::default()),
            web: WebClient::new(api),
            _dir: dir,
        }
    }

    async fn sync(&self, frames: &[WireFrame]) -> Synced {
        self.sync_with_clock_offset(frames, 0).await
    }

    async fn sync_with_clock_offset(&self, frames: &[WireFrame], clock_offset_ms: i64) -> Synced {
        let outcome = replay_logger_frames(
            frames,
            SELF,
            clock_offset_ms,
            &mut ReplayResolvers::new(&self.world_cache, &self.file_cache, &self.web, ENDPOINT),
        )
        .await;
        let inserted = insert_backfilled_feed(
            &self.db,
            &OwnerId::new(SELF),
            &outcome.entries,
            &outcome.profile_bios,
            &mut BackfillWrites::default(),
        )
        .unwrap();
        Synced { outcome, inserted }
    }

    fn record_live(&self, feed_entries: Vec<FeedLiveEntry>) {
        write_realtime_batch(
            &self.db,
            &OwnerId::new(SELF),
            &RealtimePersistenceBatch {
                feed_entries,
                ..RealtimePersistenceBatch::default()
            },
        )
        .unwrap();
    }

    fn feed(&self) -> Vec<FeedRowOutput> {
        let mut rows = feed_rows_query(
            &self.db,
            FeedRowsQueryInput {
                user_id: SELF.into(),
                mode: FeedQueryMode::Lookup,
                search: String::new(),
                filters: Vec::new(),
                vip_list: Vec::new(),
                scoped_user_ids: Vec::new(),
                excluded_user_ids: Vec::new(),
                location_hidden_user_ids: Vec::new(),
                max_entries: 100,
                date_from: String::new(),
                date_to: String::new(),
                cursor: None,
            },
        )
        .unwrap();
        rows.sort_by_key(|row| {
            DateTime::parse_from_rfc3339(row.created_at.as_deref().unwrap_or_default()).unwrap()
        });
        rows
    }

    fn timeline(&self) -> Vec<(String, String, String)> {
        self.feed()
            .into_iter()
            .map(|row| {
                (
                    row.r#type.unwrap_or_default(),
                    row.user_id.unwrap_or_default(),
                    row.created_at.unwrap_or_default(),
                )
            })
            .collect()
    }

    fn store_bio(&self, user_id: &str, bio: &str, checked_at_seconds: i64) {
        profile_bio_upsert(
            &self.db,
            &OwnerId::new(SELF),
            user_id,
            &ProfileBioRecord {
                bio: bio.into(),
                checked_at: at_millis(checked_at_seconds),
            },
        )
        .unwrap();
    }

    fn stored_bio(&self, user_id: &str) -> Option<String> {
        profile_bio_get(&self.db, &OwnerId::new(SELF), user_id)
            .unwrap()
            .map(|record| record.bio)
    }
}

fn entry(kind: &str, user_id: &str, created_at: String) -> (String, String, String) {
    (kind.into(), user_id.into(), created_at)
}

#[derive(Default)]
struct WorldsOnlyKnownToVrchat {
    vrchat: MemoryWorldCachePort,
    local: MemoryWorldCachePort,
}

#[async_trait]
impl WorldCachePort for WorldsOnlyKnownToVrchat {
    fn clear_working(&self) {}
    fn get_name(&self, world_id: &str) -> Option<String> {
        self.local.get_name(world_id)
    }
    fn get_summary(&self, world_id: &str) -> Result<Option<WorldSummaryOutput>> {
        self.local.get_summary(world_id)
    }
    fn get_cached_card_payload(&self, world_id: &str) -> Option<Value> {
        self.local.get_cached_card_payload(world_id)
    }
    fn search_summaries(&self, query: &str, limit: i64) -> Result<Vec<WorldSummaryOutput>> {
        self.local.search_summaries(query, limit)
    }
    fn hydrate_from_payload(&self, world_value: &Value) -> Option<String> {
        self.local.hydrate_from_payload(world_value)
    }
    fn hydrate_summary_from_payload(&self, world_value: &Value) -> Option<WorldSummaryOutput> {
        self.local.hydrate_summary_from_payload(world_value)
    }
    fn store_from_payload(&self, world_value: &Value) -> Result<Option<String>> {
        self.local.store_from_payload(world_value)
    }
    fn hydrate_favorite_payloads(&self, world_values: &[Value]) -> Vec<Option<Value>> {
        self.local.hydrate_favorite_payloads(world_values)
    }
    async fn resolve_name(
        &self,
        _web: &WebClient,
        _endpoint: &str,
        world_id: &str,
    ) -> Option<String> {
        if let Some(world) = self.vrchat.get_cached_card_payload(world_id) {
            self.local.insert(world);
        }
        self.local.get_name(world_id)
    }
    async fn resolve_summary(
        &self,
        web: &WebClient,
        endpoint: &str,
        world_id: &str,
    ) -> Option<WorldSummaryOutput> {
        self.local.resolve_summary(web, endpoint, world_id).await
    }
    async fn resolve_image_url(
        &self,
        web: &WebClient,
        endpoint: &str,
        world_id: &str,
    ) -> Option<String> {
        self.local.resolve_image_url(web, endpoint, world_id).await
    }
    async fn get(
        &self,
        web: &WebClient,
        endpoint: &str,
        world_id: &str,
        force: bool,
        full: bool,
    ) -> Result<VrchatResponse> {
        self.local.get(web, endpoint, world_id, force, full).await
    }
    fn hydrate_response(&self, response: &VrchatResponse) {
        self.local.hydrate_response(response);
    }
}

struct BusyThenWorldApi {
    busy_requests: AtomicUsize,
    world: Value,
    noop: NoopWebClientPort,
}

#[async_trait]
impl WebClientPort for BusyThenWorldApi {
    fn save_cookies(&self) {}
    fn proxy_url(&self) -> Option<String> {
        None
    }
    async fn fetch_image(&self, url: &str) -> Result<Vec<u8>> {
        self.noop.fetch_image(url).await
    }
    fn realtime_connection_options(&self) -> RealtimeConnectionOptions {
        self.noop.realtime_connection_options()
    }
    fn clear_cookies(&self) {}
    fn clear_cookies_everywhere(&self) {}
    fn clear_auth_cookies(&self) {}
    fn cookie_diagnostics(&self) -> Value {
        Value::Null
    }
    fn auth_cookie_value(&self) -> Option<String> {
        None
    }
    fn get_cookies(&self) -> String {
        String::new()
    }
    fn set_cookies(&self, b64: &str) -> Result<()> {
        self.noop.set_cookies(b64)
    }
    async fn execute(&self, request: WebExecuteRequest) -> Result<(i32, String)> {
        self.noop.execute(request).await
    }
    async fn execute_external(&self, request: ExternalWebExecuteRequest) -> Result<(i32, String)> {
        self.noop.execute_external(request).await
    }
    async fn execute_api(
        &self,
        _input: VrchatRequest,
        _scope: VrchatScope,
    ) -> Result<VrchatResponse> {
        let busy = self
            .busy_requests
            .try_update(Ordering::SeqCst, Ordering::SeqCst, |left| {
                left.checked_sub(1)
            })
            .is_ok();
        Ok(if busy {
            VrchatResponse {
                status: 429,
                data: json!({ "error": { "message": "Too many requests" } }).to_string(),
            }
        } else {
            VrchatResponse {
                status: 200,
                data: self.world.to_string(),
            }
        })
    }
    fn vrchat_config_snapshot(&self, endpoint: &str) -> Option<VrchatResponse> {
        self.noop.vrchat_config_snapshot(endpoint)
    }
    fn clear_vrchat_config_snapshot(&self) {}
    async fn fetch_realtime_auth_token(&self, endpoint: &str) -> Result<RealtimeAuthTokenFetch> {
        self.noop.fetch_realtime_auth_token(endpoint).await
    }
    async fn execute_external_api(
        &self,
        input: ExternalHttpRequestInput,
        scope: ExternalApiScope,
    ) -> Result<ExternalApiExecuteResponse> {
        self.noop.execute_external_api(input, scope).await
    }
    async fn execute_external_api_limited(
        &self,
        input: ExternalHttpRequestInput,
        scope: ExternalApiScope,
        max_response_bytes: usize,
    ) -> Result<ExternalApiExecuteResponse> {
        self.noop
            .execute_external_api_limited(input, scope, max_response_bytes)
            .await
    }
}

#[tokio::test]
async fn a_friends_location_change_while_closed_appears_in_the_feed_with_its_original_time() {
    let desktop = Desktop::new("backfill-location");

    desktop
        .sync(&[
            connect(1, 0),
            friend_snapshot(2, 1, 0),
            friend_moved(3, 30, "wrld_y:2"),
        ])
        .await;

    let feed = desktop.feed();
    assert_eq!(desktop.timeline(), vec![entry("GPS", "usr_a", at(30))]);
    assert_eq!(feed[0].location.as_deref(), Some("wrld_y:2"));
    assert_eq!(feed[0].previous_location.as_deref(), Some("wrld_x:1"));
}

#[tokio::test]
async fn times_from_a_recorder_whose_clock_runs_ahead_are_moved_onto_the_desktop_clock() {
    let desktop = Desktop::new("backfill-clock-offset");
    let sub_millisecond = TimeDelta::nanoseconds(123_456_789);
    let mut moved = friend_moved(2, 30, "wrld_y:2");
    moved.received_at = (time(30) + sub_millisecond).to_rfc3339();

    desktop
        .sync_with_clock_offset(&[friend_snapshot(1, 0, 0), moved], 5_000)
        .await;

    let feed = desktop.feed();
    assert_eq!(feed.len(), 1);
    assert_eq!(
        feed[0].created_at.as_deref(),
        Some((time(25) + sub_millisecond).to_rfc3339().as_str())
    );
}

#[tokio::test]
async fn a_friend_who_went_offline_appears_offline_when_the_offline_confirmation_would_have_fired()
{
    let desktop = Desktop::new("backfill-offline");

    desktop
        .sync(&[
            friend_snapshot(1, 0, 0),
            friend_went_offline(2, 60),
            still_recording(3, 600),
        ])
        .await;

    let feed = desktop.feed();
    assert_eq!(feed.len(), 1);
    assert_eq!(feed[0].r#type.as_deref(), Some("Offline"));
    let shown_at =
        DateTime::parse_from_rfc3339(feed[0].created_at.as_deref().unwrap_or_default()).unwrap();
    assert_eq!(shown_at, time(60 + OFFLINE_CONFIRMATION_DELAY_SECS));
}

#[tokio::test]
async fn an_offline_confirmation_due_after_the_last_recorded_activity_is_not_written() {
    let desktop = Desktop::new("backfill-offline-pending");

    desktop
        .sync(&[
            friend_snapshot(1, 0, 0),
            friend_went_offline(2, 60),
            still_recording(3, 120),
        ])
        .await;

    assert!(desktop.feed().is_empty());
}

#[tokio::test]
async fn messages_received_while_the_friend_snapshot_was_loading_still_apply_after_it() {
    let desktop = Desktop::new("backfill-snapshot-loading");

    let synced = desktop
        .sync(&[
            connect(1, 0),
            friend_moved(2, 1, "wrld_y:2"),
            friend_snapshot(3, 1, 0),
        ])
        .await;

    assert_eq!(desktop.timeline(), vec![entry("GPS", "usr_a", at(1))]);
    assert_eq!(synced.outcome.frames_without_baseline, 0);
}

#[tokio::test]
async fn records_whose_recording_never_got_a_friend_list_are_skipped_and_counted() {
    let desktop = Desktop::new("backfill-no-baseline");

    let synced = desktop
        .sync(&[
            friend_snapshot(1, 0, 0),
            connect(2, 300),
            friend_moved(3, 310, "wrld_y:2"),
            friend_moved(4, 320, "wrld_z:3"),
        ])
        .await;

    assert!(desktop.feed().is_empty());
    assert_eq!(synced.outcome.frames_without_baseline, 2);
}

#[tokio::test]
async fn records_from_the_moment_before_the_friend_list_loaded_are_dropped_without_a_warning() {
    let desktop = Desktop::new("backfill-handoff");

    let synced = desktop
        .sync(&[
            connect(1, 0),
            friend_moved(2, 1, "wrld_y:2"),
            friend_snapshot(3, 2, 2),
        ])
        .await;

    assert!(desktop.feed().is_empty());
    assert_eq!(synced.outcome.frames_without_baseline, 0);
}

#[tokio::test]
async fn frames_recorded_for_another_account_are_ignored() {
    let desktop = Desktop::new("backfill-other-account");
    let mut other_account = friend_moved(2, 30, "wrld_y:2");
    other_account.account_id = "usr_other".into();

    desktop
        .sync(&[friend_snapshot(1, 0, 0), other_account])
        .await;

    assert!(desktop.feed().is_empty());
}

#[tokio::test]
async fn world_names_missing_from_the_local_cache_are_fetched_so_the_feed_shows_the_world_name() {
    let worlds = WorldsOnlyKnownToVrchat::default();
    worlds
        .vrchat
        .insert(json!({ "id": "wrld_y", "name": "Y World" }));
    let desktop = Desktop::with_caches(
        "backfill-world-name",
        worlds,
        MemoryFileCachePort::default(),
    );

    desktop
        .sync(&[friend_snapshot(1, 0, 0), friend_moved(2, 30, "wrld_y:2")])
        .await;

    let feed = desktop.feed();
    assert_eq!(feed.len(), 1);
    assert_eq!(feed[0].world_name.as_deref(), Some("Y World"));
}

#[tokio::test]
async fn a_world_name_vrchat_was_too_busy_to_return_is_looked_up_again_before_writing() {
    let desktop = Desktop::with_world_api(
        "backfill-world-name-retry",
        BusyThenWorldApi {
            busy_requests: AtomicUsize::new(1),
            world: json!({ "id": "wrld_y", "name": "Y World", "authorId": "usr_author" }),
            noop: NoopWebClientPort,
        },
    );

    desktop
        .sync(&[friend_snapshot(1, 0, 0), friend_moved(2, 30, "wrld_y:2")])
        .await;

    let feed = desktop.feed();
    assert_eq!(feed.len(), 1);
    assert_eq!(feed[0].world_name.as_deref(), Some("Y World"));
}

#[tokio::test]
async fn a_world_that_cannot_be_resolved_keeps_its_world_id_like_the_live_feed() {
    let desktop = Desktop::new("backfill-world-unresolved");

    desktop
        .sync(&[friend_snapshot(1, 0, 0), friend_moved(2, 30, "wrld_y:2")])
        .await;

    let feed = desktop.feed();
    assert_eq!(feed.len(), 1);
    assert_eq!(feed[0].world_name.as_deref(), Some("wrld_y"));
}

#[tokio::test]
async fn timer_confirmed_entries_use_nanosecond_timestamps_like_live_rows() {
    let desktop = Desktop::new("backfill-timer-precision");

    desktop
        .sync(&[
            friend_snapshot(1, 0, 0),
            friend_went_offline(2, 60),
            still_recording(3, 600),
        ])
        .await;

    assert_eq!(
        desktop.timeline(),
        vec![entry(
            "Offline",
            "usr_a",
            at_nanos(60 + OFFLINE_CONFIRMATION_DELAY_SECS)
        )]
    );
}

#[tokio::test]
async fn a_friends_avatar_change_appears_in_the_feed_with_its_original_time_and_avatar_name() {
    let files = MemoryFileCachePort::default();
    files.insert(avatar_image("file_old", "Old Look"));
    files.insert(avatar_image("file_new", "New Look"));
    let desktop = Desktop::with_caches("backfill-avatar", MemoryWorldCachePort::default(), files);

    desktop
        .sync(&[
            friend_snapshot(1, 0, 0),
            friend_changed_avatar(2, 30, "file_new"),
        ])
        .await;

    let feed = desktop.feed();
    assert_eq!(desktop.timeline(), vec![entry("Avatar", "usr_a", at(30))]);
    assert_eq!(feed[0].avatar_name.as_deref(), Some("New Look"));
    assert_eq!(
        feed[0].current_avatar_image_url.as_deref(),
        Some(icon_url("file_new").as_str())
    );
    assert_eq!(
        feed[0].previous_current_avatar_image_url.as_deref(),
        Some(icon_url("file_old").as_str())
    );
}

#[tokio::test]
async fn an_avatar_whose_name_cannot_be_resolved_is_not_backfilled() {
    let files = MemoryFileCachePort::default();
    files.insert(avatar_image("file_old", "Old Look"));
    let desktop = Desktop::with_caches(
        "backfill-avatar-private",
        MemoryWorldCachePort::default(),
        files,
    );

    desktop
        .sync(&[
            friend_snapshot(1, 0, 0),
            friend_changed_avatar(2, 30, "file_private"),
        ])
        .await;

    assert!(desktop.feed().is_empty());
}

#[tokio::test]
async fn a_friends_first_recorded_bio_only_becomes_the_baseline_without_a_feed_entry() {
    let desktop = Desktop::new("backfill-bio-first");

    desktop
        .sync(&[profile_seen(
            1,
            30,
            json!({ "id": "usr_a", "displayName": "A", "bio": "first" }),
        )])
        .await;

    assert!(desktop.feed().is_empty());
    assert_eq!(desktop.stored_bio("usr_a").as_deref(), Some("first"));
}

#[tokio::test]
async fn a_friends_bio_change_while_closed_appears_in_the_feed_with_the_time_the_recorder_saw_it() {
    let desktop = Desktop::new("backfill-bio-change");
    desktop.store_bio("usr_a", "old", 0);

    desktop
        .sync(&[profile_seen(
            1,
            30,
            json!({ "id": "usr_a", "displayName": "A", "bio": " new " }),
        )])
        .await;

    let feed = desktop.feed();
    assert_eq!(
        desktop.timeline(),
        vec![entry("Bio", "usr_a", at_millis(30))]
    );
    assert_eq!(feed[0].bio.as_deref(), Some("new"));
    assert_eq!(feed[0].previous_bio.as_deref(), Some("old"));
    assert_eq!(desktop.stored_bio("usr_a").as_deref(), Some("new"));
}

#[tokio::test]
async fn an_older_bio_observation_does_not_roll_back_a_newer_desktop_check() {
    let desktop = Desktop::new("backfill-bio-stale");
    desktop.store_bio("usr_a", "desktop", 500);

    desktop
        .sync(&[profile_seen(
            1,
            30,
            json!({ "id": "usr_a", "displayName": "A", "bio": "stale" }),
        )])
        .await;

    assert!(desktop.feed().is_empty());
    assert_eq!(desktop.stored_bio("usr_a").as_deref(), Some("desktop"));
}

#[tokio::test]
async fn a_recorded_profile_without_a_bio_leaves_the_stored_bio_untouched() {
    let desktop = Desktop::new("backfill-bio-missing");
    desktop.store_bio("usr_a", "keep", 0);

    desktop
        .sync(&[profile_seen(
            1,
            30,
            json!({ "id": "usr_a", "displayName": "A" }),
        )])
        .await;

    assert!(desktop.feed().is_empty());
    assert_eq!(desktop.stored_bio("usr_a").as_deref(), Some("keep"));
}

#[tokio::test]
async fn rows_the_desktop_already_recorded_within_two_minutes_are_not_duplicated() {
    let desktop = Desktop::new("backfill-overlap");
    desktop.record_live(vec![
        live_location(60, "wrld_y:2"),
        live_online(90, "wrld_z:3"),
        live_location(1000, "wrld_w:4"),
    ]);

    let synced = desktop
        .sync(&[
            friend_snapshot(1, 0, 0),
            friend_moved(2, 30, "wrld_y:2"),
            friend_came_online(3, 40, "wrld_z:3"),
            friend_moved(4, 400, "wrld_w:4"),
        ])
        .await;

    assert_eq!(synced.inserted, 1);
    assert_eq!(
        desktop.timeline(),
        vec![
            entry("GPS", "usr_a", at(60)),
            entry("Online", "usr_b", at(90)),
            entry("GPS", "usr_a", at(400)),
            entry("GPS", "usr_a", at(1000)),
        ]
    );
}

#[tokio::test]
async fn an_avatar_change_the_desktop_already_recorded_is_not_duplicated() {
    let files = MemoryFileCachePort::default();
    files.insert(avatar_image("file_old", "Old Look"));
    files.insert(avatar_image("file_new", "New Look"));
    let desktop = Desktop::with_caches(
        "backfill-avatar-overlap",
        MemoryWorldCachePort::default(),
        files,
    );
    desktop.record_live(vec![live_avatar(70, "file_new")]);

    let synced = desktop
        .sync(&[
            friend_snapshot(1, 0, 0),
            friend_changed_avatar(2, 30, "file_new"),
        ])
        .await;

    assert_eq!(synced.inserted, 0);
    assert_eq!(desktop.timeline(), vec![entry("Avatar", "usr_a", at(70))]);
}

#[tokio::test]
async fn a_sync_can_be_retried_without_duplicating_rows() {
    let desktop = Desktop::new("backfill-retry");
    let frames = [
        friend_snapshot(1, 0, 0),
        friend_moved(2, 30, "wrld_y:2"),
        friend_went_offline(3, 60),
        still_recording(4, 600),
    ];

    let first = desktop.sync(&frames).await;
    let retried = desktop.sync(&frames).await;

    assert_eq!(first.inserted, 2);
    assert_eq!(retried.inserted, 0);
    assert_eq!(desktop.feed().len(), 2);
}

#[tokio::test]
async fn only_online_offline_location_status_avatar_and_bio_entries_are_backfilled() {
    let desktop = Desktop::new("backfill-entry-kinds");

    let synced = desktop
        .sync(&[
            friend_snapshot(1, 0, 0),
            friend_traveling(2, 20, "wrld_y:2"),
            friend_moved(3, 30, "wrld_y:2"),
            friend_came_online(4, 40, "wrld_z:3"),
            friend_changed_status(5, 50, "busy", "afk"),
        ])
        .await;

    assert_eq!(synced.inserted, 3);
    assert_eq!(
        desktop.timeline(),
        vec![
            entry("GPS", "usr_a", at(30)),
            entry("Online", "usr_b", at(40)),
            entry("Status", "usr_a", at(50)),
        ]
    );
}

#[tokio::test]
async fn every_recording_starts_from_its_own_friend_list_without_guessing_what_changed_before_it() {
    let desktop = Desktop::new("backfill-fresh-friend-list");

    desktop
        .sync(&[
            friend_snapshot(1, 0, 0),
            connect(2, 600),
            friend_snapshot_at(3, 2, 600, "wrld_y:2"),
            friend_moved(4, 630, "wrld_z:3"),
        ])
        .await;

    let feed = desktop.feed();
    assert_eq!(desktop.timeline(), vec![entry("GPS", "usr_a", at(630))]);
    assert_eq!(feed[0].previous_location.as_deref(), Some("wrld_y:2"));
}

#[tokio::test]
async fn a_pending_offline_confirmation_is_dropped_when_the_recording_was_interrupted() {
    let desktop = Desktop::new("backfill-interrupted-timer");

    desktop
        .sync(&[
            friend_snapshot(1, 0, 0),
            friend_went_offline(2, 60),
            connect(3, 100),
            still_recording(4, 600),
        ])
        .await;

    assert!(desktop.feed().is_empty());
}

#[tokio::test]
async fn a_friend_moving_back_and_forth_while_closed_keeps_every_move() {
    let desktop = Desktop::new("backfill-back-and-forth");

    let synced = desktop
        .sync(&[
            friend_snapshot(1, 0, 0),
            friend_moved(2, 30, "wrld_y:2"),
            friend_moved(3, 40, "wrld_x:1"),
            friend_moved(4, 50, "wrld_y:2"),
        ])
        .await;

    assert_eq!(synced.inserted, 3);
    assert_eq!(
        desktop.timeline(),
        vec![
            entry("GPS", "usr_a", at(30)),
            entry("GPS", "usr_a", at(40)),
            entry("GPS", "usr_a", at(50)),
        ]
    );
}
