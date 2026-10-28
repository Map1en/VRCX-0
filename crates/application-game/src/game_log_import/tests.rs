use std::path::{Path, PathBuf};

use vrcx_0_core::OwnerId;

use super::{
    import_game_log_file, inspect_game_log_import_file, GameLogImportConsent,
    GameLogImportFileStatus,
};
use crate::ports::TestGameStateStore;

const AUTH_SELF: &str = "2026.06.21 22:00:00 Debug      -  User Authenticated: Me (usr_self)";
const AUTH_OTHER: &str = "2026.06.21 22:30:00 Debug      -  User Authenticated: Alt (usr_other)";
const SESSION: [&str; 8] = [
    "2026.06.21 22:10:00 Log        -  [Behaviour] Entering Room: Midnight Rooftop",
    "2026.06.21 22:10:05 Log        -  [Behaviour] Joining wrld_abc:123",
    "2026.06.21 22:11:00 Log        -  [Behaviour] OnPlayerJoined Maple (usr_join)",
    "2026.06.21 22:12:00 Log        -  [Behaviour] OnPlayerLeft Maple (usr_join)",
    "2026.06.21 22:13:00 Log        -  [Video Playback] Attempting to resolve URL 'https://youtu.be/dQw4w9WgXcQ'",
    "2026.06.21 22:14:00 Log        -  [Behaviour] OnPlayerJoined Guest (usr_guest)",
    "2026.06.21 22:20:00 Log        -  [Behaviour] Destination fetching: wrld_def:456",
    "2026.06.21 22:20:01 Log        -  [Behaviour] OnLeftRoom",
];

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
            "vrcx-0-game-log-import-{name}-{}-{nonce}",
            std::process::id()
        ));
        std::fs::create_dir_all(&path).unwrap();
        Self { path }
    }

    fn write(&self, name: &str, lines: &[&str]) -> PathBuf {
        let path = self.path.join(name);
        let mut content = lines.join("\n");
        content.push('\n');
        std::fs::write(&path, content).unwrap();
        path
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

fn session_with(account_lines: &[&'static str]) -> Vec<&'static str> {
    account_lines.iter().copied().chain(SESSION).collect()
}

const NO_CONSENT: GameLogImportConsent = GameLogImportConsent {
    unverified_account: false,
    account_mismatch: false,
};
const FULL_CONSENT: GameLogImportConsent = GameLogImportConsent {
    unverified_account: true,
    account_mismatch: true,
};

fn status_of(path: &Path, game_running: bool) -> GameLogImportFileStatus {
    inspect_game_log_import_file(path, "usr_self", game_running).status
}

#[test]
fn inspect_classifies_the_account_that_produced_the_log() {
    let dir = TestDir::new("accounts");
    let own = dir.write("own.txt", &session_with(&[AUTH_SELF]));
    let other = dir.write("other.txt", &session_with(&[AUTH_OTHER]));
    let switched = dir.write("switched.txt", &session_with(&[AUTH_SELF, AUTH_OTHER]));
    let unknown = dir.write("unknown.txt", &SESSION);

    assert_eq!(status_of(&own, false), GameLogImportFileStatus::Ready);
    assert_eq!(
        status_of(&other, false),
        GameLogImportFileStatus::AccountMismatch
    );
    assert_eq!(
        status_of(&switched, false),
        GameLogImportFileStatus::AccountMismatch
    );
    assert_eq!(
        status_of(&unknown, false),
        GameLogImportFileStatus::AccountUnverified
    );
    assert_eq!(
        status_of(&dir.path.join("missing.txt"), false),
        GameLogImportFileStatus::Unreadable
    );
}

#[test]
fn inspect_marks_the_newest_vrchat_log_as_live_only_while_the_game_runs() {
    let dir = TestDir::new("live");
    let older = dir.write(
        "output_log_2026-06-21_22-00-00.txt",
        &session_with(&[AUTH_SELF]),
    );
    let newest = dir.write(
        "output_log_2026-06-22_22-00-00.txt",
        &session_with(&[AUTH_SELF]),
    );
    let foreign = dir.write("output_log_vrcx-replay.txt", &session_with(&[AUTH_SELF]));

    assert_eq!(status_of(&newest, true), GameLogImportFileStatus::LiveFile);
    assert_eq!(status_of(&newest, false), GameLogImportFileStatus::Ready);
    assert_eq!(status_of(&older, true), GameLogImportFileStatus::Ready);
    assert_eq!(status_of(&foreign, true), GameLogImportFileStatus::Ready);
}

#[test]
fn import_writes_history_rows_without_counting_location_time_updates_as_new_rows() {
    let dir = TestDir::new("import");
    let path = dir.write("own.txt", &session_with(&[AUTH_SELF]));
    let store = TestGameStateStore::default();
    let owner = OwnerId::new("usr_self");

    let result = import_game_log_file(&store, &owner, &path, NO_CONSENT, false).unwrap();

    assert!(result.imported);
    assert_eq!(result.status, GameLogImportFileStatus::Ready);
    assert_eq!(result.inserted_count, 6);
    let locations = store.locations(&owner);
    assert_eq!(locations.len(), 1);
    assert_eq!(locations[0].location, "wrld_abc:123");
    assert!(locations[0].time > 0);
    let join_leave = store.join_leave(&owner);
    assert_eq!(join_leave.len(), 4);
    assert!(join_leave.iter().all(|row| row.location == "wrld_abc:123"));
    let videos = store.video_plays(&owner);
    assert_eq!(videos.len(), 1);
    assert_eq!(videos[0].video_id, "YouTube");
    assert_eq!(videos[0].video_name, "dQw4w9WgXcQ");
}

#[test]
fn import_stores_history_rows_and_their_durations_in_one_write() {
    let dir = TestDir::new("import-one-write");
    let path = dir.write("own.txt", &session_with(&[AUTH_SELF]));
    let store = TestGameStateStore::default();
    store.allow_only_writes(1);
    let owner = OwnerId::new("usr_self");

    let result = import_game_log_file(&store, &owner, &path, NO_CONSENT, false).unwrap();

    assert_eq!(result.inserted_count, 6);
    assert!(store.locations(&owner)[0].time > 0);
}

#[test]
fn import_requires_confirmation_for_logs_without_an_account_line() {
    let dir = TestDir::new("unverified");
    let path = dir.write("unknown.txt", &SESSION);
    let store = TestGameStateStore::default();
    let owner = OwnerId::new("usr_self");

    let skipped = import_game_log_file(&store, &owner, &path, NO_CONSENT, false).unwrap();
    assert!(!skipped.imported);
    assert_eq!(skipped.status, GameLogImportFileStatus::AccountUnverified);
    assert!(store.locations(&owner).is_empty());

    let confirmed = import_game_log_file(
        &store,
        &owner,
        &path,
        GameLogImportConsent {
            unverified_account: true,
            account_mismatch: false,
        },
        false,
    )
    .unwrap();
    assert!(confirmed.imported);
    assert_eq!(store.locations(&owner).len(), 1);
}

#[test]
fn import_writes_another_accounts_log_only_after_its_own_consent() {
    let dir = TestDir::new("mismatch");
    let path = dir.write("other.txt", &session_with(&[AUTH_OTHER]));
    let store = TestGameStateStore::default();
    let owner = OwnerId::new("usr_self");
    let unverified_only = GameLogImportConsent {
        unverified_account: true,
        account_mismatch: false,
    };

    let skipped = import_game_log_file(&store, &owner, &path, unverified_only, false).unwrap();
    assert!(!skipped.imported);
    assert!(store.locations(&owner).is_empty());

    let confirmed = import_game_log_file(&store, &owner, &path, FULL_CONSENT, false).unwrap();
    assert!(confirmed.imported);
    assert_eq!(confirmed.status, GameLogImportFileStatus::AccountMismatch);
    assert_eq!(store.locations(&owner).len(), 1);
}

#[test]
fn import_never_writes_the_live_log() {
    let dir = TestDir::new("live-import");
    let live = dir.write(
        "output_log_2026-06-22_22-00-00.txt",
        &session_with(&[AUTH_SELF]),
    );
    let store = TestGameStateStore::default();
    let owner = OwnerId::new("usr_self");

    let live = import_game_log_file(&store, &owner, &live, FULL_CONSENT, true).unwrap();

    assert!(!live.imported);
    assert!(store.locations(&owner).is_empty());
}
