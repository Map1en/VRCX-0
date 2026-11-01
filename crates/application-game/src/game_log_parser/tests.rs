use vrcx_0_core::game_log_parser::{parse_log_line_header, GameLogEvent};

use super::context::LogContext;
use super::reader::{parse_log, LogReader};
use super::sink::GameLogParseSink;
use super::{media, presence, system};

#[derive(Default)]
struct RecordingParseSink {
    rows: Vec<Vec<String>>,
    vrc_closed_gracefully: bool,
}

impl GameLogParseSink for RecordingParseSink {
    fn push(&mut self, event: GameLogEvent) {
        self.rows.push(event.to_compat_row());
    }

    fn set_vrc_closed_gracefully(&mut self, value: bool) {
        self.vrc_closed_gracefully = value;
    }
}

impl RecordingParseSink {
    fn payloads(&self) -> Vec<Vec<String>> {
        self.rows.iter().map(|row| row[2..].to_vec()).collect()
    }
}

const FILE: &str = "output_log.txt";

fn content(line: &str) -> &str {
    parse_log_line_header(line).unwrap().1
}

fn payload(fields: &[&str]) -> Vec<String> {
    fields.iter().map(|field| (*field).to_string()).collect()
}

#[test]
fn incremental_log_parsing_reuses_the_reader_buffer() {
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let path = std::env::temp_dir().join(format!(
        "vrcx-0-game-log-reader-{}-{nonce}.txt",
        std::process::id()
    ));
    std::fs::write(&path, "2020.01.01 00:00:00 Log        -  VR Disabled\n").unwrap();
    let mut sink = RecordingParseSink::default();
    let mut ctx = LogContext::new();
    let mut reader = LogReader::new();

    assert!(parse_log(
        &mut reader,
        &mut sink,
        &path,
        FILE,
        &mut ctx,
        chrono::NaiveDateTime::MIN,
    ));
    use std::io::Write as _;
    writeln!(
        std::fs::OpenOptions::new()
            .append(true)
            .open(&path)
            .unwrap(),
        "2020.01.01 00:00:01 Log        -  Initializing VRSDK."
    )
    .unwrap();
    assert!(parse_log(
        &mut reader,
        &mut sink,
        &path,
        FILE,
        &mut ctx,
        chrono::NaiveDateTime::MIN,
    ));

    assert_eq!(reader.buffer_initialization_count(), 1);
    assert!(!reader.has_open_file());
    assert_eq!(sink.rows.len(), 2);
    drop(reader);
    std::fs::remove_file(path).unwrap();
}

#[test]
fn remembers_the_authenticated_game_account_even_before_the_cutoff() {
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let path = std::env::temp_dir().join(format!(
        "vrcx-0-game-log-auth-{}-{nonce}.txt",
        std::process::id()
    ));
    std::fs::write(
        &path,
        "2020.01.01 00:00:00 Debug      -  User Authenticated: Maple (usr_1)\n\
         2020.01.01 00:00:05 Log        -  VR Disabled\n",
    )
    .unwrap();
    let mut sink = RecordingParseSink::default();
    let mut ctx = LogContext::new();
    let mut reader = LogReader::new();
    let cutoff = chrono::NaiveDate::from_ymd_opt(2020, 1, 1)
        .unwrap()
        .and_hms_opt(0, 0, 1)
        .unwrap();

    parse_log(&mut reader, &mut sink, &path, FILE, &mut ctx, cutoff);

    assert_eq!(
        ctx.authenticated_user,
        Some(super::GameLogAuthenticatedUser {
            user_id: "usr_1".into(),
            display_name: "Maple".into(),
        })
    );
    assert_eq!(sink.rows.len(), 1);
    drop(reader);
    std::fs::remove_file(path).unwrap();
}

#[test]
fn parse_user_info_keeps_display_name_and_filters_user_id() {
    let parsed = presence::parse_user_info("Maple (usr_1234-5678~90:abc!?)");
    assert_eq!(parsed.display_name, "Maple");
    assert_eq!(parsed.user_id, "usr_1234-5678~90:abc");

    let parsed = presence::parse_user_info("Display Name Only");
    assert_eq!(parsed.display_name, "Display Name Only");
    assert_eq!(parsed.user_id, String::new());
}

#[test]
fn parses_location_with_recent_world_name_and_clears_session_state() {
    let mut sink = RecordingParseSink {
        vrc_closed_gracefully: true,
        ..RecordingParseSink::default()
    };
    let mut ctx = LogContext::new();
    ctx.last_audio_device = "Old Mic".into();
    ctx.video_errors.insert("previous video error".into());

    let room_line = "2026.06.21 22:10:00 Log        -  [Behaviour] Entering Room: Midnight Rooftop";
    assert!(presence::parse_location(
        &mut sink,
        FILE,
        room_line,
        content(room_line),
        &mut ctx,
    ));
    let join_line =
        "2026.06.21 22:10:05 Log        -  [Behaviour] Joining wrld_abc:123~group(grp_1)";
    assert!(presence::parse_location(
        &mut sink,
        FILE,
        join_line,
        content(join_line),
        &mut ctx,
    ));

    assert_eq!(
        sink.payloads(),
        vec![payload(&[
            "location",
            "wrld_abc:123~group(grp_1)",
            "Midnight Rooftop",
        ])]
    );
    assert!(ctx.last_audio_device.is_empty());
    assert!(ctx.video_errors.is_empty());
    assert!(!sink.vrc_closed_gracefully);
}

#[test]
fn parses_player_join_leave_resource_vote_and_sticker_lines() {
    let mut sink = RecordingParseSink::default();
    let cases = [
        "2026.06.21 22:11:00 Log        -  [Behaviour] OnPlayerJoined Maple (usr_join)",
        "2026.06.21 22:12:00 Log        -  [Behaviour] OnPlayerLeft Guest (usr_left)",
        "2026.06.21 22:13:00 Log        -  [Behaviour] Received executive message: A vote kick has been started.",
        "2026.06.21 22:14:00 Log        -  [StickersManager] User usr_sticker (Sticker Fan) spawned sticker inv_1234-abc~x:meta(extra)!",
    ];

    assert!(presence::parse_player_joined_or_left(
        &mut sink,
        FILE,
        cases[0],
        content(cases[0]),
    ));
    assert!(presence::parse_player_joined_or_left(
        &mut sink,
        FILE,
        cases[1],
        content(cases[1]),
    ));
    assert!(system::parse_vote_kick(
        &mut sink,
        FILE,
        cases[2],
        content(cases[2]),
    ));
    assert!(system::parse_sticker_spawn(
        &mut sink,
        FILE,
        cases[3],
        content(cases[3]),
    ));

    let local_line =
        "2026.06.21 22:15:00 Log        -  [Behaviour] Attempting to load String from URL 'http://127.0.0.1:22500/internal'";
    assert!(system::parse_string_download(
        &mut sink,
        FILE,
        local_line,
        content(local_line),
    ));
    let remote_line =
        "2026.06.21 22:16:00 Log        -  [Behaviour] Attempting to load String from URL 'https://example.test/data.json'";
    assert!(system::parse_string_download(
        &mut sink,
        FILE,
        remote_line,
        content(remote_line),
    ));

    assert_eq!(
        sink.payloads(),
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
    let mut sink = RecordingParseSink::default();
    let mut ctx = LogContext::new();
    let destination_line = "2026.06.21 22:17:00 Log        -  [Behaviour] Destination fetching: wrld_dest:456~group(grp_1)";
    let left_room_line = "2026.06.21 22:17:10 Log        -  [Behaviour] OnLeftRoom";
    let portal_line =
        "2026.06.21 22:17:20 Log        -  [Behaviour] Instantiated a (Clone [123] Portals/PortalInternalDynamic)";
    let notification_line =
        "2026.06.21 22:17:30 Log        -  [API] Received Notification: <{\"type\":\"invite\"}> received at 2026-06-21T22:17:30Z";

    assert!(presence::parse_location_destination(
        &mut sink,
        FILE,
        destination_line,
        content(destination_line),
        &mut ctx,
    ));
    assert!(presence::parse_location_destination(
        &mut sink,
        FILE,
        left_room_line,
        content(left_room_line),
        &mut ctx,
    ));
    assert!(presence::parse_portal_spawn(&mut sink, FILE, portal_line,));
    assert!(presence::parse_notification(
        &mut sink,
        FILE,
        notification_line,
        content(notification_line),
    ));

    assert_eq!(
        sink.payloads(),
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
    let mut sink = RecordingParseSink::default();
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
        &mut sink,
        FILE,
        shader_line,
        content(shader_line),
        &mut ctx,
    ));
    assert!(system::parse_shader_keywords_limit(
        &mut sink,
        FILE,
        shader_line,
        content(shader_line),
        &mut ctx,
    ));
    assert!(system::parse_application_quit(
        &mut sink,
        FILE,
        quit_line,
        content(quit_line),
    ));
    assert!(system::parse_openvr_init(
        &mut sink,
        FILE,
        openvr_line,
        content(openvr_line),
    ));
    assert!(system::parse_desktop_mode(
        &mut sink,
        FILE,
        desktop_line,
        content(desktop_line),
    ));
    assert!(system::parse_instance_reset(
        &mut sink,
        FILE,
        reset_line,
        content(reset_line),
    ));
    assert!(system::parse_vote_kick_init(
        &mut sink,
        FILE,
        vote_init_line,
        content(vote_init_line),
    ));
    assert!(system::parse_vote_kick_success(
        &mut sink,
        FILE,
        vote_success_line,
        content(vote_success_line),
    ));

    assert_eq!(
        sink.payloads(),
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
    assert!(sink.vrc_closed_gracefully);
}

#[test]
fn parses_download_failure_and_deduplicated_video_errors() {
    let mut sink = RecordingParseSink::default();
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
        &mut sink,
        FILE,
        image_line,
        content(image_line),
    ));
    assert!(system::parse_image_download(
        &mut sink,
        FILE,
        local_image_line,
        content(local_image_line),
    ));
    assert!(system::parse_failed_to_join(
        &mut sink,
        FILE,
        failed_join_line,
        content(failed_join_line),
    ));
    assert!(system::parse_osc_failed(
        &mut sink,
        FILE,
        osc_line,
        content(osc_line),
    ));
    assert!(system::parse_untrusted_url(
        &mut sink,
        FILE,
        untrusted_line,
        content(untrusted_line),
        &mut ctx,
    ));
    assert!(system::parse_untrusted_url(
        &mut sink,
        FILE,
        untrusted_line,
        content(untrusted_line),
        &mut ctx,
    ));

    assert_eq!(
        sink.payloads(),
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
    let mut sink = RecordingParseSink::default();
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
        &mut sink,
        FILE,
        initial_line,
        content(initial_line),
        &mut ctx,
    ));
    assert!(system::parse_audio_config(
        &mut sink,
        FILE,
        config_line,
        content(config_line),
        &mut ctx,
    ));
    assert!(system::parse_audio_config(
        &mut sink,
        FILE,
        unchanged_line,
        content(unchanged_line),
        &mut ctx,
    ));
    sink.rows.clear();
    assert!(system::parse_audio_config(
        &mut sink,
        FILE,
        config_line,
        content(config_line),
        &mut ctx,
    ));
    assert!(system::parse_audio_config(
        &mut sink,
        FILE,
        changed_line,
        content(changed_line),
        &mut ctx,
    ));

    assert_eq!(
        sink.payloads(),
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
    let mut sink = RecordingParseSink::default();
    let pypy_line = "[PyPyDance] Udon exception while loading media queue";
    let vm_line = "2026.06.21 22:22:00 Error      -  Exception details ---> VRC.Udon.VM.UdonVMException: program counter out of range";

    assert!(system::parse_udon_exception(&mut sink, FILE, pypy_line,));
    assert!(system::parse_udon_exception(&mut sink, FILE, vm_line,));

    assert_eq!(
        sink.payloads(),
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

#[test]
fn parses_avatar_api_join_blocked_pedestal_vrcx_and_screenshot_events() {
    let mut sink = RecordingParseSink::default();
    let api_line =
        "2026.06.21 23:00:00 Log        -  [API] [123] Sending Get request to https://api.vrchat.cloud/api/1/users/usr_test";
    let avatar_line =
        "2026.06.21 23:00:10 Log        -  [Behaviour] Switching Maple to avatar Test Avatar";
    let blocked_line = "2026.06.21 23:00:20 Log        -  [Behaviour] Master is not sending any events! Moving to a new instance.";
    let pedestal_line =
        "2026.06.21 23:00:30 Log        -  [Network Processing] RPC invoked SwitchAvatar on AvatarPedestal for Pedestal User";
    let vrcx_line =
        "2026.06.21 23:00:40 Log        -  [VRCX] VideoPlay(PyPyDance) \"https://example.test\",0,10,\"Song\"";
    let screenshot_line =
        "2026.06.21 23:00:50 Log        -  [VRC Camera] Took screenshot to: C:\\Users\\about\\Pictures\\VRChat\\shot.png";

    assert!(media::parse_api_request(
        &mut sink,
        FILE,
        api_line,
        content(api_line),
    ));
    assert!(media::parse_avatar_change(
        &mut sink,
        FILE,
        avatar_line,
        content(avatar_line),
    ));
    assert!(media::parse_join_blocked(
        &mut sink,
        FILE,
        blocked_line,
        content(blocked_line),
    ));
    assert!(media::parse_avatar_pedestal_change(
        &mut sink,
        FILE,
        pedestal_line,
        content(pedestal_line),
    ));
    assert!(media::parse_world_vrcx(
        &mut sink,
        FILE,
        vrcx_line,
        content(vrcx_line),
    ));
    assert!(media::parse_screenshot(
        &mut sink,
        FILE,
        screenshot_line,
        content(screenshot_line),
    ));

    assert_eq!(
        sink.payloads(),
        vec![
            payload(&[
                "api-request",
                "https://api.vrchat.cloud/api/1/users/usr_test",
            ]),
            payload(&["avatar-change", "Maple", "Test Avatar"]),
            payload(&["event", "Joining instance blocked by master"]),
            payload(&["event", "Pedestal User changed avatar pedestal"]),
            payload(&[
                "vrcx",
                "VideoPlay(PyPyDance) \"https://example.test\",0,10,\"Song\"",
            ]),
            payload(&["screenshot", "C:\\Users\\about\\Pictures\\VRChat\\shot.png",]),
        ]
    );
}

#[test]
fn parses_video_play_sources_and_sync_events() {
    let mut sink = RecordingParseSink::default();
    let video_line =
        "2026.06.21 23:01:00 Log        -  [Video Playback] Attempting to resolve URL 'https://example.test/video.mp4'";
    let avpro_line =
        "2026.06.21 23:01:10 Log        -  [Video Playback] Resolving URL 'https://youtu.be/video'";
    let sdk2_line =
        "2026.06.21 23:01:20 Log        -  User Maple added URL https://example.test/sdk2";
    let usharp_line =
        "2026.06.21 23:01:30 Log        -  [USharpVideo] Started video load for URL: https://example.test/usharp, requested by Udon User";
    let sync_line = "2026.06.21 23:01:40 Log        -  [USharpVideo] Syncing video to 12.34";

    assert!(media::parse_video_change(
        &mut sink,
        FILE,
        video_line,
        content(video_line),
    ));
    assert!(media::parse_avpro_video_change(
        &mut sink,
        FILE,
        avpro_line,
        content(avpro_line),
    ));
    assert!(media::parse_sdk2_video_play(
        &mut sink,
        FILE,
        sdk2_line,
        content(sdk2_line),
    ));
    assert!(media::parse_usharp_video_play(
        &mut sink,
        FILE,
        usharp_line,
        content(usharp_line),
    ));
    assert!(media::parse_usharp_video_sync(
        &mut sink,
        FILE,
        sync_line,
        content(sync_line),
    ));

    assert_eq!(
        sink.payloads(),
        vec![
            payload(&["video-play", "https://example.test/video.mp4", ""]),
            payload(&["video-play", "https://youtu.be/video", ""]),
            payload(&["video-play", "https://example.test/sdk2", "Maple"]),
            payload(&["video-play", "https://example.test/usharp", "Udon User"]),
            payload(&["video-sync", "12.34"]),
        ]
    );
}

#[test]
fn deduplicates_video_errors_and_keeps_the_original_message() {
    let mut sink = RecordingParseSink::default();
    let mut ctx = LogContext::new();
    let playback_line =
        "2026.06.21 23:02:00 Error      -  [Video Playback] ERROR: Sign in to confirm you are not a bot";
    let avpro_line = "2026.06.21 23:02:10 Error      -  [AVProVideo] Error: HTTP 403 Forbidden";

    assert!(media::parse_video_error(
        &mut sink,
        FILE,
        playback_line,
        content(playback_line),
        &mut ctx,
    ));
    assert!(media::parse_video_error(
        &mut sink,
        FILE,
        playback_line,
        content(playback_line),
        &mut ctx,
    ));
    assert!(media::parse_video_error(
        &mut sink,
        FILE,
        avpro_line,
        content(avpro_line),
        &mut ctx,
    ));

    assert_eq!(
        sink.payloads(),
        vec![
            payload(&["event", "VideoError: Sign in to confirm you are not a bot",]),
            payload(&["event", "VideoError: HTTP 403 Forbidden"]),
        ]
    );
    assert_eq!(ctx.video_errors.len(), 2);
}

#[test]
fn partial_last_line_is_not_consumed_before_it_is_complete() {
    use std::io::Write;
    let path = std::env::temp_dir().join(format!("vrcx-partial-{}.txt", std::process::id()));
    std::fs::write(
        &path,
        "2020.01.01 00:00:00 Log        -  [Behaviour] OnPlayerJoined Par",
    )
    .unwrap();
    let mut reader = LogReader::new();
    let mut sink = RecordingParseSink::default();
    let mut context = LogContext::new();
    parse_log(
        &mut reader,
        &mut sink,
        &path,
        FILE,
        &mut context,
        chrono::NaiveDateTime::MIN,
    );
    let consumed = context.position;
    writeln!(
        std::fs::OpenOptions::new()
            .append(true)
            .open(&path)
            .unwrap(),
        "tial (usr_partial)"
    )
    .unwrap();
    parse_log(
        &mut reader,
        &mut sink,
        &path,
        FILE,
        &mut context,
        chrono::NaiveDateTime::MIN,
    );
    std::fs::remove_file(path).unwrap();
    assert_eq!(consumed, 0);
    assert_eq!(
        sink.payloads(),
        vec![payload(&["player-joined", "Partial", "usr_partial"])]
    );
}

#[test]
fn incomplete_player_markers_do_not_panic_or_create_players() {
    let mut sink = RecordingParseSink::default();
    for marker in ["OnPlayerJoined", "OnPlayerLeft"] {
        let line = format!("2020.01.01 00:00:00 Log        -  [Behaviour] {marker}");
        presence::parse_player_joined_or_left(&mut sink, FILE, &line, content(&line));
    }
    assert!(sink.rows.is_empty());
    let user = presence::parse_user_info("Name) (usr_partial");
    assert_eq!(user.display_name, "Name)");
    assert_eq!(user.user_id, "usr_partial");
}

#[test]
fn parses_now_playing_lines_with_a_producer_suffix() {
    let mut sink = RecordingParseSink::default();
    let line = "2026.10.30 21:00:00 Debug      -  nowplaying {\"id\":\"ProTV-1\",\"type\":\"mediaStop\"} (ProTV)";
    let plain = "2026.10.30 21:00:01 Debug      -  nowplaying is not json";

    assert!(media::parse_now_playing_log(
        &mut sink,
        FILE,
        line,
        content(line),
    ));
    assert!(!media::parse_now_playing_log(
        &mut sink,
        FILE,
        plain,
        content(plain),
    ));
    assert_eq!(
        sink.payloads(),
        vec![payload(&[
            "nowplaying",
            "{\"id\":\"ProTV-1\",\"type\":\"mediaStop\"}"
        ])]
    );
}
