use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use super::*;

struct TestDir(PathBuf);

impl TestDir {
    fn new(name: &str) -> Self {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "vrcx-0-vrchat-log-{name}-{}-{nonce}",
            std::process::id()
        ));
        std::fs::create_dir_all(&path).unwrap();
        Self(path)
    }

    fn path(&self) -> &Path {
        &self.0
    }

    fn write(&self, file_name: &str, content: &str) -> u64 {
        let path = self.0.join(file_name);
        std::fs::write(&path, content).unwrap();
        std::fs::metadata(path).unwrap().len()
    }

    fn write_at(&self, file_name: &str, content: &str, modified: SystemTime) {
        self.write(file_name, content);
        let path = self.0.join(file_name);
        let file = std::fs::File::options().write(true).open(path).unwrap();
        file.set_times(std::fs::FileTimes::new().set_modified(modified))
            .unwrap();
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[test]
fn lists_only_valid_logs_with_the_newest_file_first() {
    let dir = TestDir::new("list");
    dir.write_at(
        "output_log_2026-08-10.txt",
        "older",
        SystemTime::UNIX_EPOCH + Duration::from_secs(100),
    );
    dir.write_at(
        "output_log_2026-08-11.txt",
        "newer",
        SystemTime::UNIX_EPOCH + Duration::from_secs(200),
    );
    dir.write("output_log_2026-08-11.log", "wrong extension");
    dir.write("notes.txt", "wrong prefix");

    let files = list_log_files(dir.path()).unwrap();

    assert_eq!(files.len(), 2);
    assert_eq!(files[0].file_name, "output_log_2026-08-11.txt");
    assert!(files[0].latest);
    assert_eq!(files[1].file_name, "output_log_2026-08-10.txt");
    assert!(!files[1].latest);
}

#[test]
fn reads_filtered_entries_with_stable_pagination_metadata() {
    let dir = TestDir::new("read");
    let file_name = "output_log_2026-08-11.txt";
    dir.write(
        file_name,
        "2026.08.11 12:00:01 Debug - [Behaviour] first needle\ncontinued detail\n2026.08.11 12:00:02 Warning - [Other] ignored\n2026.08.11 12:00:03 Error - [Behaviour] second needle",
    );

    let output = read_log_entries(
        dir.path(),
        VrchatLogEntriesReadInput {
            file_name: file_name.into(),
            offset: Some(1),
            limit: Some(1),
            query: Some("NEEDLE".into()),
            query_case_sensitive: None,
            query_regex: None,
            levels: Some(vec!["debug".into(), "error".into()]),
            categories: Some(vec!["Behaviour".into()]),
        },
    )
    .unwrap();

    assert_eq!(output.file_name, file_name);
    assert_eq!(output.entries.len(), 1);
    assert_eq!(output.entries[0].message, "[Behaviour] second needle");
    assert_eq!(output.offset, 1);
    assert_eq!(output.next_offset, None);
    assert_eq!(output.total_entries, 2);
    assert_eq!(output.total_lines, 4);
    assert_eq!(output.last_line_number, 4);
    assert!(!output.reset_required);
    assert_eq!(
        output
            .level_counts
            .expect("level counts")
            .into_iter()
            .map(|entry| (entry.level, entry.count))
            .collect::<Vec<_>>(),
        vec![
            ("Debug".to_string(), 1),
            ("Warning".to_string(), 0),
            ("Error".to_string(), 1)
        ]
    );
}

#[test]
fn entries_read_rejects_an_invalid_regex_query() {
    let dir = TestDir::new("entries-regex");
    let file_name = "output_log_2026-08-11.txt";
    dir.write(file_name, "2026.08.11 12:00:01 Debug - [Behaviour] first\n");

    let result = read_log_entries(
        dir.path(),
        VrchatLogEntriesReadInput {
            file_name: file_name.into(),
            offset: None,
            limit: None,
            query: Some("[unclosed".into()),
            query_case_sensitive: None,
            query_regex: Some(true),
            levels: None,
            categories: None,
        },
    );

    assert!(result.is_err());
}

#[test]
fn tail_requests_reset_after_the_file_shrinks() {
    let dir = TestDir::new("tail-reset");
    let file_name = "output_log_2026-08-11.txt";
    let current_size = dir.write(file_name, "short\n");

    let output = read_log_tail(
        dir.path(),
        VrchatLogTailReadInput {
            file_name: Some(file_name.into()),
            after_line_number: Some(8),
            file_size: Some(current_size + 10),
            limit: Some(10),
            query: None,
            query_case_sensitive: None,
            query_regex: None,
            levels: None,
            categories: None,
        },
    )
    .unwrap();

    assert!(output.reset_required);
    assert!(output.entries.is_empty());
    assert_eq!(output.total_lines, 0);
    assert_eq!(output.last_line_number, 0);
    assert_eq!(output.file_size, current_size);
}

#[test]
fn rejects_paths_and_non_log_file_names() {
    for file_name in [
        "",
        "../output_log_2026-08-11.txt",
        "folder/output_log_2026-08-11.txt",
        "C:\\output_log_2026-08-11.txt",
        "output_log_2026-08-11.log",
        "notes.txt",
    ] {
        assert!(validate_log_file_name(file_name).is_err(), "{file_name}");
    }
    assert_eq!(
        validate_log_file_name(" output_log_2026-08-11.txt ").unwrap(),
        "output_log_2026-08-11.txt"
    );
}
