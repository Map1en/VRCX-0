mod config;
mod connection;
mod parameters;
mod tracker;

pub use config::{HeartRateConfig, HEART_RATE_CONFIG_KEY};
pub use connection::{
    choose_heart_rate_device, heart_rate_status, HeartRateBackoff, HeartRateCandidate,
    HeartRateLink, HeartRatePhase, HeartRateProblem, HeartRateStatus, HeartRateStatusInput,
    HEART_RATE_ADAPTER_RECHECK, HEART_RATE_FIRST_PICK_WINDOW, HEART_RATE_RECONNECT_AFTER_SILENCE,
    HEART_RATE_SEARCH_WINDOW,
};
pub use parameters::{
    heart_rate_beat_interval, heart_rate_parameters, HEART_RATE_BEAT_PARAMETERS,
    HEART_RATE_BEAT_PULSE, HEART_RATE_FRAME_INTERVAL,
};
pub use tracker::{HeartRateMeasurement, HeartRateReading, HeartRateTracker};

#[cfg(test)]
mod tests;
