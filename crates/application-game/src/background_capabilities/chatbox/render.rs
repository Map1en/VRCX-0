use chrono::NaiveTime;
use vrcx_0_osc::fit_chatbox_text;

use super::config::{ChatboxAfkConfig, ChatboxPage};
use super::template::{hours_minutes, render_template};

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ChatboxMedia {
    pub title: String,
    pub artist: String,
    pub album: String,
    pub position_seconds: Option<u64>,
    pub duration_seconds: Option<u64>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ChatboxSystemStats {
    pub cpu_percent: f32,
    pub memory_used_bytes: u64,
    pub memory_total_bytes: u64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct ChatboxGpuStats {
    pub usage_percent: Option<f32>,
    pub vram_used_bytes: Option<u64>,
    pub vram_total_bytes: Option<u64>,
    pub temperature_celsius: Option<f32>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ChatboxFacts {
    pub local_time: NaiveTime,
    pub media: Option<ChatboxMedia>,
    pub system: Option<ChatboxSystemStats>,
    pub gpu: Option<ChatboxGpuStats>,
    pub game_session_seconds: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ChatboxLabels {
    pub afk: String,
}

pub(super) fn render_page(page: &ChatboxPage, facts: &ChatboxFacts) -> String {
    let lines = page
        .lines
        .iter()
        .flat_map(|line| render_template(&line.template, facts, &line.formats))
        .collect::<Vec<_>>();
    fit_chatbox_text(&lines.join("\n"))
}

pub(super) fn render_afk(
    afk: &ChatboxAfkConfig,
    labels: &ChatboxLabels,
    away_seconds: u64,
) -> String {
    let text = if afk.text.trim().is_empty() {
        labels.afk.as_str()
    } else {
        afk.text.trim()
    };
    fit_chatbox_text(&if afk.show_duration {
        format!("{text} · {}", hours_minutes(away_seconds))
    } else {
        text.to_string()
    })
}
