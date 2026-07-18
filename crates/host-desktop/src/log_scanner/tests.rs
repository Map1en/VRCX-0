use super::*;

struct TestDir {
    path: PathBuf,
}

impl TestDir {
    fn new(name: &str) -> Self {
        let nonce = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "vrcx-0-log-scanner-{name}-{}-{nonce}",
            std::process::id()
        ));
        std::fs::create_dir_all(&path).unwrap();
        Self { path }
    }

    fn write(&self, file_name: &str, lines: &[String]) -> PathBuf {
        let path = self.path.join(file_name);
        std::fs::write(&path, lines.join("\n")).unwrap();
        path
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

fn line_at(date: NaiveDateTime, content: &str) -> String {
    format!(
        "{} Log        -  {content}",
        date.format("%Y.%m.%d %H:%M:%S")
    )
}

fn recent_line(offset_minutes: i64, content: &str) -> String {
    line_at(
        Local::now().naive_local() + chrono::Duration::minutes(offset_minutes),
        content,
    )
}

#[test]
fn candidate_selection_prefers_latest_timestamped_output_log() {
    let dir = TestDir::new("candidate-timestamp");
    dir.write("ignored.txt", &[]);
    dir.write("output_log_not-a-date.txt", &[]);
    dir.write("output_log_2026-01-02_03-04-05.txt", &[]);
    dir.write("output_log_2026-01-02_03-04-06.txt", &[]);

    let candidate = latest_output_log_candidate(&dir.path).unwrap();

    assert_eq!(candidate.file_name, "output_log_2026-01-02_03-04-06.txt");
}

#[test]
fn candidate_selection_falls_back_to_an_untimestamped_output_log() {
    let dir = TestDir::new("candidate-fallback");
    dir.write("output_log_current.txt", &[]);

    let candidate = latest_output_log_candidate(&dir.path).unwrap();

    assert_eq!(candidate.file_name, "output_log_current.txt");
    assert!(candidate.timestamp.is_none());
}

#[test]
fn entering_then_joining_produces_location_snapshot() {
    let dir = TestDir::new("location-join");
    let joining = recent_line(-1, "[Behaviour] Joining wrld_test:instance/hidden");
    let path = dir.write(
        "output_log_2026-01-02_03-04-05.txt",
        &[
            recent_line(-2, "[Behaviour] Entering Room: Test World"),
            joining.clone(),
        ],
    );

    let snapshot =
        scan_log_file_location_snapshot(&path, "output_log_2026-01-02_03-04-05.txt").unwrap();

    assert_eq!(snapshot.location, "wrld_test:instancehidden");
    assert_eq!(snapshot.world_name, "Test World");
    assert_eq!(snapshot.created_at, convert_log_time_to_iso8601(&joining));
    assert_eq!(snapshot.file_name, "output_log_2026-01-02_03-04-05.txt");
}

#[test]
fn left_room_clears_the_current_location() {
    let dir = TestDir::new("location-left");
    let path = dir.write(
        "output_log_current.txt",
        &[
            recent_line(-3, "[Behaviour] Entering Room: Test World"),
            recent_line(-2, "[Behaviour] Joining wrld_test:instance"),
            recent_line(-1, "[Behaviour] OnLeftRoom"),
        ],
    );

    assert!(scan_log_file_location_snapshot(&path, "output_log_current.txt").is_none());
}

#[test]
fn friend_and_room_creation_join_lines_are_not_locations() {
    let dir = TestDir::new("location-exclusions");
    let path = dir.write(
        "output_log_current.txt",
        &[
            recent_line(-3, "[Behaviour] Entering Room: Test World"),
            recent_line(-2, "[Behaviour] Joining friend: Example User"),
            recent_line(
                -1,
                "[Behaviour] Joining or Creating Room: wrld_test:instance",
            ),
        ],
    );

    assert!(scan_log_file_location_snapshot(&path, "output_log_current.txt").is_none());
}

#[test]
fn future_location_accepts_61_minutes_but_rejects_later_entries() {
    let dir = TestDir::new("location-future");
    let rejected_path = dir.write(
        "output_log_rejected.txt",
        &[
            recent_line(0, "[Behaviour] Entering Room: Boundary World"),
            recent_line(62, "[Behaviour] Joining wrld_too_far:instance"),
        ],
    );
    assert!(scan_log_file_location_snapshot(&rejected_path, "output_log_rejected.txt").is_none());

    let accepted_path = dir.write(
        "output_log_accepted.txt",
        &[
            recent_line(0, "[Behaviour] Entering Room: Boundary World"),
            recent_line(61, "[Behaviour] Joining wrld_boundary:instance"),
        ],
    );

    let snapshot =
        scan_log_file_location_snapshot(&accepted_path, "output_log_accepted.txt").unwrap();

    assert_eq!(snapshot.location, "wrld_boundary:instance");
}

#[test]
fn vr_mode_uses_the_last_matching_event() {
    let dir = TestDir::new("vr-mode");
    let path = dir.write(
        "output_log_current.txt",
        &[
            recent_line(-3, "Initializing VRSDK."),
            recent_line(-2, "VRCApplication: OnApplicationQuit at 10"),
            recent_line(-1, "STEAMVR HMD Model: Test HMD"),
        ],
    );

    assert_eq!(scan_log_file_vr_mode(&path), Some(true));
}
