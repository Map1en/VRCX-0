mod support;

use support::feed_logger_desktop;
use vrcx_0_persistence::secrets;

#[test]
fn a_recorder_password_sealed_to_this_machine_is_resaved_so_any_machine_can_read_it() {
    secrets::init_secrets(Some([7; 32]), true);
    let sealed = secrets::seal_secret("password123");
    assert!(secrets::is_sealed_secret(&sealed));
    let desktop = feed_logger_desktop(Some(
        &serde_json::json!({
            "address": "http://192.168.1.10:8787",
            "password": sealed,
        })
        .to_string(),
    ));

    assert_eq!(
        desktop.runtime.settings_view().unwrap().address.as_deref(),
        Some("http://192.168.1.10:8787")
    );
    let resaved = desktop.config.get_raw("feedLogger").unwrap().unwrap();
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&resaved).unwrap()["password"],
        "password123"
    );
}
