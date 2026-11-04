use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::time::Instant;

use chrono::{Local, Utc};
use vrcx_0_application_core::{HostSessionRuntime, RuntimeEventBus};
use vrcx_0_application_game::chatbox::{
    build_chatbox_facts, render_line_previews, sample_chatbox_facts, ChatboxConfig,
    ChatboxEditorState, ChatboxFactNeeds, ChatboxFactSources, ChatboxFacts, ChatboxFormats,
    ChatboxGate, ChatboxGpuStats, ChatboxHeadset, ChatboxLabels, ChatboxLinePreviewInput,
    ChatboxMedia, ChatboxPauseReason, ChatboxScheduler, ChatboxSendOutcome, ChatboxStatus,
    ChatboxSystemStats, ChatboxTickInput, ChatboxVariable, CHATBOX_CONFIG_KEY, CHATBOX_LIMITS,
};
use vrcx_0_application_game::IS_GAME_NO_VR_CONFIG_KEY;
use vrcx_0_host_desktop::gpu_usage::GpuUsageSampler;
use vrcx_0_host_desktop::media_session::current_media_session;
use vrcx_0_host_desktop::osc_udp::OscUdpSender;
use vrcx_0_host_desktop::system_usage::SystemUsageSampler;
use vrcx_0_i18n::{text, ChatboxKey};
use vrcx_0_osc::{chatbox_input_message, chatbox_typing_message};
use vrcx_0_persistence::config::ConfigRepository;

use crate::game_isolation::GameIsolationRuntime;

const APP_LANGUAGE_CONFIG_KEY: &str = "appLanguage";

pub struct ChatboxRuntime {
    config: ConfigRepository,
    session: HostSessionRuntime,
    game_isolation: GameIsolationRuntime,
    event_bus: RuntimeEventBus,
    previewing: AtomicBool,
    state: Mutex<ChatboxRuntimeState>,
}

#[derive(Default)]
struct ChatboxRuntimeState {
    scheduler: ChatboxScheduler,
    sender: OscUdpSender,
    system_usage: SystemUsageSampler,
    gpu_usage: GpuUsageSampler,
    settings: Option<ChatboxSettings>,
    status: Option<ChatboxStatus>,
}

#[derive(Clone)]
struct ChatboxSettings {
    generation: u64,
    config: ChatboxConfig,
    labels: ChatboxLabels,
    is_game_no_vr: bool,
}

impl ChatboxRuntime {
    pub(crate) fn new(
        config: ConfigRepository,
        session: HostSessionRuntime,
        game_isolation: GameIsolationRuntime,
        event_bus: RuntimeEventBus,
    ) -> Self {
        Self {
            config,
            session,
            game_isolation,
            event_bus,
            previewing: AtomicBool::new(false),
            state: Mutex::new(ChatboxRuntimeState::default()),
        }
    }

    pub fn editor_state(&self) -> ChatboxEditorState {
        let mut state = self.lock_state();
        ChatboxEditorState {
            config: self.settings(&mut state).config,
            limits: CHATBOX_LIMITS,
            variables: ChatboxVariable::ALL.to_vec(),
            default_formats: ChatboxFormats::default(),
        }
    }

    pub fn set_config(
        &self,
        next: ChatboxConfig,
    ) -> vrcx_0_application_core::Result<ChatboxConfig> {
        let next = next.normalized();
        let serialized = serde_json::to_string(&next)
            .map_err(|error| vrcx_0_application_core::Error::Custom(error.to_string()))?;
        let mut state = self.lock_state();
        let previous = self.settings(&mut state).config;
        self.config.set_string(CHATBOX_CONFIG_KEY, &serialized)?;
        if next.rotation_order_changed(&previous)
            || (next.status_enabled && !previous.status_enabled)
        {
            state.scheduler.restart_rotation();
        }
        drop(state);
        self.event_bus.emit(next.clone());
        Ok(next)
    }

    pub fn status(&self) -> Option<ChatboxStatus> {
        self.lock_state().status.clone()
    }

    pub fn set_previewing(&self, previewing: bool) {
        self.previewing.store(previewing, Ordering::Release);
    }

    pub fn send_manual(&self, text: &str) -> vrcx_0_application_core::Result<ChatboxSendOutcome> {
        let gate = self.gate(self.session.snapshot().is_game_running);
        let text = match ChatboxScheduler::prepare_manual(gate, text) {
            Ok(text) => text,
            Err(error) => return Ok(error.into()),
        };
        let mut state = self.lock_state();
        let config = self.settings(&mut state).config;
        Self::transmit(
            &mut state,
            &config,
            &chatbox_input_message(&text, config.messages.notify_sound),
        )
        .map_err(|error| vrcx_0_application_core::Error::Custom(error.to_string()))?;
        state.scheduler.commit_manual(Instant::now(), text.clone());
        Ok(ChatboxSendOutcome::Sent { text })
    }

    pub fn set_typing(&self, typing: bool) {
        if !matches!(
            self.gate(self.session.snapshot().is_game_running),
            ChatboxGate::Ready
        ) {
            return;
        }
        let mut state = self.lock_state();
        let config = self.settings(&mut state).config;
        if !config.messages.typing_indicator {
            return;
        }
        if let Err(error) = Self::transmit(&mut state, &config, &chatbox_typing_message(typing)) {
            tracing::warn!(error = %error, "chatbox typing indicator send failed");
        }
    }

    pub fn set_manual_afk(&self, afk: bool) {
        self.lock_state()
            .scheduler
            .set_manual_afk(Instant::now(), afk);
    }

    pub fn render_samples(&self, lines: &[ChatboxLinePreviewInput]) -> Vec<String> {
        render_line_previews(lines, &sample_chatbox_facts(Local::now().time()))
    }

    fn live_facts(
        state: &mut ChatboxRuntimeState,
        needs: ChatboxFactNeeds,
        is_game_running: bool,
        last_game_started_at: Option<&str>,
    ) -> ChatboxFacts {
        let media_session = needs
            .media
            .then(current_media_session)
            .flatten()
            .map(|media| ChatboxMedia {
                title: media.title,
                artist: media.artist,
                album: media.album,
                position_seconds: media.position_seconds,
                duration_seconds: media.duration_seconds,
            });
        let system = needs
            .system
            .then(|| state.system_usage.sample())
            .flatten()
            .map(|usage| ChatboxSystemStats {
                cpu_percent: usage.cpu_percent,
                memory_used_bytes: usage.memory_used_bytes,
                memory_total_bytes: usage.memory_total_bytes,
            });
        let gpu = needs
            .gpu
            .then(|| state.gpu_usage.sample())
            .flatten()
            .map(|usage| ChatboxGpuStats {
                usage_percent: usage.usage_percent,
                vram_used_bytes: usage.vram_used_bytes,
                vram_total_bytes: usage.vram_total_bytes,
                temperature_celsius: usage.temperature_celsius,
            });
        build_chatbox_facts(ChatboxFactSources {
            local_time: Local::now().time(),
            now: Utc::now(),
            media_session,
            system,
            gpu,
            is_game_running,
            last_game_started_at,
        })
    }

    pub(crate) fn tick(&self) {
        let session = self.session.snapshot();
        let gate = self.gate(session.is_game_running);
        let mut state = self.lock_state();
        let settings = self.settings(&mut state);
        let needs = settings
            .config
            .fact_needs(self.previewing.load(Ordering::Acquire));
        let facts = Self::live_facts(
            &mut state,
            needs,
            session.is_game_running,
            session.last_game_started_at.as_deref(),
        );
        let output = state.scheduler.tick(ChatboxTickInput {
            now: Instant::now(),
            config: &settings.config,
            gate,
            headset: ChatboxHeadset::new(
                session.is_steamvr_running,
                settings.is_game_no_vr,
                session.is_hmd_afk,
            ),
            facts: &facts,
            labels: &settings.labels,
        });
        if let Some(text) = &output.outgoing {
            if let Err(error) = Self::transmit(
                &mut state,
                &settings.config,
                &chatbox_input_message(text, false),
            ) {
                tracing::warn!(error = %error, "chatbox OSC send failed");
            }
        }
        let changed = state
            .status
            .as_ref()
            .is_none_or(|previous| !previous.same_except_elapsed(&output.status));
        state.status = Some(output.status.clone());
        drop(state);
        if changed {
            self.event_bus.emit(output.status);
        }
    }

    fn gate(&self, is_game_running: bool) -> ChatboxGate {
        if self.game_isolation.is_enabled() {
            ChatboxGate::Paused(ChatboxPauseReason::Isolated)
        } else if !is_game_running {
            ChatboxGate::Paused(ChatboxPauseReason::GameNotRunning)
        } else {
            ChatboxGate::Ready
        }
    }

    fn transmit(
        state: &mut ChatboxRuntimeState,
        config: &ChatboxConfig,
        payload: &[u8],
    ) -> std::io::Result<()> {
        state
            .sender
            .send(&config.osc_host, config.osc_port, payload)
    }

    fn settings(&self, state: &mut ChatboxRuntimeState) -> ChatboxSettings {
        let generation = self.config.write_generation();
        if let Some(settings) = state
            .settings
            .as_ref()
            .filter(|settings| settings.generation == generation)
        {
            return settings.clone();
        }
        let language = self
            .config
            .get_string(APP_LANGUAGE_CONFIG_KEY, "en")
            .unwrap_or_else(|_| "en".into());
        let settings = ChatboxSettings {
            generation,
            config: ChatboxConfig::from_stored(
                &self
                    .config
                    .get_string(CHATBOX_CONFIG_KEY, "")
                    .unwrap_or_default(),
            ),
            labels: ChatboxLabels {
                afk: text(&language, ChatboxKey::ChatboxAfk),
            },
            is_game_no_vr: self
                .config
                .get_bool(IS_GAME_NO_VR_CONFIG_KEY, false)
                .unwrap_or(false),
        };
        state.settings = Some(settings.clone());
        settings
    }

    fn lock_state(&self) -> MutexGuard<'_, ChatboxRuntimeState> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}
