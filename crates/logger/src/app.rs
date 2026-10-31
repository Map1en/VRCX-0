use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use vrcx_0_logger_protocol::envelope::{Nonce, SecretKey, MAX_CLOCK_SKEW_SECS};
use vrcx_0_logger_protocol::wire::{StatusResponse, PROTOCOL_VERSION};

use crate::credentials::CredentialVault;
use crate::profile_scan::ProfileScan;
use crate::runtime::{lock, Presence, Shared};
use crate::session::{self, SessionHandle};
use crate::store::{
    FrameStats, Store, StoreError, DROPPED_AFTER_PASSWORD_CHANGE, DROPPED_UNSYNCED,
};
use crate::webhook::Notifier;

pub const LOGGER_VERSION: &str = env!("CARGO_PKG_VERSION");
const DAY_SECS: i64 = 24 * 60 * 60;
const MAINTENANCE_INTERVAL: Duration = Duration::from_secs(10 * 60);

pub struct App {
    pub transport_key: SecretKey,
    pub store: Arc<Store>,
    pub session: SessionHandle,
    pub presence: Arc<Presence>,
    pub notifier: Arc<Notifier>,
    pub profile_scan: Arc<ProfileScan>,
    pub shared: Arc<Shared>,
    last_pull_at: Mutex<Option<i64>>,
    retention_days: Option<u32>,
    retention_bytes: Option<u64>,
    started_at: i64,
    seen_nonces: Mutex<HashMap<Nonce, i64>>,
}

impl App {
    pub fn new(
        transport_key: SecretKey,
        store: Store,
        retention_days: Option<u32>,
        retention_bytes: Option<u64>,
    ) -> Result<Self, String> {
        let store = Arc::new(store);
        let vault = Arc::new(CredentialVault::new(store.clone()));
        let presence = Arc::new(Presence::default());
        let shared = Arc::new(Shared::default());
        let notifier = Arc::new(Notifier::new(store.clone())?);
        let profile_scan = Arc::new(ProfileScan::new(store.clone()));
        let session = session::spawn(
            store.clone(),
            vault,
            presence.clone(),
            shared.clone(),
            notifier.clone(),
            profile_scan.clone(),
        );
        Ok(Self {
            transport_key,
            store,
            session,
            presence,
            notifier,
            profile_scan,
            shared,
            last_pull_at: Mutex::new(None),
            retention_days,
            retention_bytes,
            started_at: now_unix(),
            seen_nonces: Mutex::new(HashMap::new()),
        })
    }

    pub fn accept_request(&self, nonce: Nonce, timestamp: i64, now: i64) -> bool {
        if timestamp < self.started_at {
            return false;
        }
        let mut seen = lock(&self.seen_nonces);
        seen.retain(|_, expires_at| *expires_at >= now);
        if seen.contains_key(&nonce) {
            return false;
        }
        seen.insert(nonce, now + 2 * MAX_CLOCK_SKEW_SECS);
        true
    }

    pub fn record_pull(&self) {
        *lock(&self.last_pull_at) = Some(now_unix());
        self.notifier.desktop_pulled();
    }

    pub fn spawn_maintenance(self: &Arc<Self>) {
        if self.retention_days.is_none() && self.retention_bytes.is_none() {
            return;
        }
        let app = self.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(MAINTENANCE_INTERVAL);
            loop {
                interval.tick().await;
                let app = app.clone();
                let _ = tokio::task::spawn_blocking(move || app.prune()).await;
            }
        });
    }

    fn prune(&self) {
        let older_than = self
            .retention_days
            .map(|days| now_unix() - i64::from(days) * DAY_SECS);
        match self.store.prune(older_than, self.retention_bytes) {
            Ok(0) => {}
            Ok(dropped) => {
                tracing::warn!(
                    dropped,
                    "deleted unsynced frames to stay within the retention limits"
                );
                self.notifier.unsynced_dropped(dropped);
            }
            Err(error) => tracing::error!(error = %error, "frame retention failed"),
        }
    }

    pub fn status(&self) -> Result<StatusResponse, StoreError> {
        let info = self.shared.snapshot();
        let frames = match info.account_id.as_deref() {
            Some(account_id) => self.store.frame_stats(account_id)?,
            None => FrameStats::default(),
        };
        let webhook = self.notifier.status();
        let last_pull_at = *lock(&self.last_pull_at);
        let desktop_present = info
            .account_id
            .as_deref()
            .is_some_and(|account_id| self.presence.is_present(account_id));
        Ok(StatusResponse {
            logger_version: LOGGER_VERSION.to_string(),
            protocol_version: PROTOCOL_VERSION,
            started_at: self.started_at,
            server_time: now_unix(),
            password_saved: info.password_saved,
            last_login_at: info.last_login_at,
            last_error: info.last_error,
            storage_error: info.storage_error,
            relogin_attempts: info.relogin_attempts,
            connected_since: info.connected_since,
            last_snapshot_at: info.last_snapshot_at,
            unsynced_frames: frames.count,
            oldest_unsynced_at: frames.oldest_at,
            newest_unsynced_at: frames.newest_at,
            last_pull_at,
            desktop_present,
            database_bytes: self.store.database_bytes()?,
            available_bytes: self.store.available_bytes(),
            retention_bytes: self.retention_bytes,
            retention_days: self.retention_days,
            dropped_unsynced_frames: self.store.counter(DROPPED_UNSYNCED)?,
            dropped_after_password_change: self.store.counter(DROPPED_AFTER_PASSWORD_CHANGE)?,
            webhook_configured: webhook.configured,
            webhook_target: webhook.target,
            webhook_format: webhook.format,
            last_webhook_at: webhook.last_sent_at,
            last_webhook_ok: webhook.last_ok,
            account_id: info.account_id,
            session: info.state,
            device_login: info.device_login,
        })
    }
}

pub fn now_unix() -> i64 {
    chrono::Utc::now().timestamp()
}

pub fn now_unix_millis() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use vrcx_0_logger_protocol::wire::{FrameKind, WebhookFormat, WireFrame};

    use super::*;
    use crate::test_support::{
        at, fresh_app, messages, open_store, record, record_connect, record_for, record_snapshot,
        sign_in, start_with, temp_dir, webhook_receiver, Desktop, ACCOUNT, OTHER_ACCOUNT, PASSWORD,
    };

    fn payloads(frames: &[WireFrame]) -> Vec<&str> {
        frames.iter().map(|frame| frame.payload.as_str()).collect()
    }

    #[tokio::test]
    async fn without_retention_limits_nothing_is_ever_dropped() {
        let app = fresh_app();
        sign_in(&app, ACCOUNT);
        record(&app.store, at(100), "years old");

        app.prune();

        let status = Desktop::new(&app).status().await;
        assert_eq!(status.unsynced_frames, 1);
        assert_eq!(status.dropped_unsynced_frames, 0);
    }

    #[tokio::test]
    async fn age_retention_drops_only_records_older_than_the_limit() {
        let (store, _) = open_store(&temp_dir(), PASSWORD);
        let now = now_unix();
        record_connect(&store, at(now - 3 * DAY_SECS));
        record(&store, at(now - 3 * DAY_SECS), "three days old");
        let start = record_connect(&store, at(now - 2 * 60 * 60));
        record_snapshot(&store, at(now - 2 * 60 * 60), start);
        record(&store, at(now - 60 * 60), "an hour old");
        let app = start_with(store, PASSWORD, Some(2), None);

        app.prune();

        let desktop = Desktop::new(&app);
        assert_eq!(messages(&desktop.pull_all().await), ["an hour old"]);
        assert_eq!(desktop.status().await.dropped_unsynced_frames, 2);
    }

    #[tokio::test]
    async fn size_retention_drops_the_oldest_records_first() {
        let (store, _) = open_store(&temp_dir(), PASSWORD);
        let payload = "x".repeat(4096);
        for second in 0..1000 {
            if second % 100 == 0 {
                let start = record_connect(&store, at(second));
                record_snapshot(&store, at(second), start);
            }
            record(&store, at(second), &payload);
        }
        let newest = record(&store, at(1000), "newest");
        let limit = store.database_bytes().unwrap() / 2;
        let app = start_with(store, PASSWORD, None, Some(limit));
        sign_in(&app, ACCOUNT);

        app.prune();

        let desktop = Desktop::new(&app);
        let remaining = desktop.pull_all().await;
        let seqs: Vec<i64> = remaining.iter().map(|frame| frame.seq).collect();
        let kept = i64::try_from(seqs.len()).unwrap();
        assert!(kept < 1021);
        assert_eq!(remaining[0].kind, FrameKind::Connect);
        assert_eq!(seqs, ((newest - kept + 1)..=newest).collect::<Vec<_>>());
        let status = desktop.status().await;
        assert!(status.database_bytes <= limit);
        assert_eq!(
            status.dropped_unsynced_frames,
            1021 - status.unsynced_frames
        );
    }

    #[tokio::test]
    async fn retention_removes_the_rest_of_a_recording_whose_start_was_deleted() {
        let (store, _) = open_store(&temp_dir(), PASSWORD);
        let now = now_unix();
        let first = record_connect(&store, at(now - 3 * DAY_SECS));
        record_snapshot(&store, at(now - 3 * DAY_SECS), first);
        record(&store, at(now - 3 * DAY_SECS), "expired");
        record(&store, at(now - 3 * 60 * 60), "rest of the first recording");
        let second = record_connect(&store, at(now - 2 * 60 * 60));
        record_snapshot(&store, at(now - 2 * 60 * 60), second);
        record(&store, at(now - 60 * 60), "second recording");
        let app = start_with(store, PASSWORD, Some(2), None);

        app.prune();

        let desktop = Desktop::new(&app);
        let remaining = desktop.pull_all().await;
        assert_eq!(messages(&remaining), ["second recording"]);
        assert_eq!(remaining[0].seq, second);
        assert_eq!(remaining.len(), 3);
        assert_eq!(desktop.status().await.dropped_unsynced_frames, 4);
    }

    #[tokio::test]
    async fn retention_removes_every_record_of_an_account_with_no_recording_start_left() {
        let (store, _) = open_store(&temp_dir(), PASSWORD);
        let now = now_unix();
        record(&store, at(now - 3 * DAY_SECS), "expired");
        record_for(&store, OTHER_ACCOUNT, at(now - 60 * 60), "no snapshot left");
        let app = start_with(store, PASSWORD, Some(2), None);

        app.prune();

        let desktop = Desktop::new(&app);
        assert!(desktop
            .pull_account(OTHER_ACCOUNT, 0, 10)
            .await
            .frames
            .is_empty());
        assert_eq!(desktop.status().await.dropped_unsynced_frames, 2);
    }

    #[tokio::test]
    async fn records_without_a_snapshot_are_kept_when_retention_drops_nothing() {
        let (store, _) = open_store(&temp_dir(), PASSWORD);
        record(&store, at(now_unix() - 60 * 60), "recent");
        let app = start_with(store, PASSWORD, Some(2), None);

        app.prune();

        let desktop = Desktop::new(&app);
        assert_eq!(payloads(&desktop.pull_all().await), ["recent"]);
        assert_eq!(desktop.status().await.dropped_unsynced_frames, 0);
    }

    #[tokio::test]
    async fn a_request_cannot_be_replayed_at_the_edge_of_the_clock_skew_window() {
        let app = fresh_app();
        let nonce = [7u8; 24];
        let sent_at = now_unix() + 10;
        let accepted_at = sent_at - vrcx_0_logger_protocol::envelope::MAX_CLOCK_SKEW_SECS;

        assert!(app.accept_request(nonce, sent_at, accepted_at));
        assert!(!app.accept_request(
            nonce,
            sent_at,
            sent_at + vrcx_0_logger_protocol::envelope::MAX_CLOCK_SKEW_SECS
        ));
    }

    #[tokio::test]
    async fn retention_alerts_once_until_the_desktop_pulls_again() {
        let (base, mut inbox) = webhook_receiver().await;
        let (store, _) = open_store(&temp_dir(), PASSWORD);
        let app = start_with(store, PASSWORD, Some(2), None);
        let desktop = Desktop::new(&app);
        desktop
            .save_webhook(&format!("{base}/hook"), WebhookFormat::Text)
            .await;
        let expire_one_record = || {
            record(&app.store, at(now_unix() - 3 * DAY_SECS), "expired");
            app.prune();
        };

        expire_one_record();
        let first = tokio::time::timeout(Duration::from_secs(5), inbox.recv()).await;
        assert!(first
            .unwrap()
            .unwrap()
            .contains("Details: deleted records: 1"));

        expire_one_record();
        expire_one_record();
        desktop.pull_all().await;
        expire_one_record();

        let second = tokio::time::timeout(Duration::from_secs(5), inbox.recv()).await;
        assert!(second
            .unwrap()
            .unwrap()
            .starts_with("VRCX-0 logger [storage]"));
        let extra = tokio::time::timeout(Duration::from_millis(300), inbox.recv()).await;
        assert!(extra.is_err());
        assert_eq!(desktop.status().await.dropped_unsynced_frames, 4);
    }
}
