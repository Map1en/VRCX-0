use std::time::Duration;

use vrcx_0_osc::AvatarParameterValue;

use super::config::HeartRateParameters;
use super::tracker::HeartRateReading;

pub const HEART_RATE_BEAT_PULSE: Duration = Duration::from_millis(50);
pub const HEART_RATE_FRAME_INTERVAL: Duration = Duration::from_secs(1);

const VRCOSC_BEAT_PARAMETER: &str = "VRCOSC/Heartrate/Beat";
const NORMALISED_MAX_BPM: f32 = 240.0;

pub fn heart_rate_parameters(
    reading: Option<HeartRateReading>,
    custom: &HeartRateParameters,
) -> Vec<(String, AvatarParameterValue)> {
    let connected = reading.is_some();
    let bpm = reading.map_or(0, |reading| reading.bpm);
    let average = reading.map_or(0, |reading| reading.average);
    let normalised = (f32::from(bpm) / NORMALISED_MAX_BPM).clamp(0.0, 1.0);
    let digit = |place: u16| AvatarParameterValue::Float(f32::from(bpm / place % 10) / 10.0);
    let fixed = [
        ("Connected", AvatarParameterValue::Bool(connected)),
        ("Enabled", AvatarParameterValue::Bool(connected)),
        ("Value", AvatarParameterValue::Int(i32::from(bpm))),
        ("Average", AvatarParameterValue::Int(i32::from(average))),
        ("Normalised", AvatarParameterValue::Float(normalised)),
        ("Units", digit(1)),
        ("Tens", digit(10)),
        ("Hundreds", digit(100)),
    ]
    .map(|(name, value)| (format!("VRCOSC/Heartrate/{name}"), value));
    let slots = [
        (&custom.value, AvatarParameterValue::Int(i32::from(bpm))),
        (&custom.connected, AvatarParameterValue::Bool(connected)),
        (&custom.percent, AvatarParameterValue::Float(normalised)),
    ];
    fixed
        .into_iter()
        .chain(
            slots
                .into_iter()
                .flat_map(|(names, value)| names.iter().map(move |name| (name.clone(), value))),
        )
        .collect()
}

pub fn heart_rate_beat_parameters(
    on: bool,
    custom: &HeartRateParameters,
) -> Vec<(String, AvatarParameterValue)> {
    std::iter::once(VRCOSC_BEAT_PARAMETER.to_string())
        .chain(custom.beat.iter().cloned())
        .map(|name| (name, AvatarParameterValue::Bool(on)))
        .collect()
}

pub fn heart_rate_beat_interval(bpm: u16) -> Duration {
    Duration::from_millis(60_000 / u64::from(bpm.max(1)))
}
