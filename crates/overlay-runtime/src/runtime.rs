use std::collections::{BTreeSet, VecDeque};
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Condvar, Mutex,
};
use std::thread::{self, ThreadId};
use std::time::{Duration, Instant};

use serde::Serialize;
use vrcx_0_application_activity::notification::unresolved_group_id;
use vrcx_0_application_activity::ActivitySnapshot;
use vrcx_0_application_core::{GameProcessEvent, GameProcessEventSink, TaskSupervisor};
use vrcx_0_vr_overlay_backend::VrDeviceSnapshot;

use crate::VrOverlayRuntimeServices;

use super::{
    avatar_cache::AvatarBitmapCache,
    config::VrOverlayRuntimeConfig,
    eligibility::{VrOverlayEligibility, WristOverlayStartMode},
    manager::VrOverlayManager,
    service::HostVrOverlayService,
    surfaces::hmd_toast::HmdToastState,
    tracker_watch::{TrackerDisconnect, TrackerWatch},
};

mod activity_sink;
pub(crate) mod frame;
mod surface_layout;
mod text;

pub(crate) use super::config::load_runtime_config;
pub use super::config::VR_OVERLAY_ENABLED_CONFIG_KEY;
pub use activity_sink::VrOverlayActivitySink;

use frame::{
    clear_slint_hmd_renderer, clear_slint_wrist_renderer, RuntimeWristFrameProducer,
    StaticWristFrameProducer, VrOverlayFrameProducer, VrOverlayFrameProducerFactory,
};
use surface_layout::{overlay_surface_configs, surface_active_for_start_mode, wrist_surface_ids};

type HmdFriendMembershipProvider = Arc<dyn Fn(&str) -> bool + Send + Sync>;

const WRIST_DEVICE_REFRESH_INTERVAL: Duration = Duration::from_secs(5);
const WRIST_FRAME_REFRESH_INTERVAL: Duration = Duration::from_secs(1);

struct VrOverlayFrameInput {
    config: VrOverlayRuntimeConfig,
    devices: Vec<VrDeviceSnapshot>,
    wrist_visible: bool,
    test_mode: bool,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct ActiveOverlaySurfaces {
    wrist: bool,
    hmd: bool,
}

impl ActiveOverlaySurfaces {
    fn any(self) -> bool {
        self.wrist || self.hmd
    }
}

#[derive(Default)]
struct RefreshWake {
    sequence: Mutex<u64>,
    condvar: Condvar,
}

impl RefreshWake {
    fn new() -> Self {
        Self::default()
    }

    fn notify(&self) {
        if let Ok(mut sequence) = self.sequence.lock() {
            *sequence = sequence.wrapping_add(1);
        }
        self.condvar.notify_one();
    }

    fn wait_timeout(&self, timeout: Duration, observed_sequence: &mut u64) {
        let Ok(mut sequence) = self.sequence.lock() else {
            std::thread::sleep(timeout);
            return;
        };
        if *sequence == *observed_sequence {
            let Ok((next_sequence, _)) = self.condvar.wait_timeout(sequence, timeout) else {
                return;
            };
            sequence = next_sequence;
        }
        *observed_sequence = *sequence;
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrOverlayRuntimeSnapshot {
    pub enabled: bool,
    pub backend_available: bool,
    pub running: bool,
    pub steamvr_running: bool,
    pub active_backend: Option<String>,
    pub test_mode: bool,
}

pub struct VrOverlayRuntime {
    enabled: AtomicBool,
    test_mode: AtomicBool,
    game_running: AtomicBool,
    steamvr_running: AtomicBool,
    refresh_loop_started: AtomicBool,
    wrist_frame_release_requested: AtomicBool,
    hmd_frame_release_requested: AtomicBool,
    device_refresh_requested: AtomicBool,
    config_dirty: AtomicBool,
    hmd_afk: AtomicBool,
    config_generation: AtomicU64,
    backend_available: bool,
    pub(crate) services: Option<Arc<dyn VrOverlayRuntimeServices>>,
    config: Mutex<VrOverlayRuntimeConfig>,
    hmd_friend_membership_provider: Mutex<Option<HmdFriendMembershipProvider>>,
    refresh_wake: Arc<RefreshWake>,
    devices: Mutex<Vec<VrDeviceSnapshot>>,
    tracker_watch: Mutex<TrackerWatch>,
    pub(crate) hmd_toasts: Mutex<VecDeque<HmdToastState>>,
    pub(crate) avatar_bitmap_cache: Arc<AvatarBitmapCache>,
    pub(crate) manager: Mutex<VrOverlayManager<HostVrOverlayService>>,
    running_mirror: AtomicBool,
    active_backend_mirror: Mutex<Option<&'static str>>,
    refresh_thread_id: Mutex<Option<ThreadId>>,
    frame_producer_factory: VrOverlayFrameProducerFactory,
    frame_producer: Mutex<Option<Box<dyn VrOverlayFrameProducer>>>,
}

impl VrOverlayRuntime {
    fn prefetch_wrist_group_names(self: &Arc<Self>, snapshot: &ActivitySnapshot) {
        let Some(services) = self.services.clone() else {
            return;
        };
        let group_ids = snapshot
            .entries
            .iter()
            .filter_map(|entry| unresolved_group_id(&entry.content))
            .filter(|group_id| services.cached_notification_group_name(group_id).is_none())
            .collect::<BTreeSet<_>>();
        if group_ids.is_empty() {
            return;
        }
        let endpoint = services.auth_scope().snapshot().endpoint;
        if endpoint.trim().is_empty() {
            return;
        }
        let runtime = Arc::downgrade(self);
        let tasks = services.tasks().clone();
        tasks.spawn(async move {
            let mut resolved = false;
            for group_id in group_ids {
                resolved |= services
                    .notification_group_name(&endpoint, &group_id)
                    .await
                    .is_some();
            }
            if let Some(runtime) = runtime.upgrade().filter(|_| resolved) {
                runtime.reconcile_current();
            }
        });
    }

    pub fn new<S>(services: Arc<S>) -> Self
    where
        S: VrOverlayRuntimeServices + 'static,
    {
        let config = load_runtime_config(services.as_ref());
        let services: Arc<dyn VrOverlayRuntimeServices> = services;
        let producer_services = Arc::clone(&services);
        Self::new_with_frame_producer_factory(
            HostVrOverlayService::backend_available(),
            Some(services.clone()),
            config,
            Box::new(move || {
                Box::new(RuntimeWristFrameProducer::new(Arc::clone(
                    &producer_services,
                )))
            }),
        )
    }

    pub fn new_for_test() -> Self {
        Self::new_for_test_with_backend_available(true)
    }

    pub fn new_for_test_with_backend_available(backend_available: bool) -> Self {
        Self::new_with_frame_producer_factory(
            backend_available,
            None,
            VrOverlayRuntimeConfig::default(),
            Box::new(|| Box::<StaticWristFrameProducer>::default()),
        )
    }

    fn new_with_frame_producer_factory(
        backend_available: bool,
        services: Option<Arc<dyn VrOverlayRuntimeServices>>,
        config: VrOverlayRuntimeConfig,
        frame_producer_factory: VrOverlayFrameProducerFactory,
    ) -> Self {
        let service_configs = Vec::new();
        let service = if services.is_some() {
            HostVrOverlayService::new_with_preference(service_configs, config.backend)
        } else {
            HostVrOverlayService::new_noop(service_configs)
        };
        let config_generation = services
            .as_ref()
            .map_or(0, |services| services.config().write_generation());
        Self {
            enabled: AtomicBool::new(false),
            test_mode: AtomicBool::new(false),
            game_running: AtomicBool::new(false),
            steamvr_running: AtomicBool::new(false),
            refresh_loop_started: AtomicBool::new(false),
            wrist_frame_release_requested: AtomicBool::new(false),
            hmd_frame_release_requested: AtomicBool::new(false),
            device_refresh_requested: AtomicBool::new(false),
            config_dirty: AtomicBool::new(false),
            hmd_afk: AtomicBool::new(false),
            config_generation: AtomicU64::new(config_generation),
            backend_available,
            services,
            manager: Mutex::new(VrOverlayManager::new(service)),
            running_mirror: AtomicBool::new(false),
            active_backend_mirror: Mutex::new(None),
            refresh_thread_id: Mutex::new(None),
            config: Mutex::new(config),
            hmd_friend_membership_provider: Mutex::new(None),
            refresh_wake: Arc::new(RefreshWake::new()),
            devices: Mutex::new(Vec::new()),
            tracker_watch: Mutex::new(TrackerWatch::default()),
            hmd_toasts: Mutex::new(VecDeque::new()),
            avatar_bitmap_cache: Arc::new(AvatarBitmapCache::new()),
            frame_producer_factory,
            frame_producer: Mutex::new(None),
        }
    }

    pub fn set_enabled(&self, enabled: bool) {
        if enabled && !self.backend_available {
            tracing::warn!("no VR overlay backend is available in this build");
        }
        self.enabled.store(enabled, Ordering::Release);
        self.reconcile(true, true);
        if !enabled && !self.current_runtime_config().hmd.enabled {
            self.release_frame_producer();
        }
    }

    pub fn set_test_mode(&self, test_mode: bool) {
        if self.test_mode.swap(test_mode, Ordering::AcqRel) == test_mode {
            return;
        }
        if !test_mode {
            self.clear_hmd_toasts();
        }
        self.reconcile(true, true);
        if !test_mode && !self.enabled.load(Ordering::Acquire) {
            self.release_frame_producer();
        }
    }

    pub fn is_test_mode(&self) -> bool {
        self.test_mode.load(Ordering::Acquire)
    }

    pub fn start_refresh_loop(self: &Arc<Self>, tasks: TaskSupervisor) {
        if self.refresh_loop_started.swap(true, Ordering::AcqRel) {
            return;
        }
        let runtime = Arc::clone(self);
        tasks.spawn_cancellable_thread("vr-overlay-refresh", move |stop_token| {
            runtime.set_refresh_thread_id(thread::current().id());
            let mut next_device_refresh = Instant::now();
            let mut refresh_wake_sequence = 0;
            while !stop_token.is_stop_requested() {
                runtime
                    .refresh_wake
                    .wait_timeout(runtime.refresh_interval(), &mut refresh_wake_sequence);
                if stop_token.is_stop_requested() {
                    break;
                }
                runtime.consume_slint_renderer_release_requests();
                if runtime.has_active_surface() || runtime.has_pending_config_change() {
                    let now = Instant::now();
                    let refresh_devices =
                        now >= next_device_refresh || runtime.consume_device_refresh_request();
                    runtime.reconcile(refresh_devices, false);
                    if refresh_devices {
                        next_device_refresh = now + WRIST_DEVICE_REFRESH_INTERVAL;
                    }
                }
                runtime.report_hmd_afk();
            }
            runtime.clear_refresh_thread_id();
        });
    }

    fn set_refresh_thread_id(&self, thread_id: ThreadId) {
        if let Ok(mut current) = self.refresh_thread_id.lock() {
            *current = Some(thread_id);
        }
    }

    fn clear_refresh_thread_id(&self) {
        if let Ok(mut current) = self.refresh_thread_id.lock() {
            *current = None;
        }
    }

    fn is_refresh_thread(&self) -> bool {
        self.refresh_thread_id
            .lock()
            .ok()
            .and_then(|current| *current)
            .is_some_and(|thread_id| thread_id == thread::current().id())
    }

    fn should_defer_slint_render_to_refresh_thread(&self) -> bool {
        self.services.is_some() && !self.is_refresh_thread()
    }
}

impl VrOverlayRuntime {
    pub fn stop_detached(&self) {
        if let Ok(mut manager) = self.manager.lock() {
            manager.stop_detached();
            self.refresh_manager_mirror(&manager);
        }
        self.release_frame_producer();
    }

    pub fn is_enabled(&self) -> bool {
        self.enabled.load(Ordering::Acquire)
    }

    fn has_active_surface(&self) -> bool {
        self.active_surfaces(self.current_runtime_config()).any()
    }

    pub fn set_hmd_friend_membership_provider<F>(&self, provider: F)
    where
        F: Fn(&str) -> bool + Send + Sync + 'static,
    {
        if let Ok(mut current) = self.hmd_friend_membership_provider.lock() {
            *current = Some(Arc::new(provider));
        }
    }

    pub(crate) fn is_current_hmd_friend(&self, user_id: &str) -> bool {
        let user_id = user_id.trim();
        if !user_id.starts_with("usr_") {
            return false;
        }
        let provider = self
            .hmd_friend_membership_provider
            .lock()
            .ok()
            .and_then(|provider| provider.clone());
        provider.is_some_and(|provider| provider(user_id))
    }
}

impl VrOverlayRuntime {
    fn refresh_interval(&self) -> Duration {
        match self.hmd_toast_refresh_hint(Instant::now()) {
            Some(hint) => WRIST_FRAME_REFRESH_INTERVAL.min(hint),
            None => WRIST_FRAME_REFRESH_INTERVAL,
        }
    }

    pub fn snapshot(&self) -> VrOverlayRuntimeSnapshot {
        let (running, active_backend) = if let Ok(manager) = self.manager.try_lock() {
            let running = manager.is_running();
            let active_backend = manager.active_backend();
            self.refresh_manager_mirror(&manager);
            (running, active_backend.map(str::to_string))
        } else {
            (
                self.running_mirror.load(Ordering::Acquire),
                self.active_backend_mirror(),
            )
        };
        VrOverlayRuntimeSnapshot {
            enabled: self.enabled.load(Ordering::Acquire),
            backend_available: self.backend_available,
            running,
            steamvr_running: self.steamvr_running.load(Ordering::Acquire),
            active_backend,
            test_mode: self.test_mode.load(Ordering::Acquire),
        }
    }

    pub fn is_running(&self) -> bool {
        if let Ok(manager) = self.manager.try_lock() {
            let running = manager.is_running();
            self.refresh_manager_mirror(&manager);
            return running;
        }
        self.running_mirror.load(Ordering::Acquire)
    }

    fn refresh_manager_mirror(&self, manager: &VrOverlayManager<HostVrOverlayService>) {
        self.running_mirror
            .store(manager.is_running(), Ordering::Release);
        if let Ok(mut active_backend) = self.active_backend_mirror.lock() {
            *active_backend = manager.active_backend();
        }
    }

    fn active_backend_mirror(&self) -> Option<String> {
        self.active_backend_mirror
            .lock()
            .ok()
            .and_then(|active_backend| *active_backend)
            .map(str::to_string)
    }

    fn update_process_status(&self, game_running: bool, steamvr_running: bool) {
        let previous_game_running = self.game_running.swap(game_running, Ordering::AcqRel);
        if previous_game_running && !game_running {
            self.avatar_bitmap_cache.clear();
        }
        self.steamvr_running
            .store(steamvr_running, Ordering::Release);
        self.reconcile(true, false);
    }

    pub fn reconcile_current(&self) {
        self.reconcile(false, false);
    }

    pub fn mark_config_dirty(&self) {
        self.config_dirty.store(true, Ordering::Release);
        self.refresh_wake.notify();
    }

    fn has_pending_config_change(&self) -> bool {
        self.config_dirty.load(Ordering::Acquire)
            || self.services.as_ref().is_some_and(|services| {
                services.config().write_generation()
                    != self.config_generation.load(Ordering::Acquire)
            })
    }

    fn report_hmd_afk(&self) {
        let Some(services) = &self.services else {
            return;
        };
        let is_hmd_afk = self
            .manager
            .lock()
            .is_ok_and(|manager| manager.hmd_user_present() == Some(false));
        if self.hmd_afk.swap(is_hmd_afk, Ordering::AcqRel) != is_hmd_afk {
            services.set_hmd_afk(is_hmd_afk);
        }
    }

    fn config_generation_advanced(&self) -> bool {
        let Some(services) = &self.services else {
            return false;
        };
        let generation = services.config().write_generation();
        self.config_generation.swap(generation, Ordering::AcqRel) != generation
    }

    fn reconcile(&self, refresh_devices: bool, reload_config: bool) {
        if self.is_refresh_thread() {
            self.consume_slint_renderer_release_requests();
        }
        let changed_config = if reload_config
            || self.config_dirty.swap(false, Ordering::AcqRel)
            || self.config_generation_advanced()
        {
            self.changed_runtime_config()
        } else {
            None
        };
        let mut tracker_disconnect = None;
        if let Ok(mut manager) = self.manager.lock() {
            let mut config = self.current_runtime_config();
            if let Some(next_config) = changed_config {
                if config.backend != next_config.backend {
                    manager.set_backend_preference(next_config.backend);
                }
                let clear_devices = config.should_clear_device_snapshot_for(next_config);
                self.commit_runtime_config(next_config, clear_devices);
                config = next_config;
            }
            let game_running = self.game_running.load(Ordering::Acquire);
            let steamvr_running = self.steamvr_running.load(Ordering::Acquire);
            let active_surfaces =
                self.active_surfaces_for_state(config, game_running, steamvr_running);
            if active_surfaces.any() {
                let configs = overlay_surface_configs(active_surfaces, config, self);
                if let Err(error) = manager.set_surface_configs(configs) {
                    tracing::warn!(
                        error = %error,
                        "failed to apply VR overlay surface config"
                    );
                }
            } else {
                self.clear_hmd_toasts();
            }
            let eligibility = VrOverlayEligibility {
                enabled: active_surfaces.any(),
                backend_available: self.backend_available,
                game_running,
                steamvr_running,
                start_mode: WristOverlayStartMode::SteamVr,
            };
            manager.reconcile(eligibility);
            if eligibility.can_run() && manager.is_running() {
                let defer_render = self.should_defer_slint_render_to_refresh_thread();
                if !defer_render {
                    tracker_disconnect = self.refresh_devices_if_needed(
                        &mut manager,
                        refresh_devices,
                        active_surfaces.wrist && config.render.show_devices,
                        active_surfaces.hmd && config.hmd.tracker_disconnect,
                    );
                }
                if active_surfaces.wrist {
                    if defer_render {
                        self.defer_refresh_to_refresh_thread(refresh_devices);
                    } else {
                        self.push_wrist_frame(&mut manager, config);
                    }
                } else {
                    self.release_frame_producer();
                }
                if active_surfaces.hmd {
                    if self.should_defer_slint_render_to_refresh_thread() {
                        self.refresh_wake.notify();
                    } else {
                        self.push_hmd_frame(&mut manager, config, Instant::now());
                    }
                } else {
                    self.clear_hmd_toasts();
                }
            } else {
                self.reset_tracker_watch();
                self.release_frame_producer();
            }
            self.refresh_manager_mirror(&manager);
        }
        if let Some(disconnect) = tracker_disconnect {
            self.deliver_tracker_disconnect_toast(disconnect);
        }
    }

    fn defer_refresh_to_refresh_thread(&self, refresh_devices: bool) {
        if refresh_devices {
            self.device_refresh_requested.store(true, Ordering::Release);
        }
        self.refresh_wake.notify();
    }

    fn consume_device_refresh_request(&self) -> bool {
        self.device_refresh_requested.swap(false, Ordering::AcqRel)
    }

    pub(crate) fn is_hmd_surface_active(&self, config: VrOverlayRuntimeConfig) -> bool {
        self.active_surfaces(config).hmd
    }

    pub(crate) fn active_surfaces(&self, config: VrOverlayRuntimeConfig) -> ActiveOverlaySurfaces {
        self.active_surfaces_for_state(
            config,
            self.game_running.load(Ordering::Acquire),
            self.steamvr_running.load(Ordering::Acquire),
        )
    }

    fn active_surfaces_for_state(
        &self,
        config: VrOverlayRuntimeConfig,
        game_running: bool,
        steamvr_running: bool,
    ) -> ActiveOverlaySurfaces {
        let test_mode =
            self.test_mode.load(Ordering::Acquire) && self.backend_available && steamvr_running;
        ActiveOverlaySurfaces {
            wrist: test_mode
                || surface_active_for_start_mode(
                    self.enabled.load(Ordering::Acquire),
                    config.start_mode,
                    self.backend_available,
                    steamvr_running,
                    game_running,
                ),
            hmd: test_mode
                || surface_active_for_start_mode(
                    config.hmd.enabled,
                    config.hmd.start_mode,
                    self.backend_available,
                    steamvr_running,
                    game_running,
                ),
        }
    }

    fn changed_runtime_config(&self) -> Option<VrOverlayRuntimeConfig> {
        let Some(services) = &self.services else {
            return None;
        };
        let next_config = load_runtime_config(services.as_ref());
        let Ok(current_config) = self.config.lock() else {
            return None;
        };
        if *current_config == next_config {
            return None;
        }
        Some(next_config)
    }

    fn commit_runtime_config(&self, next_config: VrOverlayRuntimeConfig, clear_devices: bool) {
        let Ok(mut current_config) = self.config.lock() else {
            return;
        };
        if *current_config == next_config {
            return;
        }
        *current_config = next_config;
        if clear_devices {
            if let Ok(mut devices) = self.devices.lock() {
                devices.clear();
            }
        }
    }

    pub(crate) fn current_runtime_config(&self) -> VrOverlayRuntimeConfig {
        self.config.lock().map(|config| *config).unwrap_or_default()
    }

    fn refresh_devices_if_needed(
        &self,
        manager: &mut VrOverlayManager<HostVrOverlayService>,
        refresh_devices: bool,
        show_devices: bool,
        watch_trackers: bool,
    ) -> Option<TrackerDisconnect> {
        if !self.prepare_device_refresh(refresh_devices, show_devices, watch_trackers) {
            return None;
        }
        match manager.snapshot_devices() {
            Ok(next_devices) => {
                self.apply_device_snapshot(next_devices, show_devices, watch_trackers)
            }
            Err(error) => {
                tracing::warn!(error = %error, "failed to snapshot VR overlay devices");
                None
            }
        }
    }

    fn prepare_device_refresh(
        &self,
        refresh_devices: bool,
        show_devices: bool,
        watch_trackers: bool,
    ) -> bool {
        if !show_devices {
            if let Ok(mut devices) = self.devices.lock() {
                devices.clear();
            }
        }
        if !watch_trackers {
            self.reset_tracker_watch();
        }
        let devices_empty = self
            .devices
            .lock()
            .map(|devices| devices.is_empty())
            .unwrap_or(true);
        (refresh_devices && (show_devices || watch_trackers)) || (show_devices && devices_empty)
    }

    fn apply_device_snapshot(
        &self,
        next_devices: Vec<VrDeviceSnapshot>,
        show_devices: bool,
        watch_trackers: bool,
    ) -> Option<TrackerDisconnect> {
        let disconnect = if watch_trackers {
            self.tracker_watch
                .lock()
                .ok()
                .and_then(|mut watch| watch.observe(&next_devices))
        } else {
            None
        };
        if show_devices {
            if let Ok(mut devices) = self.devices.lock() {
                *devices = next_devices;
            }
        }
        disconnect
    }

    fn reset_tracker_watch(&self) {
        if let Ok(mut watch) = self.tracker_watch.lock() {
            watch.reset();
        }
    }

    fn push_wrist_frame(
        &self,
        manager: &mut VrOverlayManager<HostVrOverlayService>,
        config: VrOverlayRuntimeConfig,
    ) {
        let devices = self
            .devices
            .lock()
            .map(|devices| devices.clone())
            .unwrap_or_default();
        let wrist_visible = wrist_surface_ids(config.hand)
            .iter()
            .any(|surface_id| manager.is_surface_visible(surface_id));
        let frame = match self
            .frame_producer
            .lock()
            .map_err(|_| "wrist frame producer lock poisoned".to_string())
            .and_then(|mut producer| {
                let producer = producer.get_or_insert_with(|| (self.frame_producer_factory)());
                producer.next_frame(VrOverlayFrameInput {
                    config,
                    devices,
                    wrist_visible,
                    test_mode: self.is_test_mode(),
                })
            }) {
            Ok(frame) => frame,
            Err(error) => {
                tracing::warn!(error = %error, "failed to render wrist overlay frame");
                return;
            }
        };

        for surface_id in wrist_surface_ids(config.hand) {
            if let Err(error) = manager.update_surface_frame(&surface_id, frame.clone()) {
                tracing::warn!(
                    error = %error,
                    surface_id = surface_id.as_str(),
                    "failed to update wrist overlay frame"
                );
            }
        }
    }

    fn release_frame_producer(&self) {
        if self.defer_slint_renderer_release(&self.wrist_frame_release_requested) {
            if let Ok(mut devices) = self.devices.lock() {
                devices.clear();
            }
            self.refresh_wake.notify();
            return;
        }
        self.release_frame_producer_on_current_thread();
    }

    fn consume_slint_renderer_release_requests(&self) {
        self.consume_slint_renderer_release_request(&self.wrist_frame_release_requested, || {
            self.release_frame_producer_on_current_thread();
        });
        self.consume_slint_renderer_release_request(&self.hmd_frame_release_requested, || {
            self.release_hmd_renderer_for_lifecycle_reset_on_current_thread();
        });
    }

    fn defer_slint_renderer_release(&self, request: &AtomicBool) -> bool {
        if self.should_defer_slint_render_to_refresh_thread() {
            request.store(true, Ordering::Release);
            true
        } else {
            false
        }
    }

    fn consume_slint_renderer_release_request(&self, request: &AtomicBool, release: impl FnOnce()) {
        if request.swap(false, Ordering::AcqRel) {
            release();
        }
    }

    pub(crate) fn release_hmd_renderer(&self) {
        if self.defer_slint_renderer_release(&self.hmd_frame_release_requested) {
            self.refresh_wake.notify();
            return;
        }
        self.release_hmd_renderer_for_lifecycle_reset_on_current_thread();
    }

    pub(crate) fn release_hmd_renderer_on_current_thread(&self) {
        self.hmd_frame_release_requested
            .store(false, Ordering::Release);
        clear_slint_hmd_renderer();
    }

    fn release_hmd_renderer_for_lifecycle_reset_on_current_thread(&self) {
        self.avatar_bitmap_cache.clear();
        self.release_hmd_renderer_on_current_thread();
    }

    fn release_frame_producer_on_current_thread(&self) {
        self.wrist_frame_release_requested
            .store(false, Ordering::Release);
        if let Ok(mut producer) = self.frame_producer.lock() {
            producer.take();
        }
        clear_slint_wrist_renderer();
        if let Ok(mut devices) = self.devices.lock() {
            devices.clear();
        }
    }
}

impl Default for VrOverlayRuntime {
    fn default() -> Self {
        Self::new_for_test()
    }
}

impl GameProcessEventSink for VrOverlayRuntime {
    fn on_game_process_event(
        &self,
        event: GameProcessEvent,
    ) -> vrcx_0_application_core::Result<()> {
        self.update_process_status(event.is_game_running, event.is_steamvr_running);
        Ok(())
    }
}

#[cfg(test)]
mod activity_sink_tests;
#[cfg(test)]
mod config_reload_tests;
#[cfg(test)]
mod device_refresh_tests;
#[cfg(test)]
mod footer_tests;
