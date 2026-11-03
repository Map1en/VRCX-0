use std::time::{Duration, Instant};

use serde::Serialize;
use vrcx_0_osc::fit_chatbox_text;

use super::config::{ChatboxConfig, ChatboxPage};
use super::facts::ChatboxHeadset;
use super::render::{render_afk, render_page, ChatboxFacts, ChatboxLabels};

pub const CHATBOX_MIN_SEND_INTERVAL: Duration = Duration::from_millis(900);
pub const CHATBOX_REFRESH_INTERVAL: Duration = Duration::from_secs(20);
pub const CHATBOX_MANUAL_HOLD: Duration = Duration::from_secs(8);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ChatboxPauseReason {
    GameNotRunning,
    Isolated,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ChatboxGate {
    Ready,
    Paused(ChatboxPauseReason),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ChatboxActivity {
    Off,
    Status,
    Manual,
    Afk,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ChatboxStatus {
    pub activity: ChatboxActivity,
    pub pause_reason: Option<ChatboxPauseReason>,
    pub preview: String,
    pub page_id: Option<String>,
    pub page_number: Option<u32>,
    pub page_count: u32,
    pub page_duration_seconds: Option<u32>,
    pub page_elapsed_seconds: Option<u32>,
    pub manual_afk: bool,
    pub vr_mode: bool,
}

impl vrcx_0_application_core::RuntimeEventPayload for ChatboxStatus {
    const EVENT_NAME: &'static str = "chatboxState";
}

impl ChatboxStatus {
    pub fn same_except_elapsed(&self, other: &Self) -> bool {
        Self {
            page_elapsed_seconds: None,
            ..self.clone()
        } == Self {
            page_elapsed_seconds: None,
            ..other.clone()
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ChatboxSendError {
    Empty,
    Paused(ChatboxPauseReason),
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(tag = "result", rename_all = "camelCase")]
pub enum ChatboxSendOutcome {
    Sent {
        text: String,
    },
    Empty,
    #[serde(rename_all = "camelCase")]
    Paused {
        reason: ChatboxPauseReason,
    },
}

impl From<ChatboxSendError> for ChatboxSendOutcome {
    fn from(error: ChatboxSendError) -> Self {
        match error {
            ChatboxSendError::Empty => Self::Empty,
            ChatboxSendError::Paused(reason) => Self::Paused { reason },
        }
    }
}

pub struct ChatboxTickInput<'a> {
    pub now: Instant,
    pub config: &'a ChatboxConfig,
    pub gate: ChatboxGate,
    pub headset: ChatboxHeadset,
    pub facts: &'a ChatboxFacts,
    pub labels: &'a ChatboxLabels,
}

pub struct ChatboxTickOutput {
    pub outgoing: Option<String>,
    pub status: ChatboxStatus,
}

struct ManualHold {
    text: String,
    until: Instant,
}

struct SentText {
    text: String,
    at: Instant,
}

struct RotationFrame {
    page_id: String,
    page_number: usize,
    text: String,
    duration: Duration,
    elapsed: Duration,
}

#[derive(Default)]
pub struct ChatboxScheduler {
    rotation_index: usize,
    page_started_at: Option<Instant>,
    manual: Option<ManualHold>,
    manual_afk_since: Option<Instant>,
    auto_afk_since: Option<Instant>,
    last_sent: Option<SentText>,
}

impl ChatboxScheduler {
    pub fn tick(&mut self, input: ChatboxTickInput<'_>) -> ChatboxTickOutput {
        let now = input.now;
        if self.manual.as_ref().is_some_and(|hold| now >= hold.until) {
            self.manual = None;
        }
        self.auto_afk_since = (input.config.afk.auto_when_headset_removed
            && input.headset.user_absent)
            .then(|| self.auto_afk_since.unwrap_or(now));
        let rotation = self.advance_rotation(now, input.config, input.facts);
        let afk_since = match (self.manual_afk_since, self.auto_afk_since) {
            (Some(manual), Some(auto)) => Some(manual.min(auto)),
            (manual, auto) => manual.or(auto),
        };
        let (activity, display) = if let Some(hold) = &self.manual {
            (ChatboxActivity::Manual, Some(hold.text.clone()))
        } else if let Some(since) = afk_since {
            (
                ChatboxActivity::Afk,
                Some(render_afk(
                    &input.config.afk,
                    input.labels,
                    now.saturating_duration_since(since).as_secs(),
                )),
            )
        } else if input.config.status_enabled {
            (
                ChatboxActivity::Status,
                rotation.as_ref().map(|frame| frame.text.clone()),
            )
        } else {
            (ChatboxActivity::Off, None)
        };
        let preview = display
            .clone()
            .or_else(|| rotation.as_ref().map(|frame| frame.text.clone()))
            .unwrap_or_default();
        let (outgoing, pause_reason) = match input.gate {
            ChatboxGate::Ready => (self.outgoing(now, display), None),
            ChatboxGate::Paused(reason) => {
                self.last_sent = None;
                (None, Some(reason))
            }
        };
        ChatboxTickOutput {
            outgoing,
            status: ChatboxStatus {
                activity,
                pause_reason,
                preview,
                page_id: rotation.as_ref().map(|frame| frame.page_id.clone()),
                page_number: rotation.as_ref().map(|frame| frame.page_number as u32),
                page_count: input
                    .config
                    .pages
                    .iter()
                    .filter(|page| page.enabled)
                    .count() as u32,
                page_duration_seconds: rotation
                    .as_ref()
                    .map(|frame| frame.duration.as_secs() as u32),
                page_elapsed_seconds: rotation
                    .as_ref()
                    .map(|frame| frame.elapsed.as_secs() as u32),
                manual_afk: self.manual_afk_since.is_some(),
                vr_mode: input.headset.vr_mode,
            },
        }
    }

    pub fn prepare_manual(gate: ChatboxGate, text: &str) -> Result<String, ChatboxSendError> {
        if let ChatboxGate::Paused(reason) = gate {
            return Err(ChatboxSendError::Paused(reason));
        }
        let text = fit_chatbox_text(text);
        if text.is_empty() {
            return Err(ChatboxSendError::Empty);
        }
        Ok(text)
    }

    pub fn commit_manual(&mut self, now: Instant, text: String) {
        self.manual = Some(ManualHold {
            text: text.clone(),
            until: now + CHATBOX_MANUAL_HOLD,
        });
        self.last_sent = Some(SentText { text, at: now });
    }

    pub fn set_manual_afk(&mut self, now: Instant, afk: bool) {
        self.manual_afk_since = afk.then(|| self.manual_afk_since.unwrap_or(now));
    }

    pub fn restart_rotation(&mut self) {
        self.rotation_index = 0;
        self.page_started_at = None;
    }

    fn outgoing(&mut self, now: Instant, display: Option<String>) -> Option<String> {
        let text = display.unwrap_or_default();
        let should_send = match &self.last_sent {
            None => !text.is_empty(),
            Some(last) => {
                let elapsed = now.saturating_duration_since(last.at);
                if elapsed < CHATBOX_MIN_SEND_INTERVAL {
                    false
                } else if text == last.text {
                    !text.is_empty() && elapsed >= CHATBOX_REFRESH_INTERVAL
                } else {
                    true
                }
            }
        };
        if !should_send {
            return None;
        }
        self.last_sent = Some(SentText {
            text: text.clone(),
            at: now,
        });
        Some(text)
    }

    fn advance_rotation(
        &mut self,
        now: Instant,
        config: &ChatboxConfig,
        facts: &ChatboxFacts,
    ) -> Option<RotationFrame> {
        let pages = config
            .pages
            .iter()
            .filter(|page| page.enabled)
            .collect::<Vec<_>>();
        if pages.is_empty() {
            return None;
        }
        if self.rotation_index >= pages.len() {
            self.restart_rotation();
        }
        let started = *self.page_started_at.get_or_insert(now);
        if config.status_enabled
            && now.saturating_duration_since(started) >= page_duration(pages[self.rotation_index])
        {
            self.rotation_index = (self.rotation_index + 1) % pages.len();
            self.page_started_at = Some(now);
        }
        for _ in 0..pages.len() {
            let page = pages[self.rotation_index];
            let text = render_page(page, facts);
            if !text.is_empty() {
                return Some(RotationFrame {
                    page_id: page.id.clone(),
                    page_number: self.rotation_index + 1,
                    text,
                    duration: page_duration(page),
                    elapsed: now.saturating_duration_since(self.page_started_at.unwrap_or(now)),
                });
            }
            self.rotation_index = (self.rotation_index + 1) % pages.len();
            self.page_started_at = Some(now);
        }
        None
    }
}

fn page_duration(page: &ChatboxPage) -> Duration {
    Duration::from_secs(u64::from(page.seconds))
}
