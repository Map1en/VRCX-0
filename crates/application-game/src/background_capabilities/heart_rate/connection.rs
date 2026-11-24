use std::time::Duration;

use serde::Serialize;

use super::config::HeartRateConfig;
use super::tracker::HeartRateReading;

pub const HEART_RATE_FIRST_PICK_WINDOW: Duration = Duration::from_secs(3);
pub const HEART_RATE_SEARCH_WINDOW: Duration = Duration::from_secs(15);
pub const HEART_RATE_RECONNECT_AFTER_SILENCE: Duration = Duration::from_secs(30);
pub const HEART_RATE_ADAPTER_RECHECK: Duration = Duration::from_secs(3);

const BACKOFF_STEPS: [Duration; 4] = [
    Duration::from_secs(2),
    Duration::from_secs(5),
    Duration::from_secs(10),
    Duration::from_secs(30),
];

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HeartRateCandidate {
    pub id: String,
    pub name: Option<String>,
    pub rssi: Option<i16>,
    pub system_connected: bool,
}

pub fn choose_heart_rate_device<'a>(
    candidates: &'a [HeartRateCandidate],
    remembered: Option<&str>,
) -> Option<&'a HeartRateCandidate> {
    if let Some(remembered) = remembered {
        return candidates
            .iter()
            .find(|candidate| candidate.id == remembered);
    }
    candidates.iter().max_by_key(|candidate| {
        (
            candidate.system_connected,
            candidate.rssi.unwrap_or(i16::MIN),
        )
    })
}

#[derive(Debug, Default)]
pub struct HeartRateBackoff {
    attempt: usize,
}

impl HeartRateBackoff {
    pub fn next_delay(&mut self) -> Duration {
        let delay = BACKOFF_STEPS[self.attempt.min(BACKOFF_STEPS.len() - 1)];
        self.attempt = self.attempt.saturating_add(1);
        delay
    }

    pub fn reset(&mut self) {
        self.attempt = 0;
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum HeartRatePhase {
    Unavailable,
    Off,
    Waiting,
    Connected,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum HeartRateProblem {
    Incompatible,
    PermissionDenied,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HeartRateLink {
    Waiting,
    Connected,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct HeartRateStatus {
    pub enabled: bool,
    pub phase: HeartRatePhase,
    pub device_name: Option<String>,
    pub bpm: Option<u16>,
    pub problem: Option<HeartRateProblem>,
}

impl vrcx_0_contracts::RuntimeEventPayload for HeartRateStatus {
    const EVENT_NAME: &'static str = "heartRateState";
}

pub struct HeartRateStatusInput<'a> {
    pub config: &'a HeartRateConfig,
    pub bluetooth_available: bool,
    pub link: HeartRateLink,
    pub reading: Option<HeartRateReading>,
    pub problem: Option<HeartRateProblem>,
}

pub fn heart_rate_status(input: HeartRateStatusInput<'_>) -> HeartRateStatus {
    let phase = if !input.bluetooth_available {
        HeartRatePhase::Unavailable
    } else if !input.config.enabled {
        HeartRatePhase::Off
    } else {
        match input.link {
            HeartRateLink::Waiting => HeartRatePhase::Waiting,
            HeartRateLink::Connected => HeartRatePhase::Connected,
        }
    };
    HeartRateStatus {
        enabled: input.config.enabled,
        phase,
        device_name: input.config.device_name.clone(),
        bpm: input
            .reading
            .filter(|_| phase == HeartRatePhase::Connected)
            .map(|reading| reading.bpm),
        problem: input.problem.filter(|_| !input.config.enabled),
    }
}
