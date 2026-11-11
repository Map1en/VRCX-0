use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use super::*;

struct TestDir {
    path: PathBuf,
}

impl TestDir {
    fn new(name: &str) -> Self {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "vrcx-0-local-player-moderations-{name}-{}-{nonce}",
            std::process::id()
        ));
        std::fs::create_dir_all(&path).unwrap();
        Self { path }
    }

    fn moderation_path(&self, current_user_id: &str) -> PathBuf {
        self.path
            .join("LocalPlayerModerations")
            .join(format!("{current_user_id}-show-hide-user.vrcset"))
    }

    fn write_moderations(&self, current_user_id: &str, content: &str) {
        let path = self.moderation_path(current_user_id);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, content).unwrap();
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

fn read(path: &Path) -> String {
    std::fs::read_to_string(path).unwrap()
}

#[test]
fn missing_file_returns_empty_moderations() {
    let dir = TestDir::new("missing");

    let moderations = get_vrchat_moderations_from_root(&dir.path, "usr_current").unwrap();

    assert!(moderations.is_empty());
    assert!(!dir.path.join("LocalPlayerModerations").exists());
}

#[test]
fn empty_and_malformed_lines_are_ignored_and_duplicate_ids_use_the_last_value() {
    let dir = TestDir::new("parse");
    dir.write_moderations(
        "usr_current",
        "\nmalformed\nusr_invalid nope\nusr_duplicate 001\nusr_other -02 extra\nusr_duplicate 007\n",
    );

    let moderations = get_vrchat_moderations_from_root(&dir.path, "usr_current").unwrap();

    assert_eq!(moderations.len(), 2);
    assert_eq!(moderations.get("usr_duplicate"), Some(&7));
    assert_eq!(moderations.get("usr_other"), Some(&-2));
}

#[test]
fn update_preserves_other_users_and_unparsed_lines() {
    let dir = TestDir::new("update");
    dir.write_moderations(
        "usr_current",
        "usr_other 001\nmalformed\nusr_target 002\nusr_target 003",
    );

    let updated =
        set_vrchat_user_moderation_from_root(&dir.path, "usr_current", "usr_target", 4).unwrap();

    assert!(updated);
    assert_eq!(
        read(&dir.moderation_path("usr_current")),
        format!("usr_other 001\r\nmalformed\r\n{:<64}004\r\n", "usr_target")
    );
}

#[test]
fn zero_deletes_the_target_without_adding_a_replacement() {
    let dir = TestDir::new("delete");
    dir.write_moderations(
        "usr_current",
        "usr_target 001\nusr_other 002\nusr_target -01",
    );

    set_vrchat_user_moderation_from_root(&dir.path, "usr_current", "usr_target", 0).unwrap();

    assert_eq!(
        read(&dir.moderation_path("usr_current")),
        "usr_other 002\r\n"
    );
}

#[test]
fn new_moderation_uses_padded_key_three_digit_value_and_crlf() {
    let dir = TestDir::new("format");

    set_vrchat_user_moderation_from_root(&dir.path, "usr_current", "usr_target", 7).unwrap();

    let content = read(&dir.moderation_path("usr_current"));
    assert_eq!(content, format!("{:<64}007\r\n", "usr_target"));
    assert_eq!(content.len(), 69);
}

#[test]
fn resetting_one_avatar_preserves_other_vrchat_records_byte_for_byte() {
    let dir = TestDir::new("reset-preserves-records");
    let shown = format!("{:<64}005\r\n", "usr_11111111-1111-1111-1111-111111111111");
    let hidden = format!("{:<64}004\r\n", "usr_22222222-2222-2222-2222-222222222222");
    let target = "usr_33333333-3333-3333-3333-333333333333";
    dir.write_moderations(
        "usr_current",
        &format!("{shown}{target:<64}005\r\n{hidden}"),
    );

    set_vrchat_user_moderation_from_root(&dir.path, "usr_current", target, 0).unwrap();

    assert_eq!(
        read(&dir.moderation_path("usr_current")),
        format!("{shown}{hidden}")
    );
}

#[test]
fn resetting_the_last_avatar_leaves_an_empty_file() {
    let dir = TestDir::new("reset-last");
    dir.write_moderations("usr_current", &format!("{:<64}005\r\n", "usr_target"));

    set_vrchat_user_moderation_from_root(&dir.path, "usr_current", "usr_target", 0).unwrap();

    assert_eq!(read(&dir.moderation_path("usr_current")), "");
}

#[test]
fn current_user_id_cannot_traverse_outside_the_moderations_directory() {
    let dir = TestDir::new("traversal");

    for current_user_id in ["../escaped", "usr_current/", "usr_current\\"] {
        assert!(get_vrchat_moderations_from_root(&dir.path, current_user_id).is_err());
        assert!(
            set_vrchat_user_moderation_from_root(&dir.path, current_user_id, "usr_target", 1)
                .is_err()
        );
    }
    assert!(!dir.path.join("escaped-show-hide-user.vrcset").exists());
}

#[test]
fn moderation_type_must_fit_in_i16() {
    let dir = TestDir::new("range");

    assert!(set_vrchat_user_moderation_from_root(
        &dir.path,
        "usr_current",
        "usr_target",
        i32::from(i16::MAX) + 1
    )
    .is_err());
    assert!(set_vrchat_user_moderation_from_root(
        &dir.path,
        "usr_current",
        "usr_target",
        i32::from(i16::MIN) - 1
    )
    .is_err());
    assert!(!dir.path.join("LocalPlayerModerations").exists());
}
