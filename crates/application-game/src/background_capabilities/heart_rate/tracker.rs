use std::collections::VecDeque;
use std::time::{Duration, Instant};

pub const HEART_RATE_MIN_BPM: u16 = 25;
pub const HEART_RATE_MAX_BPM: u16 = 250;
pub const HEART_RATE_STALE_AFTER: Duration = Duration::from_secs(10);
pub const HEART_RATE_AVERAGE_WINDOW: Duration = Duration::from_secs(10);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct HeartRateMeasurement {
    pub bpm: u16,
    pub skin_contact: Option<bool>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct HeartRateReading {
    pub bpm: u16,
    pub average: u16,
}

#[derive(Debug, Default)]
pub struct HeartRateTracker {
    samples: VecDeque<(Instant, u16)>,
}

impl HeartRateTracker {
    pub fn record(&mut self, at: Instant, measurement: HeartRateMeasurement) -> bool {
        let valid = (HEART_RATE_MIN_BPM..=HEART_RATE_MAX_BPM).contains(&measurement.bpm)
            && measurement.skin_contact != Some(false);
        if valid {
            self.samples.push_back((at, measurement.bpm));
            self.prune(at);
        }
        valid
    }

    pub fn reading(&self, now: Instant) -> Option<HeartRateReading> {
        let &(last_at, bpm) = self.samples.back()?;
        if now.saturating_duration_since(last_at) > HEART_RATE_STALE_AFTER {
            return None;
        }
        let window: Vec<u32> = self
            .samples
            .iter()
            .filter(|(at, _)| now.saturating_duration_since(*at) <= HEART_RATE_AVERAGE_WINDOW)
            .map(|(_, bpm)| u32::from(*bpm))
            .collect();
        let count = window.len().max(1) as u32;
        let average = (window.iter().sum::<u32>() + count / 2) / count;
        Some(HeartRateReading {
            bpm,
            average: u16::try_from(average).unwrap_or(bpm),
        })
    }

    pub fn clear(&mut self) {
        self.samples.clear();
    }

    fn prune(&mut self, now: Instant) {
        while self
            .samples
            .front()
            .is_some_and(|(at, _)| now.saturating_duration_since(*at) > HEART_RATE_AVERAGE_WINDOW)
        {
            self.samples.pop_front();
        }
    }
}
