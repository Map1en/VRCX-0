use std::cell::RefCell;
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Condvar, Mutex,
};
use std::thread::{self, ThreadId};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use chrono::{DateTime, Local, Timelike};
use serde::Serialize;
use vrcx_0_application::{
    GameLogEvent, GameLogEventSink, GameProcessEvent, GameProcessEventSink,
    OverlayActivityDelivery, OverlayActivitySink, OverlayActivitySnapshot, RealtimeFriendSnapshot,
    TaskSupervisor,
};
use vrcx_0_core::friends::FriendRecord;
use vrcx_0_core::log_watcher::GameLogEventKind;
use vrcx_0_host::vr_overlay::{
    OverlayActivationButton, OverlayInputEvent, OverlayInputKind, OverlayPlacement,
    OverlaySurfaceConfig, VrDeviceSnapshot,
};
use vrcx_0_vr_overlay::{
    AvatarBitmap, FavoriteFriendsPanelModel, MainSurfaceModel, OverlaySize, OverlaySurfaceId,
    OverlayTransform, RgbaFrame, SlintHmdRenderer, SlintPanelHost, SlintPanelPointerEvent,
    SlintWristRenderer, UvPoint, WristSurfaceModel, FRIENDS_PANEL_ID,
    FRIENDS_PANEL_LASER_LEFT_SURFACE_ID, FRIENDS_PANEL_LASER_RIGHT_SURFACE_ID,
    FRIENDS_PANEL_SURFACE_ID, LEGACY_DUMMY_PANEL_ID, MAIN_SURFACE_ID,
};

use crate::notification::user_image::UserImageCache;
use crate::RuntimeHostContext;

use super::{
    avatar_cache::AvatarBitmapCache,
    build_wrist_surface_model,
    eligibility::{VrOverlayEligibility, WristOverlayStartMode},
    localization::OverlayLocale,
    manager::VrOverlayManager,
    service::{HostVrOverlayService, OverlayBackendPreference},
    surfaces::friends::{
        build_friends_panel_model, dedupe_preserve_order,
        favorite_friend_groups_snapshot_from_baseline, friend_record_avatar_url,
        friend_record_world_ids, load_friends_panel_memos, load_friends_panel_notes,
        local_favorite_friend_groups_from_db, normalize_friends_panel_category_key,
        FavoriteFriendGroupsSnapshot, FriendsPanelModelInput, FRIENDS_PANEL_CATEGORY_ALL,
    },
    surfaces::friends_actions::{clear_expired_friends_panel_arm, disarm_friends_panel_action},
    surfaces::hmd_toast::{refresh_cached_world_name, HmdToastState},
    WristOverlayFrameInput, WristOverlayRenderOptions, WristOverlaySizePreset, WristRuntimeFooter,
};

pub(in crate::vr_overlay) use super::config::{load_runtime_config, FRIENDS_PANEL_RUNTIME_ENABLED};
#[cfg(test)]
pub use super::config::{
    HMD_NOTIFICATIONS_ENABLED_CONFIG_KEY, HMD_NOTIFICATION_START_MODE_CONFIG_KEY,
};
pub use super::config::{
    VR_OVERLAY_ENABLED_CONFIG_KEY, VR_OVERLAY_FRIENDS_PANEL_GROUP_CONFIG_KEY,
    VR_OVERLAY_PANEL_SELECTED_CATEGORY_CONFIG_KEY,
};

trait VrOverlayFrameProducer: Send {
    fn next_frame(&mut self, input: VrOverlayFrameInput) -> Result<RgbaFrame, String>;
}

type VrOverlayFrameProducerFactory = Box<dyn Fn() -> Box<dyn VrOverlayFrameProducer> + Send + Sync>;
type FriendsPanelSnapshotProvider = Arc<dyn Fn() -> Option<RealtimeFriendSnapshot> + Send + Sync>;

thread_local! {
    static SLINT_WRIST_RENDERER: RefCell<Option<SlintWristRenderer>> = const { RefCell::new(None) };
    static SLINT_HMD_RENDERER: RefCell<Option<SlintHmdRenderer>> = const { RefCell::new(None) };
    static SLINT_FRIENDS_PANEL_HOST: RefCell<Option<SlintPanelHost>> = const { RefCell::new(None) };
}

#[derive(Clone, Debug)]
struct FriendsPanelQueuedInput {
    event: OverlayInputEvent,
    release_fallback_uv: Option<UvPoint>,
}

const WRIST_DEVICE_REFRESH_INTERVAL: Duration = Duration::from_secs(5);
const WRIST_FRAME_REFRESH_INTERVAL: Duration = Duration::from_secs(1);
const FRIENDS_PANEL_ANIMATION_REFRESH_INTERVAL: Duration = Duration::from_millis(100);
const MAX_FRIENDS_PANEL_INPUT_EVENTS: usize = 512;
const FRIENDS_PANEL_AVATAR_FETCH_BATCH: usize = 8;
const FRIENDS_PANEL_SCROLL_ROW_PIXELS: f32 = 106.0;
pub(crate) const FRIENDS_PANEL_ACTION_ARM_TIMEOUT: Duration = Duration::from_secs(3);
const FRIENDS_PANEL_LASER_SIZE: OverlaySize = OverlaySize::new(256, 6);
const FRIENDS_PANEL_LASER_INITIAL_WIDTH_METERS: f32 = 0.45;
const INTERACTIVE_INPUT_DRAIN_INTERVAL: Duration = Duration::from_millis(30);

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum WristOverlayHand {
    #[default]
    Left,
    Right,
    Both,
}

impl WristOverlayHand {
    pub(in crate::vr_overlay) fn from_config(value: &str) -> Self {
        match value.trim() {
            "right" => Self::Right,
            "both" => Self::Both,
            _ => Self::Left,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum HmdNotificationPosition {
    Top,
    #[default]
    Bottom,
    Left,
    Right,
}

impl HmdNotificationPosition {
    pub(in crate::vr_overlay) fn from_config(value: &str) -> Self {
        match value.trim() {
            "top" => Self::Top,
            "left" => Self::Left,
            "right" => Self::Right,
            _ => Self::Bottom,
        }
    }

    fn as_device_hint(self) -> &'static str {
        match self {
            Self::Top => "hmd:top",
            Self::Bottom => "hmd:bottom",
            Self::Left => "hmd:left",
            Self::Right => "hmd:right",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(in crate::vr_overlay) struct HmdNotificationConfig {
    pub(in crate::vr_overlay) enabled: bool,
    pub(in crate::vr_overlay) start_mode: WristOverlayStartMode,
    pub(in crate::vr_overlay) timeout_ms: u64,
    pub(in crate::vr_overlay) opacity_percent: u8,
    pub(in crate::vr_overlay) position: HmdNotificationPosition,
}

impl Default for HmdNotificationConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            start_mode: WristOverlayStartMode::VrchatVrMode,
            timeout_ms: 5_000,
            opacity_percent: 100,
            position: HmdNotificationPosition::Bottom,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct VrOverlayRuntimeConfig {
    pub(in crate::vr_overlay) start_mode: WristOverlayStartMode,
    pub(in crate::vr_overlay) backend: OverlayBackendPreference,
    pub(in crate::vr_overlay) button: OverlayActivationButton,
    pub(in crate::vr_overlay) hand: WristOverlayHand,
    pub(in crate::vr_overlay) panel_enabled: bool,
    pub(in crate::vr_overlay) panel_all_friends_includes_favorites: bool,
    pub(in crate::vr_overlay) hmd: HmdNotificationConfig,
    pub(in crate::vr_overlay) render: WristOverlayRenderOptions,
    pub(in crate::vr_overlay) locale: OverlayLocale,
    pub(in crate::vr_overlay) dt_hour12: bool,
    pub(in crate::vr_overlay) show_instance_id_in_location: bool,
}

impl Default for VrOverlayRuntimeConfig {
    fn default() -> Self {
        Self {
            start_mode: WristOverlayStartMode::VrchatVrMode,
            backend: OverlayBackendPreference::Auto,
            button: OverlayActivationButton::Grip,
            hand: WristOverlayHand::Left,
            panel_enabled: FRIENDS_PANEL_RUNTIME_ENABLED,
            panel_all_friends_includes_favorites: true,
            hmd: HmdNotificationConfig::default(),
            render: WristOverlayRenderOptions::default(),
            locale: OverlayLocale::default(),
            dt_hour12: false,
            show_instance_id_in_location: false,
        }
    }
}

impl VrOverlayRuntimeConfig {
    fn surface_config_key(self) -> WristSurfaceRuntimeConfig {
        WristSurfaceRuntimeConfig {
            button: self.button,
            hand: self.hand,
            size: self.render.size,
            hmd_enabled: self.hmd.enabled,
            hmd_position: self.hmd.position,
        }
    }

    fn should_clear_device_snapshot_for(self, next_config: Self) -> bool {
        self.surface_config_key() != next_config.surface_config_key()
            || self.render.show_devices != next_config.render.show_devices
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct WristSurfaceRuntimeConfig {
    button: OverlayActivationButton,
    hand: WristOverlayHand,
    size: WristOverlaySizePreset,
    hmd_enabled: bool,
    hmd_position: HmdNotificationPosition,
}

struct VrOverlayFrameInput {
    config: VrOverlayRuntimeConfig,
    devices: Vec<VrDeviceSnapshot>,
}

#[derive(Clone, Default)]
struct FriendsPanelNoteMemoCache {
    owner_user_id: String,
    notes_by_user_id: HashMap<String, String>,
    memos_by_user_id: HashMap<String, String>,
    valid: bool,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(in crate::vr_overlay) struct ActiveOverlaySurfaces {
    wrist: bool,
    hmd: bool,
    pub(in crate::vr_overlay) panel_listener: bool,
    friends_panel: bool,
}

impl ActiveOverlaySurfaces {
    fn any(self) -> bool {
        self.wrist || self.hmd || self.panel_listener || self.friends_panel
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct OverlayInputProcessOutcome {
    surface_config_changed: bool,
    frame_changed: bool,
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

    #[cfg(test)]
    fn sequence(&self) -> u64 {
        self.sequence
            .lock()
            .map(|sequence| *sequence)
            .unwrap_or_default()
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

#[derive(Clone)]
pub(crate) struct InteractivePanelRuntimeState {
    pub(crate) visible: bool,
    transform: OverlayTransform,
    pub(crate) model: FavoriteFriendsPanelModel,
    focused: bool,
    pub(crate) armed_action_expires_at: Option<Instant>,
    slint_animation_active: bool,
}

impl Default for InteractivePanelRuntimeState {
    fn default() -> Self {
        Self {
            visible: false,
            transform: OverlayTransform::identity(),
            model: FavoriteFriendsPanelModel::default(),
            focused: false,
            armed_action_expires_at: None,
            slint_animation_active: false,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum FriendsPanelActionKind {
    Open,
    Request,
    Invite,
}

impl FriendsPanelActionKind {
    pub(crate) fn from_panel_kind(value: &str) -> Option<Self> {
        match value {
            "open" => Some(Self::Open),
            "request" => Some(Self::Request),
            "invite" => Some(Self::Invite),
            _ => None,
        }
    }

    pub(crate) fn as_panel_kind(self) -> &'static str {
        match self {
            Self::Open => "open",
            Self::Request => "request",
            Self::Invite => "invite",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct FriendsPanelActionRequest {
    pub(crate) user_id: String,
    pub(crate) kind: FriendsPanelActionKind,
}

#[derive(Clone)]
struct FriendsPanelAvatarCacheEntry {
    bitmap: AvatarBitmap,
    source_url: String,
    allow_user_icon: bool,
}

impl FriendsPanelAvatarCacheEntry {
    fn matches(&self, initial_image_url: &str, allow_user_icon: bool) -> bool {
        let initial_image_url = initial_image_url.trim();
        if initial_image_url.is_empty() {
            self.allow_user_icon == allow_user_icon
        } else {
            self.source_url == initial_image_url
        }
    }
}

fn insert_friends_panel_avatar_if_session_current(
    avatars: &Arc<Mutex<HashMap<String, FriendsPanelAvatarCacheEntry>>>,
    session_generation: &AtomicU64,
    expected_generation: u64,
    user_id: &str,
    bitmap: AvatarBitmap,
    source_url: &str,
    allow_user_icon: bool,
) -> bool {
    if session_generation.load(Ordering::Acquire) != expected_generation {
        return false;
    }
    let Ok(mut avatars) = avatars.lock() else {
        return false;
    };
    if session_generation.load(Ordering::Acquire) != expected_generation {
        return false;
    }
    avatars.insert(
        user_id.to_string(),
        FriendsPanelAvatarCacheEntry {
            bitmap,
            source_url: source_url.to_string(),
            allow_user_icon,
        },
    );
    true
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrOverlayRuntimeSnapshot {
    pub enabled: bool,
    pub backend_available: bool,
    pub running: bool,
    pub vr_mode: bool,
    pub steamvr_running: bool,
    pub active_backend: Option<String>,
}

pub struct VrOverlayRuntime {
    enabled: AtomicBool,
    game_running: AtomicBool,
    vr_mode: AtomicBool,
    steamvr_running: AtomicBool,
    refresh_loop_started: AtomicBool,
    wrist_frame_release_requested: AtomicBool,
    hmd_frame_release_requested: AtomicBool,
    friends_panel_host_release_requested: AtomicBool,
    device_refresh_requested: AtomicBool,
    interactive_degraded_logged: AtomicBool,
    backend_available: bool,
    pub(crate) context: Option<Arc<RuntimeHostContext>>,
    config: Mutex<VrOverlayRuntimeConfig>,
    friends_panel_snapshot_provider: Mutex<Option<FriendsPanelSnapshotProvider>>,
    friends_panel_favorite_groups: Mutex<FavoriteFriendGroupsSnapshot>,
    friends_panel_avatars: Arc<Mutex<HashMap<String, FriendsPanelAvatarCacheEntry>>>,
    friends_panel_avatar_session_generation: Arc<AtomicU64>,
    friends_panel_avatar_fetches: Arc<Mutex<HashSet<String>>>,
    friends_panel_world_resolves: Arc<Mutex<HashSet<String>>>,
    friends_panel_note_memo_cache: Mutex<FriendsPanelNoteMemoCache>,
    friends_panel_model_dirty: Arc<AtomicBool>,
    pub(crate) friends_panel_frame_dirty: Arc<AtomicBool>,
    friends_panel_input_events: Mutex<VecDeque<FriendsPanelQueuedInput>>,
    refresh_wake: Arc<RefreshWake>,
    devices: Mutex<Vec<VrDeviceSnapshot>>,
    pub(crate) hmd_toasts: Mutex<VecDeque<HmdToastState>>,
    pub(crate) interactive_panel: Arc<Mutex<InteractivePanelRuntimeState>>,
    pub(in crate::vr_overlay) avatar_bitmap_cache: Arc<AvatarBitmapCache>,
    pub(crate) user_image_cache: Arc<UserImageCache>,
    pub(crate) manager: Mutex<VrOverlayManager<HostVrOverlayService>>,
    running_mirror: AtomicBool,
    active_backend_mirror: Mutex<Option<&'static str>>,
    refresh_thread_id: Mutex<Option<ThreadId>>,
    frame_producer_factory: VrOverlayFrameProducerFactory,
    frame_producer: Mutex<Option<Box<dyn VrOverlayFrameProducer>>>,
}

#[derive(Clone)]
pub struct VrOverlayActivitySink {
    runtime: Arc<VrOverlayRuntime>,
}

impl VrOverlayActivitySink {
    pub fn new(runtime: Arc<VrOverlayRuntime>) -> Self {
        Self { runtime }
    }
}

impl OverlayActivitySink for VrOverlayActivitySink {
    fn emit_overlay_activity_snapshot(&self, _snapshot: OverlayActivitySnapshot) {
        self.runtime
            .friends_panel_model_dirty
            .store(true, Ordering::Release);
        self.runtime.reconcile_current();
    }

    fn emit_overlay_activity_delivery(&self, delivery: OverlayActivityDelivery) {
        self.runtime.ingest_hmd_delivery(delivery);
    }
}

impl VrOverlayRuntime {
    pub fn new(context: Arc<RuntimeHostContext>) -> Self {
        let config = load_runtime_config(context.config());
        let producer_context = Arc::clone(&context);
        Self::new_with_frame_producer_factory(
            HostVrOverlayService::backend_available(),
            Some(context.clone()),
            config,
            Box::new(move || {
                Box::new(RuntimeWristFrameProducer::new(Arc::clone(
                    &producer_context,
                )))
            }),
        )
    }

    pub fn new_for_test() -> Self {
        Self::new_for_test_with_backend_available(true)
    }

    pub fn new_for_test_with_backend_available(backend_available: bool) -> Self {
        let config = VrOverlayRuntimeConfig {
            panel_enabled: true,
            ..VrOverlayRuntimeConfig::default()
        };
        Self::new_with_frame_producer_factory(
            backend_available,
            None,
            config,
            Box::new(|| Box::<StaticWristFrameProducer>::default()),
        )
    }

    #[cfg(test)]
    fn new_for_test_with_config_and_frame_producer_factory(
        backend_available: bool,
        config: VrOverlayRuntimeConfig,
        frame_producer_factory: VrOverlayFrameProducerFactory,
    ) -> Self {
        Self::new_with_frame_producer_factory(
            backend_available,
            None,
            config,
            frame_producer_factory,
        )
    }

    fn new_with_frame_producer_factory(
        backend_available: bool,
        context: Option<Arc<RuntimeHostContext>>,
        config: VrOverlayRuntimeConfig,
        frame_producer_factory: VrOverlayFrameProducerFactory,
    ) -> Self {
        let service_configs = Vec::new();
        let service = if context.is_some() {
            HostVrOverlayService::new_with_preference(service_configs, config.backend)
        } else {
            HostVrOverlayService::new_noop(service_configs)
        };
        Self {
            enabled: AtomicBool::new(false),
            game_running: AtomicBool::new(false),
            vr_mode: AtomicBool::new(false),
            steamvr_running: AtomicBool::new(false),
            refresh_loop_started: AtomicBool::new(false),
            wrist_frame_release_requested: AtomicBool::new(false),
            hmd_frame_release_requested: AtomicBool::new(false),
            friends_panel_host_release_requested: AtomicBool::new(false),
            device_refresh_requested: AtomicBool::new(false),
            interactive_degraded_logged: AtomicBool::new(false),
            backend_available,
            context,
            manager: Mutex::new(VrOverlayManager::new(service)),
            running_mirror: AtomicBool::new(false),
            active_backend_mirror: Mutex::new(None),
            refresh_thread_id: Mutex::new(None),
            config: Mutex::new(config),
            friends_panel_snapshot_provider: Mutex::new(None),
            friends_panel_favorite_groups: Mutex::new(FavoriteFriendGroupsSnapshot::default()),
            friends_panel_avatars: Arc::new(Mutex::new(HashMap::new())),
            friends_panel_avatar_session_generation: Arc::new(AtomicU64::new(0)),
            friends_panel_avatar_fetches: Arc::new(Mutex::new(HashSet::new())),
            friends_panel_world_resolves: Arc::new(Mutex::new(HashSet::new())),
            friends_panel_note_memo_cache: Mutex::new(FriendsPanelNoteMemoCache::default()),
            friends_panel_model_dirty: Arc::new(AtomicBool::new(false)),
            friends_panel_frame_dirty: Arc::new(AtomicBool::new(false)),
            friends_panel_input_events: Mutex::new(VecDeque::new()),
            refresh_wake: Arc::new(RefreshWake::new()),
            devices: Mutex::new(Vec::new()),
            hmd_toasts: Mutex::new(VecDeque::new()),
            interactive_panel: Arc::new(Mutex::new(InteractivePanelRuntimeState::default())),
            avatar_bitmap_cache: Arc::new(AvatarBitmapCache::new()),
            user_image_cache: Arc::new(UserImageCache::new()),
            frame_producer_factory,
            frame_producer: Mutex::new(None),
        }
    }

    pub fn set_enabled(&self, enabled: bool) {
        if enabled && !self.backend_available {
            tracing::warn!("no VR overlay backend is available in this build");
        }
        self.enabled.store(enabled, Ordering::Release);
        self.reconcile_current_with_device_refresh(true);
        if !enabled && !self.current_runtime_config().hmd.enabled {
            self.release_frame_producer();
        }
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
                if !runtime.has_active_surface() {
                    continue;
                }
                let now = Instant::now();
                let refresh_devices =
                    now >= next_device_refresh || runtime.consume_device_refresh_request();
                runtime.reconcile_current_with_device_refresh(refresh_devices);
                if refresh_devices {
                    next_device_refresh = now + WRIST_DEVICE_REFRESH_INTERVAL;
                }
            }
            runtime.clear_refresh_thread_id();
        });

        let input_runtime = Arc::clone(self);
        tasks.spawn_cancellable_thread("vr-overlay-input", move |stop_token| {
            while !stop_token.is_stop_requested() {
                std::thread::sleep(input_runtime.input_drain_interval());
                input_runtime.drain_overlay_input_events();
            }
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
        self.context.is_some() && !self.is_refresh_thread()
    }

    pub(crate) fn set_friends_panel_snapshot_provider<F>(&self, provider: F)
    where
        F: Fn() -> Option<RealtimeFriendSnapshot> + Send + Sync + 'static,
    {
        if let Ok(mut current) = self.friends_panel_snapshot_provider.lock() {
            *current = Some(Arc::new(provider));
        }
    }

    pub(crate) fn update_friends_panel_favorite_groups_from_baseline(
        &self,
        snapshot: &serde_json::Value,
    ) {
        let next = favorite_friend_groups_snapshot_from_baseline(snapshot);
        if let Ok(mut current) = self.friends_panel_favorite_groups.lock() {
            *current = next;
        }
        self.friends_panel_model_dirty
            .store(true, Ordering::Release);
        if self
            .interactive_panel
            .lock()
            .map(|panel| panel.visible)
            .unwrap_or(false)
        {
            self.rebuild_visible_friends_panel_model();
            self.reconcile_current();
        }
    }

    pub(crate) fn clear_friends_panel_session_state(&self) {
        self.friends_panel_avatar_session_generation
            .fetch_add(1, Ordering::AcqRel);
        if let Ok(mut current) = self.friends_panel_favorite_groups.lock() {
            *current = FavoriteFriendGroupsSnapshot::default();
        }
        if let Ok(mut avatars) = self.friends_panel_avatars.lock() {
            avatars.clear();
        }
        self.avatar_bitmap_cache.clear();
        self.clear_friends_panel_note_memo_cache();
        self.friends_panel_model_dirty
            .store(true, Ordering::Release);
        if self
            .interactive_panel
            .lock()
            .map(|panel| panel.visible)
            .unwrap_or(false)
        {
            self.rebuild_visible_friends_panel_model();
            self.reconcile_current();
        }
    }

    pub fn invalidate_friends_panel_note_memo_cache(&self) {
        self.clear_friends_panel_note_memo_cache();
        self.friends_panel_model_dirty
            .store(true, Ordering::Release);
    }

    fn clear_friends_panel_note_memo_cache(&self) {
        if let Ok(mut cache) = self.friends_panel_note_memo_cache.lock() {
            *cache = FriendsPanelNoteMemoCache::default();
        }
    }

    pub fn is_backend_available(&self) -> bool {
        self.backend_available
    }

    pub fn set_vr_mode(&self, vr_mode: bool) {
        self.vr_mode.store(vr_mode, Ordering::Release);
        self.reconcile_current_with_device_refresh(true);
    }

    pub fn stop(&self) {
        if let Ok(mut manager) = self.manager.lock() {
            manager.reconcile(VrOverlayEligibility::default());
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

    pub(crate) fn rebuild_visible_friends_panel_model(&self) {
        let (selected, status_message) = match self.interactive_panel.lock() {
            Ok(panel) if panel.visible => (
                Some(panel.model.selected_category_key.clone()),
                panel.model.status_message.clone(),
            ),
            _ => return,
        };
        let mut model = self.build_current_friends_panel_model(selected);
        model.status_message = status_message;
        if let Ok(mut panel) = self.interactive_panel.lock() {
            if panel.visible {
                panel.model = model;
            }
        }
    }

    fn build_current_friends_panel_model(
        &self,
        selected_category_key: Option<String>,
    ) -> FavoriteFriendsPanelModel {
        let runtime_config = self.current_runtime_config();
        let selected_category_key =
            selected_category_key.unwrap_or_else(|| self.load_friends_panel_selected_category());
        let friend_snapshot = self.current_friends_panel_snapshot();
        let favorite_groups = self.current_friends_panel_favorite_groups();
        let (current_location, current_location_player_ids) =
            self.current_friends_panel_location_snapshot();
        let (notes_by_user_id, memos_by_user_id) =
            self.current_friends_panel_note_memo_maps(&friend_snapshot);
        let world_names_by_id = self.current_friends_panel_world_names(&friend_snapshot);
        let avatars_by_user_id = self
            .friends_panel_avatars
            .lock()
            .map(|avatars| {
                avatars
                    .iter()
                    .map(|(user_id, entry)| (user_id.clone(), entry.bitmap.clone()))
                    .collect()
            })
            .unwrap_or_default();
        build_friends_panel_model(FriendsPanelModelInput {
            selected_category_key,
            friend_snapshot,
            favorite_groups,
            current_location,
            current_location_player_ids,
            notes_by_user_id,
            memos_by_user_id,
            world_names_by_id,
            avatars_by_user_id,
            locale: runtime_config.locale,
            all_friends_includes_favorites: runtime_config.panel_all_friends_includes_favorites,
            is_game_running: self.game_running.load(Ordering::Acquire),
        })
    }

    pub(crate) fn current_friends_panel_location_snapshot(&self) -> (String, Vec<String>) {
        let Some(context) = &self.context else {
            return (String::new(), Vec::new());
        };
        let game_log = context.game_log_snapshot();
        let current_location = if game_log.location.trim().eq_ignore_ascii_case("traveling")
            && !game_log.destination.trim().is_empty()
        {
            game_log.destination
        } else {
            game_log.location
        };
        let player_ids = game_log
            .players
            .into_iter()
            .map(|player| player.user_id.trim().to_string())
            .filter(|user_id| !user_id.is_empty())
            .collect::<Vec<_>>();
        (current_location, dedupe_preserve_order(player_ids))
    }

    pub(crate) fn current_friends_panel_snapshot(&self) -> Option<RealtimeFriendSnapshot> {
        let provider = self
            .friends_panel_snapshot_provider
            .lock()
            .ok()
            .and_then(|provider| provider.clone());
        provider.and_then(|provider| provider())
    }

    fn current_friends_panel_favorite_groups(&self) -> FavoriteFriendGroupsSnapshot {
        let current = self
            .friends_panel_favorite_groups
            .lock()
            .map(|groups| groups.clone())
            .unwrap_or_default();
        if !current.groups.is_empty() {
            return current;
        }
        let Some(context) = &self.context else {
            return current;
        };
        local_favorite_friend_groups_from_db(context.db.as_ref()).unwrap_or_default()
    }

    fn current_friends_panel_note_memo_maps(
        &self,
        snapshot: &Option<RealtimeFriendSnapshot>,
    ) -> (HashMap<String, String>, HashMap<String, String>) {
        let Some(context) = &self.context else {
            return (HashMap::new(), HashMap::new());
        };
        let owner_user_id = snapshot
            .as_ref()
            .map(|snapshot| snapshot.current_user_id.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| context.auth_scope.snapshot().current_user_id);
        if let Ok(mut cache) = self.friends_panel_note_memo_cache.lock() {
            if cache.valid && cache.owner_user_id == owner_user_id {
                return (
                    cache.notes_by_user_id.clone(),
                    cache.memos_by_user_id.clone(),
                );
            }
            let notes_by_user_id = load_friends_panel_notes(context, owner_user_id.clone());
            let memos_by_user_id = load_friends_panel_memos(context);
            *cache = FriendsPanelNoteMemoCache {
                owner_user_id,
                notes_by_user_id: notes_by_user_id.clone(),
                memos_by_user_id: memos_by_user_id.clone(),
                valid: true,
            };
            return (notes_by_user_id, memos_by_user_id);
        }
        (
            load_friends_panel_notes(context, owner_user_id),
            load_friends_panel_memos(context),
        )
    }

    fn current_friends_panel_world_names(
        &self,
        snapshot: &Option<RealtimeFriendSnapshot>,
    ) -> HashMap<String, String> {
        let Some(context) = &self.context else {
            return HashMap::new();
        };
        let Some(snapshot) = snapshot else {
            return HashMap::new();
        };
        let mut names = HashMap::new();
        for record in snapshot.friends_by_id.values() {
            for world_id in friend_record_world_ids(record) {
                if let Some(name) = context.world_cache.get_name(&world_id) {
                    names.insert(world_id, name);
                }
            }
        }
        names
    }

    fn queue_friends_panel_assets(&self, model: &FavoriteFriendsPanelModel) {
        let Some(context) = &self.context else {
            return;
        };
        let Some(snapshot) = self.current_friends_panel_snapshot() else {
            return;
        };
        let visible_user_ids = model
            .rows
            .iter()
            .filter(|row| row.section_label.is_none())
            .map(|row| row.user_id.clone())
            .collect::<HashSet<_>>();
        if visible_user_ids.is_empty() {
            return;
        }
        let endpoint = if snapshot.endpoint.trim().is_empty() {
            context.auth_scope.snapshot().endpoint
        } else {
            snapshot.endpoint.clone()
        };
        let inflight_avatar_fetches = self
            .friends_panel_avatar_fetches
            .lock()
            .map(|inflight| inflight.len())
            .unwrap_or(usize::MAX);
        let mut avatar_fetch_budget =
            FRIENDS_PANEL_AVATAR_FETCH_BATCH.saturating_sub(inflight_avatar_fetches);
        for user_id in &visible_user_ids {
            if let Some(record) = snapshot.friends_by_id.get(user_id) {
                if avatar_fetch_budget > 0
                    && self.queue_friends_panel_avatar(context, &endpoint, record)
                {
                    avatar_fetch_budget -= 1;
                }
                self.queue_friends_panel_world_names(context, &endpoint, record);
            }
        }
    }

    fn queue_friends_panel_avatar(
        &self,
        context: &Arc<RuntimeHostContext>,
        endpoint: &str,
        record: &FriendRecord,
    ) -> bool {
        let user_id = record.id.trim();
        if user_id.is_empty() {
            return false;
        }
        let endpoint = endpoint.to_string();
        let allow_user_icon = context
            .config()
            .get_bool("displayVRCPlusIconsAsAvatar", true)
            .unwrap_or(true);
        let initial_image_url = friend_record_avatar_url(record, allow_user_icon, &endpoint);
        if self
            .friends_panel_avatars
            .lock()
            .map(|avatars| {
                avatars
                    .get(user_id)
                    .is_some_and(|entry| entry.matches(&initial_image_url, allow_user_icon))
            })
            .unwrap_or(false)
        {
            return false;
        }
        let Ok(mut inflight) = self.friends_panel_avatar_fetches.lock() else {
            return false;
        };
        if !inflight.insert(user_id.to_string()) {
            return false;
        }
        drop(inflight);

        let context = Arc::clone(context);
        let user_image_cache = Arc::clone(&self.user_image_cache);
        let avatar_cache = Arc::clone(&self.avatar_bitmap_cache);
        let avatars = Arc::clone(&self.friends_panel_avatars);
        let avatar_session_generation = Arc::clone(&self.friends_panel_avatar_session_generation);
        let expected_avatar_session_generation = avatar_session_generation.load(Ordering::Acquire);
        let inflight = Arc::clone(&self.friends_panel_avatar_fetches);
        let dirty = Arc::clone(&self.friends_panel_model_dirty);
        let wake = Arc::clone(&self.refresh_wake);
        let user_id = user_id.to_string();
        let tasks = context.tasks.clone();
        tasks.spawn(async move {
            let image_url = if initial_image_url.is_empty() {
                user_image_cache
                    .resolve(
                        context.web.as_ref(),
                        context.db.as_ref(),
                        &endpoint,
                        &user_id,
                        allow_user_icon,
                    )
                    .await
                    .unwrap_or_default()
            } else {
                initial_image_url
            };
            if !image_url.trim().is_empty() {
                if let Some(bitmap) = avatar_cache
                    .resolve(context.web.as_ref(), image_url.trim(), &user_id)
                    .await
                {
                    if insert_friends_panel_avatar_if_session_current(
                        &avatars,
                        avatar_session_generation.as_ref(),
                        expected_avatar_session_generation,
                        &user_id,
                        bitmap,
                        image_url.trim(),
                        allow_user_icon,
                    ) {
                        dirty.store(true, Ordering::Release);
                        wake.notify();
                    }
                }
            }
            if let Ok(mut inflight) = inflight.lock() {
                inflight.remove(&user_id);
            }
        });
        true
    }

    fn queue_friends_panel_world_names(
        &self,
        context: &Arc<RuntimeHostContext>,
        endpoint: &str,
        record: &FriendRecord,
    ) {
        if endpoint.trim().is_empty() {
            return;
        }
        for world_id in friend_record_world_ids(record) {
            if context.world_cache.get_name(&world_id).is_some() {
                continue;
            }
            let Ok(mut inflight) = self.friends_panel_world_resolves.lock() else {
                continue;
            };
            if !inflight.insert(world_id.clone()) {
                continue;
            }
            drop(inflight);

            let context = Arc::clone(context);
            let inflight = Arc::clone(&self.friends_panel_world_resolves);
            let dirty = Arc::clone(&self.friends_panel_model_dirty);
            let endpoint = endpoint.to_string();
            let tasks = context.tasks.clone();
            tasks.spawn(async move {
                let resolved = context
                    .world_cache
                    .resolve_name(context.web.as_ref(), &endpoint, &world_id)
                    .await
                    .is_some();
                if resolved {
                    dirty.store(true, Ordering::Release);
                }
                if let Ok(mut inflight) = inflight.lock() {
                    inflight.remove(&world_id);
                }
            });
        }
    }

    pub(in crate::vr_overlay) fn load_friends_panel_selected_category(&self) -> String {
        if !self.current_runtime_config().panel_enabled {
            return FRIENDS_PANEL_CATEGORY_ALL.to_string();
        }
        let Some(context) = &self.context else {
            return FRIENDS_PANEL_CATEGORY_ALL.to_string();
        };
        if let Ok(value) = context
            .config()
            .get_string(VR_OVERLAY_PANEL_SELECTED_CATEGORY_CONFIG_KEY, "")
        {
            let value = value.trim();
            if !value.is_empty() {
                return normalize_friends_panel_category_key(value);
            }
        }
        context
            .config()
            .get_string(
                VR_OVERLAY_FRIENDS_PANEL_GROUP_CONFIG_KEY,
                FRIENDS_PANEL_CATEGORY_ALL,
            )
            .ok()
            .map(|value| normalize_friends_panel_category_key(&value))
            .unwrap_or_else(|| FRIENDS_PANEL_CATEGORY_ALL.to_string())
    }

    pub(in crate::vr_overlay) fn persist_friends_panel_selected_category(&self, key: &str) {
        if !self.current_runtime_config().panel_enabled {
            return;
        }
        let Some(context) = &self.context else {
            return;
        };
        if let Err(error) = context
            .config()
            .set_string(VR_OVERLAY_PANEL_SELECTED_CATEGORY_CONFIG_KEY, key)
        {
            tracing::warn!(error = %error, "failed to persist VR friends panel category");
        }
    }

    fn refresh_interval(&self) -> Duration {
        if !self.current_runtime_config().panel_enabled {
            return WRIST_FRAME_REFRESH_INTERVAL;
        }
        if self.friends_panel_animation_refresh_active() {
            FRIENDS_PANEL_ANIMATION_REFRESH_INTERVAL
        } else {
            WRIST_FRAME_REFRESH_INTERVAL
        }
    }

    fn input_drain_interval(&self) -> Duration {
        if !self.current_runtime_config().panel_enabled {
            return WRIST_FRAME_REFRESH_INTERVAL;
        }
        if self.panel_listener_available() || self.interactive_panel_interaction_active() {
            INTERACTIVE_INPUT_DRAIN_INTERVAL
        } else {
            WRIST_FRAME_REFRESH_INTERVAL
        }
    }

    fn panel_listener_available(&self) -> bool {
        self.active_surfaces(self.current_runtime_config())
            .panel_listener
    }

    fn interactive_panel_interaction_active(&self) -> bool {
        self.interactive_panel
            .lock()
            .map(|panel| panel.visible || panel.focused)
            .unwrap_or(false)
    }

    fn friends_panel_animation_refresh_active(&self) -> bool {
        self.interactive_panel
            .lock()
            .map(|panel| {
                panel.visible
                    && (panel.slint_animation_active || panel.armed_action_expires_at.is_some())
            })
            .unwrap_or(false)
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
            vr_mode: self.vr_mode.load(Ordering::Acquire),
            steamvr_running: self.steamvr_running.load(Ordering::Acquire),
            active_backend,
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
        if !game_running {
            self.vr_mode.store(false, Ordering::Release);
        }
        let previous_game_running = self.game_running.swap(game_running, Ordering::AcqRel);
        if previous_game_running && !game_running {
            self.avatar_bitmap_cache.clear();
        }
        if previous_game_running != game_running {
            self.friends_panel_model_dirty
                .store(true, Ordering::Release);
        }
        self.steamvr_running
            .store(steamvr_running, Ordering::Release);
        self.reconcile_current_with_device_refresh(true);
    }

    pub fn reconcile_current(&self) {
        self.reconcile_current_with_device_refresh(false);
    }

    fn reconcile_current_with_device_refresh(&self, refresh_devices: bool) {
        if self.is_refresh_thread() {
            self.consume_slint_renderer_release_requests();
        }
        let changed_config = self.changed_runtime_config();
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
            let vr_mode = self.vr_mode.load(Ordering::Acquire);
            let steamvr_running = self.steamvr_running.load(Ordering::Acquire);
            let active_surfaces =
                self.active_surfaces_for_state(config, game_running, vr_mode, steamvr_running);
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
                vr_mode,
                steamvr_running,
                start_mode: WristOverlayStartMode::SteamVr,
            };
            manager.reconcile(eligibility);
            self.log_interactive_backend_degradation(&manager, active_surfaces);
            if eligibility.can_run() && manager.is_running() {
                let input_outcome = self.process_overlay_input_events(&mut manager);
                if input_outcome.surface_config_changed {
                    let refreshed_surfaces = self.active_surfaces_for_state(
                        config,
                        game_running,
                        vr_mode,
                        steamvr_running,
                    );
                    let configs = overlay_surface_configs(refreshed_surfaces, config, self);
                    if let Err(error) = manager.set_surface_configs(configs) {
                        tracing::warn!(
                            error = %error,
                            "failed to apply VR overlay interactive surface config"
                        );
                    }
                }
                if let Err(error) =
                    manager.set_interaction_active(self.interactive_panel_interaction_active())
                {
                    tracing::warn!(error = %error, "failed to set VR overlay interaction mode");
                }
                if active_surfaces.wrist {
                    if self.should_defer_slint_render_to_refresh_thread() {
                        self.defer_refresh_to_refresh_thread(refresh_devices);
                    } else {
                        self.refresh_devices_if_needed(
                            &mut manager,
                            refresh_devices,
                            config.render.show_devices,
                        );
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
                self.push_friends_panel_frame(&mut manager);
            } else {
                self.release_frame_producer();
            }
            self.refresh_manager_mirror(&manager);
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

    fn drain_overlay_input_events(&self) {
        if !self.panel_listener_available() && !self.interactive_panel_interaction_active() {
            return;
        }
        let Ok(mut manager) = self.manager.try_lock() else {
            return;
        };
        let input_outcome = self.process_overlay_input_events(&mut manager);
        self.handle_overlay_input_drain_outcome(input_outcome);
        self.refresh_manager_mirror(&manager);
    }

    fn handle_overlay_input_drain_outcome(&self, input_outcome: OverlayInputProcessOutcome) {
        if input_outcome.surface_config_changed || input_outcome.frame_changed {
            self.refresh_wake.notify();
        }
    }

    pub(in crate::vr_overlay) fn is_hmd_surface_active(
        &self,
        config: VrOverlayRuntimeConfig,
    ) -> bool {
        self.active_surfaces(config).hmd
    }

    pub(in crate::vr_overlay) fn active_surfaces(
        &self,
        config: VrOverlayRuntimeConfig,
    ) -> ActiveOverlaySurfaces {
        self.active_surfaces_for_state(
            config,
            self.game_running.load(Ordering::Acquire),
            self.vr_mode.load(Ordering::Acquire),
            self.steamvr_running.load(Ordering::Acquire),
        )
    }

    fn active_surfaces_for_state(
        &self,
        config: VrOverlayRuntimeConfig,
        game_running: bool,
        vr_mode: bool,
        steamvr_running: bool,
    ) -> ActiveOverlaySurfaces {
        let panel_listener = self.backend_available && steamvr_running && config.panel_enabled;
        let friends_panel = panel_listener
            && self
                .interactive_panel
                .lock()
                .map(|panel| panel.visible)
                .unwrap_or(false);
        ActiveOverlaySurfaces {
            wrist: surface_active_for_start_mode(
                self.enabled.load(Ordering::Acquire),
                config.start_mode,
                self.backend_available,
                steamvr_running,
                game_running,
                vr_mode,
            ),
            hmd: surface_active_for_start_mode(
                config.hmd.enabled,
                config.hmd.start_mode,
                self.backend_available,
                steamvr_running,
                game_running,
                vr_mode,
            ),
            panel_listener,
            friends_panel,
        }
    }

    fn changed_runtime_config(&self) -> Option<VrOverlayRuntimeConfig> {
        let Some(context) = &self.context else {
            return None;
        };
        let next_config = load_runtime_config(context.config());
        let Ok(current_config) = self.config.lock() else {
            return None;
        };
        if *current_config == next_config {
            return None;
        }
        Some(next_config)
    }

    fn commit_runtime_config(&self, next_config: VrOverlayRuntimeConfig, clear_devices: bool) {
        let (close_panel, rebuild_friends_panel_model) = {
            let Ok(mut current_config) = self.config.lock() else {
                return;
            };
            if *current_config == next_config {
                (!next_config.panel_enabled, false)
            } else {
                let previous_config = *current_config;
                let close_panel = current_config.panel_enabled && !next_config.panel_enabled;
                let rebuild_friends_panel_model = previous_config.locale != next_config.locale
                    || previous_config.panel_all_friends_includes_favorites
                        != next_config.panel_all_friends_includes_favorites;
                *current_config = next_config;
                if clear_devices {
                    if let Ok(mut devices) = self.devices.lock() {
                        devices.clear();
                    }
                }
                (close_panel, rebuild_friends_panel_model)
            }
        };
        if close_panel {
            self.close_friends_panel();
        } else if rebuild_friends_panel_model {
            self.friends_panel_model_dirty
                .store(true, Ordering::Release);
        }
    }

    pub(in crate::vr_overlay) fn current_runtime_config(&self) -> VrOverlayRuntimeConfig {
        self.config.lock().map(|config| *config).unwrap_or_default()
    }

    fn refresh_devices_if_needed(
        &self,
        manager: &mut VrOverlayManager<HostVrOverlayService>,
        refresh_devices: bool,
        show_devices: bool,
    ) {
        if !show_devices {
            if let Ok(mut devices) = self.devices.lock() {
                devices.clear();
            }
            return;
        }
        let devices_empty = self
            .devices
            .lock()
            .map(|devices| devices.is_empty())
            .unwrap_or(true);
        if !refresh_devices && !devices_empty {
            return;
        }
        match manager.snapshot_devices() {
            Ok(next_devices) => {
                if let Ok(mut devices) = self.devices.lock() {
                    *devices = next_devices;
                }
            }
            Err(error) => {
                tracing::warn!(error = %error, "failed to snapshot VR overlay devices");
            }
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
        let frame = match self
            .frame_producer
            .lock()
            .map_err(|_| "wrist frame producer lock poisoned".to_string())
            .and_then(|mut producer| {
                let producer = producer.get_or_insert_with(|| (self.frame_producer_factory)());
                producer.next_frame(VrOverlayFrameInput { config, devices })
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
        self.consume_slint_renderer_release_request(
            &self.friends_panel_host_release_requested,
            || {
                self.release_friends_panel_host_on_current_thread();
            },
        );
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

    pub(in crate::vr_overlay) fn release_hmd_renderer(&self) {
        if self.defer_slint_renderer_release(&self.hmd_frame_release_requested) {
            self.refresh_wake.notify();
            return;
        }
        self.release_hmd_renderer_for_lifecycle_reset_on_current_thread();
    }

    fn release_friends_panel_host(&self) {
        if let Ok(mut avatars) = self.friends_panel_avatars.lock() {
            avatars.clear();
        }
        if self.defer_slint_renderer_release(&self.friends_panel_host_release_requested) {
            self.refresh_wake.notify();
            return;
        }
        self.release_friends_panel_host_on_current_thread();
    }

    fn release_friends_panel_host_on_current_thread(&self) {
        self.friends_panel_host_release_requested
            .store(false, Ordering::Release);
        clear_slint_friends_panel_host();
    }

    pub(in crate::vr_overlay) fn release_hmd_renderer_on_current_thread(&self) {
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

    fn close_friends_panel(&self) -> bool {
        let Ok(mut panel) = self.interactive_panel.lock() else {
            return false;
        };
        let was_visible = panel.visible;
        panel.visible = false;
        panel.focused = false;
        panel.model.pointer_uv = None;
        disarm_friends_panel_action(&mut panel);
        panel.slint_animation_active = false;
        drop(panel);
        self.clear_friends_panel_input_events();
        self.release_friends_panel_host();
        was_visible
    }

    fn enqueue_friends_panel_input_event(
        &self,
        event: OverlayInputEvent,
    ) -> OverlayInputProcessOutcome {
        let release_fallback_uv = {
            let Ok(mut panel) = self.interactive_panel.lock() else {
                return OverlayInputProcessOutcome::default();
            };
            if !panel.visible {
                return OverlayInputProcessOutcome::default();
            }
            let pointer_missed = friends_panel_pointer_missed(event.uv);
            let release_fallback_uv =
                if pointer_missed && matches!(event.kind, OverlayInputKind::ClickUp) {
                    panel.model.pointer_uv
                } else {
                    None
                };
            if !pointer_missed {
                panel.model.pointer_uv = Some(event.uv);
            }
            panel.focused = !pointer_missed;
            release_fallback_uv
        };
        if let Ok(mut events) = self.friends_panel_input_events.lock() {
            if events.len() >= MAX_FRIENDS_PANEL_INPUT_EVENTS {
                events.pop_front();
            }
            events.push_back(FriendsPanelQueuedInput {
                event,
                release_fallback_uv,
            });
        }
        self.friends_panel_frame_dirty
            .store(true, Ordering::Release);
        OverlayInputProcessOutcome {
            surface_config_changed: false,
            frame_changed: true,
        }
    }

    fn drain_friends_panel_input_events(&self) -> Vec<FriendsPanelQueuedInput> {
        self.friends_panel_input_events
            .lock()
            .map(|mut events| events.drain(..).collect())
            .unwrap_or_default()
    }

    fn clear_friends_panel_input_events(&self) {
        if let Ok(mut events) = self.friends_panel_input_events.lock() {
            events.clear();
        }
    }

    fn process_overlay_input_events(
        &self,
        manager: &mut VrOverlayManager<HostVrOverlayService>,
    ) -> OverlayInputProcessOutcome {
        let mut outcome = OverlayInputProcessOutcome::default();
        for event in manager.drain_input_events() {
            if !is_friends_panel_id(&event.panel_id) {
                continue;
            }
            let event_outcome = self.apply_friends_panel_input(event);
            outcome.surface_config_changed |= event_outcome.surface_config_changed;
            outcome.frame_changed |= event_outcome.frame_changed;
        }
        outcome
    }

    fn apply_friends_panel_input(&self, event: OverlayInputEvent) -> OverlayInputProcessOutcome {
        if !self.current_runtime_config().panel_enabled {
            return OverlayInputProcessOutcome {
                surface_config_changed: self.close_friends_panel(),
                frame_changed: false,
            };
        }
        if friends_panel_slint_consumes_input(&event.kind) {
            return self.enqueue_friends_panel_input_event(event);
        }
        let next_model_for_summon = if matches!(&event.kind, OverlayInputKind::Summon { .. }) {
            let opening = self
                .interactive_panel
                .lock()
                .map(|panel| !panel.visible)
                .unwrap_or(false);
            if opening {
                self.clear_friends_panel_note_memo_cache();
                Some(self.build_current_friends_panel_model(None))
            } else {
                None
            }
        } else {
            None
        };
        let now = Instant::now();
        let outcome = {
            let Ok(mut panel) = self.interactive_panel.lock() else {
                return OverlayInputProcessOutcome::default();
            };
            clear_expired_friends_panel_arm(&mut panel, now);
            match &event.kind {
                OverlayInputKind::Summon { transform } => {
                    let frame_changed = !panel.visible;
                    if panel.visible {
                        panel.visible = false;
                        panel.focused = false;
                        panel.model.pointer_uv = None;
                        disarm_friends_panel_action(&mut panel);
                        panel.slint_animation_active = false;
                        self.clear_friends_panel_input_events();
                        self.release_friends_panel_host();
                    } else {
                        panel.visible = true;
                        panel.focused = true;
                        panel.transform = *transform;
                        if let Some(model) = next_model_for_summon {
                            panel.model = model;
                        }
                    }
                    OverlayInputProcessOutcome {
                        surface_config_changed: true,
                        frame_changed,
                    }
                }
                _ if !panel.visible => OverlayInputProcessOutcome::default(),
                OverlayInputKind::Hover
                | OverlayInputKind::ClickDown
                | OverlayInputKind::ClickUp
                | OverlayInputKind::Scroll { .. } => OverlayInputProcessOutcome::default(),
                OverlayInputKind::GrabStart => {
                    panel.focused = true;
                    OverlayInputProcessOutcome::default()
                }
                OverlayInputKind::GrabMove { transform } => {
                    panel.transform = *transform;
                    panel.focused = true;
                    OverlayInputProcessOutcome {
                        surface_config_changed: true,
                        frame_changed: false,
                    }
                }
                OverlayInputKind::GrabEnd { transform } => {
                    panel.transform = *transform;
                    panel.focused = true;
                    OverlayInputProcessOutcome {
                        surface_config_changed: true,
                        frame_changed: false,
                    }
                }
            }
        };
        if outcome.frame_changed {
            self.friends_panel_frame_dirty
                .store(true, Ordering::Release);
        }
        outcome
    }

    fn set_friends_panel_slint_animation_active(&self, active: bool) {
        if let Ok(mut panel) = self.interactive_panel.lock() {
            panel.slint_animation_active = panel.visible && active;
        }
    }

    fn push_friends_panel_frame(&self, manager: &mut VrOverlayManager<HostVrOverlayService>) {
        let model_dirty = self.friends_panel_model_dirty.swap(false, Ordering::AcqRel);
        if model_dirty {
            self.rebuild_visible_friends_panel_model();
        }
        let frame_dirty = self.friends_panel_frame_dirty.swap(false, Ordering::AcqRel);
        let input_events = self.drain_friends_panel_input_events();
        let initial_model = {
            let Ok(mut panel) = self.interactive_panel.lock() else {
                return;
            };
            if !panel.visible {
                return;
            }
            let arm_expired = clear_expired_friends_panel_arm(&mut panel, Instant::now());
            let animation_active =
                panel.slint_animation_active || panel.armed_action_expires_at.is_some();
            let frame_dirty = frame_dirty || arm_expired;
            if !model_dirty && !frame_dirty && !animation_active && input_events.is_empty() {
                return;
            }
            panel.model.clone()
        };

        let ui_events = match with_slint_friends_panel_host(initial_model.size, |host| {
            host.set_model(&initial_model);
            for input in input_events {
                for event in friends_panel_pointer_events(input, initial_model.size) {
                    host.dispatch(event)?;
                }
            }
            Ok(host.drain_events())
        }) {
            Ok(events) => events,
            Err(error) => {
                tracing::warn!(error = %error, "failed to dispatch VR friends panel input");
                return;
            }
        };
        self.apply_friends_panel_slint_events(ui_events);

        let model = {
            let Ok(panel) = self.interactive_panel.lock() else {
                return;
            };
            if !panel.visible {
                return;
            }
            panel.model.clone()
        };
        self.queue_friends_panel_assets(&model);
        let render_result = match with_slint_friends_panel_host(model.size, |host| {
            host.set_model(&model);
            let frame = host.render_if_needed()?;
            Ok((frame, host.has_active_animations()))
        }) {
            Ok(result) => result,
            Err(error) => {
                tracing::warn!(error = %error, "failed to render VR Slint friends panel frame");
                return;
            }
        };
        let (rendered, slint_animation_active) = render_result;
        self.set_friends_panel_slint_animation_active(slint_animation_active);
        let Some(rendered) = rendered else {
            return;
        };
        tracing::debug!(
            elapsed_us = rendered.stats.elapsed.as_micros(),
            dirty_area = rendered.stats.dirty_area,
            dirty_rects = rendered.stats.dirty_rects,
            "rendered VR Slint friends panel frame"
        );
        let surface_id = OverlaySurfaceId::new(FRIENDS_PANEL_SURFACE_ID);
        if let Err(error) = manager.update_surface_frame(&surface_id, rendered.frame) {
            tracing::warn!(error = %error, "failed to update VR friends panel frame");
            return;
        }
        if let Err(error) = manager.show_surface(&surface_id) {
            tracing::warn!(error = %error, "failed to show VR friends panel surface");
        }
        self.push_friends_panel_laser_frames(manager);
    }

    fn push_friends_panel_laser_frames(
        &self,
        manager: &mut VrOverlayManager<HostVrOverlayService>,
    ) {
        let frame = friends_panel_laser_frame();
        for surface_id in friends_panel_laser_surface_ids() {
            if let Err(error) = manager.update_surface_frame(&surface_id, frame.clone()) {
                tracing::warn!(
                    error = %error,
                    surface_id = surface_id.as_str(),
                    "failed to update VR friends panel laser frame"
                );
            }
        }
    }

    fn log_interactive_backend_degradation(
        &self,
        manager: &VrOverlayManager<HostVrOverlayService>,
        active_surfaces: ActiveOverlaySurfaces,
    ) {
        if !active_surfaces.panel_listener {
            self.interactive_degraded_logged
                .store(false, Ordering::Release);
            return;
        }
        match manager.active_backend() {
            Some("openvr") | None => {
                self.interactive_degraded_logged
                    .store(false, Ordering::Release);
            }
            Some(backend) => {
                if !self
                    .interactive_degraded_logged
                    .swap(true, Ordering::AcqRel)
                {
                    tracing::debug!(
                        backend,
                        "VR interactive panel input is unavailable on this overlay backend"
                    );
                }
            }
        }
    }

    fn friends_panel_surface_config(&self) -> Option<OverlaySurfaceConfig> {
        let panel = self.interactive_panel.lock().ok()?;
        if !panel.visible {
            return None;
        }
        Some(OverlaySurfaceConfig {
            surface_id: OverlaySurfaceId::new(FRIENDS_PANEL_SURFACE_ID),
            size: panel.model.size,
            physical_width_meters: 0.82,
            placement: OverlayPlacement::Absolute {
                transform: panel.transform,
            },
            activation_button: OverlayActivationButton::Menu,
            interactive: true,
        })
    }

    fn friends_panel_laser_surface_configs(&self) -> Vec<OverlaySurfaceConfig> {
        let Ok(panel) = self.interactive_panel.lock() else {
            return Vec::new();
        };
        if !panel.visible {
            return Vec::new();
        }
        friends_panel_laser_surface_ids()
            .into_iter()
            .map(|surface_id| OverlaySurfaceConfig {
                surface_id,
                size: FRIENDS_PANEL_LASER_SIZE,
                physical_width_meters: FRIENDS_PANEL_LASER_INITIAL_WIDTH_METERS,
                placement: OverlayPlacement::Absolute {
                    transform: panel.transform,
                },
                activation_button: OverlayActivationButton::Menu,
                interactive: false,
            })
            .collect()
    }
}

impl Default for VrOverlayRuntime {
    fn default() -> Self {
        Self::new_for_test()
    }
}

impl GameProcessEventSink for VrOverlayRuntime {
    fn on_game_process_event(&self, event: GameProcessEvent) -> vrcx_0_application::Result<()> {
        self.update_process_status(event.is_game_running, event.is_steamvr_running);
        Ok(())
    }
}

impl GameLogEventSink for VrOverlayRuntime {
    fn ingest_game_log_event(&self, event: &GameLogEvent) -> vrcx_0_application::Result<()> {
        match event.kind {
            GameLogEventKind::OpenVrInit => self.set_vr_mode(true),
            GameLogEventKind::DesktopMode => self.set_vr_mode(false),
            GameLogEventKind::VrcQuit => {
                self.set_vr_mode(false);
                self.friends_panel_model_dirty
                    .store(true, Ordering::Release);
            }
            GameLogEventKind::Location { .. }
            | GameLogEventKind::LocationDestination { .. }
            | GameLogEventKind::PlayerJoined { .. }
            | GameLogEventKind::PlayerLeft { .. } => {
                self.friends_panel_model_dirty
                    .store(true, Ordering::Release);
            }
            _ => {}
        }
        Ok(())
    }
}

struct RuntimeWristFrameProducer {
    context: Arc<RuntimeHostContext>,
}

impl RuntimeWristFrameProducer {
    fn new(context: Arc<RuntimeHostContext>) -> Self {
        Self { context }
    }
}

impl VrOverlayFrameProducer for RuntimeWristFrameProducer {
    fn next_frame(&mut self, input: VrOverlayFrameInput) -> Result<RgbaFrame, String> {
        let frame_input = build_wrist_frame_input(&self.context, input.config, input.devices);
        let model = build_wrist_surface_model(frame_input);
        render_slint_wrist_frame(&model)
    }
}

fn render_slint_wrist_frame(model: &WristSurfaceModel) -> Result<RgbaFrame, String> {
    SLINT_WRIST_RENDERER.with(|renderer| {
        renderer
            .borrow_mut()
            .get_or_insert_with(SlintWristRenderer::new)
            .render(model)
    })
}

fn clear_slint_wrist_renderer() {
    SLINT_WRIST_RENDERER.with(|renderer| {
        renderer.borrow_mut().take();
    });
}

fn clear_slint_friends_panel_host() {
    SLINT_FRIENDS_PANEL_HOST.with(|host| {
        host.borrow_mut().take();
    });
}

pub(in crate::vr_overlay) fn render_slint_hmd_frame(
    model: &MainSurfaceModel,
) -> Result<RgbaFrame, String> {
    SLINT_HMD_RENDERER.with(|renderer| {
        renderer
            .borrow_mut()
            .get_or_insert_with(SlintHmdRenderer::new)
            .render(model)
    })
}

fn clear_slint_hmd_renderer() {
    SLINT_HMD_RENDERER.with(|renderer| {
        renderer.borrow_mut().take();
    });
}

#[derive(Default)]
struct StaticWristFrameProducer;

impl VrOverlayFrameProducer for StaticWristFrameProducer {
    fn next_frame(&mut self, _input: VrOverlayFrameInput) -> Result<RgbaFrame, String> {
        Ok(RgbaFrame::new(OverlaySize::new(16, 8), vec![0; 16 * 8 * 4]))
    }
}

fn start_mode_allows(start_mode: WristOverlayStartMode, game_running: bool, vr_mode: bool) -> bool {
    match start_mode {
        WristOverlayStartMode::SteamVr => true,
        WristOverlayStartMode::VrchatVrMode => game_running && vr_mode,
    }
}

fn friends_panel_slint_consumes_input(kind: &OverlayInputKind) -> bool {
    matches!(
        kind,
        OverlayInputKind::Hover
            | OverlayInputKind::ClickDown
            | OverlayInputKind::ClickUp
            | OverlayInputKind::Scroll { .. }
    )
}

fn friends_panel_pointer_missed(uv: UvPoint) -> bool {
    !uv.x.is_finite() || !uv.y.is_finite() || uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0
}

fn friends_panel_pointer_position(uv: UvPoint, size: OverlaySize) -> (f32, f32) {
    (uv.x * size.width as f32, uv.y * size.height as f32)
}

fn friends_panel_pointer_events(
    input: FriendsPanelQueuedInput,
    size: OverlaySize,
) -> Vec<SlintPanelPointerEvent> {
    if friends_panel_pointer_missed(input.event.uv) {
        if matches!(input.event.kind, OverlayInputKind::ClickUp) {
            if let Some(uv) = input
                .release_fallback_uv
                .filter(|uv| !friends_panel_pointer_missed(*uv))
            {
                let (x, y) = friends_panel_pointer_position(uv, size);
                return vec![
                    SlintPanelPointerEvent::Released { x, y },
                    SlintPanelPointerEvent::Exited,
                ];
            }
        }
        return vec![SlintPanelPointerEvent::Exited];
    }
    vec![friends_panel_pointer_event_at(
        input.event.kind,
        input.event.uv,
        size,
    )]
}

fn friends_panel_pointer_event_at(
    kind: OverlayInputKind,
    uv: UvPoint,
    size: OverlaySize,
) -> SlintPanelPointerEvent {
    let (x, y) = friends_panel_pointer_position(uv, size);
    match kind {
        OverlayInputKind::Hover => SlintPanelPointerEvent::Moved { x, y },
        OverlayInputKind::ClickDown => SlintPanelPointerEvent::Pressed { x, y },
        OverlayInputKind::ClickUp => SlintPanelPointerEvent::Released { x, y },
        OverlayInputKind::Scroll { delta } => SlintPanelPointerEvent::Scrolled {
            x,
            y,
            delta_x: 0.0,
            delta_y: -delta * FRIENDS_PANEL_SCROLL_ROW_PIXELS,
        },
        _ => SlintPanelPointerEvent::Exited,
    }
}

fn with_slint_friends_panel_host<T>(
    size: OverlaySize,
    callback: impl FnOnce(&mut SlintPanelHost) -> Result<T, String>,
) -> Result<T, String> {
    SLINT_FRIENDS_PANEL_HOST.with(|slot| {
        let mut host = slot.borrow_mut();
        let needs_new = host
            .as_ref()
            .map(|current| current.size() != size)
            .unwrap_or(true);
        if needs_new {
            *host = Some(SlintPanelHost::new(size)?);
        }
        let Some(host) = host.as_mut() else {
            return Err("Slint friends panel host is unavailable".to_string());
        };
        callback(host)
    })
}

fn surface_active_for_start_mode(
    enabled: bool,
    start_mode: WristOverlayStartMode,
    backend_available: bool,
    steamvr_running: bool,
    game_running: bool,
    vr_mode: bool,
) -> bool {
    enabled
        && backend_available
        && steamvr_running
        && start_mode_allows(start_mode, game_running, vr_mode)
}

fn overlay_surface_configs(
    active_surfaces: ActiveOverlaySurfaces,
    config: VrOverlayRuntimeConfig,
    runtime: &VrOverlayRuntime,
) -> Vec<OverlaySurfaceConfig> {
    let mut configs = Vec::new();
    if active_surfaces.wrist {
        configs.extend(wrist_surface_configs(config));
    }
    if active_surfaces.hmd {
        configs.push(hmd_surface_config(config.hmd.position));
    }
    if active_surfaces.friends_panel {
        if let Some(config) = runtime.friends_panel_surface_config() {
            configs.push(config);
        }
        configs.extend(runtime.friends_panel_laser_surface_configs());
    }
    configs
}

fn friends_panel_laser_surface_ids() -> [OverlaySurfaceId; 2] {
    [
        OverlaySurfaceId::new(FRIENDS_PANEL_LASER_LEFT_SURFACE_ID),
        OverlaySurfaceId::new(FRIENDS_PANEL_LASER_RIGHT_SURFACE_ID),
    ]
}

fn friends_panel_laser_frame() -> RgbaFrame {
    let size = FRIENDS_PANEL_LASER_SIZE;
    let width = size.width as usize;
    let height = size.height as usize;
    let mut data = vec![0; width * height * 4];
    let center = (height.saturating_sub(1)) as f32 * 0.5;
    let max_y_distance = (center + 0.5).max(1.0);
    for y in 0..height {
        let y_distance = (y as f32 - center).abs();
        let y_alpha = ((max_y_distance - y_distance) / max_y_distance).clamp(0.0, 1.0);
        for x in 0..width {
            let edge = x.min(width.saturating_sub(1).saturating_sub(x)) as f32;
            let x_alpha = (edge / 18.0).clamp(0.0, 1.0);
            let alpha = (220.0 * y_alpha * x_alpha).round().clamp(0.0, 220.0) as u8;
            let index = (y * width + x) * 4;
            data[index] = 45;
            data[index + 1] = 212;
            data[index + 2] = 191;
            data[index + 3] = alpha;
        }
    }
    RgbaFrame::new(size, data)
}

fn wrist_surface_configs(config: VrOverlayRuntimeConfig) -> Vec<OverlaySurfaceConfig> {
    wrist_surface_ids(config.hand)
        .into_iter()
        .map(|surface_id| {
            let device_hint = if surface_id.as_str() == "wrist-right" {
                "right-hand"
            } else {
                "left-hand"
            };
            wrist_surface_config(
                surface_id.as_str(),
                device_hint,
                config.render.size,
                config.button,
            )
        })
        .collect()
}

fn wrist_surface_ids(hand: WristOverlayHand) -> Vec<OverlaySurfaceId> {
    let mut surface_ids = Vec::new();
    if matches!(hand, WristOverlayHand::Left | WristOverlayHand::Both) {
        surface_ids.push(OverlaySurfaceId::new("wrist-left"));
    }
    if matches!(hand, WristOverlayHand::Right | WristOverlayHand::Both) {
        surface_ids.push(OverlaySurfaceId::new("wrist-right"));
    }
    surface_ids
}

fn wrist_surface_config(
    surface_id: &str,
    device_hint: &str,
    size: WristOverlaySizePreset,
    button: OverlayActivationButton,
) -> OverlaySurfaceConfig {
    OverlaySurfaceConfig {
        surface_id: OverlaySurfaceId::new(surface_id),
        size: size.overlay_size(),
        physical_width_meters: size.physical_width_meters(),
        placement: OverlayPlacement::TrackedDeviceRelative {
            device_hint: device_hint.to_string(),
        },
        activation_button: button,
        interactive: false,
    }
}

fn hmd_surface_config(position: HmdNotificationPosition) -> OverlaySurfaceConfig {
    OverlaySurfaceConfig {
        surface_id: OverlaySurfaceId::new(MAIN_SURFACE_ID),
        size: OverlaySize::new(960, 528),
        physical_width_meters: 0.95,
        placement: OverlayPlacement::TrackedDeviceRelative {
            device_hint: position.as_device_hint().to_string(),
        },
        activation_button: OverlayActivationButton::Grip,
        interactive: false,
    }
}

fn is_friends_panel_id(panel_id: &str) -> bool {
    matches!(panel_id, FRIENDS_PANEL_ID | LEGACY_DUMMY_PANEL_ID)
}

pub(super) fn build_wrist_frame_input(
    context: &RuntimeHostContext,
    config: VrOverlayRuntimeConfig,
    devices: Vec<VrDeviceSnapshot>,
) -> WristOverlayFrameInput {
    let game_log = context.game_log_snapshot();
    let captured_at_ms = now_ms();
    let mut activity = context.overlay_activity.snapshot();
    for entry in &mut activity.entries {
        refresh_cached_world_name(&context.world_cache, entry);
    }
    WristOverlayFrameInput {
        activity,
        devices,
        footer: WristRuntimeFooter {
            player_count: game_log.players.len() as u32,
            instance_duration: instance_duration_text(
                &game_log.location,
                &game_log.started_at,
                captured_at_ms,
            ),
            local_time: local_time_text(config.dt_hour12),
        },
        options: config.render,
        locale: config.locale.as_str().to_string(),
        show_instance_id_in_location: config.show_instance_id_in_location,
        captured_at_ms,
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or_default()
}

fn local_time_text(hour12: bool) -> String {
    let now = Local::now();
    format_local_time(now.hour(), now.minute(), hour12)
}

fn format_local_time(hour: u32, minute: u32, hour12: bool) -> String {
    if !hour12 {
        return format!("{hour:02}:{minute:02}");
    }
    let period = if hour < 12 { "AM" } else { "PM" };
    let display_hour = match hour % 12 {
        0 => 12,
        value => value,
    };
    format!("{display_hour}:{minute:02} {period}")
}

fn instance_duration_text(location: &str, started_at: &str, now_ms: i64) -> String {
    if !is_real_instance_location(location) {
        return String::new();
    }
    let Some(started_at_ms) = DateTime::parse_from_rfc3339(started_at)
        .ok()
        .map(|value| value.timestamp_millis())
    else {
        return String::new();
    };
    if now_ms < started_at_ms {
        return String::new();
    }
    compact_duration(now_ms - started_at_ms)
}

fn compact_duration(duration_ms: i64) -> String {
    let total_minutes = duration_ms / 60_000;
    if total_minutes < 1 {
        return "<1m".to_string();
    }
    let total_hours = total_minutes / 60;
    let minutes = total_minutes % 60;
    if total_hours < 1 {
        return format!("{minutes}m");
    }
    if total_hours < 24 {
        return format!("{total_hours}h {minutes}m");
    }
    let days = total_hours / 24;
    let hours = total_hours % 24;
    format!("{days}d {hours}h")
}

fn is_real_instance_location(location: &str) -> bool {
    let location = location.trim().to_ascii_lowercase();
    location.starts_with("wrld_") && location.contains(':')
}

#[cfg(test)]
pub(crate) mod tests;
