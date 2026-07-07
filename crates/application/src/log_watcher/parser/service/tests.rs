use std::sync::atomic::{AtomicBool, AtomicU64};
use std::sync::{Arc, Mutex, RwLock};

use vrcx_0_core::log_watcher::parse_log_line_header;

use super::super::super::watcher::NoopLogLocationSnapshotScanner;
use super::*;

fn make_inner() -> Inner {
    Inner {
        log_list: RwLock::new(Vec::new()),
        event_buffer: Mutex::new(Vec::new()),
        compat_event_buffer: Mutex::new(Vec::new()),
        event_sink: None,
        log_dir: RwLock::new(None),
        till_date: Mutex::new(None),
        active: Mutex::new(false),
        reset_flag: Mutex::new(false),
        vrc_closed_gracefully: Mutex::new(false),
        game_running: Mutex::new(false),
        poll_without_process_monitor: Mutex::new(false),
        keep_polling_until: Mutex::new(None),
        location_snapshot_scanner: Arc::new(NoopLogLocationSnapshotScanner),
        started: AtomicBool::new(false),
        stop_requested: AtomicBool::new(false),
        generation: AtomicU64::new(0),
        handle: Mutex::new(None),
    }
}

fn content(line: &str) -> &str {
    parse_log_line_header(line).unwrap().1
}

fn parsed_payloads(inner: &Inner) -> Vec<Vec<String>> {
    inner
        .log_list
        .read()
        .unwrap()
        .iter()
        .map(|row| row[2..].to_vec())
        .collect()
}

fn payload(fields: &[&str]) -> Vec<String> {
    fields.iter().map(|field| (*field).to_string()).collect()
}

fn clear_payloads(inner: &Inner) {
    inner.log_list.write().unwrap().clear();
}

#[test]
fn parse_user_info_keeps_display_name_and_filters_user_id() {
    assert_eq!(
        presence::parse_user_info("Maple (usr_1234-5678~90:abc!?)"),
        ("Maple".into(), "usr_1234-5678~90:abc".into())
    );
    assert_eq!(
        presence::parse_user_info("Display Name Only"),
        ("Display Name Only".into(), String::new())
    );
}

#[test]
fn parses_location_with_recent_world_name_and_clears_session_state() {
    let inner = make_inner();
    let mut ctx = LogContext::new();
    ctx.last_audio_device = "Old Mic".into();
    ctx.video_errors.insert("previous video error".into());
    *inner.vrc_closed_gracefully.lock().unwrap() = true;

    let room_line = "2026.06.21 22:10:00 Log        -  [Behaviour] Entering Room: Midnight Rooftop";
    assert!(presence::parse_location(
        &inner,
        "output_log.txt",
        room_line,
        content(room_line),
        &mut ctx,
        false,
    ));
    let join_line =
        "2026.06.21 22:10:05 Log        -  [Behaviour] Joining wrld_abc:123~group(grp_1)";
    assert!(presence::parse_location(
        &inner,
        "output_log.txt",
        join_line,
        content(join_line),
        &mut ctx,
        false,
    ));

    assert_eq!(
        parsed_payloads(&inner),
        vec![payload(&[
            "location",
            "wrld_abc:123~group(grp_1)",
            "Midnight Rooftop",
        ])]
    );
    assert!(ctx.last_audio_device.is_empty());
    assert!(ctx.video_errors.is_empty());
    assert!(!*inner.vrc_closed_gracefully.lock().unwrap());
}

#[test]
fn parses_player_join_leave_resource_vote_and_sticker_lines() {
    let inner = make_inner();
    let cases = [
        "2026.06.21 22:11:00 Log        -  [Behaviour] OnPlayerJoined Maple (usr_join)",
        "2026.06.21 22:12:00 Log        -  [Behaviour] OnPlayerLeft Guest (usr_left)",
        "2026.06.21 22:13:00 Log        -  [Behaviour] Received executive message: A vote kick has been started.",
        "2026.06.21 22:14:00 Log        -  [StickersManager] User Sticker Fan (usr_sticker) spawned sticker inv_1234-abc~x:meta(extra)!",
    ];

    assert!(presence::parse_player_joined_or_left(
        &inner,
        "output_log.txt",
        cases[0],
        content(cases[0]),
        false,
    ));
    assert!(presence::parse_player_joined_or_left(
        &inner,
        "output_log.txt",
        cases[1],
        content(cases[1]),
        false,
    ));
    assert!(system::parse_vote_kick(
        &inner,
        "output_log.txt",
        cases[2],
        content(cases[2]),
        false,
    ));
    assert!(system::parse_sticker_spawn(
        &inner,
        "output_log.txt",
        cases[3],
        content(cases[3]),
        false,
    ));

    let local_line =
        "2026.06.21 22:15:00 Log        -  [Behaviour] Attempting to load String from URL 'http://127.0.0.1:22500/internal'";
    assert!(system::parse_string_download(
        &inner,
        "output_log.txt",
        local_line,
        content(local_line),
        false,
    ));
    let remote_line =
        "2026.06.21 22:16:00 Log        -  [Behaviour] Attempting to load String from URL 'https://example.test/data.json'";
    assert!(system::parse_string_download(
        &inner,
        "output_log.txt",
        remote_line,
        content(remote_line),
        false,
    ));

    assert_eq!(
        parsed_payloads(&inner),
        vec![
            payload(&["player-joined", "Maple", "usr_join"]),
            payload(&["player-left", "Guest", "usr_left"]),
            payload(&["event", "A vote kick has been started."]),
            payload(&[
                "sticker-spawn",
                "usr_sticker",
                "Sticker Fan",
                "inv_1234-abc~x:meta(extra)",
            ]),
            payload(&["resource-load-string", "https://example.test/data.json"]),
        ]
    );
}

#[test]
fn parses_location_destination_portal_and_notification_lines() {
    let inner = make_inner();
    let mut ctx = LogContext::new();
    let destination_line = "2026.06.21 22:17:00 Log        -  [Behaviour] Destination fetching: wrld_dest:456~group(grp_1)";
    let left_room_line = "2026.06.21 22:17:10 Log        -  [Behaviour] OnLeftRoom";
    let portal_line =
        "2026.06.21 22:17:20 Log        -  [Behaviour] Instantiated a (Clone [123] Portals/PortalInternalDynamic)";
    let notification_line =
        "2026.06.21 22:17:30 Log        -  [API] Received Notification: <{\"type\":\"invite\"}> received at 2026-06-21T22:17:30Z";

    assert!(presence::parse_location_destination(
        &inner,
        "output_log.txt",
        destination_line,
        content(destination_line),
        &mut ctx,
        false,
    ));
    assert!(presence::parse_location_destination(
        &inner,
        "output_log.txt",
        left_room_line,
        content(left_room_line),
        &mut ctx,
        false,
    ));
    assert!(presence::parse_portal_spawn(
        &inner,
        "output_log.txt",
        portal_line,
        false,
    ));
    assert!(presence::parse_notification(
        &inner,
        "output_log.txt",
        notification_line,
        content(notification_line),
        false,
    ));

    assert_eq!(
        parsed_payloads(&inner),
        vec![
            payload(&["location-destination", "wrld_dest:456~group(grp_1)"]),
            payload(&["portal-spawn"]),
            payload(&["notification", "{\"type\":\"invite\"}"]),
        ]
    );
    assert!(ctx.location_destination.is_empty());
}

#[test]
fn parses_runtime_mode_quit_shader_and_moderation_events() {
    let inner = make_inner();
    let mut ctx = LogContext::new();
    let shader_line = "2026.06.21 22:18:00 Error      -  Maximum number (384) of shader global keywords exceeded, keyword FOO ignored.";
    let quit_line =
        "2026.06.21 22:18:10 Log        -  VRCApplication: OnApplicationQuit at 123.456";
    let openvr_line = "2026.06.21 22:18:20 Log        -  Initializing VRSDK. SteamVR";
    let desktop_line = "2026.06.21 22:18:30 Log        -  VR Disabled";
    let reset_line = "2026.06.21 22:18:40 Log        -  [ModerationManager] This instance will be reset in 5 minutes.";
    let vote_init_line = "2026.06.21 22:18:50 Log        -  [ModerationManager] A vote kick has been initiated against Maple.";
    let vote_success_line =
        "2026.06.21 22:19:00 Log        -  [ModerationManager] Vote to kick Maple succeeded.";

    assert!(system::parse_shader_keywords_limit(
        &inner,
        "output_log.txt",
        shader_line,
        content(shader_line),
        &mut ctx,
        false,
    ));
    assert!(system::parse_shader_keywords_limit(
        &inner,
        "output_log.txt",
        shader_line,
        content(shader_line),
        &mut ctx,
        false,
    ));
    assert!(system::parse_application_quit(
        &inner,
        "output_log.txt",
        quit_line,
        content(quit_line),
        &mut ctx,
        false,
    ));
    assert!(system::parse_openvr_init(
        &inner,
        "output_log.txt",
        openvr_line,
        content(openvr_line),
        false,
    ));
    assert!(system::parse_desktop_mode(
        &inner,
        "output_log.txt",
        desktop_line,
        content(desktop_line),
        false,
    ));
    assert!(system::parse_instance_reset(
        &inner,
        "output_log.txt",
        reset_line,
        content(reset_line),
        false,
    ));
    assert!(system::parse_vote_kick_init(
        &inner,
        "output_log.txt",
        vote_init_line,
        content(vote_init_line),
        false,
    ));
    assert!(system::parse_vote_kick_success(
        &inner,
        "output_log.txt",
        vote_success_line,
        content(vote_success_line),
        false,
    ));

    assert_eq!(
        parsed_payloads(&inner),
        vec![
            payload(&["event", "Shader Keyword Limit has been reached"]),
            payload(&["vrc-quit"]),
            payload(&["openvr-init"]),
            payload(&["desktop-mode"]),
            payload(&["event", "This instance will be reset in 5 minutes."]),
            payload(&["event", "A vote kick has been initiated against Maple."]),
            payload(&["event", "Vote to kick Maple succeeded."]),
        ]
    );
    assert!(ctx.shader_keywords_limit_reached);
    assert!(*inner.vrc_closed_gracefully.lock().unwrap());
}

#[test]
fn parses_download_failure_and_deduplicated_video_errors() {
    let inner = make_inner();
    let mut ctx = LogContext::new();
    let image_line =
        "2026.06.21 22:20:00 Log        -  [Behaviour] Attempting to load image from URL 'https://example.test/image.png'";
    let local_image_line =
        "2026.06.21 22:20:05 Log        -  [Behaviour] Attempting to load image from URL 'http://localhost:22500/thumbnail.png'";
    let failed_join_line =
        "2026.06.21 22:20:10 Log        -  [Behaviour] Failed to join instance wrld_fail:123";
    let osc_line = "2026.06.21 22:20:20 Error      -  Could not Start OSC: port already in use";
    let untrusted_line =
        "2026.06.21 22:20:30 Warning    -  Attempted to play an untrusted URL https://bad.example/video";

    assert!(system::parse_image_download(
        &inner,
        "output_log.txt",
        image_line,
        content(image_line),
        false,
    ));
    assert!(system::parse_image_download(
        &inner,
        "output_log.txt",
        local_image_line,
        content(local_image_line),
        false,
    ));
    assert!(system::parse_failed_to_join(
        &inner,
        "output_log.txt",
        failed_join_line,
        content(failed_join_line),
        false,
    ));
    assert!(system::parse_osc_failed(
        &inner,
        "output_log.txt",
        osc_line,
        content(osc_line),
        false,
    ));
    assert!(system::parse_untrusted_url(
        &inner,
        "output_log.txt",
        untrusted_line,
        content(untrusted_line),
        &mut ctx,
        false,
    ));
    assert!(system::parse_untrusted_url(
        &inner,
        "output_log.txt",
        untrusted_line,
        content(untrusted_line),
        &mut ctx,
        false,
    ));

    assert_eq!(
        parsed_payloads(&inner),
        vec![
            payload(&["resource-load-image", "https://example.test/image.png"]),
            payload(&["event", "Failed to join instance wrld_fail:123"]),
            payload(&[
                "event",
                "VRChat couldn't start OSC server, \"Could not Start OSC: port already in use\"",
            ]),
            payload(&[
                "event",
                "VideoError: Attempted to play an untrusted URL https://bad.example/video",
            ]),
        ]
    );
    assert_eq!(ctx.video_errors.len(), 1);
}

#[test]
fn parses_audio_device_change_only_after_configuration_change() {
    let inner = make_inner();
    let mut ctx = LogContext::new();
    let initial_line =
        "2026.06.21 22:21:00 Log        -  [Always] uSpeak: SetInputDevice 0 (UnityEngine.Microphone) 'Index Mic'";
    let config_line =
        "2026.06.21 22:21:10 Log        -  [Always] uSpeak: OnAudioConfigurationChanged";
    let unchanged_line =
        "2026.06.21 22:21:20 Log        -  [Always] uSpeak: SetInputDevice 0 (UnityEngine.Microphone) 'Index Mic'";
    let changed_line =
        "2026.06.21 22:21:30 Log        -  [Always] uSpeak: SetInputDevice 0 (UnityEngine.Microphone) 'Quest Mic'";

    assert!(system::parse_audio_config(
        &inner,
        "output_log.txt",
        initial_line,
        content(initial_line),
        &mut ctx,
        false,
    ));
    assert!(system::parse_audio_config(
        &inner,
        "output_log.txt",
        config_line,
        content(config_line),
        &mut ctx,
        false,
    ));
    assert!(system::parse_audio_config(
        &inner,
        "output_log.txt",
        unchanged_line,
        content(unchanged_line),
        &mut ctx,
        false,
    ));
    clear_payloads(&inner);
    assert!(system::parse_audio_config(
        &inner,
        "output_log.txt",
        config_line,
        content(config_line),
        &mut ctx,
        false,
    ));
    assert!(system::parse_audio_config(
        &inner,
        "output_log.txt",
        changed_line,
        content(changed_line),
        &mut ctx,
        false,
    ));

    assert_eq!(
        parsed_payloads(&inner),
        vec![payload(&[
            "event",
            "Audio device changed, mic set to 'Quest Mic'",
        ])]
    );
    assert_eq!(ctx.last_audio_device, "Quest Mic");
    assert!(!ctx.audio_device_changed);
}

#[test]
fn parses_udon_exception_lines_without_log_header_requirements() {
    let inner = make_inner();
    let pypy_line = "[PyPyDance] Udon exception while loading media queue";
    let vm_line = "2026.06.21 22:22:00 Error      -  Exception details ---> VRC.Udon.VM.UdonVMException: program counter out of range";

    assert!(system::parse_udon_exception(
        &inner,
        "output_log.txt",
        pypy_line,
        false,
    ));
    assert!(system::parse_udon_exception(
        &inner,
        "output_log.txt",
        vm_line,
        false,
    ));

    assert_eq!(
        parsed_payloads(&inner),
        vec![
            payload(&[
                "udon-exception",
                "[PyPyDance] Udon exception while loading media queue",
            ]),
            payload(&[
                "udon-exception",
                " ---> VRC.Udon.VM.UdonVMException: program counter out of range",
            ]),
        ]
    );
}
