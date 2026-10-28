use std::future::Future;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use chrono::{DateTime, Utc};
use futures_util::StreamExt;
use serde_json::Value;
use tokio::sync::watch;
use tokio::task::JoinHandle;
use tokio::time::Instant;
use vrcx_0_contracts::profile_bio::{
    PROFILE_BIO_SCAN_INTERVAL, PROFILE_BIO_SCAN_MIN_AGE, PROFILE_BIO_SCAN_PAUSE,
};
use vrcx_0_contracts::vrchat_api::{classify_vrchat_response, VrchatResponseClass};
use vrcx_0_logger_protocol::wire::{FrameKind, SessionState, SnapshotPayload};
use vrcx_0_vrchat_client::realtime::{
    classify_websocket_frame, heartbeat, Error as RealtimeError, RealtimeFrame,
    RealtimeWebSocketStream, HEARTBEAT_INTERVAL,
};

use crate::credentials::CredentialVault;
use crate::profile_scan::ProfileScan;
use crate::runtime::{lock, Presence, Shared};
use crate::store::Store;
use crate::vrchat::Vrchat;
use crate::webhook::Notifier;

const RECONNECT_BASE_DELAY: Duration = Duration::from_secs(2);
const RECONNECT_MAX_DELAY: Duration = Duration::from_secs(60);
const STABLE_CONNECTION: Duration = Duration::from_secs(60);
const PRESENCE_CHECK_INTERVAL: Duration = Duration::from_secs(2);
const SEGMENT_MAX_AGE: Duration = Duration::from_secs(6 * 60 * 60);
const SNAPSHOT_RETRY_DELAYS: [Duration; 3] = [
    Duration::from_secs(10),
    Duration::from_secs(30),
    Duration::from_secs(60),
];

#[derive(Debug)]
pub enum RecorderExit {
    AuthFailed(String),
    Stopped,
}

enum ConnectionEnd {
    Stopped,
    Disconnected(String),
}

#[derive(Default)]
pub struct Segments {
    current: Option<OpenSegment>,
    opened: u64,
}

#[derive(Clone, Copy)]
struct OpenSegment {
    id: u64,
    opened_at: Instant,
    snapshot_seq: Option<i64>,
}

#[derive(Default)]
struct SnapshotLoop(Option<JoinHandle<()>>);

impl SnapshotLoop {
    fn start(&mut self, attempts: impl Future<Output = ()> + Send + 'static) {
        if self.0.as_ref().is_some_and(|task| !task.is_finished()) {
            return;
        }
        self.0 = Some(tokio::spawn(attempts));
    }
}

impl Drop for SnapshotLoop {
    fn drop(&mut self) {
        if let Some(task) = self.0.take() {
            task.abort();
        }
    }
}

#[derive(Clone)]
pub struct Recorder {
    pub client: Arc<Vrchat>,
    pub account_id: String,
    pub store: Arc<Store>,
    pub presence: Arc<Presence>,
    pub shared: Arc<Shared>,
    pub credentials: Arc<CredentialVault>,
    pub profile_scan: Arc<ProfileScan>,
    pub notifier: Arc<Notifier>,
    pub segments: Arc<Mutex<Segments>>,
}

impl Recorder {
    pub async fn run(self, stop: watch::Receiver<bool>) -> RecorderExit {
        let profile_scan = tokio::spawn(self.clone().scan_profiles(stop.clone()));
        let exit = self.record_until_stopped(stop).await;
        profile_scan.abort();
        exit
    }

    async fn record_until_stopped(&self, mut stop: watch::Receiver<bool>) -> RecorderExit {
        let mut delay = RECONNECT_BASE_DELAY;
        loop {
            if *stop.borrow() {
                return RecorderExit::Stopped;
            }
            match self.client.connect_realtime().await {
                Err(RealtimeError::AuthFailure { reason, .. }) => {
                    return RecorderExit::AuthFailed(reason);
                }
                Err(RealtimeError::Other(reason)) => {
                    tracing::warn!(reason, "websocket connect failed");
                }
                Ok(stream) => {
                    if *stop.borrow() {
                        return RecorderExit::Stopped;
                    }
                    let started = Instant::now();
                    let end = self.record(stream, &mut stop).await;
                    self.shared.update(|info| {
                        info.connected_since = None;
                        if matches!(end, ConnectionEnd::Disconnected(_)) {
                            info.state = SessionState::Reconnecting;
                        }
                    });
                    match end {
                        ConnectionEnd::Stopped => return RecorderExit::Stopped,
                        ConnectionEnd::Disconnected(reason) => {
                            tracing::warn!(reason, "websocket disconnected");
                        }
                    }
                    if started.elapsed() >= STABLE_CONNECTION {
                        delay = RECONNECT_BASE_DELAY;
                    }
                }
            }

            tokio::select! {
                () = tokio::time::sleep(delay) => {}
                changed = stop.changed() => {
                    if changed.is_err() || *stop.borrow() {
                        return RecorderExit::Stopped;
                    }
                }
            }
            delay = (delay * 2).min(RECONNECT_MAX_DELAY);
        }
    }

    async fn record(
        &self,
        mut stream: RealtimeWebSocketStream,
        stop: &mut watch::Receiver<bool>,
    ) -> ConnectionEnd {
        let connected_at = Utc::now();
        self.shared.update(|info| {
            info.connected_since = Some(connected_at.timestamp());
            info.state = SessionState::Recording;
        });
        if let Err(error) = self.credentials.update_cookies(self.client.cookies()) {
            tracing::warn!(error = %error, "failed to persist VRChat cookies");
        }
        lock(&self.segments).current = None;
        let mut snapshots = SnapshotLoop::default();
        tracing::info!("websocket connected");

        let mut presence_check = tokio::time::interval(PRESENCE_CHECK_INTERVAL);
        let mut last_inbound_at = Instant::now();
        let mut pinged_at: Option<Instant> = None;
        loop {
            if last_inbound_at.elapsed() >= HEARTBEAT_INTERVAL
                && pinged_at.is_none_or(|at| at.elapsed() >= HEARTBEAT_INTERVAL)
            {
                if let Err(reason) = heartbeat(&mut stream, last_inbound_at).await {
                    return ConnectionEnd::Disconnected(reason);
                }
                pinged_at = Some(Instant::now());
            }
            tokio::select! {
                changed = stop.changed() => {
                    if changed.is_err() || *stop.borrow() {
                        return ConnectionEnd::Stopped;
                    }
                }
                _ = presence_check.tick() => {
                    if self.segment_needs_snapshot() {
                        self.start_snapshot(&mut snapshots, stop);
                    }
                }
                frame = tokio::time::timeout(HEARTBEAT_INTERVAL, stream.next()) => {
                    let frame = match frame {
                        Err(_) => continue,
                        Ok(None) => {
                            return ConnectionEnd::Disconnected("websocket stream ended".into());
                        }
                        Ok(Some(Err(error))) => {
                            return ConnectionEnd::Disconnected(format!("websocket read: {error}"));
                        }
                        Ok(Some(Ok(frame))) => frame,
                    };
                    last_inbound_at = Instant::now();
                    match classify_websocket_frame(frame) {
                        RealtimeFrame::Text(text) => self.write(FrameKind::Message, Utc::now(), &text),
                        RealtimeFrame::Close(reason) => {
                            return ConnectionEnd::Disconnected(format!("websocket closed: {reason}"));
                        }
                        RealtimeFrame::Other => {}
                    }
                }
            }
        }
    }

    fn desktop_present(&self) -> bool {
        self.presence.is_present(&self.account_id)
    }

    fn segments_while_away(&self) -> Option<MutexGuard<'_, Segments>> {
        let desktop_present = self.desktop_present();
        let mut segments = lock(&self.segments);
        if desktop_present {
            segments.current = None;
            return None;
        }
        Some(segments)
    }

    fn segment_needs_snapshot(&self) -> bool {
        let Some(mut segments) = self.segments_while_away() else {
            return false;
        };
        match segments.current {
            None
            | Some(OpenSegment {
                snapshot_seq: None, ..
            }) => true,
            Some(OpenSegment {
                snapshot_seq: Some(seq),
                opened_at,
                ..
            }) => {
                let snapshot_kept = self.store.frame_exists(seq).unwrap_or(true);
                if snapshot_kept && opened_at.elapsed() < SEGMENT_MAX_AGE {
                    return false;
                }
                segments.current = None;
                true
            }
        }
    }

    fn begin_segment(&self) -> Option<u64> {
        let mut segments = self.segments_while_away()?;
        if let Some(open) = segments.current {
            return Some(open.id);
        }
        self.insert(FrameKind::Connect, Utc::now(), "{}")?;
        segments.opened += 1;
        let id = segments.opened;
        segments.current = Some(OpenSegment {
            id,
            opened_at: Instant::now(),
            snapshot_seq: None,
        });
        Some(id)
    }

    fn write(&self, kind: FrameKind, received_at: DateTime<Utc>, payload: &str) {
        if self.begin_segment().is_some() {
            self.insert(kind, received_at, payload);
        }
    }

    fn insert(&self, kind: FrameKind, received_at: DateTime<Utc>, payload: &str) -> Option<i64> {
        match self
            .store
            .insert_frame(kind, received_at, &self.account_id, payload)
        {
            Ok(seq) => {
                if self
                    .shared
                    .update(|info| info.storage_error.take())
                    .is_some()
                {
                    self.notifier.recovered();
                }
                Some(seq)
            }
            Err(error) => {
                tracing::error!(error = %error, "failed to store a frame");
                let reason = error.to_string();
                let first = self
                    .shared
                    .update(|info| info.storage_error.replace(reason.clone()).is_none());
                if first {
                    self.notifier.storage_failed(&reason);
                }
                None
            }
        }
    }

    fn start_snapshot(&self, snapshots: &mut SnapshotLoop, stop: &watch::Receiver<bool>) {
        let recorder = self.clone();
        let stop = stop.clone();
        snapshots.start(async move {
            recorder
                .snapshot_until_taken(stop, || recorder.client.snapshot())
                .await;
        });
    }

    async fn snapshot_until_taken<F, Fut>(&self, mut stop: watch::Receiver<bool>, mut fetch: F)
    where
        F: FnMut() -> Fut,
        Fut: Future<Output = Result<SnapshotPayload, String>>,
    {
        let mut retry_delays = SNAPSHOT_RETRY_DELAYS.into_iter().chain(std::iter::repeat(
            SNAPSHOT_RETRY_DELAYS[SNAPSHOT_RETRY_DELAYS.len() - 1],
        ));
        loop {
            if *stop.borrow() || self.desktop_present() {
                return;
            }
            match self.take_snapshot(&stop, &mut fetch).await {
                Ok(()) => return,
                Err(error) => tracing::warn!(error, "friend snapshot failed"),
            }
            let delay = retry_delays.next().unwrap_or_default();
            tokio::select! {
                () = tokio::time::sleep(delay) => {}
                changed = stop.changed() => {
                    if changed.is_err() || *stop.borrow() {
                        return;
                    }
                }
            }
        }
    }

    async fn take_snapshot<F, Fut>(
        &self,
        stop: &watch::Receiver<bool>,
        fetch: &mut F,
    ) -> Result<(), String>
    where
        F: FnMut() -> Fut,
        Fut: Future<Output = Result<SnapshotPayload, String>>,
    {
        let Some(segment_id) = self.begin_segment() else {
            return Ok(());
        };
        let started_at = Utc::now();
        let after_seq = self.store.last_seq().map_err(|error| error.to_string())?;
        let mut snapshot = fetch().await?;
        if *stop.borrow() {
            return Ok(());
        }
        self.profile_scan
            .set_friends(snapshot_friend_ids(&snapshot));
        snapshot.after_seq = Some(after_seq);
        let payload = serde_json::to_string(&snapshot).map_err(|error| error.to_string())?;
        self.record_snapshot(segment_id, started_at, &payload)?;
        self.shared
            .update(|info| info.last_snapshot_at = Some(Utc::now().timestamp()));
        Ok(())
    }

    fn record_snapshot(
        &self,
        segment_id: u64,
        started_at: DateTime<Utc>,
        payload: &str,
    ) -> Result<(), String> {
        let mut segments = self.segments_while_away();
        let Some(open) = segments
            .as_mut()
            .and_then(|segments| segments.current.as_mut())
            .filter(|open| open.id == segment_id)
        else {
            return Err("the recording restarted while the friend list was loading".into());
        };
        let seq = self
            .insert(FrameKind::Snapshot, started_at, payload)
            .ok_or_else(|| String::from("the friend list could not be saved"))?;
        open.snapshot_seq = Some(seq);
        Ok(())
    }

    async fn scan_profiles(self, mut stop: watch::Receiver<bool>) {
        let mut delay = PROFILE_BIO_SCAN_INTERVAL;
        loop {
            tokio::select! {
                () = tokio::time::sleep(delay) => {}
                changed = stop.changed() => {
                    if changed.is_err() || *stop.borrow() {
                        return;
                    }
                }
            }
            delay = self.scan_next_profile().await;
        }
    }

    async fn scan_next_profile(&self) -> Duration {
        if !self.profile_scan.is_enabled() || self.desktop_present() {
            return PROFILE_BIO_SCAN_INTERVAL;
        }
        let now = Utc::now();
        let min_age = i64::try_from(PROFILE_BIO_SCAN_MIN_AGE.as_secs()).unwrap_or(i64::MAX);
        let Some(user_id) = self.profile_scan.next_stale(now.timestamp() - min_age) else {
            return PROFILE_BIO_SCAN_PAUSE;
        };
        let response = self.client.profile(&user_id).await;
        match classify_vrchat_response(response.status).class {
            VrchatResponseClass::Ok => self.write(FrameKind::Profile, now, &response.data),
            VrchatResponseClass::ClientError => {}
            _ => return PROFILE_BIO_SCAN_PAUSE,
        }
        self.profile_scan.mark_checked(&user_id, now.timestamp());
        PROFILE_BIO_SCAN_INTERVAL
    }
}

fn snapshot_friend_ids(snapshot: &SnapshotPayload) -> Vec<String> {
    snapshot
        .online_friends
        .iter()
        .chain(&snapshot.offline_friends)
        .filter_map(|friend| friend.get("id").and_then(Value::as_str))
        .filter(|user_id| user_id.starts_with("usr_"))
        .map(ToOwned::to_owned)
        .collect()
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;
    use crate::app::{now_unix, App};
    use vrcx_0_logger_protocol::wire::WebhookFormat;

    use crate::test_support::{
        fresh_app, messages, presence, sign_in, webhook_receiver, Desktop, ACCOUNT,
    };

    fn recorder(app: &Arc<App>) -> Recorder {
        Recorder {
            client: Arc::new(Vrchat::new(None).unwrap()),
            account_id: ACCOUNT.into(),
            store: app.store.clone(),
            presence: app.presence.clone(),
            shared: app.shared.clone(),
            credentials: Arc::new(CredentialVault::new(app.store.clone())),
            profile_scan: app.profile_scan.clone(),
            notifier: app.notifier.clone(),
            segments: Arc::new(Mutex::new(Segments::default())),
        }
    }

    fn receive(recorder: &Recorder, payload: &str) {
        recorder.write(FrameKind::Message, Utc::now(), payload);
    }

    fn friend_list() -> Result<SnapshotPayload, String> {
        Ok(SnapshotPayload::default())
    }

    #[tokio::test]
    async fn nothing_is_recorded_while_the_desktop_of_the_same_account_is_online() {
        let app = fresh_app();
        sign_in(&app, ACCOUNT);
        let desktop = Desktop::new(&app);
        desktop
            .report_presence(presence(ACCOUNT, false, false))
            .await;

        receive(&recorder(&app), "while online");

        assert!(desktop.pull_all().await.is_empty());
        assert_eq!(desktop.status().await.unsynced_frames, 0);
    }

    #[tokio::test]
    async fn a_record_that_cannot_be_saved_is_reported_once_until_saving_works_again() {
        let (base, mut inbox) = webhook_receiver().await;
        let app = fresh_app();
        let recorder = recorder(&app);
        let desktop = Desktop::new(&app);
        desktop
            .save_webhook(&format!("{base}/hook"), WebhookFormat::Text)
            .await;

        app.store.refuse_writes_for_test(true);
        receive(&recorder, "lost");
        receive(&recorder, "also lost");
        assert!(desktop.status().await.storage_error.is_some());
        let alert = tokio::time::timeout(Duration::from_secs(5), inbox.recv()).await;
        let alert = alert.unwrap().unwrap();
        assert!(alert.starts_with("VRCX-0 logger [storage]"));
        assert!(alert.contains("Details: database: disk is full"));

        app.store.refuse_writes_for_test(false);
        receive(&recorder, "saved");

        assert_eq!(desktop.status().await.storage_error, None);
        let recovered = tokio::time::timeout(Duration::from_secs(5), inbox.recv()).await;
        assert!(recovered
            .unwrap()
            .unwrap()
            .starts_with("VRCX-0 logger [recovered]"));
        let frames = desktop.pull_all().await;
        assert_eq!(kinds(&frames), [FrameKind::Connect, FrameKind::Message]);
        assert_eq!(messages(&frames), ["saved"]);
    }

    #[tokio::test]
    async fn recording_resumes_as_soon_as_the_desktop_says_it_is_leaving() {
        let app = fresh_app();
        let desktop = Desktop::new(&app);
        desktop
            .report_presence(presence(ACCOUNT, false, false))
            .await;
        desktop
            .report_presence(presence(ACCOUNT, true, false))
            .await;

        receive(&recorder(&app), "after leaving");

        let frames = desktop.pull_all().await;
        assert_eq!(messages(&frames), ["after leaving"]);
        assert!(frames.iter().all(|frame| frame.account_id == ACCOUNT));
    }

    #[tokio::test]
    async fn a_desktop_signed_in_to_another_account_does_not_pause_recording() {
        let app = fresh_app();
        let desktop = Desktop::new(&app);
        desktop
            .report_presence(presence("usr_other", false, false))
            .await;

        receive(&recorder(&app), "still away");

        assert_eq!(messages(&desktop.pull_all().await), ["still away"]);
    }

    #[tokio::test]
    async fn another_account_leaving_does_not_resume_recording() {
        let app = fresh_app();
        let desktop = Desktop::new(&app);
        desktop
            .report_presence(presence(ACCOUNT, false, false))
            .await;
        desktop
            .report_presence(presence("usr_other", true, false))
            .await;

        receive(&recorder(&app), "while online");

        assert!(desktop.pull_all().await.is_empty());
    }

    async fn friend_still_due_after_one_bio_check_turn(app: &Arc<App>) -> bool {
        app.profile_scan.set_friends(vec!["usr_friend".into()]);

        let wait = recorder(app).scan_next_profile().await;

        assert_eq!(wait, PROFILE_BIO_SCAN_INTERVAL);
        app.profile_scan.next_stale(now_unix()).as_deref() == Some("usr_friend")
    }

    #[tokio::test]
    async fn bio_checks_stay_idle_until_the_desktop_enables_them() {
        let app = fresh_app();
        let desktop = Desktop::new(&app);
        desktop
            .report_presence(presence(ACCOUNT, true, false))
            .await;

        assert!(friend_still_due_after_one_bio_check_turn(&app).await);
        assert!(desktop.pull_all().await.is_empty());
    }

    #[tokio::test]
    async fn bio_checks_wait_while_the_desktop_is_online() {
        let app = fresh_app();
        let desktop = Desktop::new(&app);
        desktop
            .report_presence(presence(ACCOUNT, false, true))
            .await;

        assert!(friend_still_due_after_one_bio_check_turn(&app).await);
        assert!(desktop.pull_all().await.is_empty());
    }
    fn kinds(frames: &[vrcx_0_logger_protocol::wire::WireFrame]) -> Vec<FrameKind> {
        frames.iter().map(|frame| frame.kind).collect()
    }

    fn failing_snapshots(
        recorder: &Recorder,
        attempts: Arc<AtomicUsize>,
    ) -> impl Future<Output = ()> + Send + 'static {
        let recorder = recorder.clone();
        let (stop_sender, stop) = watch::channel(false);
        async move {
            let _stop_sender = stop_sender;
            recorder
                .snapshot_until_taken(stop, || {
                    attempts.fetch_add(1, Ordering::SeqCst);
                    async { Err(String::from("VRChat is down")) }
                })
                .await;
        }
    }

    #[tokio::test]
    async fn every_recording_starts_with_a_segment_marker() {
        let app = fresh_app();
        let recorder = recorder(&app);

        receive(&recorder, "first");
        receive(&recorder, "second");

        let frames = Desktop::new(&app).pull_all().await;
        assert_eq!(
            kinds(&frames),
            [FrameKind::Connect, FrameKind::Message, FrameKind::Message]
        );
    }

    #[tokio::test]
    async fn records_after_the_desktop_leaves_again_start_a_new_segment() {
        let app = fresh_app();
        let recorder = recorder(&app);
        let desktop = Desktop::new(&app);
        receive(&recorder, "first time away");

        desktop
            .report_presence(presence(ACCOUNT, false, false))
            .await;
        receive(&recorder, "while online");
        desktop
            .report_presence(presence(ACCOUNT, true, false))
            .await;
        receive(&recorder, "away again");

        let frames = desktop.pull_all().await;
        assert_eq!(
            kinds(&frames),
            [
                FrameKind::Connect,
                FrameKind::Message,
                FrameKind::Connect,
                FrameKind::Message
            ]
        );
        assert_eq!(messages(&frames), ["first time away", "away again"]);
    }

    #[tokio::test]
    async fn a_new_segment_needs_a_friend_snapshot_until_one_is_saved() {
        let app = fresh_app();
        let recorder = recorder(&app);
        let (_stop_sender, stop) = watch::channel(false);

        assert!(recorder.segment_needs_snapshot());
        recorder
            .snapshot_until_taken(stop, || async { friend_list() })
            .await;

        assert!(!recorder.segment_needs_snapshot());
    }

    #[tokio::test]
    async fn a_snapshot_after_the_desktop_leaves_starts_after_the_new_segment() {
        let app = fresh_app();
        let recorder = recorder(&app);
        let desktop = Desktop::new(&app);
        let (_stop_sender, stop) = watch::channel(false);
        desktop
            .report_presence(presence(ACCOUNT, false, false))
            .await;
        receive(&recorder, "while online");
        desktop
            .report_presence(presence(ACCOUNT, true, false))
            .await;

        recorder
            .snapshot_until_taken(stop, || async { friend_list() })
            .await;

        let frames = desktop.pull_all().await;
        assert_eq!(kinds(&frames), [FrameKind::Connect, FrameKind::Snapshot]);
        let snapshot: Value = serde_json::from_str(&frames[1].payload).unwrap();
        assert_eq!(snapshot["afterSeq"], frames[0].seq);
    }

    #[tokio::test]
    async fn a_recording_whose_friend_snapshot_was_deleted_starts_a_new_segment() {
        let app = fresh_app();
        let recorder = recorder(&app);
        let desktop = Desktop::new(&app);
        let (_stop_sender, stop) = watch::channel(false);
        recorder
            .snapshot_until_taken(stop, || async { friend_list() })
            .await;
        let snapshot_seq = app.store.last_seq().unwrap();

        app.store.ack(ACCOUNT, snapshot_seq).unwrap();
        assert!(recorder.segment_needs_snapshot());
        receive(&recorder, "after");

        let frames = desktop.pull_all().await;
        assert_eq!(kinds(&frames), [FrameKind::Connect, FrameKind::Message]);
    }

    #[tokio::test(start_paused = true)]
    async fn a_long_recording_is_split_into_segments_of_at_most_six_hours() {
        let app = fresh_app();
        let recorder = recorder(&app);
        let desktop = Desktop::new(&app);
        let (_stop_sender, stop) = watch::channel(false);
        recorder
            .snapshot_until_taken(stop, || async { friend_list() })
            .await;

        tokio::time::advance(SEGMENT_MAX_AGE - Duration::from_secs(1)).await;
        assert!(!recorder.segment_needs_snapshot());
        tokio::time::advance(Duration::from_secs(1)).await;
        assert!(recorder.segment_needs_snapshot());
        receive(&recorder, "next segment");

        let frames = desktop.pull_all().await;
        assert_eq!(
            kinds(&frames),
            [
                FrameKind::Connect,
                FrameKind::Snapshot,
                FrameKind::Connect,
                FrameKind::Message
            ]
        );
    }

    #[tokio::test]
    async fn an_older_segments_snapshot_expiring_leaves_the_current_segment_alone() {
        let app = fresh_app();
        let recorder = recorder(&app);
        let desktop = Desktop::new(&app);
        let (_stop_sender, stop) = watch::channel(false);
        recorder
            .snapshot_until_taken(stop.clone(), || async { friend_list() })
            .await;
        let old_snapshot = app.store.last_seq().unwrap();
        desktop
            .report_presence(presence(ACCOUNT, false, false))
            .await;
        assert!(!recorder.segment_needs_snapshot());
        desktop
            .report_presence(presence(ACCOUNT, true, false))
            .await;
        recorder
            .snapshot_until_taken(stop, || async { friend_list() })
            .await;

        app.store.ack(ACCOUNT, old_snapshot).unwrap();

        assert!(!recorder.segment_needs_snapshot());
    }

    #[tokio::test]
    async fn a_friend_list_loaded_across_a_desktop_visit_is_not_saved() {
        let app = fresh_app();
        let recorder = recorder(&app);
        let desktop = Desktop::new(&app);
        let (_stop_sender, stop) = watch::channel(false);

        let result = recorder
            .take_snapshot(&stop, &mut || async {
                desktop
                    .report_presence(presence(ACCOUNT, false, false))
                    .await;
                receive(&recorder, "while online");
                desktop
                    .report_presence(presence(ACCOUNT, true, false))
                    .await;
                friend_list()
            })
            .await;

        assert!(result.is_err());
        assert_eq!(kinds(&desktop.pull_all().await), [FrameKind::Connect]);
    }

    #[tokio::test(start_paused = true)]
    async fn a_failed_snapshot_is_retried_after_10_then_30_then_every_60_seconds() {
        let app = fresh_app();
        let recorder = recorder(&app);
        let (_stop_sender, stop) = watch::channel(false);
        let mut attempts = Vec::new();

        let still_retrying = tokio::time::timeout(
            Duration::from_secs(165),
            recorder.snapshot_until_taken(stop, || {
                attempts.push(Instant::now());
                async { Err(String::from("VRChat is down")) }
            }),
        )
        .await
        .is_err();

        assert!(still_retrying);
        let gaps: Vec<u64> = attempts
            .windows(2)
            .map(|pair| (pair[1] - pair[0]).as_secs())
            .collect();
        assert_eq!(gaps, [10, 30, 60, 60]);
    }

    #[tokio::test(start_paused = true)]
    async fn snapshot_retries_stop_once_the_desktop_returns() {
        let app = fresh_app();
        let recorder = recorder(&app);
        let desktop = Desktop::new(&app);
        let (_stop_sender, stop) = watch::channel(false);
        let attempts = AtomicUsize::new(0);

        let finished = tokio::time::timeout(
            Duration::from_secs(600),
            recorder.snapshot_until_taken(stop, || async {
                attempts.fetch_add(1, Ordering::SeqCst);
                desktop
                    .report_presence(presence(ACCOUNT, false, false))
                    .await;
                Err(String::from("VRChat is down"))
            }),
        )
        .await;

        assert!(finished.is_ok());
        assert_eq!(attempts.load(Ordering::SeqCst), 1);
        assert_eq!(kinds(&desktop.pull_all().await), [FrameKind::Connect]);
    }

    #[tokio::test(start_paused = true)]
    async fn snapshot_retries_stop_when_the_recorder_stops() {
        let app = fresh_app();
        let recorder = recorder(&app);
        let (stop_sender, stop) = watch::channel(false);
        let attempts = AtomicUsize::new(0);

        let finished = tokio::time::timeout(
            Duration::from_secs(600),
            recorder.snapshot_until_taken(stop, || {
                attempts.fetch_add(1, Ordering::SeqCst);
                stop_sender.send_replace(true);
                async { Err(String::from("VRChat is down")) }
            }),
        )
        .await;

        assert!(finished.is_ok());
        assert_eq!(attempts.load(Ordering::SeqCst), 1);
    }

    #[tokio::test(start_paused = true)]
    async fn a_new_departure_does_not_start_a_second_snapshot_while_one_is_retrying() {
        let app = fresh_app();
        let recorder = recorder(&app);
        let first = Arc::new(AtomicUsize::new(0));
        let second = Arc::new(AtomicUsize::new(0));
        let mut snapshots = SnapshotLoop::default();

        snapshots.start(failing_snapshots(&recorder, first.clone()));
        tokio::time::sleep(Duration::from_secs(5)).await;
        snapshots.start(failing_snapshots(&recorder, second.clone()));
        tokio::time::sleep(Duration::from_secs(200)).await;

        assert!(first.load(Ordering::SeqCst) > 1);
        assert_eq!(second.load(Ordering::SeqCst), 0);
    }

    #[tokio::test(start_paused = true)]
    async fn snapshot_retries_end_with_the_connection() {
        let app = fresh_app();
        let recorder = recorder(&app);
        let attempts = Arc::new(AtomicUsize::new(0));
        let mut snapshots = SnapshotLoop::default();
        snapshots.start(failing_snapshots(&recorder, attempts.clone()));
        tokio::time::sleep(Duration::from_secs(5)).await;

        drop(snapshots);
        let attempts_when_closed = attempts.load(Ordering::SeqCst);
        tokio::time::sleep(Duration::from_secs(600)).await;

        assert_eq!(attempts_when_closed, 1);
        assert_eq!(attempts.load(Ordering::SeqCst), 1);
    }
}
