use chrono::Local;
use vrcx_0_application_activity::{
    ActivityActorRelation, ActivityCategory, ActivityContent, ActivityEntry, ActivitySnapshot,
    ActivityText,
};
use vrcx_0_contracts::activity::ActivityKind;

use super::config::VrOverlayRuntimeConfig;
use super::surfaces::main::HmdToastView;
use super::{WristOverlayFrameInput, WristRuntimeFooter};

const TEST_ENTRY_SOURCE_ID: &str = "vrcx-0-overlay-test";
const TEST_ENTRY_TITLE: &str = "VRCX-0";
const TEST_ENTRY_BODY: &str = "Overlay test";

pub(crate) fn test_overlay_entry() -> ActivityEntry {
    ActivityEntry {
        sequence: 0,
        source_id: TEST_ENTRY_SOURCE_ID.to_string(),
        kind: ActivityKind::Event,
        category: ActivityCategory::CurrentInstance,
        created_at: Local::now().to_rfc3339(),
        actor_user_id: String::new(),
        actor_display_name: TEST_ENTRY_TITLE.to_string(),
        content: ActivityContent {
            title: ActivityText::literal(TEST_ENTRY_TITLE),
            body: ActivityText::literal(TEST_ENTRY_BODY),
            ..ActivityContent::default()
        },
        actor_relation: ActivityActorRelation::None,
    }
}

pub(crate) fn test_wrist_frame_input(
    config: VrOverlayRuntimeConfig,
    devices: Vec<vrcx_0_vr_overlay_backend::VrDeviceSnapshot>,
    local_time: String,
    captured_at_ms: i64,
) -> WristOverlayFrameInput {
    WristOverlayFrameInput {
        activity: ActivitySnapshot {
            entries: vec![test_overlay_entry()],
        },
        devices,
        now_playing: None,
        live_now_playing: false,
        footer: WristRuntimeFooter {
            player_count: 0,
            instance_duration: String::new(),
            online_duration: String::new(),
            local_time,
        },
        options: config.render,
        locale: config.locale.as_str().to_string(),
        show_instance_id_in_location: config.show_instance_id_in_location,
        captured_at_ms,
    }
}

pub(crate) fn test_hmd_toast_views() -> Vec<HmdToastView> {
    vec![HmdToastView {
        entry: test_overlay_entry(),
        avatar: None,
        show_avatar: false,
        merge_count: 1,
    }]
}
