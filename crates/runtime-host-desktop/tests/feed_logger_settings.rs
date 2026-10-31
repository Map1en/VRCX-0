mod support;

use support::{desktop, desktop_with_saved_settings, SAVED_RECORDER};
use vrcx_0_runtime_host_desktop::feed_logger::{FeedLoggerError, FeedLoggerProbe, SettingsCheck};

#[tokio::test]
async fn a_recorder_that_cannot_be_reached_is_reported_and_nothing_is_saved() {
    let (_dir, desktop) = desktop();

    let check = desktop
        .verify_settings("127.0.0.1:1".into(), "password123".into())
        .await;

    assert!(matches!(
        check,
        SettingsCheck::Unhealthy(FeedLoggerProbe::Unreachable { .. })
    ));
    assert_eq!(desktop.settings_view().unwrap().address, None);
    assert!(desktop.ensure_backup_can_turn_off(false).is_ok());
}

#[tokio::test]
async fn an_address_that_is_not_a_web_address_is_refused_and_nothing_is_saved() {
    let (_dir, desktop) = desktop();

    let check = desktop
        .verify_settings("ftp://recorder".into(), "password123".into())
        .await;

    assert!(matches!(
        check,
        SettingsCheck::Invalid(FeedLoggerError::Client(_))
    ));
    assert_eq!(desktop.settings_view().unwrap().address, None);
}

#[test]
fn without_a_recorder_a_reconnect_always_writes_what_changed() {
    let (_dir, desktop) = desktop();

    assert!(!desktop.recorder_may_be_recording());
}

#[test]
fn with_a_recorder_that_vrcx0_is_not_linked_to_a_reconnect_is_left_to_the_backfill() {
    let (_dir, desktop) = desktop_with_saved_settings(Some(SAVED_RECORDER));

    assert!(desktop.recorder_may_be_recording());
}

#[test]
fn automatic_backups_cannot_be_turned_off_while_a_recorder_is_set_up() {
    let (_dir, desktop) = desktop_with_saved_settings(Some(SAVED_RECORDER));

    assert!(matches!(
        desktop.ensure_backup_can_turn_off(false),
        Err(FeedLoggerError::BackupRequired)
    ));
    assert!(desktop.ensure_backup_can_turn_off(true).is_ok());

    desktop.clear_settings().unwrap();

    assert!(desktop.ensure_backup_can_turn_off(false).is_ok());
    assert!(!desktop.recorder_may_be_recording());
}

#[test]
fn a_recorder_setting_this_machine_can_no_longer_decrypt_counts_as_no_recorder() {
    vrcx_0_persistence::secrets::init_secrets(Some([7; 32]), false);
    let (_dir, desktop) = desktop_with_saved_settings(Some(
        r#"{"address":"http://127.0.0.1:8787","password":"enc1:sealed-by-another-machine"}"#,
    ));

    assert!(!desktop.recorder_may_be_recording());
    assert_eq!(desktop.settings_view().unwrap().address, None);
}
