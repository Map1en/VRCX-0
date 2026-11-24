use std::time::{Duration, Instant};

use vrcx_0_osc::AvatarParameterValue;

use super::*;

fn measurement(bpm: u16) -> HeartRateMeasurement {
    HeartRateMeasurement {
        bpm,
        skin_contact: None,
    }
}

fn candidate(id: &str, rssi: Option<i16>, system_connected: bool) -> HeartRateCandidate {
    HeartRateCandidate {
        id: id.into(),
        name: None,
        rssi,
        system_connected,
    }
}

fn parameter(
    frame: &[(&'static str, AvatarParameterValue)],
    name: &str,
) -> Option<AvatarParameterValue> {
    frame
        .iter()
        .find(|(candidate, _)| *candidate == name)
        .map(|(_, value)| *value)
}

#[test]
fn unreadable_stored_config_falls_back_to_off() {
    assert_eq!(
        HeartRateConfig::from_stored("not json"),
        HeartRateConfig::default()
    );
    assert_eq!(HeartRateConfig::from_stored(""), HeartRateConfig::default());
}

#[test]
fn connecting_again_forgets_the_previous_device_so_a_new_one_is_picked() {
    let config = HeartRateConfig::connect().remembering("old".into(), Some("Band".into()));

    let reconnected = HeartRateConfig::connect();

    assert!(config.device_id.is_some());
    assert!(reconnected.enabled);
    assert_eq!(reconnected.device_id, None);
    assert_eq!(reconnected.device_name, None);
}

#[test]
fn disconnecting_keeps_the_remembered_device() {
    let config = HeartRateConfig::connect()
        .remembering("band".into(), Some("Band".into()))
        .disconnected();

    assert!(!config.enabled);
    assert_eq!(config.device_id.as_deref(), Some("band"));
}

#[test]
fn tracker_drops_out_of_range_readings_and_readings_without_skin_contact() {
    let mut tracker = HeartRateTracker::default();
    let now = Instant::now();

    assert!(!tracker.record(now, measurement(0)));
    assert!(!tracker.record(now, measurement(300)));
    assert!(!tracker.record(
        now,
        HeartRateMeasurement {
            bpm: 80,
            skin_contact: Some(false),
        }
    ));

    assert_eq!(tracker.reading(now), None);
}

#[test]
fn tracker_goes_quiet_ten_seconds_after_the_last_reading() {
    let mut tracker = HeartRateTracker::default();
    let start = Instant::now();
    tracker.record(start, measurement(72));

    assert!(tracker.reading(start + Duration::from_secs(10)).is_some());
    assert_eq!(tracker.reading(start + Duration::from_secs(11)), None);
}

#[test]
fn tracker_averages_the_last_ten_seconds() {
    let mut tracker = HeartRateTracker::default();
    let start = Instant::now();
    tracker.record(start, measurement(200));
    tracker.record(start + Duration::from_secs(11), measurement(60));
    tracker.record(start + Duration::from_secs(12), measurement(81));

    let reading = tracker.reading(start + Duration::from_secs(12));

    assert_eq!(
        reading,
        Some(HeartRateReading {
            bpm: 81,
            average: 71,
        })
    );
}

#[test]
fn parameters_cover_common_prefabs_and_the_vrcosc_names() {
    let frame = heart_rate_parameters(Some(HeartRateReading {
        bpm: 172,
        average: 150,
    }));

    assert_eq!(
        parameter(&frame, "VRCOSC/Heartrate/Connected"),
        Some(AvatarParameterValue::Bool(true))
    );
    assert_eq!(
        parameter(&frame, "VRCOSC/Heartrate/Value"),
        Some(AvatarParameterValue::Int(172))
    );
    assert_eq!(
        parameter(&frame, "HR"),
        Some(AvatarParameterValue::Int(172))
    );
    assert_eq!(
        parameter(&frame, "VRCOSC/Heartrate/Average"),
        Some(AvatarParameterValue::Int(150))
    );
    assert_eq!(
        parameter(&frame, "VRCOSC/Heartrate/Units"),
        Some(AvatarParameterValue::Float(0.2))
    );
    assert_eq!(
        parameter(&frame, "VRCOSC/Heartrate/Tens"),
        Some(AvatarParameterValue::Float(0.7))
    );
    assert_eq!(
        parameter(&frame, "VRCOSC/Heartrate/Hundreds"),
        Some(AvatarParameterValue::Float(0.1))
    );
    let Some(AvatarParameterValue::Float(normalised)) =
        parameter(&frame, "VRCOSC/Heartrate/Normalised")
    else {
        panic!("normalised parameter missing");
    };
    assert!((normalised - 172.0 / 240.0).abs() < f32::EPSILON);
}

#[test]
fn parameters_report_disconnected_with_zeroed_values_without_a_reading() {
    let frame = heart_rate_parameters(None);

    assert_eq!(
        parameter(&frame, "VRCOSC/Heartrate/Connected"),
        Some(AvatarParameterValue::Bool(false))
    );
    assert_eq!(
        parameter(&frame, "VRCOSC/Heartrate/Enabled"),
        Some(AvatarParameterValue::Bool(false))
    );
    assert_eq!(
        parameter(&frame, "VRCOSC/Heartrate/Value"),
        Some(AvatarParameterValue::Int(0))
    );
    assert_eq!(
        parameter(&frame, "VRCOSC/Heartrate/Normalised"),
        Some(AvatarParameterValue::Float(0.0))
    );
}

#[test]
fn beat_interval_is_one_period_per_beat() {
    assert_eq!(heart_rate_beat_interval(60), Duration::from_secs(1));
    assert_eq!(heart_rate_beat_interval(120), Duration::from_millis(500));
}

#[test]
fn first_pick_prefers_a_system_connected_device_then_the_strongest_signal() {
    let candidates = [
        candidate("far", Some(-90), false),
        candidate("near", Some(-40), false),
        candidate("system", None, true),
    ];

    assert_eq!(
        choose_heart_rate_device(&candidates, None).map(|candidate| candidate.id.as_str()),
        Some("system")
    );
    assert_eq!(
        choose_heart_rate_device(&candidates[..2], None).map(|candidate| candidate.id.as_str()),
        Some("near")
    );
}

#[test]
fn reconnecting_only_accepts_the_remembered_device() {
    let candidates = [
        candidate("neighbour", Some(-30), true),
        candidate("mine", Some(-80), false),
    ];

    assert_eq!(
        choose_heart_rate_device(&candidates, Some("mine")).map(|candidate| candidate.id.as_str()),
        Some("mine")
    );
    assert_eq!(choose_heart_rate_device(&candidates, Some("gone")), None);
}

#[test]
fn backoff_steps_up_to_thirty_seconds_and_resets() {
    let mut backoff = HeartRateBackoff::default();
    let delays: Vec<u64> = (0..5).map(|_| backoff.next_delay().as_secs()).collect();

    assert_eq!(delays, [2, 5, 10, 30, 30]);
    backoff.reset();
    assert_eq!(backoff.next_delay(), Duration::from_secs(2));
}

#[test]
fn status_greys_out_without_bluetooth_even_when_off() {
    let config = HeartRateConfig::default();

    let status = heart_rate_status(HeartRateStatusInput {
        config: &config,
        bluetooth_available: false,
        link: HeartRateLink::Waiting,
        reading: None,
        problem: None,
    });

    assert_eq!(status.phase, HeartRatePhase::Unavailable);
}

#[test]
fn status_keeps_reporting_enabled_when_bluetooth_drops_so_it_can_be_turned_off() {
    let config = HeartRateConfig::connect();

    let status = heart_rate_status(HeartRateStatusInput {
        config: &config,
        bluetooth_available: false,
        link: HeartRateLink::Waiting,
        reading: None,
        problem: None,
    });

    assert_eq!(status.phase, HeartRatePhase::Unavailable);
    assert!(status.enabled);
}

#[test]
fn status_shows_bpm_only_while_connected() {
    let config = HeartRateConfig::connect().remembering("band".into(), Some("Band".into()));
    let reading = Some(HeartRateReading {
        bpm: 72,
        average: 70,
    });
    let status = |link| {
        heart_rate_status(HeartRateStatusInput {
            config: &config,
            bluetooth_available: true,
            link,
            reading,
            problem: None,
        })
    };

    assert_eq!(status(HeartRateLink::Connected).bpm, Some(72));
    assert_eq!(status(HeartRateLink::Waiting).bpm, None);
    assert_eq!(
        status(HeartRateLink::Connected).device_name.as_deref(),
        Some("Band")
    );
}

#[test]
fn status_reports_why_it_stopped_once_turned_off() {
    let config = HeartRateConfig::default();

    let status = heart_rate_status(HeartRateStatusInput {
        config: &config,
        bluetooth_available: true,
        link: HeartRateLink::Waiting,
        reading: None,
        problem: Some(HeartRateProblem::Incompatible),
    });

    assert_eq!(status.phase, HeartRatePhase::Off);
    assert_eq!(status.problem, Some(HeartRateProblem::Incompatible));
}
