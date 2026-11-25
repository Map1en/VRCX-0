use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use tokio::sync::Notify;
use tokio::time::Instant;
use vrcx_0_application_core::{
    ConfigStore, HostSessionRuntime, RuntimeEventBus, TaskStopToken, TaskSupervisor,
};
use vrcx_0_application_game::chatbox::{ChatboxConfig, CHATBOX_CONFIG_KEY};
use vrcx_0_application_game::heart_rate::{
    choose_heart_rate_device, heart_rate_beat_interval, heart_rate_beat_parameters,
    heart_rate_parameters, heart_rate_status, HeartRateBackoff, HeartRateCandidate,
    HeartRateConfig, HeartRateLink, HeartRateMeasurement, HeartRateParameters,
    HeartRateParametersEditor, HeartRateProblem, HeartRateReading, HeartRateStatus,
    HeartRateStatusInput, HeartRateTracker, HEART_RATE_ADAPTER_RECHECK, HEART_RATE_BEAT_PULSE,
    HEART_RATE_CONFIG_KEY, HEART_RATE_FIRST_PICK_WINDOW, HEART_RATE_FRAME_INTERVAL,
    HEART_RATE_PARAMETERS_CONFIG_KEY, HEART_RATE_RECONNECT_AFTER_SILENCE, HEART_RATE_SEARCH_WINDOW,
};
use vrcx_0_host_desktop::heart_rate_ble::{
    heart_rate_bluetooth_available, HeartRateBleError, HeartRateBleEvent, HeartRateBleLink,
    HeartRateBluetooth,
};
use vrcx_0_host_desktop::osc_udp::OscUdpSender;
use vrcx_0_osc::{avatar_parameter_message, AvatarParameterValue};

use crate::game_isolation::GameIsolationRuntime;

const STOP_POLL: Duration = Duration::from_secs(1);
const IDLE_WAIT: Duration = Duration::from_secs(3600);

pub struct HeartRateRuntime {
    config: Arc<dyn ConfigStore>,
    session: HostSessionRuntime,
    game_isolation: GameIsolationRuntime,
    event_bus: RuntimeEventBus,
    started: AtomicBool,
    watching: AtomicBool,
    wake: Notify,
    state: Mutex<HeartRateState>,
}

struct HeartRateState {
    config: HeartRateConfig,
    generation: u64,
    bluetooth_available: bool,
    link: HeartRateLink,
    problem: Option<HeartRateProblem>,
    tracker: HeartRateTracker,
    status: Option<HeartRateStatus>,
    output: Option<OutputSettings>,
}

#[derive(Clone)]
struct OutputSettings {
    generation: u64,
    host: String,
    port: u16,
    parameters: HeartRateParameters,
}

impl HeartRateRuntime {
    pub(crate) fn new(
        config: Arc<dyn ConfigStore>,
        session: HostSessionRuntime,
        game_isolation: GameIsolationRuntime,
        event_bus: RuntimeEventBus,
    ) -> Self {
        let stored = HeartRateConfig::from_stored(
            &config
                .get_string(HEART_RATE_CONFIG_KEY, "")
                .unwrap_or_default(),
        );
        Self {
            config,
            session,
            game_isolation,
            event_bus,
            started: AtomicBool::new(false),
            watching: AtomicBool::new(false),
            wake: Notify::new(),
            state: Mutex::new(HeartRateState {
                config: stored,
                generation: 0,
                bluetooth_available: true,
                link: HeartRateLink::Waiting,
                problem: None,
                tracker: HeartRateTracker::default(),
                status: None,
                output: None,
            }),
        }
    }

    pub(crate) fn start(self: &Arc<Self>, tasks: &TaskSupervisor) {
        if self.started.swap(true, Ordering::AcqRel) {
            return;
        }
        let link_runtime = Arc::clone(self);
        tasks.spawn_cancellable(move |stop| async move { link_runtime.run_link(stop).await });
        let output_runtime = Arc::clone(self);
        tasks.spawn_cancellable(move |stop| async move { output_runtime.run_output(stop).await });
    }

    pub(crate) fn set_watching(&self, watching: bool) {
        if !self.watching.swap(watching, Ordering::AcqRel) && watching {
            self.wake.notify_one();
        }
    }

    pub fn refreshed_status(&self) -> HeartRateStatus {
        if !self.lock_state().config.enabled {
            self.wake.notify_one();
        }
        self.status()
    }

    pub fn status(&self) -> HeartRateStatus {
        Self::compute_status(&self.lock_state())
    }

    pub fn set_connected(
        &self,
        connected: bool,
    ) -> vrcx_0_application_core::Result<HeartRateStatus> {
        let mut state = self.lock_state();
        let next = if connected {
            HeartRateConfig::connect()
        } else {
            state.config.clone().disconnected()
        };
        self.persist(&next)?;
        state.config = next;
        state.problem = None;
        Self::reset_link(&mut state);
        drop(state);
        self.wake.notify_one();
        self.publish_status();
        Ok(self.status())
    }

    pub fn parameters_editor(&self) -> HeartRateParametersEditor {
        HeartRateParametersEditor {
            parameters: self.output_settings().parameters,
            defaults: HeartRateParameters::default(),
        }
    }

    pub fn set_parameters(
        &self,
        parameters: HeartRateParameters,
    ) -> vrcx_0_application_core::Result<HeartRateParameters> {
        let parameters = parameters.normalized();
        let serialized = serde_json::to_string(&parameters)
            .map_err(|error| vrcx_0_application_core::Error::Custom(error.to_string()))?;
        self.config
            .set_string(HEART_RATE_PARAMETERS_CONFIG_KEY, &serialized)?;
        Ok(parameters)
    }

    pub(crate) fn current_bpm(&self) -> Option<u16> {
        let state = self.lock_state();
        Self::live_reading(&state, Instant::now()).map(|reading| reading.bpm)
    }

    async fn run_link(&self, stop: TaskStopToken) {
        let mut backoff = HeartRateBackoff::default();
        let mut backoff_generation = None;
        while !stop.is_stop_requested() {
            let (config, generation) = {
                let state = self.lock_state();
                (state.config.clone(), state.generation)
            };
            if backoff_generation != Some(generation) {
                backoff_generation = Some(generation);
                backoff.reset();
            }
            if !config.enabled {
                let available = heart_rate_bluetooth_available().await;
                self.update(|state| state.bluetooth_available = available);
                let wait = if self.watching.load(Ordering::Acquire) {
                    HEART_RATE_ADAPTER_RECHECK
                } else {
                    IDLE_WAIT
                };
                if self.pause(wait, &stop).await {
                    return;
                }
                continue;
            }
            let delay = match self.attempt(&config, generation, &stop).await {
                Ok(None) => continue,
                Ok(Some(received)) => {
                    if received {
                        backoff.reset();
                    }
                    backoff.next_delay()
                }
                Err(HeartRateBleError::PermissionDenied) => {
                    self.stop_with(generation, HeartRateProblem::PermissionDenied, false);
                    continue;
                }
                Err(HeartRateBleError::Incompatible) => {
                    self.stop_with(generation, HeartRateProblem::Incompatible, true);
                    continue;
                }
                Err(HeartRateBleError::Unavailable) => {
                    self.update(|state| state.bluetooth_available = false);
                    HEART_RATE_ADAPTER_RECHECK
                }
                Err(HeartRateBleError::Failed(error)) => {
                    tracing::debug!(error = %error, "heart rate connection attempt failed");
                    backoff.next_delay()
                }
            };
            if self.pause(delay, &stop).await {
                return;
            }
        }
    }

    async fn attempt(
        &self,
        config: &HeartRateConfig,
        generation: u64,
        stop: &TaskStopToken,
    ) -> Result<Option<bool>, HeartRateBleError> {
        let bluetooth = HeartRateBluetooth::open().await?;
        self.update(|state| state.bluetooth_available = true);
        let remembered = config.device_id.as_deref();
        let window = if remembered.is_some() {
            HEART_RATE_SEARCH_WINDOW
        } else {
            HEART_RATE_FIRST_PICK_WINDOW
        };
        let superseded = || !self.is_current(generation);
        let devices = bluetooth.discover(window, remembered, &superseded).await?;
        if superseded() {
            return Ok(None);
        }
        let candidates: Vec<HeartRateCandidate> = devices
            .iter()
            .map(|device| HeartRateCandidate {
                id: device.id.clone(),
                name: device.name.clone(),
                rssi: device.rssi,
                system_connected: device.system_connected,
            })
            .collect();
        let chosen = choose_heart_rate_device(&candidates, remembered)
            .ok_or_else(|| HeartRateBleError::Failed("no heart rate device found".into()))?;
        let device = devices
            .iter()
            .find(|device| device.id == chosen.id)
            .ok_or_else(|| HeartRateBleError::Failed("chosen device vanished".into()))?;
        let link = bluetooth.connect(device).await?;
        if !self.remember(generation, chosen) {
            link.close().await;
            return Ok(None);
        }
        Ok(Some(self.pump(link, generation, stop).await))
    }

    async fn pump(
        &self,
        mut link: HeartRateBleLink,
        generation: u64,
        stop: &TaskStopToken,
    ) -> bool {
        let mut last_heard = Instant::now();
        let mut received = false;
        loop {
            tokio::select! {
                event = link.next_event() => match event {
                    HeartRateBleEvent::Measurement(measurement) => {
                        last_heard = Instant::now();
                        let accepted = {
                            let mut state = self.lock_state();
                            state.tracker.record(
                                Instant::now().into_std(),
                                HeartRateMeasurement {
                                    bpm: measurement.bpm,
                                    skin_contact: measurement.skin_contact,
                                },
                            )
                        };
                        if accepted {
                            received = true;
                            self.publish_status();
                        }
                    }
                    HeartRateBleEvent::Disconnected => break,
                },
                () = tokio::time::sleep(STOP_POLL) => {
                    if stop.is_stop_requested() || !self.is_current(generation) {
                        break;
                    }
                    if last_heard.elapsed() > HEART_RATE_RECONNECT_AFTER_SILENCE {
                        break;
                    }
                }
            }
        }
        link.close().await;
        self.update(|state| {
            if state.generation == generation {
                Self::reset_link(state);
            }
        });
        received
    }

    async fn run_output(&self, stop: TaskStopToken) {
        let mut sender = OscUdpSender::default();
        let mut next_frame = Instant::now();
        let mut next_beat: Option<Instant> = None;
        let mut beat_release: Option<Instant> = None;
        let mut owes_reset = false;
        while !stop.is_stop_requested() {
            let now = Instant::now();
            let (enabled, reading) = {
                let state = self.lock_state();
                (state.config.enabled, Self::live_reading(&state, now))
            };
            self.publish_status();
            let ready =
                self.session.snapshot().is_game_running && !self.game_isolation.is_enabled();
            if now >= next_frame {
                if ready && (enabled || owes_reset) {
                    let frame = heart_rate_parameters(reading, &self.output_settings().parameters);
                    self.send_frame(&mut sender, &frame);
                    owes_reset = reading.is_some();
                }
                next_frame = now + HEART_RATE_FRAME_INTERVAL;
            }
            match reading.filter(|_| ready) {
                Some(reading) => {
                    let due = *next_beat.get_or_insert(now);
                    if now >= due {
                        self.send_beat(&mut sender, true);
                        beat_release = Some(now + HEART_RATE_BEAT_PULSE);
                        next_beat = Some(now + heart_rate_beat_interval(reading.bpm));
                    }
                }
                None => next_beat = None,
            }
            if beat_release.is_some_and(|release| now >= release) {
                beat_release = None;
                if ready {
                    self.send_beat(&mut sender, false);
                }
            }
            let wake_at = [Some(next_frame), next_beat, beat_release]
                .into_iter()
                .flatten()
                .min()
                .unwrap_or(next_frame);
            tokio::time::sleep_until(wake_at).await;
        }
        let ready = self.session.snapshot().is_game_running && !self.game_isolation.is_enabled();
        if ready && owes_reset {
            let parameters = self.output_settings().parameters;
            self.send_frame(&mut sender, &heart_rate_parameters(None, &parameters));
            self.send_beat(&mut sender, false);
        }
    }

    fn send_beat(&self, sender: &mut OscUdpSender, on: bool) {
        let frame = heart_rate_beat_parameters(on, &self.output_settings().parameters);
        self.send_frame(sender, &frame);
    }

    fn send_frame(&self, sender: &mut OscUdpSender, frame: &[(String, AvatarParameterValue)]) {
        let OutputSettings { host, port, .. } = self.output_settings();
        for (name, value) in frame {
            if let Err(error) = sender.send(&host, port, &avatar_parameter_message(name, *value)) {
                tracing::debug!(error = %error, "heart rate OSC send failed");
                return;
            }
        }
    }

    fn output_settings(&self) -> OutputSettings {
        let generation = self.config.write_generation();
        if let Some(cached) = self
            .lock_state()
            .output
            .as_ref()
            .filter(|cached| cached.generation == generation)
        {
            return cached.clone();
        }
        let read = |key| self.config.get_string(key, "").unwrap_or_default();
        let chatbox = ChatboxConfig::from_stored(&read(CHATBOX_CONFIG_KEY));
        let settings = OutputSettings {
            generation,
            host: chatbox.osc_host,
            port: chatbox.osc_port,
            parameters: HeartRateParameters::from_stored(&read(HEART_RATE_PARAMETERS_CONFIG_KEY)),
        };
        self.lock_state().output = Some(settings.clone());
        settings
    }

    async fn pause(&self, duration: Duration, stop: &TaskStopToken) -> bool {
        let deadline = Instant::now() + duration;
        loop {
            if stop.is_stop_requested() {
                return true;
            }
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return false;
            }
            tokio::select! {
                () = self.wake.notified() => return false,
                () = tokio::time::sleep(remaining.min(STOP_POLL)) => {}
            }
        }
    }

    fn remember(&self, generation: u64, device: &HeartRateCandidate) -> bool {
        let mut state = self.lock_state();
        if state.generation != generation {
            return false;
        }
        let known = state.config.device_id.as_deref() == Some(device.id.as_str())
            && state.config.device_name == device.name;
        if !known {
            let next = state
                .config
                .clone()
                .remembering(device.id.clone(), device.name.clone());
            if let Err(error) = self.persist(&next) {
                tracing::warn!(error = %error, "failed to remember heart rate device");
            }
            state.config = next;
        }
        state.link = HeartRateLink::Connected;
        drop(state);
        self.publish_status();
        true
    }

    fn stop_with(&self, generation: u64, problem: HeartRateProblem, forget_device: bool) {
        let mut state = self.lock_state();
        if state.generation != generation {
            return;
        }
        let next = if forget_device {
            state.config.clone().forget_device()
        } else {
            state.config.clone().disconnected()
        };
        if let Err(error) = self.persist(&next) {
            tracing::warn!(error = %error, "failed to save heart rate state");
        }
        state.config = next;
        state.problem = Some(problem);
        Self::reset_link(&mut state);
        drop(state);
        self.publish_status();
    }

    fn reset_link(state: &mut HeartRateState) {
        state.generation = state.generation.wrapping_add(1);
        state.link = HeartRateLink::Waiting;
        state.tracker.clear();
    }

    fn is_current(&self, generation: u64) -> bool {
        self.lock_state().generation == generation
    }

    fn update(&self, change: impl FnOnce(&mut HeartRateState)) {
        change(&mut self.lock_state());
        self.publish_status();
    }

    fn publish_status(&self) {
        let mut state = self.lock_state();
        let status = Self::compute_status(&state);
        if state.status.as_ref() == Some(&status) {
            return;
        }
        state.status = Some(status.clone());
        drop(state);
        self.event_bus.emit(status);
    }

    fn compute_status(state: &HeartRateState) -> HeartRateStatus {
        heart_rate_status(HeartRateStatusInput {
            config: &state.config,
            bluetooth_available: state.bluetooth_available,
            link: state.link,
            reading: Self::live_reading(state, Instant::now()),
            problem: state.problem,
        })
    }

    fn live_reading(state: &HeartRateState, now: Instant) -> Option<HeartRateReading> {
        if !state.config.enabled || state.link != HeartRateLink::Connected {
            return None;
        }
        state.tracker.reading(now.into_std())
    }

    fn persist(&self, config: &HeartRateConfig) -> vrcx_0_application_core::Result<()> {
        let serialized = serde_json::to_string(config)
            .map_err(|error| vrcx_0_application_core::Error::Custom(error.to_string()))?;
        self.config.set_string(HEART_RATE_CONFIG_KEY, &serialized)
    }

    fn lock_state(&self) -> MutexGuard<'_, HeartRateState> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}
