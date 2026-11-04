use serde::{Deserialize, Serialize};
use vrcx_0_osc::{fit_chatbox_text, CHATBOX_MAX_CHARS};

use super::template::ChatboxVariable;

pub const CHATBOX_CONFIG_KEY: &str = "chatboxConfig";
pub const CHATBOX_DEFAULT_OSC_HOST: &str = "127.0.0.1";
pub const CHATBOX_DEFAULT_OSC_PORT: u16 = 9000;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ChatboxLimits {
    pub max_chars: u32,
    pub max_pages: u32,
    pub max_lines_per_page: u32,
    pub max_template_chars: u32,
    pub max_decimals: u32,
    pub max_afk_text_chars: u32,
    pub max_quick_phrases: u32,
    pub min_page_seconds: u32,
    pub max_page_seconds: u32,
}

pub const CHATBOX_LIMITS: ChatboxLimits = ChatboxLimits {
    max_chars: CHATBOX_MAX_CHARS as u32,
    max_pages: 20,
    max_lines_per_page: 9,
    max_template_chars: 256,
    max_decimals: 2,
    max_afk_text_chars: 64,
    max_quick_phrases: 12,
    min_page_seconds: 3,
    max_page_seconds: 300,
};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ChatboxEditorState {
    pub config: ChatboxConfig,
    pub limits: ChatboxLimits,
    pub variables: Vec<ChatboxVariable>,
    pub default_formats: ChatboxFormats,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ChatboxConfig {
    pub status_enabled: bool,
    pub pages: Vec<ChatboxPage>,
    pub afk: ChatboxAfkConfig,
    pub messages: ChatboxMessageConfig,
    pub osc_host: String,
    pub osc_port: u16,
}

impl vrcx_0_application_core::RuntimeEventPayload for ChatboxConfig {
    const EVENT_NAME: &'static str = "chatboxConfig";
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ChatboxAfkConfig {
    pub text: String,
    pub show_duration: bool,
    pub auto_when_headset_removed: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ChatboxMessageConfig {
    pub typing_indicator: bool,
    pub notify_sound: bool,
    pub quick_phrases: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ChatboxPage {
    pub id: String,
    pub enabled: bool,
    pub seconds: u32,
    pub lines: Vec<ChatboxPageLine>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ChatboxPageLine {
    pub id: String,
    pub template: String,
    pub formats: ChatboxFormats,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ChatboxMemoryFormat {
    Percent,
    Used,
    UsedOfTotal,
    Total,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ChatboxMemoryUnit {
    Gb,
    Mb,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ChatboxTemperatureUnit {
    Celsius,
    Fahrenheit,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ChatboxProgressStyle {
    Line,
    Blocks,
    Dots,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(default, rename_all = "camelCase")]
pub struct ChatboxFormats {
    pub hour12: bool,
    pub show_seconds: bool,
    pub cpu_decimals: u8,
    pub memory: ChatboxMemoryFormat,
    pub memory_decimals: u8,
    pub memory_unit: ChatboxMemoryUnit,
    pub media_max_chars: u32,
    pub gpu_decimals: u8,
    pub vram: ChatboxMemoryFormat,
    pub vram_decimals: u8,
    pub vram_unit: ChatboxMemoryUnit,
    pub temperature_unit: ChatboxTemperatureUnit,
    pub progress: ChatboxProgressStyle,
}

impl Default for ChatboxFormats {
    fn default() -> Self {
        Self {
            hour12: false,
            show_seconds: false,
            cpu_decimals: 0,
            memory: ChatboxMemoryFormat::Percent,
            memory_decimals: 0,
            memory_unit: ChatboxMemoryUnit::Gb,
            media_max_chars: 0,
            gpu_decimals: 0,
            vram: ChatboxMemoryFormat::Percent,
            vram_decimals: 0,
            vram_unit: ChatboxMemoryUnit::Gb,
            temperature_unit: ChatboxTemperatureUnit::Celsius,
            progress: ChatboxProgressStyle::Line,
        }
    }
}

impl Default for ChatboxConfig {
    fn default() -> Self {
        Self {
            status_enabled: false,
            pages: vec![ChatboxPage {
                id: "default".into(),
                enabled: true,
                seconds: 8,
                lines: vec![
                    ChatboxPageLine {
                        id: "default-time".into(),
                        template: "{time}".into(),
                        formats: ChatboxFormats::default(),
                    },
                    ChatboxPageLine {
                        id: "default-now-playing".into(),
                        template: "♪ {track}\n{progress} {position} / {duration}".into(),
                        formats: ChatboxFormats::default(),
                    },
                ],
            }],
            afk: ChatboxAfkConfig {
                text: String::new(),
                show_duration: true,
                auto_when_headset_removed: true,
            },
            messages: ChatboxMessageConfig {
                typing_indicator: true,
                notify_sound: false,
                quick_phrases: Vec::new(),
            },
            osc_host: CHATBOX_DEFAULT_OSC_HOST.into(),
            osc_port: CHATBOX_DEFAULT_OSC_PORT,
        }
    }
}

impl ChatboxConfig {
    pub fn from_stored(raw: &str) -> Self {
        if raw.trim().is_empty() {
            return Self::default();
        }
        serde_json::from_str::<Self>(raw)
            .map(Self::normalized)
            .unwrap_or_default()
    }

    pub fn normalized(self) -> Self {
        let osc_host = self.osc_host.trim();
        Self {
            status_enabled: self.status_enabled,
            pages: self
                .pages
                .into_iter()
                .take(CHATBOX_LIMITS.max_pages as usize)
                .map(ChatboxPage::normalized)
                .collect(),
            afk: ChatboxAfkConfig {
                text: capped(&self.afk.text, CHATBOX_LIMITS.max_afk_text_chars),
                ..self.afk
            },
            messages: ChatboxMessageConfig {
                quick_phrases: self
                    .messages
                    .quick_phrases
                    .iter()
                    .map(|phrase| fit_chatbox_text(phrase))
                    .filter(|phrase| !phrase.is_empty())
                    .take(CHATBOX_LIMITS.max_quick_phrases as usize)
                    .collect(),
                ..self.messages
            },
            osc_host: if osc_host.is_empty() {
                CHATBOX_DEFAULT_OSC_HOST.into()
            } else {
                osc_host.into()
            },
            osc_port: if self.osc_port == 0 {
                CHATBOX_DEFAULT_OSC_PORT
            } else {
                self.osc_port
            },
        }
    }

    pub fn rotation_order_changed(&self, previous: &Self) -> bool {
        let rotation = |config: &Self| {
            config
                .pages
                .iter()
                .filter(|page| page.enabled)
                .map(|page| page.id.clone())
                .collect::<Vec<_>>()
        };
        rotation(self) != rotation(previous)
    }

    pub(super) fn enabled_templates(&self) -> impl Iterator<Item = &str> {
        self.pages
            .iter()
            .filter(|page| page.enabled)
            .flat_map(|page| page.lines.iter())
            .map(|line| line.template.as_str())
    }
}

impl ChatboxPage {
    fn normalized(self) -> Self {
        Self {
            id: self.id,
            enabled: self.enabled,
            seconds: self.seconds.clamp(
                CHATBOX_LIMITS.min_page_seconds,
                CHATBOX_LIMITS.max_page_seconds,
            ),
            lines: self
                .lines
                .into_iter()
                .take(CHATBOX_LIMITS.max_lines_per_page as usize)
                .map(ChatboxPageLine::normalized)
                .collect(),
        }
    }
}

impl ChatboxPageLine {
    fn normalized(self) -> Self {
        let max_decimals = CHATBOX_LIMITS.max_decimals as u8;
        Self {
            id: self.id,
            template: capped(
                &self.template.replace("\r\n", "\n"),
                CHATBOX_LIMITS.max_template_chars,
            ),
            formats: ChatboxFormats {
                cpu_decimals: self.formats.cpu_decimals.min(max_decimals),
                memory_decimals: self.formats.memory_decimals.min(max_decimals),
                media_max_chars: self.formats.media_max_chars.min(CHATBOX_LIMITS.max_chars),
                gpu_decimals: self.formats.gpu_decimals.min(max_decimals),
                vram_decimals: self.formats.vram_decimals.min(max_decimals),
                ..self.formats
            },
        }
    }
}

fn capped(text: &str, max_chars: u32) -> String {
    text.trim().chars().take(max_chars as usize).collect()
}
