use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use crate::game_log_parser::{GameLogEvent, LogReader};
use vrcx_0_core::game_log_parser::GameLogEventKind;

use super::sink::{GameLogEventOrigin, GameLogEventSink};
use super::watcher::{update, LogWatcher};

#[derive(Default)]
struct RecordingSink {
    origins: Mutex<Vec<GameLogEventOrigin>>,
    events: Mutex<Vec<GameLogEvent>>,
}

impl GameLogEventSink for RecordingSink {
    fn ingest_game_log_event(&self, _event: &GameLogEvent) -> crate::Result<()> {
        Ok(())
    }

    fn ingest_game_log_events_with_origin(
        &self,
        events: &[GameLogEvent],
        origin: GameLogEventOrigin,
    ) -> crate::Result<()> {
        self.origins.lock().unwrap().push(origin);
        self.events.lock().unwrap().extend_from_slice(events);
        Ok(())
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
        let path = std::env::temp_dir().join(format!(
            "vrcx-0-log-watcher-{name}-{}-{nonce}",
            std::process::id()
        ));
        std::fs::create_dir_all(&path).unwrap();
        Self { path }
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

#[test]
fn update_tracks_only_vrchat_output_logs_and_removes_deleted_contexts() {
    let dir = TestDir::new("scan");
    std::fs::write(dir.path().join("output_log_2026-08-02_00-00-00.txt"), []).unwrap();
    std::fs::write(dir.path().join("output_log_ignored.log"), []).unwrap();
    std::fs::write(dir.path().join("output_log_vrcx-replay.txt"), []).unwrap();
    std::fs::write(dir.path().join("other.txt"), []).unwrap();
    let watcher = LogWatcher::new(None);
    let mut reader = LogReader::new();
    let mut contexts = HashMap::new();
    let mut first_run = true;

    assert!(!update(
        &watcher.inner,
        dir.path(),
        &mut reader,
        &mut contexts,
        &mut first_run,
    ));
    assert!(!first_run);
    assert_eq!(contexts.len(), 1);
    assert!(contexts.contains_key("output_log_2026-08-02_00-00-00.txt"));

    std::fs::remove_file(dir.path().join("output_log_2026-08-02_00-00-00.txt")).unwrap();
    assert!(!update(
        &watcher.inner,
        dir.path(),
        &mut reader,
        &mut contexts,
        &mut first_run,
    ));
    assert!(contexts.is_empty());
}

#[test]
fn update_skips_files_older_than_the_requested_cutoff() {
    let dir = TestDir::new("cutoff");
    std::fs::write(dir.path().join("output_log_2026-08-02_00-00-00.txt"), []).unwrap();
    let watcher = LogWatcher::new(None);
    watcher.set_date_till("2999-01-01T00:00:00.000Z");
    let mut reader = LogReader::new();
    let mut contexts = HashMap::new();
    let mut first_run = true;

    assert!(!update(
        &watcher.inner,
        dir.path(),
        &mut reader,
        &mut contexts,
        &mut first_run,
    ));
    assert!(contexts.is_empty());
    assert!(!first_run);
}

#[test]
fn update_handles_a_missing_directory_as_an_empty_completed_scan() {
    let dir = TestDir::new("missing");
    let missing = dir.path().join("not-created");
    let watcher = LogWatcher::new(None);
    let mut reader = LogReader::new();
    let mut contexts = HashMap::new();
    let mut first_run = true;

    assert!(!update(
        &watcher.inner,
        &missing,
        &mut reader,
        &mut contexts,
        &mut first_run,
    ));
    assert!(contexts.is_empty());
    assert!(!first_run);
}

#[test]
fn initial_scan_can_limit_replay_to_latest_output_log() {
    let dir = TestDir::new("latest-only");
    std::fs::write(dir.path().join("output_log_2026-08-01_00-00-00.txt"), []).unwrap();
    std::fs::write(dir.path().join("output_log_2026-08-02_00-00-00.txt"), []).unwrap();
    let watcher = LogWatcher::new(None);
    watcher.set_initial_scan_latest_file_only(true);
    let mut reader = LogReader::new();
    let mut contexts = HashMap::new();
    let mut first_run = true;

    update(
        &watcher.inner,
        dir.path(),
        &mut reader,
        &mut contexts,
        &mut first_run,
    );

    assert_eq!(contexts.len(), 1);
    assert!(contexts.contains_key("output_log_2026-08-02_00-00-00.txt"));
    assert!(!first_run);
}

#[test]
fn flush_labels_initial_and_live_batches() {
    let sink = Arc::new(RecordingSink::default());
    let watcher = LogWatcher::new(Some(sink.clone()));
    let event = GameLogEvent {
        file_name: "output_log_test.txt".into(),
        created_at: "2026-08-06T00:00:00.000Z".into(),
        kind: GameLogEventKind::DesktopMode,
    };

    watcher
        .inner
        .event_buffer
        .lock()
        .unwrap()
        .push(event.clone());
    super::queue::flush_game_log_events(&watcher.inner, true);
    watcher.inner.event_buffer.lock().unwrap().push(event);
    super::queue::flush_game_log_events(&watcher.inner, false);

    assert_eq!(
        *sink.origins.lock().unwrap(),
        vec![GameLogEventOrigin::InitialScan, GameLogEventOrigin::Live]
    );
}

#[test]
fn latest_only_replay_does_not_ingest_older_files_on_later_polls() {
    use chrono::{Duration, Local, Utc};
    struct Seen(Mutex<Vec<(String, GameLogEventOrigin)>>);
    impl GameLogEventSink for Seen {
        fn ingest_game_log_event(&self, _: &GameLogEvent) -> crate::Result<()> {
            Ok(())
        }
        fn ingest_game_log_events_with_origin(
            &self,
            events: &[GameLogEvent],
            origin: GameLogEventOrigin,
        ) -> crate::Result<()> {
            let mut seen = self.0.lock().unwrap();
            for event in events {
                if let GameLogEventKind::Location { location, .. } = &event.kind {
                    seen.push((location.clone(), origin));
                }
            }
            Ok(())
        }
    }
    let dir = TestDir::new("analysis-latest-only");
    let older = Local::now() - Duration::minutes(5);
    let latest = older + Duration::minutes(1);
    for (name, time, location) in [
        ("output_log_2026-08-01_00-00-00.txt", older, "wrld_old:1"),
        (
            "output_log_2026-08-02_00-00-00.txt",
            latest,
            "wrld_current:2",
        ),
    ] {
        std::fs::write(
            dir.path().join(name),
            format!(
                "{} Debug      -  [Behaviour] Joining {location}\n",
                time.format("%Y.%m.%d %H:%M:%S")
            ),
        )
        .unwrap();
    }
    let seen = Arc::new(Seen(Mutex::new(Vec::new())));
    let watcher = LogWatcher::new(Some(seen.clone()));
    watcher.set_initial_scan_latest_file_only(true);
    watcher.set_date_till(
        &(older - Duration::minutes(1))
            .with_timezone(&Utc)
            .to_rfc3339(),
    );
    let mut reader = LogReader::new();
    let mut contexts = HashMap::new();
    let mut first = true;
    update(
        &watcher.inner,
        dir.path(),
        &mut reader,
        &mut contexts,
        &mut first,
    );
    assert_eq!(
        *seen.0.lock().unwrap(),
        vec![("wrld_current:2".into(), GameLogEventOrigin::InitialScan)]
    );
    update(
        &watcher.inner,
        dir.path(),
        &mut reader,
        &mut contexts,
        &mut first,
    );
    let result = seen.0.lock().unwrap();

    assert_eq!(
        *result,
        vec![("wrld_current:2".into(), GameLogEventOrigin::InitialScan)]
    );
}

#[test]
fn truncated_current_log_is_read_again_from_its_new_beginning() {
    let dir = TestDir::new("truncate-current");
    let path = dir.path().join("output_log_2026-08-03_00-00-00.txt");
    let old = "2020.01.01 00:00:00 Log        -  [Behaviour] Joining wrld_old:1\n";
    std::fs::write(&path, old.repeat(2)).unwrap();
    let sink = Arc::new(RecordingSink::default());
    let watcher = LogWatcher::new(Some(sink.clone()));
    let mut reader = LogReader::new();
    let mut contexts = HashMap::new();
    let mut first = true;
    update(
        &watcher.inner,
        dir.path(),
        &mut reader,
        &mut contexts,
        &mut first,
    );
    std::fs::write(
        &path,
        "2020.01.01 00:00:01 Log        -  [Behaviour] Joining wrld_new:2\n",
    )
    .unwrap();
    update(
        &watcher.inner,
        dir.path(),
        &mut reader,
        &mut contexts,
        &mut first,
    );
    let events = sink.events.lock().unwrap();
    assert!(
        matches!(&events.last().unwrap().kind, GameLogEventKind::Location { location, .. } if location == "wrld_new:2")
    );
}

#[test]
fn regression_failed_scan_retains_cursor_and_initial_origin() {
    struct RetrySink(Mutex<Vec<super::GameLogScanCursor>>);
    impl GameLogEventSink for RetrySink {
        fn ingest_game_log_event(&self, _: &GameLogEvent) -> crate::Result<()> {
            Ok(())
        }
        fn ingest_game_log_scan(
            &self,
            _: &[GameLogEvent],
            origin: GameLogEventOrigin,
            cursor: super::GameLogScanCursor,
            _: bool,
        ) -> crate::Result<()> {
            assert_eq!(origin, GameLogEventOrigin::InitialScan);
            let mut seen = self.0.lock().unwrap();
            seen.push(cursor);
            if seen.len() == 1 {
                Err(crate::Error::Custom("temporary failure".into()))
            } else {
                Ok(())
            }
        }
    }
    let dir = TestDir::new("scan-retry");
    std::fs::write(
        dir.path().join("output_log_2026-08-03_00-00-00.txt"),
        "2020.01.01 00:00:00 Log        -  [Behaviour] Joining wrld_retry:1\n",
    )
    .unwrap();
    let sink = Arc::new(RetrySink(Mutex::new(Vec::new())));
    let watcher = LogWatcher::new(Some(sink.clone()));
    let mut reader = LogReader::new();
    let mut contexts = HashMap::new();
    let mut first = true;
    update(
        &watcher.inner,
        dir.path(),
        &mut reader,
        &mut contexts,
        &mut first,
    );
    assert!(first);
    assert_eq!(contexts["output_log_2026-08-03_00-00-00.txt"].position, 0);
    use std::io::Write;
    writeln!(
        std::fs::OpenOptions::new()
            .append(true)
            .open(dir.path().join("output_log_2026-08-03_00-00-00.txt"))
            .unwrap(),
        "2020.01.01 00:00:01 Log        -  [Behaviour] Joining wrld_next:2"
    )
    .unwrap();
    update(
        &watcher.inner,
        dir.path(),
        &mut reader,
        &mut contexts,
        &mut first,
    );
    assert!(!first);
    let seen = sink.0.lock().unwrap();
    assert_eq!(seen.len(), 3);
    assert_eq!(seen[0].context.position, seen[1].context.position);
    assert!(seen[2].context.position > seen[1].context.position);
}

#[test]
fn retry_in_later_file_does_not_revisit_completed_earlier_files() {
    struct Sink(Mutex<Vec<String>>);
    impl GameLogEventSink for Sink {
        fn ingest_game_log_event(&self, _: &GameLogEvent) -> crate::Result<()> {
            Ok(())
        }
        fn ingest_game_log_scan(
            &self,
            _: &[GameLogEvent],
            _: GameLogEventOrigin,
            cursor: super::GameLogScanCursor,
            _: bool,
        ) -> crate::Result<()> {
            let mut seen = self.0.lock().unwrap();
            seen.push(cursor.file_name);
            if seen.len() == 2 {
                Err(crate::Error::Custom("write unavailable".into()))
            } else {
                Ok(())
            }
        }
    }
    let dir = TestDir::new("retry-multiple-files");
    for name in [
        "output_log_2026-08-01_00-00-00.txt",
        "output_log_2026-08-02_00-00-00.txt",
    ] {
        std::fs::write(
            dir.path().join(name),
            "2020.01.01 00:00:00 Log        -  [Behaviour] Joining wrld_retry:1\n",
        )
        .unwrap();
    }
    let sink = Arc::new(Sink(Mutex::new(Vec::new())));
    let watcher = LogWatcher::new(Some(sink.clone()));
    let mut reader = LogReader::new();
    let mut contexts = HashMap::new();
    let mut first = true;
    update(
        &watcher.inner,
        dir.path(),
        &mut reader,
        &mut contexts,
        &mut first,
    );
    update(
        &watcher.inner,
        dir.path(),
        &mut reader,
        &mut contexts,
        &mut first,
    );
    assert!(!first);
    assert_eq!(
        sink.0
            .lock()
            .unwrap()
            .iter()
            .filter(|name| name.as_str() == "output_log_2026-08-01_00-00-00.txt")
            .count(),
        1
    );
}

#[test]
fn follows_the_older_client_log_after_the_newer_client_quits() {
    use std::io::Write;
    use std::time::{Duration, SystemTime};
    struct Sink(Mutex<Vec<(super::GameLogScanCursor, bool, Vec<GameLogEvent>)>>);
    impl GameLogEventSink for Sink {
        fn ingest_game_log_event(&self, _: &GameLogEvent) -> crate::Result<()> {
            Ok(())
        }
        fn ingest_game_log_scan(
            &self,
            events: &[GameLogEvent],
            _: GameLogEventOrigin,
            cursor: super::GameLogScanCursor,
            publish: bool,
        ) -> crate::Result<()> {
            self.0
                .lock()
                .unwrap()
                .push((cursor, publish, events.to_vec()));
            Ok(())
        }
    }
    fn append(path: &Path, line: &str, modified: SystemTime) {
        let mut file = std::fs::OpenOptions::new().append(true).open(path).unwrap();
        writeln!(file, "{line}").unwrap();
        file.set_modified(modified).unwrap();
    }
    let dir = TestDir::new("multi-client");
    let older = dir.path().join("output_log_2026-08-01_00-00-00.txt");
    let newer = dir.path().join("output_log_2026-08-02_00-00-00.txt");
    std::fs::write(&older, []).unwrap();
    std::fs::write(&newer, []).unwrap();
    let now = SystemTime::now();
    append(
        &older,
        "2020.01.01 00:00:00 Log        -  [Behaviour] Joining wrld_older:1",
        now - Duration::from_secs(300),
    );
    append(
        &newer,
        "2020.01.01 00:00:01 Log        -  [Behaviour] Joining wrld_newer:2",
        now - Duration::from_secs(240),
    );
    let sink = Arc::new(Sink(Mutex::new(Vec::new())));
    let watcher = LogWatcher::new(Some(sink.clone()));
    let mut reader = LogReader::new();
    let mut contexts = HashMap::new();
    let mut first = true;
    let mut poll = || {
        update(
            &watcher.inner,
            dir.path(),
            &mut reader,
            &mut contexts,
            &mut first,
        );
    };
    poll();
    let scans_after_initial = sink.0.lock().unwrap().len();

    append(
        &older,
        "2020.01.01 00:00:02 Log        -  [Behaviour] Joining wrld_older:3",
        now - Duration::from_secs(180),
    );
    poll();
    assert_eq!(sink.0.lock().unwrap().len(), scans_after_initial);

    let quit_at = now - Duration::from_secs(120);
    append(
        &newer,
        "2020.01.01 00:00:03 Log        -  VRCApplication: OnApplicationQuit at 2020.01.01 00:00:03",
        quit_at,
    );
    poll();
    append(
        &older,
        "2020.01.01 00:00:04 Log        -  [Behaviour] Joining wrld_older:4",
        now - Duration::from_secs(60),
    );
    poll();
    poll();

    let scans = sink.0.lock().unwrap();
    let (cursor, publish, events) = scans.last().unwrap();
    assert_eq!(cursor.file_name, "output_log_2026-08-01_00-00-00.txt");
    assert!(cursor.rebuild);
    assert!(*publish);
    assert_eq!(
        cursor.cutoff,
        chrono::DateTime::<chrono::Utc>::from(quit_at).to_rfc3339()
    );
    assert!(matches!(
        &events.last().unwrap().kind,
        GameLogEventKind::Location { location, .. } if location == "wrld_older:4"
    ));
    assert_eq!(
        scans
            .iter()
            .filter(|(cursor, _, _)| cursor.file_name == "output_log_2026-08-01_00-00-00.txt")
            .count(),
        2
    );
}
