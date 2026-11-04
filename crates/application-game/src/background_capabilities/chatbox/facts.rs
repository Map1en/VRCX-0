use chrono::{DateTime, NaiveTime, Utc};
use serde::Deserialize;
use vrcx_0_osc::fit_chatbox_text;

use super::config::{ChatboxConfig, ChatboxFormats};
use super::render::{ChatboxFacts, ChatboxGpuStats, ChatboxMedia, ChatboxSystemStats};
use super::template::{render_template, template_variables};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ChatboxFactNeeds {
    pub media: bool,
    pub system: bool,
    pub gpu: bool,
}

impl ChatboxConfig {
    pub fn fact_needs(&self, previewing: bool) -> ChatboxFactNeeds {
        if !self.status_enabled && !previewing {
            return ChatboxFactNeeds::default();
        }
        self.enabled_templates().flat_map(template_variables).fold(
            ChatboxFactNeeds::default(),
            |needs, variable| ChatboxFactNeeds {
                media: needs.media || variable.needs_media(),
                system: needs.system || variable.needs_system(),
                gpu: needs.gpu || variable.needs_gpu(),
            },
        )
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ChatboxHeadset {
    pub vr_mode: bool,
    pub user_absent: bool,
}

impl ChatboxHeadset {
    pub fn new(is_steamvr_running: bool, is_game_no_vr: bool, is_hmd_afk: bool) -> Self {
        let vr_mode = is_steamvr_running && !is_game_no_vr;
        Self {
            vr_mode,
            user_absent: vr_mode && is_hmd_afk,
        }
    }
}

pub struct ChatboxFactSources<'a> {
    pub local_time: NaiveTime,
    pub now: DateTime<Utc>,
    pub media_session: Option<ChatboxMedia>,
    pub system: Option<ChatboxSystemStats>,
    pub gpu: Option<ChatboxGpuStats>,
    pub is_game_running: bool,
    pub last_game_started_at: Option<&'a str>,
}

pub fn build_chatbox_facts(sources: ChatboxFactSources<'_>) -> ChatboxFacts {
    ChatboxFacts {
        local_time: sources.local_time,
        media: sources
            .media_session
            .filter(|media| !media.title.trim().is_empty()),
        system: sources.system,
        gpu: sources.gpu,
        game_session_seconds: game_session_seconds(
            sources.is_game_running,
            sources.last_game_started_at,
            sources.now,
        ),
    }
}

pub fn sample_chatbox_facts(local_time: NaiveTime) -> ChatboxFacts {
    const GIB: u64 = 1024 * 1024 * 1024;
    ChatboxFacts {
        local_time,
        media: Some(ChatboxMedia {
            title: "Idol".into(),
            artist: "YOASOBI".into(),
            album: "THE BOOK 3".into(),
            position_seconds: Some(106),
            duration_seconds: Some(213),
        }),
        system: Some(ChatboxSystemStats {
            cpu_percent: 23.4,
            memory_used_bytes: 9 * GIB,
            memory_total_bytes: 32 * GIB,
        }),
        gpu: Some(ChatboxGpuStats {
            usage_percent: Some(41.6),
            vram_used_bytes: Some(6 * GIB + GIB / 4),
            vram_total_bytes: Some(12 * GIB),
            temperature_celsius: Some(62.0),
        }),
        game_session_seconds: Some(3_900),
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ChatboxLinePreviewInput {
    pub template: String,
    pub formats: ChatboxFormats,
}

pub fn render_line_previews(
    lines: &[ChatboxLinePreviewInput],
    facts: &ChatboxFacts,
) -> Vec<String> {
    lines
        .iter()
        .map(|line| {
            fit_chatbox_text(&render_template(&line.template, facts, &line.formats).join("\n"))
        })
        .collect()
}

fn game_session_seconds(
    is_game_running: bool,
    started_at: Option<&str>,
    now: DateTime<Utc>,
) -> Option<u64> {
    if !is_game_running {
        return None;
    }
    let started = DateTime::parse_from_rfc3339(started_at?.trim()).ok()?;
    u64::try_from((now - started.with_timezone(&Utc)).num_seconds()).ok()
}
