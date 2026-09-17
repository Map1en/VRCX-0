use chrono::Local;
use vrcx_0_application_activity::{
    OverlayActivityActorRelation, OverlayActivityCategory, OverlayActivityContent,
    OverlayActivityEntry, OverlayActivitySnapshot, OverlayActivityText,
};

use super::runtime::VrOverlayRuntimeConfig;
use super::surfaces::main::HmdToastView;
use super::{WristOverlayFrameInput, WristRuntimeFooter};

const TEST_ENTRY_SOURCE_ID: &str = "vrcx-0-overlay-test";
const TEST_ENTRY_ACTIVITY_TYPE: &str = "OverlayTest";
const TEST_ENTRY_TITLE: &str = "VRCX-0";
const TEST_ENTRY_BODY: &str = "Overlay test";

pub(crate) fn test_overlay_entry() -> OverlayActivityEntry {
    OverlayActivityEntry {
        sequence: 0,
        source_id: TEST_ENTRY_SOURCE_ID.to_string(),
        activity_type: TEST_ENTRY_ACTIVITY_TYPE.to_string(),
        category: OverlayActivityCategory::CurrentInstance,
        created_at: Local::now().to_rfc3339(),
        actor_user_id: String::new(),
        actor_display_name: TEST_ENTRY_TITLE.to_string(),
        content: OverlayActivityContent {
            title: OverlayActivityText::literal(TEST_ENTRY_TITLE),
            body: OverlayActivityText::literal(TEST_ENTRY_BODY),
            ..OverlayActivityContent::default()
        },
        actor_relation: OverlayActivityActorRelation::None,
        payload: Default::default(),
    }
}

pub(crate) fn test_wrist_frame_input(
    config: VrOverlayRuntimeConfig,
    devices: Vec<vrcx_0_host_desktop::vr_overlay::VrDeviceSnapshot>,
    local_time: String,
    captured_at_ms: i64,
) -> WristOverlayFrameInput {
    WristOverlayFrameInput {
        activity: OverlayActivitySnapshot {
            entries: vec![test_overlay_entry()],
        },
        devices,
        now_playing: None,
        footer: WristRuntimeFooter {
            player_count: 0,
            instance_duration: String::new(),
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
