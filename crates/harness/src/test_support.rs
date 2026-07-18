use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

static TEST_DATABASE_SEQUENCE: AtomicU64 = AtomicU64::new(0);

pub(crate) fn unique_test_database_path(prefix: &str) -> PathBuf {
    let sequence = TEST_DATABASE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!(
        "{prefix}-{}-{nonce}-{sequence}",
        std::process::id()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir.join("VRCX-0.sqlite3")
}
