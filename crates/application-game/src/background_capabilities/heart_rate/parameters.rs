use std::time::Duration;

use vrcx_0_osc::AvatarParameterValue;

use super::tracker::HeartRateReading;

pub const HEART_RATE_BEAT_PARAMETERS: [&str; 2] = ["VRCOSC/Heartrate/Beat", "isHRBeat"];
pub const HEART_RATE_BEAT_PULSE: Duration = Duration::from_millis(50);
pub const HEART_RATE_FRAME_INTERVAL: Duration = Duration::from_secs(1);

const NORMALISED_MAX_BPM: f32 = 240.0;

pub fn heart_rate_parameters(
    reading: Option<HeartRateReading>,
) -> Vec<(&'static str, AvatarParameterValue)> {
    let connected = reading.is_some();
    let bpm = reading.map_or(0, |reading| reading.bpm);
    let average = reading.map_or(0, |reading| reading.average);
    let digit = |place: u16| AvatarParameterValue::Float(f32::from(bpm / place % 10) / 10.0);
    vec![
        ("HR", AvatarParameterValue::Int(i32::from(bpm))),
        (
            "VRCOSC/Heartrate/Connected",
            AvatarParameterValue::Bool(connected),
        ),
        (
            "VRCOSC/Heartrate/Enabled",
            AvatarParameterValue::Bool(connected),
        ),
        (
            "VRCOSC/Heartrate/Value",
            AvatarParameterValue::Int(i32::from(bpm)),
        ),
        (
            "VRCOSC/Heartrate/Average",
            AvatarParameterValue::Int(i32::from(average)),
        ),
        (
            "VRCOSC/Heartrate/Normalised",
            AvatarParameterValue::Float((f32::from(bpm) / NORMALISED_MAX_BPM).clamp(0.0, 1.0)),
        ),
        ("VRCOSC/Heartrate/Units", digit(1)),
        ("VRCOSC/Heartrate/Tens", digit(10)),
        ("VRCOSC/Heartrate/Hundreds", digit(100)),
    ]
}

pub fn heart_rate_beat_interval(bpm: u16) -> Duration {
    Duration::from_millis(60_000 / u64::from(bpm.max(1)))
}
