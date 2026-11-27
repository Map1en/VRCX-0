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

fn parameter(frame: &[(String, AvatarParameterValue)], name: &str) -> Option<AvatarParameterValue> {
    frame
        .iter()
        .find(|(candidate, _)| candidate == name)
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
fn parameters_default_to_the_common_prefab_names() {
    assert_eq!(
        HeartRateParameters::from_stored(""),
        HeartRateParameters::default()
    );
    assert_eq!(HeartRateParameters::default().value, ["HR"]);
    assert_eq!(HeartRateParameters::default().beat, ["isHRBeat"]);
}

#[test]
fn parameter_names_are_trimmed_deduplicated_and_invalid_ones_dropped() {
    let parameters = HeartRateParameters {
        value: vec![
            " HR ".into(),
            "HR".into(),
            "/HeartRateInt".into(),
            "bad name".into(),
            "a,b".into(),
            String::new(),
        ],
        beat: Vec::new(),
        connected: vec!["isHRConnected".into()],
        percent: Vec::new(),
    }
    .normalized();

    assert_eq!(parameters.value, ["HR", "HeartRateInt"]);
    assert!(parameters.beat.is_empty());
    assert_eq!(parameters.connected, ["isHRConnected"]);
}

#[test]
fn connecting_again_forgets_the_previous_device_so_a_new_one_is_picked() {
    let config = HeartRateConfig::default()
        .connect()
        .remembering("old".into(), Some("Band".into()));

    let reconnected = HeartRateConfig::default().connect();

    assert!(config.device_id.is_some());
    assert!(reconnected.enabled);
    assert_eq!(reconnected.device_id, None);
    assert_eq!(reconnected.device_name, None);
}

#[test]
fn disconnecting_keeps_the_remembered_device() {
    let config = HeartRateConfig::default()
        .connect()
        .remembering("band".into(), Some("Band".into()))
        .disconnected();

    assert!(!config.enabled);
    assert_eq!(config.device_id.as_deref(), Some("band"));
}

#[test]
fn avatar_parameters_need_a_connection_their_own_switch_and_the_chatbox() {
    let connected = HeartRateConfig::default().connect();
    assert!(connected.sends_parameters(true));
    assert!(!connected.sends_parameters(false));
    assert!(!HeartRateConfig::default().sends_parameters(true));

    let muted = HeartRateConfig {
        send_parameters: false,
        ..connected
    };
    assert!(!muted.sends_parameters(true));
    assert!(!muted.clone().connect().send_parameters);
    assert!(!muted.forget_device().send_parameters);
}

#[test]
fn stored_config_from_before_the_parameter_switch_keeps_sending() {
    let config = HeartRateConfig::from_stored(r#"{"enabled":true,"deviceId":"band"}"#);

    assert!(config.send_parameters);
    assert!(config.sends_parameters(true));
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
    let frame = heart_rate_parameters(
        Some(HeartRateReading {
            bpm: 172,
            average: 150,
        }),
        &HeartRateParameters::default(),
    );

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
    let frame = heart_rate_parameters(None, &HeartRateParameters::default());

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
    let config = HeartRateConfig::default().connect();

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
    let config = HeartRateConfig::default()
        .connect()
        .remembering("band".into(), Some("Band".into()));
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

#[test]
fn custom_slots_receive_the_value_connection_and_percent() {
    let custom = HeartRateParameters {
        value: vec!["HeartRateInt".into(), "HR".into()],
        beat: Vec::new(),
        connected: vec!["isHRConnected".into()],
        percent: vec!["HRPercent".into()],
    };

    let frame = heart_rate_parameters(
        Some(HeartRateReading {
            bpm: 120,
            average: 110,
        }),
        &custom,
    );

    assert_eq!(
        parameter(&frame, "HeartRateInt"),
        Some(AvatarParameterValue::Int(120))
    );
    assert_eq!(
        parameter(&frame, "HR"),
        Some(AvatarParameterValue::Int(120))
    );
    assert_eq!(
        parameter(&frame, "isHRConnected"),
        Some(AvatarParameterValue::Bool(true))
    );
    assert_eq!(
        parameter(&frame, "HRPercent"),
        Some(AvatarParameterValue::Float(0.5))
    );
}

#[test]
fn clearing_a_slot_stops_sending_it_but_keeps_the_vrcosc_names() {
    let custom = HeartRateParameters {
        value: Vec::new(),
        beat: Vec::new(),
        connected: Vec::new(),
        percent: Vec::new(),
    };

    let frame = heart_rate_parameters(None, &custom);
    let beat = heart_rate_beat_parameters(true, &custom);

    assert_eq!(parameter(&frame, "HR"), None);
    assert!(parameter(&frame, "VRCOSC/Heartrate/Value").is_some());
    assert_eq!(
        beat,
        [(
            "VRCOSC/Heartrate/Beat".to_string(),
            AvatarParameterValue::Bool(true)
        )]
    );
}

#[test]
fn beat_pulses_go_to_vrcosc_and_every_custom_beat_name() {
    let beat = heart_rate_beat_parameters(false, &HeartRateParameters::default());

    assert_eq!(
        parameter(&beat, "isHRBeat"),
        Some(AvatarParameterValue::Bool(false))
    );
    assert_eq!(
        parameter(&beat, "VRCOSC/Heartrate/Beat"),
        Some(AvatarParameterValue::Bool(false))
    );
}

#[test]
fn stored_parameters_fill_missing_slots_with_defaults() {
    let stored = HeartRateParameters::from_stored(r#"{"value":["HeartRateInt"]}"#);

    assert_eq!(stored.value, ["HeartRateInt"]);
    assert_eq!(stored.beat, ["isHRBeat"]);
    assert_eq!(
        HeartRateParameters::from_stored("not json"),
        HeartRateParameters::default()
    );
}
