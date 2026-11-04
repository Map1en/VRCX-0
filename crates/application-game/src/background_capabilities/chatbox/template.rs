use chrono::Timelike;
use serde::Serialize;

use super::config::{
    ChatboxFormats, ChatboxMemoryFormat, ChatboxMemoryUnit, ChatboxProgressStyle,
    ChatboxTemperatureUnit,
};
use super::render::{ChatboxFacts, ChatboxMedia};

const PROGRESS_SLOTS: u64 = 10;
const BYTES_PER_GIB: f64 = 1024.0 * 1024.0 * 1024.0;
const BYTES_PER_MIB: f64 = 1024.0 * 1024.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ChatboxVariable {
    Time,
    Track,
    Title,
    Artist,
    Album,
    Progress,
    Position,
    Duration,
    Cpu,
    Memory,
    Gpu,
    Vram,
    #[serde(rename = "gputemp")]
    GpuTemp,
    Session,
}

impl ChatboxVariable {
    pub const ALL: [Self; 14] = [
        Self::Time,
        Self::Track,
        Self::Title,
        Self::Artist,
        Self::Album,
        Self::Progress,
        Self::Position,
        Self::Duration,
        Self::Cpu,
        Self::Memory,
        Self::Gpu,
        Self::Vram,
        Self::GpuTemp,
        Self::Session,
    ];

    fn name(self) -> &'static str {
        match self {
            Self::Time => "time",
            Self::Track => "track",
            Self::Title => "title",
            Self::Artist => "artist",
            Self::Album => "album",
            Self::Progress => "progress",
            Self::Position => "position",
            Self::Duration => "duration",
            Self::Cpu => "cpu",
            Self::Memory => "memory",
            Self::Gpu => "gpu",
            Self::Vram => "vram",
            Self::GpuTemp => "gputemp",
            Self::Session => "session",
        }
    }

    fn parse(name: &str) -> Option<Self> {
        Self::ALL
            .into_iter()
            .find(|variable| variable.name() == name)
    }

    pub(super) fn needs_media(self) -> bool {
        matches!(
            self,
            Self::Track
                | Self::Title
                | Self::Artist
                | Self::Album
                | Self::Progress
                | Self::Position
                | Self::Duration
        )
    }

    pub(super) fn needs_system(self) -> bool {
        matches!(self, Self::Cpu | Self::Memory)
    }

    pub(super) fn needs_gpu(self) -> bool {
        matches!(self, Self::Gpu | Self::Vram | Self::GpuTemp)
    }

    fn value(self, facts: &ChatboxFacts, formats: &ChatboxFormats) -> Option<String> {
        let media = || facts.media.as_ref();
        let gpu = || facts.gpu.as_ref();
        match self {
            Self::Time => Some(clock(facts, formats)),
            Self::Track => media().map(|media| track(media, formats.media_max_chars)),
            Self::Title => media().map(|media| clipped(&media.title, formats.media_max_chars)),
            Self::Artist => media()
                .map(|media| clipped(&media.artist, formats.media_max_chars))
                .filter(|artist| !artist.is_empty()),
            Self::Album => media()
                .map(|media| clipped(&media.album, formats.media_max_chars))
                .filter(|album| !album.is_empty()),
            Self::Progress => media()
                .and_then(timeline)
                .map(|(position, duration)| progress_bar(position, duration, formats.progress)),
            Self::Position => media()
                .and_then(timeline)
                .map(|(position, _)| minutes_seconds(position)),
            Self::Duration => media()
                .and_then(timeline)
                .map(|(_, duration)| minutes_seconds(duration)),
            Self::Cpu => facts.system.map(|stats| {
                format!(
                    "{:.*}%",
                    usize::from(formats.cpu_decimals),
                    stats.cpu_percent
                )
            }),
            Self::Memory => facts
                .system
                .filter(|stats| stats.memory_total_bytes > 0)
                .map(|stats| {
                    memory(
                        stats.memory_used_bytes,
                        stats.memory_total_bytes,
                        MemoryStyle {
                            format: formats.memory,
                            decimals: formats.memory_decimals,
                            unit: formats.memory_unit,
                        },
                    )
                }),
            Self::Gpu => gpu()
                .and_then(|gpu| gpu.usage_percent)
                .map(|percent| format!("{:.*}%", usize::from(formats.gpu_decimals), percent)),
            Self::Vram => gpu()
                .and_then(|gpu| Some((gpu.vram_used_bytes?, gpu.vram_total_bytes?)))
                .filter(|(_, total)| *total > 0)
                .map(|(used, total)| {
                    memory(
                        used,
                        total,
                        MemoryStyle {
                            format: formats.vram,
                            decimals: formats.vram_decimals,
                            unit: formats.vram_unit,
                        },
                    )
                }),
            Self::GpuTemp => gpu()
                .and_then(|gpu| gpu.temperature_celsius)
                .map(|celsius| temperature(celsius, formats.temperature_unit)),
            Self::Session => facts
                .game_session_seconds
                .map(|seconds| session(seconds, formats.show_seconds)),
        }
    }
}

pub(super) fn template_variables(template: &str) -> impl Iterator<Item = ChatboxVariable> + '_ {
    template.split('{').skip(1).filter_map(|segment| {
        segment
            .split_once('}')
            .and_then(|(name, _)| ChatboxVariable::parse(name))
    })
}

pub(super) fn render_template(
    template: &str,
    facts: &ChatboxFacts,
    formats: &ChatboxFormats,
) -> Vec<String> {
    template
        .split('\n')
        .filter_map(|line| render_line(line, facts, formats))
        .collect()
}

fn render_line(line: &str, facts: &ChatboxFacts, formats: &ChatboxFormats) -> Option<String> {
    let mut output = String::with_capacity(line.len());
    let mut rest = line;
    while let Some(start) = rest.find('{') {
        output.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        let variable = after
            .split_once('}')
            .and_then(|(name, tail)| ChatboxVariable::parse(name).map(|variable| (variable, tail)));
        match variable {
            Some((variable, tail)) => {
                output.push_str(&variable.value(facts, formats)?);
                rest = tail;
            }
            None => {
                output.push('{');
                rest = after;
            }
        }
    }
    output.push_str(rest);
    let output = output.trim_end();
    (!output.trim().is_empty()).then(|| output.to_string())
}

fn clock(facts: &ChatboxFacts, formats: &ChatboxFormats) -> String {
    let time = facts.local_time;
    let seconds = if formats.show_seconds {
        format!(":{:02}", time.second())
    } else {
        String::new()
    };
    if !formats.hour12 {
        return format!("{:02}:{:02}{seconds}", time.hour(), time.minute());
    }
    let (is_pm, hour) = time.hour12();
    format!(
        "{hour}:{:02}{seconds} {}",
        time.minute(),
        if is_pm { "PM" } else { "AM" }
    )
}

fn track(media: &ChatboxMedia, max_chars: u32) -> String {
    let title = clipped(&media.title, max_chars);
    let artist = clipped(&media.artist, max_chars);
    if artist.is_empty() {
        title
    } else {
        format!("{title} - {artist}")
    }
}

fn clipped(text: &str, max_chars: u32) -> String {
    let text = text.trim();
    let max_chars = max_chars as usize;
    if max_chars == 0 || text.chars().count() <= max_chars {
        return text.to_string();
    }
    let kept: String = text.chars().take(max_chars.saturating_sub(1)).collect();
    format!("{}…", kept.trim_end())
}

fn timeline(media: &ChatboxMedia) -> Option<(u64, u64)> {
    let duration = media.duration_seconds.filter(|duration| *duration > 0)?;
    Some((media.position_seconds?.min(duration), duration))
}

fn progress_bar(position: u64, duration: u64, style: ChatboxProgressStyle) -> String {
    let filled_of = |slots: u64| ((position * slots + duration / 2) / duration).min(slots) as usize;
    let slots = PROGRESS_SLOTS as usize;
    match style {
        ChatboxProgressStyle::Line => {
            let knob = filled_of(PROGRESS_SLOTS - 1);
            format!("{}●{}", "━".repeat(knob), "─".repeat(slots - 1 - knob))
        }
        ChatboxProgressStyle::Blocks => {
            let filled = filled_of(PROGRESS_SLOTS);
            format!("{}{}", "▰".repeat(filled), "▱".repeat(slots - filled))
        }
        ChatboxProgressStyle::Dots => {
            let filled = filled_of(PROGRESS_SLOTS);
            format!("{}{}", "●".repeat(filled), "○".repeat(slots - filled))
        }
    }
}

fn minutes_seconds(seconds: u64) -> String {
    let hours = seconds / 3600;
    let minutes = seconds % 3600 / 60;
    let seconds = seconds % 60;
    if hours > 0 {
        format!("{hours}:{minutes:02}:{seconds:02}")
    } else {
        format!("{minutes}:{seconds:02}")
    }
}

fn session(seconds: u64, show_seconds: bool) -> String {
    let hours = seconds / 3600;
    let minutes = seconds % 3600 / 60;
    if show_seconds {
        format!("{hours}:{minutes:02}:{:02}", seconds % 60)
    } else {
        format!("{hours}:{minutes:02}")
    }
}

struct MemoryStyle {
    format: ChatboxMemoryFormat,
    decimals: u8,
    unit: ChatboxMemoryUnit,
}

fn memory(used_bytes: u64, total_bytes: u64, style: MemoryStyle) -> String {
    let decimals = usize::from(style.decimals);
    let (divisor, unit) = match style.unit {
        ChatboxMemoryUnit::Gb => (BYTES_PER_GIB, "GB"),
        ChatboxMemoryUnit::Mb => (BYTES_PER_MIB, "MB"),
    };
    let used = used_bytes as f64 / divisor;
    let total = total_bytes as f64 / divisor;
    match style.format {
        ChatboxMemoryFormat::Percent => {
            format!(
                "{:.*}%",
                decimals,
                used_bytes as f64 / total_bytes as f64 * 100.0
            )
        }
        ChatboxMemoryFormat::Used => format!("{used:.decimals$} {unit}"),
        ChatboxMemoryFormat::UsedOfTotal => format!("{used:.decimals$}/{total:.decimals$} {unit}"),
        ChatboxMemoryFormat::Total => format!("{total:.decimals$} {unit}"),
    }
}

fn temperature(celsius: f32, unit: ChatboxTemperatureUnit) -> String {
    match unit {
        ChatboxTemperatureUnit::Celsius => format!("{celsius:.0}°C"),
        ChatboxTemperatureUnit::Fahrenheit => format!("{:.0}°F", celsius * 9.0 / 5.0 + 32.0),
    }
}

pub(super) fn hours_minutes(seconds: u64) -> String {
    session(seconds, false)
}
