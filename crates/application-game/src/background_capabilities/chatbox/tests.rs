use std::time::{Duration, Instant};

use chrono::NaiveTime;

use super::*;

const GIB: u64 = 1024 * 1024 * 1024;

fn labels() -> ChatboxLabels {
    ChatboxLabels { afk: "AFK".into() }
}

fn facts() -> ChatboxFacts {
    ChatboxFacts {
        local_time: NaiveTime::from_hms_opt(21, 5, 9).unwrap(),
        media: None,
        system: None,
        gpu: None,
        game_session_seconds: None,
    }
}

fn media() -> ChatboxMedia {
    ChatboxMedia {
        title: "Idol".into(),
        artist: "YOASOBI".into(),
        album: "THE BOOK 3".into(),
        position_seconds: Some(106),
        duration_seconds: Some(213),
    }
}

fn stats() -> ChatboxSystemStats {
    ChatboxSystemStats {
        cpu_percent: 23.456,
        memory_used_bytes: 8 * GIB + GIB / 4,
        memory_total_bytes: 32 * GIB,
    }
}

fn module(templates: &[&str]) -> ChatboxPageLine {
    module_with(templates, ChatboxFormats::default())
}

fn module_with(templates: &[&str], formats: ChatboxFormats) -> ChatboxPageLine {
    ChatboxPageLine {
        id: templates.join("|"),
        template: templates.join("\n"),
        formats,
    }
}

fn page(id: &str, seconds: u32, lines: Vec<ChatboxPageLine>) -> ChatboxPage {
    ChatboxPage {
        id: id.into(),
        enabled: true,
        seconds,
        lines,
    }
}

fn config(pages: Vec<ChatboxPage>) -> ChatboxConfig {
    ChatboxConfig {
        status_enabled: true,
        pages,
        ..ChatboxConfig::default()
    }
}

struct Harness {
    scheduler: ChatboxScheduler,
    start: Instant,
    config: ChatboxConfig,
    facts: ChatboxFacts,
    gate: ChatboxGate,
    vr_mode: bool,
    hmd_user_absent: bool,
}

impl Harness {
    fn new(config: ChatboxConfig) -> Self {
        Self {
            scheduler: ChatboxScheduler::default(),
            start: Instant::now(),
            config,
            facts: facts(),
            gate: ChatboxGate::Ready,
            vr_mode: false,
            hmd_user_absent: false,
        }
    }

    fn at(&self, seconds: f32) -> Instant {
        self.start + Duration::from_secs_f32(seconds)
    }

    fn tick(&mut self, seconds: f32) -> ChatboxTickOutput {
        let now = self.at(seconds);
        let labels = labels();
        self.scheduler.tick(ChatboxTickInput {
            now,
            config: &self.config,
            gate: self.gate,
            headset: ChatboxHeadset::new(self.vr_mode, false, self.hmd_user_absent),
            facts: &self.facts,
            labels: &labels,
        })
    }

    fn submit(&mut self, seconds: f32, text: &str) -> Result<String, ChatboxSendError> {
        let text = ChatboxScheduler::prepare_manual(self.gate, text)?;
        self.scheduler.commit_manual(self.at(seconds), text.clone());
        Ok(text)
    }
}

fn render(module: ChatboxPageLine, facts: ChatboxFacts) -> Option<String> {
    let mut harness = Harness::new(config(vec![page("a", 5, vec![module])]));
    harness.facts = facts;
    harness.tick(0.0).outgoing
}

fn with_media() -> ChatboxFacts {
    ChatboxFacts {
        media: Some(media()),
        ..facts()
    }
}

fn with_stats() -> ChatboxFacts {
    ChatboxFacts {
        system: Some(stats()),
        ..facts()
    }
}

#[test]
fn time_variable_follows_its_clock_format() {
    assert_eq!(
        render(module(&["{time}"]), facts()).as_deref(),
        Some("21:05")
    );
    assert_eq!(
        render(
            module_with(
                &["⌚ {time}"],
                ChatboxFormats {
                    hour12: true,
                    show_seconds: true,
                    ..ChatboxFormats::default()
                }
            ),
            facts()
        )
        .as_deref(),
        Some("⌚ 9:05:09 PM")
    );
}

#[test]
fn media_variables_render_track_and_timeline() {
    assert_eq!(
        render(
            module(&["♪ {track}\n{progress} {position} / {duration}"]),
            with_media()
        )
        .as_deref(),
        Some("♪ Idol - YOASOBI\n━━━━●───── 1:46 / 3:33")
    );
    assert_eq!(
        render(
            module_with(
                &["「{title}」{artist} {progress}"],
                ChatboxFormats {
                    progress: ChatboxProgressStyle::Blocks,
                    ..ChatboxFormats::default()
                }
            ),
            with_media()
        )
        .as_deref(),
        Some("「Idol」YOASOBI ▰▰▰▰▰▱▱▱▱▱")
    );
}

#[test]
fn lines_with_a_missing_value_are_hidden_but_others_stay() {
    assert_eq!(
        render(module(&["{time}\n♪ {track}"]), facts()).as_deref(),
        Some("21:05")
    );
}

#[test]
fn unknown_braces_are_kept_as_text() {
    assert_eq!(
        render(module(&["{hi} {time} }"]), facts()).as_deref(),
        Some("{hi} 21:05 }")
    );
}

#[test]
fn cpu_and_memory_follow_decimals_mode_and_unit() {
    let formats = |memory, decimals, unit| ChatboxFormats {
        cpu_decimals: 2,
        memory,
        memory_decimals: decimals,
        memory_unit: unit,
        ..ChatboxFormats::default()
    };
    let rendered = |memory, decimals, unit| {
        render(
            module_with(
                &["CPU {cpu} | RAM {memory}"],
                formats(memory, decimals, unit),
            ),
            with_stats(),
        )
    };

    assert_eq!(
        rendered(ChatboxMemoryFormat::Percent, 0, ChatboxMemoryUnit::Gb).as_deref(),
        Some("CPU 23.46% | RAM 26%")
    );
    assert_eq!(
        rendered(ChatboxMemoryFormat::UsedOfTotal, 1, ChatboxMemoryUnit::Gb).as_deref(),
        Some("CPU 23.46% | RAM 8.2/32.0 GB")
    );
    assert_eq!(
        rendered(ChatboxMemoryFormat::Used, 0, ChatboxMemoryUnit::Mb).as_deref(),
        Some("CPU 23.46% | RAM 8448 MB")
    );
    assert_eq!(
        rendered(ChatboxMemoryFormat::Total, 0, ChatboxMemoryUnit::Gb).as_deref(),
        Some("CPU 23.46% | RAM 32 GB")
    );
}

#[test]
fn gpu_variables_follow_their_formats() {
    let facts = ChatboxFacts {
        gpu: Some(ChatboxGpuStats {
            usage_percent: Some(41.56),
            vram_used_bytes: Some(6 * GIB + GIB / 4),
            vram_total_bytes: Some(12 * GIB),
            temperature_celsius: Some(62.4),
        }),
        ..facts()
    };
    let formats = ChatboxFormats {
        gpu_decimals: 1,
        vram: ChatboxMemoryFormat::UsedOfTotal,
        vram_decimals: 1,
        ..ChatboxFormats::default()
    };

    assert_eq!(
        render(
            module_with(&["GPU {gpu} {gputemp} | VRAM {vram}"], formats),
            facts.clone()
        )
        .as_deref(),
        Some("GPU 41.6% 62°C | VRAM 6.2/12.0 GB")
    );
    let fahrenheit = ChatboxFormats {
        temperature_unit: ChatboxTemperatureUnit::Fahrenheit,
        ..ChatboxFormats::default()
    };
    assert_eq!(
        render(module_with(&["{gputemp} {vram}"], fahrenheit), facts).as_deref(),
        Some("144°F 52%")
    );
}

#[test]
fn gpu_lines_hide_when_the_reading_is_unavailable() {
    let facts = ChatboxFacts {
        gpu: Some(ChatboxGpuStats {
            usage_percent: Some(12.0),
            ..ChatboxGpuStats::default()
        }),
        ..facts()
    };

    assert_eq!(
        render(module(&["GPU {gpu}", "{gputemp}", "VRAM {vram}"]), facts).as_deref(),
        Some("GPU 12%")
    );
}

#[test]
fn media_text_is_split_and_clipped_to_the_line_limit() {
    let facts = ChatboxFacts {
        media: Some(ChatboxMedia {
            title: "Racing into the Night".into(),
            ..media()
        }),
        ..facts()
    };

    assert_eq!(
        render(module(&["{title} / {artist} / {album}"]), facts.clone()).as_deref(),
        Some("Racing into the Night / YOASOBI / THE BOOK 3")
    );
    let clipped = ChatboxFormats {
        media_max_chars: 8,
        ..ChatboxFormats::default()
    };
    assert_eq!(
        render(module_with(&["♪ {track} [{album}]"], clipped), facts).as_deref(),
        Some("♪ Racing… - YOASOBI [THE BOO…]")
    );
}

#[test]
fn album_line_hides_when_the_player_reports_no_album() {
    let facts = ChatboxFacts {
        media: Some(ChatboxMedia {
            album: "  ".into(),
            ..media()
        }),
        ..facts()
    };

    assert_eq!(
        render(module(&["♪ {title}", "💿 {album}"]), facts).as_deref(),
        Some("♪ Idol")
    );
}

#[test]
fn session_variable_counts_hours_and_minutes() {
    let facts = ChatboxFacts {
        game_session_seconds: Some(3_905),
        ..facts()
    };

    assert_eq!(
        render(module(&["⏱ {session}"]), facts.clone()).as_deref(),
        Some("⏱ 1:05")
    );
    assert_eq!(
        render(
            module_with(
                &["{session}"],
                ChatboxFormats {
                    show_seconds: true,
                    ..ChatboxFormats::default()
                }
            ),
            facts
        )
        .as_deref(),
        Some("1:05:05")
    );
}

#[test]
fn rotation_cycles_through_enabled_pages_in_order() {
    let mut harness = Harness::new(config(vec![
        page("a", 5, vec![module(&["one"]), module(&["line two"])]),
        page("b", 5, vec![module(&["two"])]),
    ]));

    assert_eq!(harness.tick(0.0).outgoing.as_deref(), Some("one\nline two"));
    assert_eq!(harness.tick(4.0).outgoing, None);
    let output = harness.tick(5.0);
    assert_eq!(output.outgoing.as_deref(), Some("two"));
    assert_eq!(output.status.page_id.as_deref(), Some("b"));
    assert_eq!(output.status.page_number, Some(2));
    assert_eq!(output.status.page_count, 2);
    assert_eq!(
        harness.tick(10.0).outgoing.as_deref(),
        Some("one\nline two")
    );
}

#[test]
fn disabled_pages_are_kept_but_not_shown() {
    let mut disabled = page("b", 5, vec![module(&["saved for later"])]);
    disabled.enabled = false;
    let mut harness = Harness::new(config(vec![
        page("a", 5, vec![module(&["one"])]),
        disabled,
        page("c", 5, vec![module(&["three"])]),
    ]));

    assert_eq!(harness.tick(0.0).outgoing.as_deref(), Some("one"));
    let output = harness.tick(5.0);
    assert_eq!(output.outgoing.as_deref(), Some("three"));
    assert_eq!(output.status.page_number, Some(2));
    assert_eq!(output.status.page_count, 2);
}

#[test]
fn empty_pages_are_skipped() {
    let mut harness = Harness::new(config(vec![
        page("a", 5, vec![module(&["♪ {track}"])]),
        page("b", 5, vec![module(&["shown"])]),
    ]));

    let output = harness.tick(0.0);

    assert_eq!(output.outgoing.as_deref(), Some("shown"));
    assert_eq!(output.status.page_id.as_deref(), Some("b"));
}

#[test]
fn unchanged_text_is_only_resent_after_the_refresh_interval() {
    let mut harness = Harness::new(config(vec![page("a", 300, vec![module(&["hi"])])]));

    assert_eq!(harness.tick(0.0).outgoing.as_deref(), Some("hi"));
    assert_eq!(harness.tick(10.0).outgoing, None);
    assert_eq!(harness.tick(20.0).outgoing.as_deref(), Some("hi"));
}

#[test]
fn changes_inside_the_minimum_interval_wait_for_the_next_tick() {
    let mut harness = Harness::new(config(vec![page("a", 300, vec![module(&["{time}"])])]));

    assert_eq!(harness.tick(0.0).outgoing.as_deref(), Some("21:05"));
    harness.facts.local_time = NaiveTime::from_hms_opt(21, 6, 0).unwrap();
    assert_eq!(harness.tick(0.5).outgoing, None);
    assert_eq!(harness.tick(1.0).outgoing.as_deref(), Some("21:06"));
}

#[test]
fn manual_message_holds_then_status_resumes() {
    let mut harness = Harness::new(config(vec![page("a", 300, vec![module(&["status"])])]));
    assert_eq!(harness.tick(0.0).outgoing.as_deref(), Some("status"));

    let sent = harness.submit(1.0, "  hello  ").unwrap();
    assert_eq!(sent, "hello");

    let held = harness.tick(5.0);
    assert_eq!(held.outgoing, None);
    assert_eq!(held.status.activity, ChatboxActivity::Manual);
    assert_eq!(held.status.preview, "hello");
    assert_eq!(harness.tick(9.0).outgoing.as_deref(), Some("status"));
}

#[test]
fn manual_message_clears_after_the_hold_when_status_is_off() {
    let mut harness = Harness::new(ChatboxConfig {
        status_enabled: false,
        ..config(vec![page("a", 5, vec![module(&["status"])])])
    });

    assert_eq!(harness.tick(0.0).outgoing, None);
    harness.submit(0.0, "hello").unwrap();
    let cleared = harness.tick(8.0);

    assert_eq!(cleared.outgoing.as_deref(), Some(""));
    assert_eq!(cleared.status.activity, ChatboxActivity::Off);
    assert_eq!(cleared.status.preview, "status");
}

#[test]
fn turning_status_off_clears_the_bubble_once() {
    let mut harness = Harness::new(config(vec![page("a", 5, vec![module(&["status"])])]));
    assert_eq!(harness.tick(0.0).outgoing.as_deref(), Some("status"));

    harness.config.status_enabled = false;

    assert_eq!(harness.tick(2.0).outgoing.as_deref(), Some(""));
    assert_eq!(harness.tick(30.0).outgoing, None);
}

#[test]
fn paused_gate_sends_nothing_and_resumes_with_a_fresh_send() {
    let mut harness = Harness::new(config(vec![page("a", 300, vec![module(&["status"])])]));
    assert_eq!(harness.tick(0.0).outgoing.as_deref(), Some("status"));

    harness.gate = ChatboxGate::Paused(ChatboxPauseReason::Isolated);
    let paused = harness.tick(2.0);
    assert_eq!(paused.outgoing, None);
    assert_eq!(
        paused.status.pause_reason,
        Some(ChatboxPauseReason::Isolated)
    );
    assert_eq!(
        harness.submit(3.0, "hello"),
        Err(ChatboxSendError::Paused(ChatboxPauseReason::Isolated))
    );
    assert_eq!(harness.tick(3.5).status.activity, ChatboxActivity::Status);

    harness.gate = ChatboxGate::Ready;
    assert_eq!(harness.tick(4.0).outgoing.as_deref(), Some("status"));
}

#[test]
fn empty_manual_message_is_rejected() {
    assert_eq!(
        ChatboxScheduler::prepare_manual(ChatboxGate::Ready, " \n "),
        Err(ChatboxSendError::Empty)
    );
}

#[test]
fn headset_removal_switches_to_afk_only_in_vr_with_the_option_on() {
    let mut harness = Harness::new(config(vec![page("a", 300, vec![module(&["status"])])]));
    harness.hmd_user_absent = true;
    assert_eq!(harness.tick(0.0).status.activity, ChatboxActivity::Status);

    harness.vr_mode = true;
    let afk = harness.tick(2.0);
    assert_eq!(afk.status.activity, ChatboxActivity::Afk);
    assert_eq!(afk.outgoing.as_deref(), Some("AFK · 0:00"));
    assert_eq!(harness.tick(122.0).outgoing.as_deref(), Some("AFK · 0:02"));

    harness.hmd_user_absent = false;
    assert_eq!(harness.tick(124.0).outgoing.as_deref(), Some("status"));

    harness.config.afk.auto_when_headset_removed = false;
    harness.hmd_user_absent = true;
    assert_eq!(harness.tick(126.0).status.activity, ChatboxActivity::Status);
}

#[test]
fn afk_uses_custom_text_and_can_hide_the_duration() {
    let mut harness = Harness::new(config(vec![page("a", 300, vec![module(&["status"])])]));
    harness.config.afk.text = "brb".into();
    harness.scheduler.set_manual_afk(harness.at(0.0), true);
    assert_eq!(
        harness.tick(3_600.0).outgoing.as_deref(),
        Some("brb · 1:00")
    );

    harness.config.afk.show_duration = false;
    assert_eq!(harness.tick(3_602.0).outgoing.as_deref(), Some("brb"));

    harness.scheduler.set_manual_afk(harness.at(3_603.0), false);
    assert_eq!(harness.tick(3_604.0).outgoing.as_deref(), Some("status"));
}

#[test]
fn config_json_round_trips_unchanged() {
    let mut original = config(vec![page("a", 12, vec![module(&["{cpu}", "{memory}"])])]);
    original.afk.text = "brb".into();
    original.messages.quick_phrases = vec!["gg".into()];

    let json = serde_json::to_value(&original).unwrap();

    assert_eq!(
        serde_json::from_value::<ChatboxConfig>(json).unwrap(),
        original
    );
}

#[test]
fn partial_line_formats_fill_defaults_only_on_the_lenient_path() {
    let json = serde_json::json!({
        "statusEnabled": true,
        "pages": [{"id": "a", "enabled": true, "seconds": 8, "lines": [
            {"id": "m1", "template": "{cpu}", "formats": {"cpuDecimals": 1}}
        ]}],
        "afk": {"text": "", "showDuration": true, "autoWhenHeadsetRemoved": true},
        "messages": {"typingIndicator": true, "notifySound": false, "quickPhrases": []},
        "oscHost": "127.0.0.1",
        "oscPort": 9000
    });

    let config = ChatboxConfig::from_partial_json(json.clone()).unwrap();

    assert_eq!(
        config.pages[0].lines[0].formats,
        ChatboxFormats {
            cpu_decimals: 1,
            ..ChatboxFormats::default()
        }
    );
    assert!(serde_json::from_value::<ChatboxConfig>(json).is_err());
}

#[test]
fn stored_config_is_normalized_and_bad_json_falls_back_to_defaults() {
    let stored = r#"{
        "statusEnabled": true,
        "pages": [{"id": "a", "enabled": false, "seconds": 1, "lines": [
            {"id": "m1", "template": "  hi  ", "formats": {"cpuDecimals": 9}},
            {"id": "m2", "template": "   ", "formats": {}}
        ]}],
        "afk": {"text": "  brb  ", "showDuration": true, "autoWhenHeadsetRemoved": false},
        "messages": {"typingIndicator": true, "notifySound": false,
                     "quickPhrases": ["  gg  ", " "]},
        "oscHost": "  ",
        "oscPort": 0
    }"#;

    let config = ChatboxConfig::from_stored(stored);

    let page = &config.pages[0];
    assert!(!page.enabled);
    assert_eq!(page.seconds, CHATBOX_LIMITS.min_page_seconds);
    assert_eq!(page.lines[0].template, "hi");
    assert_eq!(page.lines[1].template, "");
    assert_eq!(page.lines[0].formats.cpu_decimals, 2);
    assert_eq!(page.lines[0].formats.memory, ChatboxMemoryFormat::Percent);
    assert_eq!(config.afk.text, "brb");
    assert_eq!(config.messages.quick_phrases, vec!["gg".to_string()]);
    assert_eq!(config.osc_host, CHATBOX_DEFAULT_OSC_HOST);
    assert_eq!(config.osc_port, CHATBOX_DEFAULT_OSC_PORT);
    assert_eq!(ChatboxConfig::from_stored("{"), ChatboxConfig::default());
    assert_eq!(ChatboxConfig::from_stored(""), ChatboxConfig::default());
}

#[test]
fn rotation_restarts_only_when_the_enabled_page_order_changes() {
    let before = config(vec![
        page("a", 5, vec![module(&["one"])]),
        page("b", 5, vec![module(&["two"])]),
    ]);
    let mut edited = before.clone();
    edited.pages[0].lines[0].template = "changed".into();
    edited.pages[1].seconds = 10;
    assert!(!edited.rotation_order_changed(&before));

    let mut toggled = before.clone();
    toggled.pages[1].enabled = false;
    assert!(toggled.rotation_order_changed(&before));

    let mut reordered = before.clone();
    reordered.pages.reverse();
    assert!(reordered.rotation_order_changed(&before));

    let mut shorter = before.clone();
    shorter.pages.pop();
    assert!(shorter.rotation_order_changed(&before));
}

#[test]
fn facts_are_only_read_for_variables_the_templates_use() {
    let mut config = config(vec![page("a", 5, vec![module(&["♪ {track}", "{time}"])])]);

    assert_eq!(
        config.fact_needs(false),
        ChatboxFactNeeds {
            media: true,
            ..ChatboxFactNeeds::default()
        }
    );

    config.pages[0].lines[0].template = "RAM {memory}".into();
    assert_eq!(
        config.fact_needs(false),
        ChatboxFactNeeds {
            system: true,
            ..ChatboxFactNeeds::default()
        }
    );

    config.pages[0].lines[0].template = "GPU {gpu} {gputemp}".into();
    assert_eq!(
        config.fact_needs(false),
        ChatboxFactNeeds {
            gpu: true,
            ..ChatboxFactNeeds::default()
        }
    );
    config.pages[0].lines[0].template = "RAM {memory}".into();

    config.pages[0].enabled = false;
    assert_eq!(config.fact_needs(true), ChatboxFactNeeds::default());
    config.pages[0].enabled = true;

    config.status_enabled = false;
    assert_eq!(config.fact_needs(false), ChatboxFactNeeds::default());
    assert!(config.fact_needs(true).system);
}

#[test]
fn headset_absence_counts_only_in_vr_mode() {
    assert_eq!(
        ChatboxHeadset::new(true, false, true),
        ChatboxHeadset {
            vr_mode: true,
            user_absent: true
        }
    );
    assert!(!ChatboxHeadset::new(true, true, true).user_absent);
    assert!(!ChatboxHeadset::new(false, false, true).vr_mode);
}

fn now() -> chrono::DateTime<chrono::Utc> {
    chrono::DateTime::parse_from_rfc3339("2026-11-03T12:00:00Z")
        .unwrap()
        .with_timezone(&chrono::Utc)
}

fn fact_sources() -> ChatboxFactSources<'static> {
    ChatboxFactSources {
        local_time: NaiveTime::from_hms_opt(12, 0, 0).unwrap(),
        now: now(),
        media_session: None,
        system: None,
        gpu: None,
        is_game_running: true,
        last_game_started_at: Some("2026-11-03T10:30:00Z"),
    }
}

#[test]
fn only_desktop_media_with_a_title_counts_as_playing() {
    let session = ChatboxMedia {
        title: "Desktop song".into(),
        ..ChatboxMedia::default()
    };

    let facts = build_chatbox_facts(ChatboxFactSources {
        media_session: Some(session.clone()),
        ..fact_sources()
    });
    assert_eq!(facts.media, Some(session));

    let untitled = build_chatbox_facts(ChatboxFactSources {
        media_session: Some(ChatboxMedia::default()),
        ..fact_sources()
    });
    assert_eq!(untitled.media, None);
}

#[test]
fn game_session_counts_from_the_start_time_only_while_running() {
    assert_eq!(
        build_chatbox_facts(fact_sources()).game_session_seconds,
        Some(5_400)
    );
    assert_eq!(
        build_chatbox_facts(ChatboxFactSources {
            is_game_running: false,
            ..fact_sources()
        })
        .game_session_seconds,
        None
    );
    assert_eq!(
        build_chatbox_facts(ChatboxFactSources {
            last_game_started_at: Some("not a time"),
            ..fact_sources()
        })
        .game_session_seconds,
        None
    );
}

fn preview_input(template: &str) -> ChatboxLinePreviewInput {
    ChatboxLinePreviewInput {
        template: template.into(),
        formats: ChatboxFormats::default(),
    }
}

#[test]
fn style_samples_render_every_value_with_sample_data() {
    let lines = [
        preview_input("⌚ {time}"),
        preview_input("♪ {track}"),
        preview_input("CPU {cpu} · {session}"),
    ];

    assert_eq!(
        render_line_previews(&lines, &sample_chatbox_facts(facts().local_time)),
        vec![
            "⌚ 21:05".to_string(),
            "♪ Idol - YOASOBI".to_string(),
            "CPU 23% · 1:05".to_string()
        ]
    );
    assert_eq!(
        render_line_previews(&lines[1..2], &facts()),
        vec![String::new()]
    );
}
