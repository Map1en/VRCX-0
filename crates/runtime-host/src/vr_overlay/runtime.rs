use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use chrono::{DateTime, Local, Timelike};
use serde::Serialize;
use vrcx_0_application::{
    GameLogEvent, GameLogEventSink, GameProcessEvent, GameProcessEventSink,
    OverlayActivityActorRelation, OverlayActivityDelivery, OverlayActivityEntry,
    OverlayActivitySink, OverlayActivitySnapshot, RealtimeFriendSnapshot, TaskSupervisor,
    WebClient,
};
use vrcx_0_core::friends::FriendRecord;
use vrcx_0_core::location::world_id_from_location;
use vrcx_0_core::log_watcher::GameLogEventKind;
use vrcx_0_host::vr_overlay::{
    OverlayActivationButton, OverlayInputEvent, OverlayInputKind, OverlayPlacement,
    OverlaySurfaceConfig, VrDeviceSnapshot,
};
use vrcx_0_persistence::config::ConfigRepository;
use vrcx_0_persistence::favorites::favorite_list;
use vrcx_0_persistence::memos::{memo_list_user_notes, memo_list_users};
use vrcx_0_vr_overlay::{
    build_friends_panel_scene, build_main_scene, build_wrist_scene, new_shared_overlay_font_system,
    AvatarBitmap, FavoriteFriendsPanelModel, FriendPanelAction, FriendPanelCategory,
    FriendPanelRow, FriendPanelStatusTone, MainSurfaceModel, OverlayRenderer, OverlaySize,
    OverlaySurfaceId, OverlayTransform, RgbaFrame, TextMeasurer, TinySkiaRenderer,
    FRIENDS_PANEL_ID, FRIENDS_PANEL_LASER_LEFT_SURFACE_ID, FRIENDS_PANEL_LASER_RIGHT_SURFACE_ID,
    FRIENDS_PANEL_SURFACE_ID, LEGACY_DUMMY_PANEL_ID, MAIN_SURFACE_ID,
};

use crate::notification::user_image::UserImageCache;
use crate::RuntimeHostContext;

use super::{
    build_wrist_surface_model,
    eligibility::{VrOverlayEligibility, WristOverlayStartMode},
    localization::{OverlayLocale, OverlayLocalizer},
    manager::VrOverlayManager,
    service::{HostVrOverlayService, OverlayBackendPreference},
    surfaces::main::{build_main_surface_model, HmdToastView, MainOverlayFrameInput},
    WristOverlayFrameInput, WristOverlayRenderOptions, WristOverlaySizePreset, WristRuntimeFooter,
};

trait VrOverlayFrameProducer: Send {
    fn next_frame(&mut self, input: VrOverlayFrameInput) -> Result<RgbaFrame, String>;
}

type VrOverlayFrameProducerFactory = Box<dyn Fn() -> Box<dyn VrOverlayFrameProducer> + Send + Sync>;
type FriendsPanelSnapshotProvider = Arc<dyn Fn() -> Option<RealtimeFriendSnapshot> + Send + Sync>;

pub const VR_OVERLAY_ENABLED_CONFIG_KEY: &str = "wristOverlayEnabled";
pub const VR_OVERLAY_BACKEND_CONFIG_KEY: &str = "wristOverlayBackend";
pub const VR_OVERLAY_START_MODE_CONFIG_KEY: &str = "wristOverlayStartMode";
pub const VR_OVERLAY_BUTTON_CONFIG_KEY: &str = "wristOverlayButton";
pub const VR_OVERLAY_HAND_CONFIG_KEY: &str = "wristOverlayHand";
pub const VR_OVERLAY_SIZE_CONFIG_KEY: &str = "wristOverlaySize";
pub const VR_OVERLAY_HIDE_PRIVATE_WORLDS_CONFIG_KEY: &str = "wristOverlayHidePrivateWorlds";
pub const VR_OVERLAY_DARK_BACKGROUND_CONFIG_KEY: &str = "wristOverlayDarkBackground";
pub const VR_OVERLAY_SHOW_DEVICES_CONFIG_KEY: &str = "wristOverlayShowDevices";
pub const VR_OVERLAY_SHOW_BATTERY_PERCENT_CONFIG_KEY: &str = "wristOverlayShowBatteryPercent";
pub const VR_OVERLAY_PANEL_ENABLED_CONFIG_KEY: &str = "vrOverlayPanelEnabled";
pub const VR_OVERLAY_PANEL_SELECTED_CATEGORY_CONFIG_KEY: &str = "vrOverlayPanelSelectedCategory";
pub const VR_OVERLAY_PANEL_ALL_FRIENDS_INCLUDES_FAVORITES_CONFIG_KEY: &str =
    "vrOverlayPanelAllFriendsIncludesFavorites";
pub const VR_OVERLAY_FRIENDS_PANEL_GROUP_CONFIG_KEY: &str = "vrOverlayFriendsPanelGroup";
pub const HMD_NOTIFICATIONS_ENABLED_CONFIG_KEY: &str = "hmdNotificationsEnabled";
pub const HMD_NOTIFICATION_START_MODE_CONFIG_KEY: &str = "hmdNotificationStartMode";
pub const HMD_NOTIFICATION_TIMEOUT_CONFIG_KEY: &str = "hmdNotificationTimeout";
pub const HMD_NOTIFICATION_OPACITY_CONFIG_KEY: &str = "hmdNotificationOpacity";
pub const HMD_NOTIFICATION_POSITION_CONFIG_KEY: &str = "hmdNotificationPosition";
const APP_LANGUAGE_CONFIG_KEY: &str = "appLanguage";
const DATE_TIME_HOUR12_CONFIG_KEY: &str = "dtHour12";
const WRIST_DEVICE_REFRESH_INTERVAL: Duration = Duration::from_secs(5);
const WRIST_FRAME_REFRESH_INTERVAL: Duration = Duration::from_secs(1);
const FRIENDS_PANEL_ANIMATION_REFRESH_INTERVAL: Duration = Duration::from_millis(100);
const FRIENDS_PANEL_SPINNER_PHASE_STEP: f32 = 0.1;
const FRIENDS_PANEL_LASER_SIZE: OverlaySize = OverlaySize::new(256, 6);
const FRIENDS_PANEL_LASER_INITIAL_WIDTH_METERS: f32 = 0.45;
const INTERACTIVE_INPUT_DRAIN_INTERVAL: Duration = Duration::from_millis(30);
const HMD_TOAST_CAPACITY: usize = 3;
const HMD_JOIN_LEAVE_MERGE_WINDOW: Duration = Duration::from_secs(4);
const HMD_AVATAR_SIZE: u32 = 96;
const HMD_AVATAR_FETCH_TIMEOUT: Duration = Duration::from_secs(5);
const HMD_AVATAR_SUCCESS_TTL: Duration = Duration::from_secs(15 * 60);
const HMD_AVATAR_FAILURE_TTL: Duration = Duration::from_secs(60);
const FRIENDS_PANEL_CATEGORY_ALL: &str = "all";
const FRIENDS_PANEL_CATEGORY_FAVORITES_ONLINE: &str = "favOnline";
const FRIENDS_PANEL_CATEGORY_LOCAL_FAVORITES: &str = "favLocal";
const FRIENDS_PANEL_CATEGORY_GROUP_PREFIX: &str = "group:";
const LOCAL_FAVORITE_GROUP_PREFIX: &str = "local:";

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum WristOverlayHand {
    #[default]
    Left,
    Right,
    Both,
}

impl WristOverlayHand {
    fn from_config(value: &str) -> Self {
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
    fn from_config(value: &str) -> Self {
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
struct HmdNotificationConfig {
    enabled: bool,
    start_mode: WristOverlayStartMode,
    timeout_ms: u64,
    opacity_percent: u8,
    position: HmdNotificationPosition,
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
    start_mode: WristOverlayStartMode,
    backend: OverlayBackendPreference,
    button: OverlayActivationButton,
    hand: WristOverlayHand,
    panel_enabled: bool,
    panel_all_friends_includes_favorites: bool,
    hmd: HmdNotificationConfig,
    render: WristOverlayRenderOptions,
    locale: OverlayLocale,
    dt_hour12: bool,
}

impl Default for VrOverlayRuntimeConfig {
    fn default() -> Self {
        Self {
            start_mode: WristOverlayStartMode::VrchatVrMode,
            backend: OverlayBackendPreference::Auto,
            button: OverlayActivationButton::Grip,
            hand: WristOverlayHand::Left,
            panel_enabled: true,
            panel_all_friends_includes_favorites: true,
            hmd: HmdNotificationConfig::default(),
            render: WristOverlayRenderOptions::default(),
            locale: OverlayLocale::default(),
            dt_hour12: false,
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
struct ActiveOverlaySurfaces {
    wrist: bool,
    hmd: bool,
    panel_listener: bool,
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

#[derive(Clone)]
struct InteractivePanelRuntimeState {
    visible: bool,
    transform: OverlayTransform,
    model: FavoriteFriendsPanelModel,
    focused: bool,
}

impl Default for InteractivePanelRuntimeState {
    fn default() -> Self {
        Self {
            visible: false,
            transform: OverlayTransform::identity(),
            model: FavoriteFriendsPanelModel::default(),
            focused: false,
        }
    }
}

#[derive(Clone)]
struct HmdToastState {
    entry: OverlayActivityEntry,
    expires_at: Instant,
    last_updated_at: Instant,
    avatar: Option<AvatarBitmap>,
    merge_count: u32,
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
    interactive_degraded_logged: AtomicBool,
    backend_available: bool,
    context: Option<Arc<RuntimeHostContext>>,
    config: Mutex<VrOverlayRuntimeConfig>,
    friends_panel_snapshot_provider: Mutex<Option<FriendsPanelSnapshotProvider>>,
    friends_panel_favorite_groups: Mutex<FavoriteFriendGroupsSnapshot>,
    friends_panel_avatars: Arc<Mutex<HashMap<String, AvatarBitmap>>>,
    friends_panel_avatar_fetches: Arc<Mutex<HashSet<String>>>,
    friends_panel_world_resolves: Arc<Mutex<HashSet<String>>>,
    friends_panel_note_memo_cache: Mutex<FriendsPanelNoteMemoCache>,
    friends_panel_model_dirty: Arc<AtomicBool>,
    devices: Mutex<Vec<VrDeviceSnapshot>>,
    hmd_toasts: Mutex<VecDeque<HmdToastState>>,
    interactive_panel: Mutex<InteractivePanelRuntimeState>,
    avatar_bitmap_cache: Arc<AvatarBitmapCache>,
    user_image_cache: Arc<UserImageCache>,
    manager: Mutex<VrOverlayManager<HostVrOverlayService>>,
    running_mirror: AtomicBool,
    active_backend_mirror: Mutex<Option<&'static str>>,
    frame_producer_factory: VrOverlayFrameProducerFactory,
    frame_producer: Mutex<Option<Box<dyn VrOverlayFrameProducer>>>,
    main_frame_renderer: Mutex<Option<RuntimeMainFrameRenderer>>,
    friends_panel_renderer: Mutex<TinySkiaRenderer>,
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
        Self::new_with_frame_producer_factory(
            backend_available,
            None,
            VrOverlayRuntimeConfig::default(),
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
            interactive_degraded_logged: AtomicBool::new(false),
            backend_available,
            context,
            manager: Mutex::new(VrOverlayManager::new(service)),
            running_mirror: AtomicBool::new(false),
            active_backend_mirror: Mutex::new(None),
            config: Mutex::new(config),
            friends_panel_snapshot_provider: Mutex::new(None),
            friends_panel_favorite_groups: Mutex::new(FavoriteFriendGroupsSnapshot::default()),
            friends_panel_avatars: Arc::new(Mutex::new(HashMap::new())),
            friends_panel_avatar_fetches: Arc::new(Mutex::new(HashSet::new())),
            friends_panel_world_resolves: Arc::new(Mutex::new(HashSet::new())),
            friends_panel_note_memo_cache: Mutex::new(FriendsPanelNoteMemoCache::default()),
            friends_panel_model_dirty: Arc::new(AtomicBool::new(false)),
            devices: Mutex::new(Vec::new()),
            hmd_toasts: Mutex::new(VecDeque::new()),
            interactive_panel: Mutex::new(InteractivePanelRuntimeState::default()),
            avatar_bitmap_cache: Arc::new(AvatarBitmapCache::new()),
            user_image_cache: Arc::new(UserImageCache::new()),
            frame_producer_factory,
            frame_producer: Mutex::new(None),
            main_frame_renderer: Mutex::new(None),
            friends_panel_renderer: Mutex::new(TinySkiaRenderer::new()),
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
            let mut next_device_refresh = Instant::now();
            while !stop_token.is_stop_requested() {
                std::thread::sleep(runtime.refresh_interval());
                if !runtime.has_active_surface() {
                    continue;
                }
                let now = Instant::now();
                let refresh_devices = now >= next_device_refresh;
                runtime.reconcile_current_with_device_refresh(refresh_devices);
                if refresh_devices {
                    next_device_refresh = now + WRIST_DEVICE_REFRESH_INTERVAL;
                }
            }
        });

        let input_runtime = Arc::clone(self);
        tasks.spawn_cancellable_thread("vr-overlay-input", move |stop_token| {
            while !stop_token.is_stop_requested() {
                std::thread::sleep(input_runtime.input_drain_interval());
                input_runtime.drain_overlay_input_events();
            }
        });
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
        if let Ok(mut current) = self.friends_panel_favorite_groups.lock() {
            *current = FavoriteFriendGroupsSnapshot::default();
        }
        if let Ok(mut avatars) = self.friends_panel_avatars.lock() {
            avatars.clear();
        }
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

    fn rebuild_visible_friends_panel_model(&self) {
        let (selected, spinner_phase) = match self.interactive_panel.lock() {
            Ok(panel) if panel.visible => (
                Some(panel.model.selected_category_key.clone()),
                panel.model.spinner_phase,
            ),
            _ => return,
        };
        let model = self.build_current_friends_panel_model(selected, spinner_phase);
        if let Ok(mut panel) = self.interactive_panel.lock() {
            if panel.visible {
                panel.model = model;
            }
        }
    }

    fn build_current_friends_panel_model(
        &self,
        selected_category_key: Option<String>,
        spinner_phase: f32,
    ) -> FavoriteFriendsPanelModel {
        let runtime_config = self.current_runtime_config();
        let selected_category_key =
            selected_category_key.unwrap_or_else(|| self.load_friends_panel_selected_category());
        let friend_snapshot = self.current_friends_panel_snapshot();
        let favorite_groups = self.current_friends_panel_favorite_groups();
        let (notes_by_user_id, memos_by_user_id) =
            self.current_friends_panel_note_memo_maps(&friend_snapshot);
        let world_names_by_id = self.current_friends_panel_world_names(&friend_snapshot);
        let avatars_by_user_id = self
            .friends_panel_avatars
            .lock()
            .map(|avatars| avatars.clone())
            .unwrap_or_default();
        build_friends_panel_model(FriendsPanelModelInput {
            selected_category_key,
            friend_snapshot,
            favorite_groups,
            notes_by_user_id,
            memos_by_user_id,
            world_names_by_id,
            avatars_by_user_id,
            locale: runtime_config.locale,
            all_friends_includes_favorites: runtime_config.panel_all_friends_includes_favorites,
            spinner_phase,
        })
    }

    fn current_friends_panel_snapshot(&self) -> Option<RealtimeFriendSnapshot> {
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
            .visible_rows()
            .map(|(_, row)| row.user_id.clone())
            .collect::<HashSet<_>>();
        if visible_user_ids.is_empty() {
            return;
        }
        let endpoint = if snapshot.endpoint.trim().is_empty() {
            context.auth_scope.snapshot().endpoint
        } else {
            snapshot.endpoint.clone()
        };
        for user_id in &visible_user_ids {
            if let Some(record) = snapshot.friends_by_id.get(user_id) {
                self.queue_friends_panel_avatar(context, &endpoint, record);
                self.queue_friends_panel_world_names(context, &endpoint, record);
            }
        }
    }

    fn queue_friends_panel_avatar(
        &self,
        context: &Arc<RuntimeHostContext>,
        endpoint: &str,
        record: &FriendRecord,
    ) {
        let user_id = record.id.trim();
        if user_id.is_empty()
            || self
                .friends_panel_avatars
                .lock()
                .map(|avatars| avatars.contains_key(user_id))
                .unwrap_or(false)
        {
            return;
        }
        let Ok(mut inflight) = self.friends_panel_avatar_fetches.lock() else {
            return;
        };
        if !inflight.insert(user_id.to_string()) {
            return;
        }
        drop(inflight);

        let context = Arc::clone(context);
        let user_image_cache = Arc::clone(&self.user_image_cache);
        let avatar_cache = Arc::clone(&self.avatar_bitmap_cache);
        let avatars = Arc::clone(&self.friends_panel_avatars);
        let inflight = Arc::clone(&self.friends_panel_avatar_fetches);
        let dirty = Arc::clone(&self.friends_panel_model_dirty);
        let endpoint = endpoint.to_string();
        let user_id = user_id.to_string();
        let initial_image_url = friend_record_avatar_url(record);
        let tasks = context.tasks.clone();
        let allow_user_icon = context
            .config()
            .get_bool("displayVRCPlusIconsAsAvatar", true)
            .unwrap_or(true);
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
                    .resolve(context.web.as_ref(), image_url.trim())
                    .await
                {
                    if let Ok(mut avatars) = avatars.lock() {
                        avatars.insert(user_id.clone(), bitmap);
                    }
                    dirty.store(true, Ordering::Release);
                }
            }
            if let Ok(mut inflight) = inflight.lock() {
                inflight.remove(&user_id);
            }
        });
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

    fn load_friends_panel_selected_category(&self) -> String {
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

    fn persist_friends_panel_selected_category(&self, key: &str) {
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
        if self.friends_panel_animation_refresh_active() {
            FRIENDS_PANEL_ANIMATION_REFRESH_INTERVAL
        } else {
            WRIST_FRAME_REFRESH_INTERVAL
        }
    }

    fn input_drain_interval(&self) -> Duration {
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
            .map(|panel| panel.visible && panel.model.has_visible_traveling_row())
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
        self.game_running.store(game_running, Ordering::Release);
        self.steamvr_running
            .store(steamvr_running, Ordering::Release);
        self.reconcile_current_with_device_refresh(true);
    }

    fn ingest_hmd_delivery(self: &Arc<Self>, delivery: OverlayActivityDelivery) {
        let config = self.current_runtime_config();
        let hmd_config = config.hmd;
        if !delivery.hmd || !self.is_hmd_surface_active(config) {
            return;
        }
        let entry = delivery.entry;
        let now = Instant::now();
        let timeout = Duration::from_millis(hmd_config.timeout_ms);
        let changed = self.enqueue_hmd_toast(entry.clone(), now, timeout);
        if !changed {
            return;
        }
        self.spawn_avatar_fetch(&entry);
        self.reconcile_current();
    }

    fn enqueue_hmd_toast(
        &self,
        entry: OverlayActivityEntry,
        now: Instant,
        timeout: Duration,
    ) -> bool {
        let Ok(mut queue) = self.hmd_toasts.lock() else {
            return false;
        };
        prune_expired_hmd_toasts(&mut queue, now);
        if let Some(existing) = queue
            .iter_mut()
            .rev()
            .find(|toast| should_merge_hmd_toast(toast, &entry, now))
        {
            existing.entry = entry;
            existing.merge_count = existing.merge_count.saturating_add(1);
            existing.expires_at = now + timeout;
            existing.last_updated_at = now;
            return true;
        }
        while queue.len() >= HMD_TOAST_CAPACITY {
            queue.pop_front();
        }
        queue.push_back(HmdToastState {
            entry,
            expires_at: now + timeout,
            last_updated_at: now,
            avatar: None,
            merge_count: 1,
        });
        true
    }

    fn clear_hmd_toasts(&self) {
        if let Ok(mut queue) = self.hmd_toasts.lock() {
            queue.clear();
        }
    }

    fn push_hmd_frame(
        &self,
        manager: &mut VrOverlayManager<HostVrOverlayService>,
        config: VrOverlayRuntimeConfig,
        now: Instant,
    ) {
        let surface_id = OverlaySurfaceId::new(MAIN_SURFACE_ID);
        let toasts = self.hmd_toast_views(now);
        if toasts.is_empty() {
            if let Err(error) = manager.hide_surface(&surface_id) {
                tracing::warn!(error = %error, "failed to hide HMD overlay surface");
            }
            return;
        }
        let frame = match self.render_hmd_frame(toasts, config.locale) {
            Ok(frame) => frame,
            Err(error) => {
                tracing::warn!(error = %error, "failed to render HMD overlay frame");
                return;
            }
        };
        if let Err(error) = manager.update_surface_frame(&surface_id, frame) {
            tracing::warn!(error = %error, "failed to update HMD overlay frame");
            return;
        }
        if let Err(error) =
            manager.set_surface_alpha(&surface_id, f32::from(config.hmd.opacity_percent) / 100.0)
        {
            tracing::warn!(error = %error, "failed to set HMD overlay alpha");
        }
        if let Err(error) = manager.show_surface(&surface_id) {
            tracing::warn!(error = %error, "failed to show HMD overlay surface");
        }
    }

    fn hmd_toast_views(&self, now: Instant) -> Vec<HmdToastView> {
        let Ok(mut queue) = self.hmd_toasts.lock() else {
            return Vec::new();
        };
        prune_expired_hmd_toasts(&mut queue, now);
        queue
            .iter()
            .map(|toast| HmdToastView {
                entry: toast.entry.clone(),
                avatar: toast.avatar.clone(),
                merge_count: toast.merge_count,
            })
            .collect()
    }

    fn render_hmd_frame(
        &self,
        toasts: Vec<HmdToastView>,
        locale: OverlayLocale,
    ) -> Result<RgbaFrame, String> {
        let model = build_main_surface_model(MainOverlayFrameInput { toasts, locale });
        self.main_frame_renderer
            .lock()
            .map_err(|_| "HMD frame renderer lock poisoned".to_string())?
            .get_or_insert_with(RuntimeMainFrameRenderer::new)
            .render(&model)
    }

    fn spawn_avatar_fetch(self: &Arc<Self>, entry: &OverlayActivityEntry) {
        let Some(context) = self.context.as_ref().cloned() else {
            return;
        };
        let source_id = entry.source_id.trim().to_string();
        if source_id.is_empty() {
            return;
        }
        let actor_user_id = entry.actor_user_id.trim().to_string();
        let initial_image_url = entry.content.image_url.trim().to_string();
        if initial_image_url.is_empty() && !actor_user_id.starts_with("usr_") {
            return;
        }
        let allow_user_icon = context
            .config()
            .get_bool("displayVRCPlusIconsAsAvatar", true)
            .unwrap_or(true);
        let user_image_cache = Arc::clone(&self.user_image_cache);
        let avatar_cache = Arc::clone(&self.avatar_bitmap_cache);
        let runtime = Arc::clone(self);
        let tasks = context.tasks.clone();
        tasks.spawn(async move {
            let image_url = if initial_image_url.is_empty() {
                let auth = context.auth_scope.snapshot();
                if actor_user_id == auth.current_user_id {
                    return;
                }
                user_image_cache
                    .resolve(
                        context.web.as_ref(),
                        context.db.as_ref(),
                        &auth.endpoint,
                        &actor_user_id,
                        allow_user_icon,
                    )
                    .await
                    .unwrap_or_default()
            } else {
                initial_image_url
            };
            if image_url.trim().is_empty() {
                return;
            }
            let Some(bitmap) = avatar_cache
                .resolve(context.web.as_ref(), image_url.trim())
                .await
            else {
                return;
            };
            runtime.update_hmd_avatar(&source_id, bitmap);
        });
    }

    fn update_hmd_avatar(&self, source_id: &str, avatar: AvatarBitmap) {
        let updated = {
            let Ok(mut queue) = self.hmd_toasts.lock() else {
                return;
            };
            let Some(toast) = queue
                .iter_mut()
                .find(|toast| toast.entry.source_id == source_id)
            else {
                return;
            };
            if toast.avatar.as_ref() == Some(&avatar) {
                false
            } else {
                toast.avatar = Some(avatar);
                true
            }
        };
        if updated {
            self.reconcile_current();
        }
    }

    pub fn reconcile_current(&self) {
        self.reconcile_current_with_device_refresh(false);
    }

    fn reconcile_current_with_device_refresh(&self, refresh_devices: bool) {
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
                    self.refresh_devices_if_needed(
                        &mut manager,
                        refresh_devices,
                        config.render.show_devices,
                    );
                    self.push_wrist_frame(&mut manager, config);
                } else {
                    self.release_frame_producer();
                }
                if active_surfaces.hmd {
                    self.push_hmd_frame(&mut manager, config, Instant::now());
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

    fn drain_overlay_input_events(&self) {
        if !self.panel_listener_available() && !self.interactive_panel_interaction_active() {
            return;
        }
        let Ok(mut manager) = self.manager.try_lock() else {
            return;
        };
        let input_outcome = self.process_overlay_input_events(&mut manager);
        if input_outcome.surface_config_changed {
            self.apply_current_surface_configs(&mut manager, "interactive");
        }
        if input_outcome.surface_config_changed || input_outcome.frame_changed {
            if let Err(error) =
                manager.set_interaction_active(self.interactive_panel_interaction_active())
            {
                tracing::warn!(error = %error, "failed to set VR overlay interaction mode");
            }
        }
        if input_outcome.frame_changed {
            self.push_friends_panel_frame(&mut manager);
        }
        self.refresh_manager_mirror(&manager);
    }

    fn apply_current_surface_configs(
        &self,
        manager: &mut VrOverlayManager<HostVrOverlayService>,
        context: &str,
    ) {
        let config = self.current_runtime_config();
        let active_surfaces = self.active_surfaces(config);
        if !active_surfaces.any() {
            self.clear_hmd_toasts();
            return;
        }
        let configs = overlay_surface_configs(active_surfaces, config, self);
        if let Err(error) = manager.set_surface_configs(configs) {
            tracing::warn!(
                error = %error,
                context,
                "failed to apply VR overlay surface config"
            );
        }
    }

    fn is_hmd_surface_active(&self, config: VrOverlayRuntimeConfig) -> bool {
        self.active_surfaces(config).hmd
    }

    fn active_surfaces(&self, config: VrOverlayRuntimeConfig) -> ActiveOverlaySurfaces {
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

    fn current_runtime_config(&self) -> VrOverlayRuntimeConfig {
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
        if let Ok(mut producer) = self.frame_producer.lock() {
            producer.take();
        }
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
        panel.model.hovered_region_id = None;
        panel.model.pressed_region_id = None;
        was_visible
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
        let next_model_for_summon = if matches!(&event.kind, OverlayInputKind::Summon { .. }) {
            let opening = self
                .interactive_panel
                .lock()
                .map(|panel| !panel.visible)
                .unwrap_or(false);
            if opening {
                self.clear_friends_panel_note_memo_cache();
                Some(self.build_current_friends_panel_model(None, 0.0))
            } else {
                None
            }
        } else {
            None
        };
        let mut selected_category_to_persist = None;
        let outcome = {
            let Ok(mut panel) = self.interactive_panel.lock() else {
                return OverlayInputProcessOutcome::default();
            };
            match event.kind {
                OverlayInputKind::Summon { transform } => {
                    let frame_changed = !panel.visible;
                    if panel.visible {
                        panel.visible = false;
                        panel.focused = false;
                        panel.model.hovered_region_id = None;
                        panel.model.pressed_region_id = None;
                    } else {
                        panel.visible = true;
                        panel.focused = true;
                        panel.transform = transform;
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
                OverlayInputKind::Hover => {
                    panel
                        .model
                        .apply_uv_action(event.uv, FriendPanelAction::Hover);
                    panel.focused = panel.model.hovered_region_id.is_some();
                    OverlayInputProcessOutcome {
                        surface_config_changed: false,
                        frame_changed: true,
                    }
                }
                OverlayInputKind::ClickDown => {
                    panel
                        .model
                        .apply_uv_action(event.uv, FriendPanelAction::ClickDown);
                    panel.focused = true;
                    OverlayInputProcessOutcome {
                        surface_config_changed: false,
                        frame_changed: true,
                    }
                }
                OverlayInputKind::ClickUp => {
                    let previous_category = panel.model.selected_category_key.clone();
                    let hit = panel
                        .model
                        .apply_uv_action(event.uv, FriendPanelAction::ClickUp);
                    if let Some(region_id) = hit {
                        tracing::debug!(region_id = %region_id, "VR friends panel clicked");
                    }
                    if panel.model.selected_category_key != previous_category {
                        selected_category_to_persist =
                            Some(panel.model.selected_category_key.clone());
                    }
                    panel.focused = panel.model.hovered_region_id.is_some();
                    OverlayInputProcessOutcome {
                        surface_config_changed: false,
                        frame_changed: true,
                    }
                }
                OverlayInputKind::Scroll { delta } => {
                    panel
                        .model
                        .apply_uv_action(event.uv, FriendPanelAction::Scroll { delta });
                    panel.focused = true;
                    OverlayInputProcessOutcome {
                        surface_config_changed: false,
                        frame_changed: true,
                    }
                }
                OverlayInputKind::GrabStart => {
                    panel.focused = true;
                    OverlayInputProcessOutcome::default()
                }
                OverlayInputKind::GrabMove { transform } => {
                    panel.transform = transform;
                    panel.focused = true;
                    OverlayInputProcessOutcome {
                        surface_config_changed: true,
                        frame_changed: false,
                    }
                }
                OverlayInputKind::GrabEnd { transform } => {
                    panel.transform = transform;
                    panel.focused = true;
                    OverlayInputProcessOutcome {
                        surface_config_changed: true,
                        frame_changed: false,
                    }
                }
            }
        };
        if let Some(selected_category) = selected_category_to_persist {
            self.persist_friends_panel_selected_category(&selected_category);
            if self.context.is_some() {
                self.rebuild_visible_friends_panel_model();
            }
            OverlayInputProcessOutcome {
                surface_config_changed: outcome.surface_config_changed,
                frame_changed: true,
            }
        } else {
            outcome
        }
    }

    fn push_friends_panel_frame(&self, manager: &mut VrOverlayManager<HostVrOverlayService>) {
        if self.friends_panel_model_dirty.swap(false, Ordering::AcqRel) {
            self.rebuild_visible_friends_panel_model();
        }
        let model = {
            let Ok(mut panel) = self.interactive_panel.lock() else {
                return;
            };
            if !panel.visible {
                return;
            }
            if panel.model.has_visible_traveling_row() {
                panel.model.spinner_phase =
                    (panel.model.spinner_phase + FRIENDS_PANEL_SPINNER_PHASE_STEP).rem_euclid(1.0);
            }
            panel.model.clone()
        };
        self.queue_friends_panel_assets(&model);
        let scene = build_friends_panel_scene(&model);
        let frame = match self
            .friends_panel_renderer
            .lock()
            .map_err(|_| "friends panel renderer lock poisoned".to_string())
            .and_then(|mut renderer| renderer.render(&scene).map_err(|error| error.to_string()))
        {
            Ok(frame) => frame,
            Err(error) => {
                tracing::warn!(error = %error, "failed to render VR friends panel frame");
                return;
            }
        };
        let surface_id = OverlaySurfaceId::new(FRIENDS_PANEL_SURFACE_ID);
        if let Err(error) = manager.update_surface_frame(&surface_id, frame) {
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
            GameLogEventKind::DesktopMode | GameLogEventKind::VrcQuit => self.set_vr_mode(false),
            _ => {}
        }
        Ok(())
    }
}

struct RuntimeWristFrameProducer {
    context: Arc<RuntimeHostContext>,
    text: TextMeasurer,
    renderer: TinySkiaRenderer,
}

impl RuntimeWristFrameProducer {
    fn new(context: Arc<RuntimeHostContext>) -> Self {
        let font_system = new_shared_overlay_font_system();
        Self {
            context,
            text: TextMeasurer::with_font_system(Arc::clone(&font_system)),
            renderer: TinySkiaRenderer::with_font_system(font_system),
        }
    }
}

impl VrOverlayFrameProducer for RuntimeWristFrameProducer {
    fn next_frame(&mut self, input: VrOverlayFrameInput) -> Result<RgbaFrame, String> {
        let frame_input = build_wrist_frame_input(&self.context, input.config, input.devices);
        let model = build_wrist_surface_model(frame_input);
        self.renderer
            .render(&build_wrist_scene(&model, &mut self.text))
            .map_err(|error| error.to_string())
    }
}

#[derive(Default)]
struct StaticWristFrameProducer;

impl VrOverlayFrameProducer for StaticWristFrameProducer {
    fn next_frame(&mut self, _input: VrOverlayFrameInput) -> Result<RgbaFrame, String> {
        Ok(RgbaFrame::new(OverlaySize::new(16, 8), vec![0; 16 * 8 * 4]))
    }
}

struct RuntimeMainFrameRenderer {
    text: TextMeasurer,
    renderer: TinySkiaRenderer,
}

impl RuntimeMainFrameRenderer {
    fn new() -> Self {
        let font_system = new_shared_overlay_font_system();
        Self {
            text: TextMeasurer::with_font_system(Arc::clone(&font_system)),
            renderer: TinySkiaRenderer::with_font_system(font_system),
        }
    }

    fn render(&mut self, model: &MainSurfaceModel) -> Result<RgbaFrame, String> {
        self.renderer
            .render(&build_main_scene(model, &mut self.text))
            .map_err(|error| error.to_string())
    }
}

#[derive(Default)]
struct AvatarBitmapCache {
    success: Mutex<HashMap<String, (AvatarBitmap, Instant)>>,
    failures: Mutex<HashMap<String, Instant>>,
    inflight: Mutex<HashMap<String, std::sync::Weak<tokio::sync::Mutex<()>>>>,
}

impl AvatarBitmapCache {
    fn new() -> Self {
        Self::default()
    }

    async fn resolve(&self, web: &WebClient, url: &str) -> Option<AvatarBitmap> {
        let url = url.trim();
        if url.is_empty() {
            return None;
        }
        if let Some(bitmap) = self.cached(url) {
            return Some(bitmap);
        }
        if self.recently_failed(url) {
            return None;
        }
        let inflight = self.inflight_lock(url);
        let _guard = inflight.lock().await;
        if let Some(bitmap) = self.cached(url) {
            return Some(bitmap);
        }
        if self.recently_failed(url) {
            return None;
        }
        let bitmap = self.fetch_and_decode(web, url).await;
        match bitmap {
            Some(bitmap) => {
                self.store_success(url, bitmap.clone());
                Some(bitmap)
            }
            None => {
                self.store_failure(url);
                None
            }
        }
    }

    async fn fetch_and_decode(&self, web: &WebClient, url: &str) -> Option<AvatarBitmap> {
        let fetcher = web.image_fetcher().ok()?;
        let bytes = tokio::time::timeout(HMD_AVATAR_FETCH_TIMEOUT, fetcher.fetch_image(url))
            .await
            .ok()?
            .ok()?;
        decode_avatar_bitmap(&bytes)
    }

    fn cached(&self, url: &str) -> Option<AvatarBitmap> {
        let mut success = self
            .success
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let (bitmap, at) = success.get(url)?;
        if at.elapsed() >= HMD_AVATAR_SUCCESS_TTL {
            success.remove(url);
            return None;
        }
        Some(bitmap.clone())
    }

    fn recently_failed(&self, url: &str) -> bool {
        self.failures
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .get(url)
            .is_some_and(|at| at.elapsed() < HMD_AVATAR_FAILURE_TTL)
    }

    fn store_success(&self, url: &str, bitmap: AvatarBitmap) {
        let mut success = self
            .success
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        success.retain(|_, (_, at)| at.elapsed() < HMD_AVATAR_SUCCESS_TTL);
        success.insert(url.to_string(), (bitmap, Instant::now()));
    }

    fn store_failure(&self, url: &str) {
        let mut failures = self
            .failures
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        failures.retain(|_, at| at.elapsed() < HMD_AVATAR_FAILURE_TTL);
        failures.insert(url.to_string(), Instant::now());
    }

    fn inflight_lock(&self, url: &str) -> Arc<tokio::sync::Mutex<()>> {
        let mut inflight = self
            .inflight
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if let Some(existing) = inflight.get(url).and_then(std::sync::Weak::upgrade) {
            return existing;
        }
        inflight.retain(|_, weak| weak.strong_count() > 0);
        let guard = Arc::new(tokio::sync::Mutex::new(()));
        inflight.insert(url.to_string(), Arc::downgrade(&guard));
        guard
    }
}

fn decode_avatar_bitmap(bytes: &[u8]) -> Option<AvatarBitmap> {
    let resized = image::load_from_memory(bytes)
        .ok()?
        .resize_to_fill(
            HMD_AVATAR_SIZE,
            HMD_AVATAR_SIZE,
            image::imageops::FilterType::Lanczos3,
        )
        .to_rgba8();
    let mut rgba = resized.into_raw();
    apply_circular_avatar_mask(&mut rgba, HMD_AVATAR_SIZE, HMD_AVATAR_SIZE);
    Some(AvatarBitmap {
        width: HMD_AVATAR_SIZE,
        height: HMD_AVATAR_SIZE,
        rgba: Arc::<[u8]>::from(rgba),
    })
}

fn apply_circular_avatar_mask(rgba: &mut [u8], width: u32, height: u32) {
    let center_x = (width as f32 - 1.0) / 2.0;
    let center_y = (height as f32 - 1.0) / 2.0;
    let radius = width.min(height) as f32 / 2.0;
    let radius_sq = radius * radius;
    for y in 0..height {
        for x in 0..width {
            let dx = x as f32 - center_x;
            let dy = y as f32 - center_y;
            if dx * dx + dy * dy <= radius_sq {
                continue;
            }
            let alpha_index = ((y * width + x) * 4 + 3) as usize;
            if let Some(alpha) = rgba.get_mut(alpha_index) {
                *alpha = 0;
            }
        }
    }
}

fn prune_expired_hmd_toasts(queue: &mut VecDeque<HmdToastState>, now: Instant) {
    queue.retain(|toast| toast.expires_at > now);
}

fn should_merge_hmd_toast(
    existing: &HmdToastState,
    entry: &OverlayActivityEntry,
    now: Instant,
) -> bool {
    let existing_instance_key = hmd_instance_key(&existing.entry);
    let entry_instance_key = hmd_instance_key(entry);
    existing.last_updated_at + HMD_JOIN_LEAVE_MERGE_WINDOW >= now
        && is_mergeable_hmd_activity(&existing.entry)
        && is_mergeable_hmd_activity(entry)
        && existing.entry.activity_type == entry.activity_type
        && existing_instance_key.is_some()
        && existing_instance_key == entry_instance_key
}

fn is_mergeable_hmd_activity(entry: &OverlayActivityEntry) -> bool {
    entry.actor_relation == OverlayActivityActorRelation::None
        && matches!(
            entry.activity_type.as_str(),
            "OnPlayerJoined" | "OnPlayerLeft"
        )
}

fn hmd_instance_key(entry: &OverlayActivityEntry) -> Option<String> {
    [
        entry.content.location.as_str(),
        entry.content.display_location.as_str(),
        entry.content.world_id.as_str(),
        entry.content.world_name.as_str(),
    ]
    .into_iter()
    .map(str::trim)
    .find(|value| !value.is_empty())
    .map(str::to_string)
}

fn start_mode_allows(start_mode: WristOverlayStartMode, game_running: bool, vr_mode: bool) -> bool {
    match start_mode {
        WristOverlayStartMode::SteamVr => true,
        WristOverlayStartMode::VrchatVrMode => game_running && vr_mode,
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
struct FavoriteFriendGroupSnapshot {
    key: String,
    label: String,
    user_ids: Vec<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
struct FavoriteFriendGroupsSnapshot {
    groups: Vec<FavoriteFriendGroupSnapshot>,
}

impl FavoriteFriendGroupsSnapshot {
    fn all_user_ids(&self) -> Vec<String> {
        self.user_ids_for_groups(|_| true)
    }

    fn group_user_ids(&self, key: &str) -> Option<Vec<String>> {
        self.groups
            .iter()
            .find(|group| group.key == key)
            .map(|group| group.user_ids.clone())
    }

    fn local_user_ids(&self) -> Vec<String> {
        self.user_ids_for_groups(|group| group.key.starts_with(LOCAL_FAVORITE_GROUP_PREFIX))
    }

    fn user_ids_for_groups(
        &self,
        include_group: impl Fn(&FavoriteFriendGroupSnapshot) -> bool,
    ) -> Vec<String> {
        let mut seen = HashSet::new();
        let mut user_ids = Vec::new();
        for group in self.groups.iter().filter(|group| include_group(group)) {
            for user_id in &group.user_ids {
                if seen.insert(user_id.clone()) {
                    user_ids.push(user_id.clone());
                }
            }
        }
        user_ids
    }
}

#[derive(Clone, Debug, Default)]
struct FriendsPanelModelInput {
    selected_category_key: String,
    friend_snapshot: Option<RealtimeFriendSnapshot>,
    favorite_groups: FavoriteFriendGroupsSnapshot,
    notes_by_user_id: HashMap<String, String>,
    memos_by_user_id: HashMap<String, String>,
    world_names_by_id: HashMap<String, String>,
    avatars_by_user_id: HashMap<String, AvatarBitmap>,
    locale: OverlayLocale,
    all_friends_includes_favorites: bool,
    spinner_phase: f32,
}

fn favorite_friend_groups_snapshot_from_baseline(
    snapshot: &serde_json::Value,
) -> FavoriteFriendGroupsSnapshot {
    let remote_membership = object_string_vecs(snapshot.get("groupedFavoriteFriendIdsByGroupKey"));
    let local_membership = object_string_vecs(snapshot.get("localFriendFavorites"));
    let remote_labels = group_labels(snapshot.get("favoriteFriendGroups"), "");
    let local_labels = group_labels(
        snapshot.get("localFriendFavoriteGroups"),
        LOCAL_FAVORITE_GROUP_PREFIX,
    );
    let mut groups = Vec::new();

    for (key, user_ids) in remote_membership {
        if user_ids.is_empty() {
            continue;
        }
        let label = remote_labels
            .get(&key)
            .cloned()
            .unwrap_or_else(|| fallback_group_label(&key));
        groups.push(FavoriteFriendGroupSnapshot {
            key,
            label,
            user_ids,
        });
    }
    for (raw_key, user_ids) in local_membership {
        if user_ids.is_empty() {
            continue;
        }
        let key = format!("{LOCAL_FAVORITE_GROUP_PREFIX}{raw_key}");
        let label = local_labels
            .get(&key)
            .cloned()
            .unwrap_or_else(|| fallback_group_label(&raw_key));
        groups.push(FavoriteFriendGroupSnapshot {
            key,
            label,
            user_ids,
        });
    }
    FavoriteFriendGroupsSnapshot { groups }
}

fn local_favorite_friend_groups_from_db(
    db: &vrcx_0_persistence::DatabaseService,
) -> std::result::Result<FavoriteFriendGroupsSnapshot, vrcx_0_persistence::Error> {
    let rows = favorite_list(db, "friend".to_string())?;
    let mut groups_by_key: HashMap<String, Vec<String>> = HashMap::new();
    for row in rows {
        let user_id = json_string_field(&row, "userId").unwrap_or_default();
        if user_id.is_empty() {
            continue;
        }
        let group_name = json_string_field(&row, "groupName").unwrap_or_else(|| "Favorites".into());
        let group_name = if group_name.trim().is_empty() {
            "Favorites".to_string()
        } else {
            group_name
        };
        groups_by_key.entry(group_name).or_default().push(user_id);
    }
    let mut groups = groups_by_key
        .into_iter()
        .map(|(group_name, user_ids)| FavoriteFriendGroupSnapshot {
            key: format!("{LOCAL_FAVORITE_GROUP_PREFIX}{group_name}"),
            label: group_name,
            user_ids: dedupe_preserve_order(user_ids),
        })
        .collect::<Vec<_>>();
    groups.sort_by(|left, right| left.label.cmp(&right.label).then(left.key.cmp(&right.key)));
    Ok(FavoriteFriendGroupsSnapshot { groups })
}

fn load_friends_panel_notes(
    context: &RuntimeHostContext,
    owner_user_id: String,
) -> HashMap<String, String> {
    memo_list_user_notes(context.db.as_ref(), owner_user_id)
        .map(|notes| {
            notes
                .into_iter()
                .filter(|note| !note.user_id.trim().is_empty() && !note.note.trim().is_empty())
                .map(|note| (note.user_id, note.note))
                .collect()
        })
        .unwrap_or_default()
}

fn load_friends_panel_memos(context: &RuntimeHostContext) -> HashMap<String, String> {
    memo_list_users(context.db.as_ref())
        .map(|memos| {
            memos
                .into_iter()
                .filter(|memo| !memo.user_id.trim().is_empty() && !memo.memo.trim().is_empty())
                .map(|memo| (memo.user_id, memo.memo))
                .collect()
        })
        .unwrap_or_default()
}

fn build_friends_panel_model(input: FriendsPanelModelInput) -> FavoriteFriendsPanelModel {
    let localizer = OverlayLocalizer::new(input.locale);
    let strings = localizer.friends_panel_strings();
    let snapshot = input.friend_snapshot.as_ref();
    let favorites_user_ids = input.favorite_groups.all_user_ids();
    let favorites_user_id_set = favorites_user_ids.iter().cloned().collect::<HashSet<_>>();
    let all_user_ids = all_friend_category_user_ids(
        snapshot,
        &favorites_user_id_set,
        input.all_friends_includes_favorites,
    );
    let local_favorite_user_ids = input.favorite_groups.local_user_ids();
    let mut categories = vec![
        FriendPanelCategory {
            key: FRIENDS_PANEL_CATEGORY_ALL.to_string(),
            label: strings.all_label.clone(),
            count: present_friend_count(snapshot, &all_user_ids),
        },
        FriendPanelCategory {
            key: FRIENDS_PANEL_CATEGORY_FAVORITES_ONLINE.to_string(),
            label: localizer.friends_panel_favorites_online_label(),
            count: visible_friend_count(snapshot, &favorites_user_ids),
        },
        FriendPanelCategory {
            key: FRIENDS_PANEL_CATEGORY_LOCAL_FAVORITES.to_string(),
            label: localizer.friends_panel_local_favorites_label(),
            count: present_friend_count(snapshot, &local_favorite_user_ids),
        },
    ];
    categories.extend(
        input
            .favorite_groups
            .groups
            .iter()
            .map(|group| FriendPanelCategory {
                key: format!("{FRIENDS_PANEL_CATEGORY_GROUP_PREFIX}{}", group.key),
                label: group.label.clone(),
                count: present_friend_count(snapshot, &group.user_ids),
            }),
    );

    let selected_category_key = normalize_friends_panel_category_key(&input.selected_category_key);
    let selected_category_key = if categories
        .iter()
        .any(|category| category.key == selected_category_key)
    {
        selected_category_key
    } else {
        FRIENDS_PANEL_CATEGORY_ALL.to_string()
    };
    let selected_user_ids = selected_category_user_ids(
        &selected_category_key,
        snapshot,
        &input.favorite_groups,
        &favorites_user_id_set,
        input.all_friends_includes_favorites,
    );
    let online_only = category_is_online_only(&selected_category_key);
    let mut rows = snapshot
        .map(|snapshot| {
            selected_user_ids
                .into_iter()
                .filter_map(|user_id| {
                    let record = snapshot.friends_by_id.get(&user_id)?;
                    if online_only && !friend_record_is_visible(record) {
                        return None;
                    }
                    Some(friend_row_from_record(&input, &localizer, record))
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    rows.sort_by(|left, right| {
        let left_record = snapshot.and_then(|snapshot| snapshot.friends_by_id.get(&left.user_id));
        let right_record = snapshot.and_then(|snapshot| snapshot.friends_by_id.get(&right.user_id));
        friend_sort_key(left, left_record).cmp(&friend_sort_key(right, right_record))
    });

    FavoriteFriendsPanelModel {
        categories,
        selected_category_key,
        rows,
        spinner_phase: input.spinner_phase,
        strings,
        ..FavoriteFriendsPanelModel::default()
    }
}

fn all_friend_category_user_ids(
    snapshot: Option<&RealtimeFriendSnapshot>,
    favorite_user_ids: &HashSet<String>,
    include_favorites: bool,
) -> Vec<String> {
    snapshot
        .map(|snapshot| {
            snapshot
                .friends_by_id
                .keys()
                .filter(|user_id| include_favorites || !favorite_user_ids.contains(*user_id))
                .cloned()
                .collect()
        })
        .unwrap_or_default()
}

fn selected_category_user_ids(
    selected_category_key: &str,
    snapshot: Option<&RealtimeFriendSnapshot>,
    favorite_groups: &FavoriteFriendGroupsSnapshot,
    favorite_user_ids: &HashSet<String>,
    include_favorites: bool,
) -> Vec<String> {
    match selected_category_key {
        FRIENDS_PANEL_CATEGORY_ALL => {
            all_friend_category_user_ids(snapshot, favorite_user_ids, include_favorites)
        }
        FRIENDS_PANEL_CATEGORY_FAVORITES_ONLINE => favorite_groups.all_user_ids(),
        FRIENDS_PANEL_CATEGORY_LOCAL_FAVORITES => favorite_groups.local_user_ids(),
        _ => selected_category_key
            .strip_prefix(FRIENDS_PANEL_CATEGORY_GROUP_PREFIX)
            .and_then(|key| favorite_groups.group_user_ids(key))
            .unwrap_or_default(),
    }
}

fn normalize_friends_panel_category_key(key: &str) -> String {
    let key = key.trim();
    if key.is_empty() || key == FRIENDS_PANEL_CATEGORY_ALL {
        return FRIENDS_PANEL_CATEGORY_ALL.to_string();
    }
    if key == FRIENDS_PANEL_CATEGORY_FAVORITES_ONLINE
        || key == FRIENDS_PANEL_CATEGORY_LOCAL_FAVORITES
        || key.starts_with(FRIENDS_PANEL_CATEGORY_GROUP_PREFIX)
    {
        return key.to_string();
    }
    format!("{FRIENDS_PANEL_CATEGORY_GROUP_PREFIX}{key}")
}

fn friend_record_world_ids(record: &FriendRecord) -> Vec<String> {
    let ids = [
        record.world_id.trim().to_string(),
        world_id_from_location(&record.location),
        world_id_from_location(&record.traveling_to_location),
        world_id_from_location(&extra_string(record, "travelingToLocation")),
        world_id_from_location(&extra_string(record, "$travelingToLocation")),
    ]
    .into_iter()
    .filter(|value| !value.is_empty())
    .collect::<Vec<_>>();
    dedupe_preserve_order(ids)
}

fn object_string_vecs(value: Option<&serde_json::Value>) -> Vec<(String, Vec<String>)> {
    let Some(object) = value.and_then(serde_json::Value::as_object) else {
        return Vec::new();
    };
    let mut groups = object
        .iter()
        .filter_map(|(key, value)| {
            let user_ids = value
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|value| value.as_str().map(str::trim).map(str::to_string))
                .filter(|value| !value.is_empty())
                .collect::<Vec<_>>();
            if user_ids.is_empty() {
                None
            } else {
                Some((key.clone(), dedupe_preserve_order(user_ids)))
            }
        })
        .collect::<Vec<_>>();
    groups.sort_by(|left, right| left.0.cmp(&right.0));
    groups
}

fn group_labels(value: Option<&serde_json::Value>, key_prefix: &str) -> HashMap<String, String> {
    value
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|group| {
            let raw_key = json_string_field(group, "key")
                .or_else(|| json_string_field(group, "name"))
                .or_else(|| json_string_field(group, "displayName"))?;
            let key = format!("{key_prefix}{raw_key}");
            let label = json_string_field(group, "displayName")
                .or_else(|| json_string_field(group, "name"))
                .unwrap_or_else(|| fallback_group_label(&raw_key));
            Some((key, label))
        })
        .collect()
}

fn json_string_field(value: &serde_json::Value, key: &str) -> Option<String> {
    value
        .as_object()
        .and_then(|object| object.get(key))
        .and_then(|value| match value {
            serde_json::Value::String(value) => Some(value.trim().to_string()),
            serde_json::Value::Number(value) => Some(value.to_string()),
            serde_json::Value::Bool(value) => Some(value.to_string()),
            _ => None,
        })
        .filter(|value| !value.is_empty())
}

fn fallback_group_label(key: &str) -> String {
    key.rsplit(':').next().unwrap_or(key).to_string()
}

fn dedupe_preserve_order(values: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    values
        .into_iter()
        .filter(|value| seen.insert(value.clone()))
        .collect()
}

fn visible_friend_count(snapshot: Option<&RealtimeFriendSnapshot>, user_ids: &[String]) -> usize {
    let Some(snapshot) = snapshot else {
        return 0;
    };
    user_ids
        .iter()
        .filter_map(|user_id| snapshot.friends_by_id.get(user_id))
        .filter(|record| friend_record_is_visible(record))
        .count()
}

fn present_friend_count(snapshot: Option<&RealtimeFriendSnapshot>, user_ids: &[String]) -> usize {
    let Some(snapshot) = snapshot else {
        return 0;
    };
    user_ids
        .iter()
        .filter(|user_id| snapshot.friends_by_id.contains_key(*user_id))
        .count()
}

fn category_is_online_only(category_key: &str) -> bool {
    category_key == FRIENDS_PANEL_CATEGORY_FAVORITES_ONLINE
}

fn friend_record_is_visible(record: &FriendRecord) -> bool {
    let state = first_non_empty([record.state_bucket.as_str(), record.state.as_str()]);
    matches!(
        state.trim().to_ascii_lowercase().as_str(),
        "online" | "active"
    )
}

fn friend_row_from_record(
    input: &FriendsPanelModelInput,
    localizer: &OverlayLocalizer,
    record: &FriendRecord,
) -> FriendPanelRow {
    let user_id = record.id.trim().to_string();
    let traveling_location = traveling_location(record);
    let is_traveling =
        !traveling_location.is_empty() || record.location.trim().eq_ignore_ascii_case("traveling");
    let (location_text, traveling_text) = if is_traveling {
        (
            localizer.friends_panel_traveling_label(),
            Some(display_friend_location(
                localizer,
                &input.world_names_by_id,
                &traveling_location,
                "",
            )),
        )
    } else {
        (
            display_friend_location(
                localizer,
                &input.world_names_by_id,
                &record.location,
                &record.world_id,
            ),
            None,
        )
    };
    FriendPanelRow {
        user_id: user_id.clone(),
        display_name: record.display_name_or_id(),
        status: friend_status_tone(record),
        location_text,
        is_traveling,
        traveling_text: traveling_text.filter(|value| !value.trim().is_empty()),
        note: friend_record_note(record).or_else(|| input.notes_by_user_id.get(&user_id).cloned()),
        memo: input.memos_by_user_id.get(&user_id).cloned(),
        avatar: input.avatars_by_user_id.get(&user_id).cloned(),
    }
}

fn friend_record_note(record: &FriendRecord) -> Option<String> {
    record
        .extra
        .get("note")
        .and_then(|value| match value {
            serde_json::Value::String(value) => Some(value.trim().to_string()),
            serde_json::Value::Number(value) => Some(value.to_string()),
            serde_json::Value::Bool(value) => Some(value.to_string()),
            _ => None,
        })
        .filter(|value| !value.is_empty())
}

fn display_friend_location(
    localizer: &OverlayLocalizer,
    world_names_by_id: &HashMap<String, String>,
    location: &str,
    record_world_id: &str,
) -> String {
    let location = location.trim();
    if location.is_empty() || location.eq_ignore_ascii_case("private") {
        return localizer.friends_panel_private_label();
    }
    if location.eq_ignore_ascii_case("offline") {
        return localizer.friends_panel_offline_label();
    }
    let parsed_world_id = world_id_from_location(location);
    let world_id = if record_world_id.trim().is_empty() {
        parsed_world_id.as_str()
    } else {
        record_world_id.trim()
    };
    let world_name = world_names_by_id
        .get(world_id)
        .map(String::as_str)
        .unwrap_or(world_id);
    let display = localizer.panel_display_location(location, world_name, "");
    if display.trim().is_empty() {
        localizer.friends_panel_private_label()
    } else {
        display
    }
}

fn traveling_location(record: &FriendRecord) -> String {
    let traveling_to_location = extra_string(record, "travelingToLocation");
    let legacy_traveling_to_location = extra_string(record, "$travelingToLocation");
    first_non_empty([
        record.traveling_to_location.as_str(),
        traveling_to_location.as_str(),
        legacy_traveling_to_location.as_str(),
    ])
    .to_string()
}

fn friend_record_avatar_url(record: &FriendRecord) -> String {
    let profile_override = extra_string(record, "profilePicOverride");
    let user_icon = extra_string(record, "userIcon");
    first_non_empty([
        profile_override.as_str(),
        record.current_avatar_thumbnail_image_url.as_str(),
        record.current_avatar_image_url.as_str(),
        user_icon.as_str(),
    ])
    .to_string()
}

fn extra_string(record: &FriendRecord, key: &str) -> String {
    record
        .extra
        .get(key)
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or_default()
        .to_string()
}

fn friend_status_tone(record: &FriendRecord) -> FriendPanelStatusTone {
    if !friend_record_is_visible(record) {
        return FriendPanelStatusTone::Offline;
    }
    match record.status.trim().to_ascii_lowercase().as_str() {
        "busy" => FriendPanelStatusTone::Busy,
        "ask me" | "askme" => FriendPanelStatusTone::AskMe,
        _ if record.state_bucket.trim().eq_ignore_ascii_case("active") => {
            FriendPanelStatusTone::Active
        }
        _ => FriendPanelStatusTone::Online,
    }
}

fn friend_sort_key(
    row: &FriendPanelRow,
    record: Option<&FriendRecord>,
) -> (u8, i64, String, String) {
    let state_order = match row.status {
        FriendPanelStatusTone::Online
        | FriendPanelStatusTone::Busy
        | FriendPanelStatusTone::AskMe => 0,
        FriendPanelStatusTone::Active => 1,
        FriendPanelStatusTone::Offline => 2,
    };
    let friend_number = record.and_then(friend_number).unwrap_or(i64::MAX);
    (
        state_order,
        friend_number,
        row.display_name.to_ascii_lowercase(),
        row.user_id.clone(),
    )
}

fn friend_number(record: &FriendRecord) -> Option<i64> {
    for key in ["friendNumber", "friend_number"] {
        let Some(value) = record.extra.get(key) else {
            continue;
        };
        if let Some(number) = value.as_i64() {
            return Some(number);
        }
        if let Some(number) = value.as_str().and_then(|value| value.trim().parse().ok()) {
            return Some(number);
        }
    }
    None
}

fn first_non_empty<'a>(values: impl IntoIterator<Item = &'a str>) -> &'a str {
    values
        .into_iter()
        .find(|value| !value.trim().is_empty())
        .unwrap_or("")
        .trim()
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
    WristOverlayFrameInput {
        activity: context.overlay_activity.snapshot(),
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
        captured_at_ms,
    }
}

pub(super) fn load_runtime_config(config: &ConfigRepository) -> VrOverlayRuntimeConfig {
    let start_mode = config
        .get_string(VR_OVERLAY_START_MODE_CONFIG_KEY, "vrchatVrMode")
        .map(|value| WristOverlayStartMode::from_config(&value))
        .unwrap_or_default();
    let backend = config
        .get_string(VR_OVERLAY_BACKEND_CONFIG_KEY, "auto")
        .map(|value| OverlayBackendPreference::from_config(&value))
        .unwrap_or_default();
    let button = config
        .get_string(VR_OVERLAY_BUTTON_CONFIG_KEY, "grip")
        .map(|value| match value.trim() {
            "menu" => OverlayActivationButton::Menu,
            _ => OverlayActivationButton::Grip,
        })
        .unwrap_or_default();
    let hand = config
        .get_string(VR_OVERLAY_HAND_CONFIG_KEY, "left")
        .map(|value| WristOverlayHand::from_config(&value))
        .unwrap_or_default();
    let size = config
        .get_string(
            VR_OVERLAY_SIZE_CONFIG_KEY,
            WristOverlaySizePreset::Normal.as_config(),
        )
        .map(|value| WristOverlaySizePreset::from_config(&value))
        .unwrap_or_default();
    let hide_private_worlds = config
        .get_bool(VR_OVERLAY_HIDE_PRIVATE_WORLDS_CONFIG_KEY, false)
        .unwrap_or(false);
    let dark_background = config
        .get_bool(VR_OVERLAY_DARK_BACKGROUND_CONFIG_KEY, true)
        .unwrap_or(true);
    let show_devices = config
        .get_bool(VR_OVERLAY_SHOW_DEVICES_CONFIG_KEY, true)
        .unwrap_or(true);
    let show_battery_percent = config
        .get_bool(VR_OVERLAY_SHOW_BATTERY_PERCENT_CONFIG_KEY, false)
        .unwrap_or(false);
    let hmd_enabled = config
        .get_bool(HMD_NOTIFICATIONS_ENABLED_CONFIG_KEY, false)
        .unwrap_or(false);
    let hmd_start_mode = config
        .get_string(HMD_NOTIFICATION_START_MODE_CONFIG_KEY, "vrchatVrMode")
        .map(|value| WristOverlayStartMode::from_config(&value))
        .unwrap_or_default();
    let hmd_timeout_ms = config
        .get_raw(HMD_NOTIFICATION_TIMEOUT_CONFIG_KEY)
        .ok()
        .flatten()
        .and_then(|value| value.trim().parse::<u64>().ok())
        .unwrap_or(5_000)
        .clamp(1_000, 30_000);
    let hmd_opacity_percent = config
        .get_raw(HMD_NOTIFICATION_OPACITY_CONFIG_KEY)
        .ok()
        .flatten()
        .and_then(|value| value.trim().parse::<u8>().ok())
        .unwrap_or(100)
        .min(100);
    let hmd_position = config
        .get_string(HMD_NOTIFICATION_POSITION_CONFIG_KEY, "bottom")
        .map(|value| HmdNotificationPosition::from_config(&value))
        .unwrap_or_default();
    let panel_enabled = config
        .get_bool(VR_OVERLAY_PANEL_ENABLED_CONFIG_KEY, true)
        .unwrap_or(true);
    let panel_all_friends_includes_favorites = config
        .get_bool(
            VR_OVERLAY_PANEL_ALL_FRIENDS_INCLUDES_FAVORITES_CONFIG_KEY,
            true,
        )
        .unwrap_or(true);
    let locale = config
        .get_string(APP_LANGUAGE_CONFIG_KEY, "en")
        .map(|value| OverlayLocale::from_config(&value))
        .unwrap_or_default();
    let dt_hour12 = config
        .get_bool(DATE_TIME_HOUR12_CONFIG_KEY, false)
        .unwrap_or(false);

    VrOverlayRuntimeConfig {
        start_mode,
        backend,
        button,
        hand,
        panel_enabled,
        panel_all_friends_includes_favorites,
        hmd: HmdNotificationConfig {
            enabled: hmd_enabled,
            start_mode: hmd_start_mode,
            timeout_ms: hmd_timeout_ms,
            opacity_percent: hmd_opacity_percent,
            position: hmd_position,
        },
        render: WristOverlayRenderOptions {
            size,
            hide_private_worlds,
            dark_background,
            show_devices,
            show_battery_percent,
        },
        locale,
        dt_hour12,
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
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use vrcx_0_host::vr_overlay::OverlayHand;
    use vrcx_0_vr_overlay::UvPoint;

    fn friends_panel_input(kind: OverlayInputKind, uv: UvPoint) -> OverlayInputEvent {
        OverlayInputEvent {
            surface_id: OverlaySurfaceId::new(FRIENDS_PANEL_SURFACE_ID),
            panel_id: FRIENDS_PANEL_ID.to_string(),
            hand: OverlayHand::Left,
            uv,
            kind,
        }
    }

    fn friends_panel_summon_input(transform: OverlayTransform) -> OverlayInputEvent {
        friends_panel_input(
            OverlayInputKind::Summon { transform },
            UvPoint::new(0.5, 0.5),
        )
    }

    fn legacy_dummy_summon_input(transform: OverlayTransform) -> OverlayInputEvent {
        OverlayInputEvent {
            surface_id: OverlaySurfaceId::new(vrcx_0_vr_overlay::INTERACTIVE_DUMMY_SURFACE_ID),
            panel_id: LEGACY_DUMMY_PANEL_ID.to_string(),
            hand: OverlayHand::Left,
            uv: UvPoint::new(0.5, 0.5),
            kind: OverlayInputKind::Summon { transform },
        }
    }

    fn friend_panel_test_row(
        user_id: impl Into<String>,
        display_name: impl Into<String>,
        status: FriendPanelStatusTone,
    ) -> FriendPanelRow {
        FriendPanelRow {
            user_id: user_id.into(),
            display_name: display_name.into(),
            status,
            location_text: "World".to_string(),
            is_traveling: false,
            traveling_text: None,
            note: None,
            memo: None,
            avatar: None,
        }
    }

    fn friends_panel_region_uv(runtime: &VrOverlayRuntime, region_id: &str) -> UvPoint {
        let panel = runtime.interactive_panel.lock().unwrap();
        build_friends_panel_scene(&panel.model)
            .hit_regions
            .iter()
            .find(|region| region.id == region_id)
            .map(|region| region.rect.center_uv(panel.model.size))
            .unwrap_or_else(|| panic!("{region_id} hit region"))
    }

    struct TestDir {
        path: std::path::PathBuf,
    }

    impl TestDir {
        fn new(name: &str) -> Self {
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "vrcx-0-vr-overlay-{name}-{}-{nonce}",
                std::process::id()
            ));
            std::fs::create_dir_all(&path).unwrap();
            Self { path }
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    fn test_context(
        name: &str,
    ) -> (
        TestDir,
        Arc<vrcx_0_persistence::DatabaseService>,
        Arc<RuntimeHostContext>,
    ) {
        let dir = TestDir::new(name);
        let db = Arc::new(
            vrcx_0_persistence::DatabaseService::new(&dir.path.join("VRCX-0.sqlite3")).unwrap(),
        );
        let storage =
            vrcx_0_persistence::storage::StorageService::new(&dir.path.join("VRCX-0.json"))
                .unwrap();
        let web = Arc::new(
            WebClient::new(
                &storage,
                &db,
                "https://app.example".into(),
                env!("CARGO_PKG_VERSION"),
            )
            .unwrap(),
        );
        let image_fetcher = web.image_fetcher().unwrap();
        let image_cache = Arc::new(
            vrcx_0_application::ImageCache::new(dir.path.join("ImageCache"), image_fetcher)
                .unwrap(),
        );
        let context = Arc::new(RuntimeHostContext::new(Arc::clone(&db), web, image_cache));
        (dir, db, context)
    }

    fn friends_panel_snapshot(record: FriendRecord) -> RealtimeFriendSnapshot {
        RealtimeFriendSnapshot {
            current_user_id: "usr_self".to_string(),
            friends_by_id: [(record.id.clone(), record)].into_iter().collect(),
            ..RealtimeFriendSnapshot::default()
        }
    }

    fn set_friends_panel_favorite(runtime: &VrOverlayRuntime, user_id: &str) {
        runtime.update_friends_panel_favorite_groups_from_baseline(&serde_json::json!({
            "favoriteFriendGroups": [
                {
                    "key": "friend:group_0",
                    "displayName": "VIP"
                }
            ],
            "groupedFavoriteFriendIdsByGroupKey": {
                "friend:group_0": [user_id]
            }
        }));
    }

    fn visible_friends_panel_row(runtime: &VrOverlayRuntime, user_id: &str) -> FriendPanelRow {
        runtime
            .interactive_panel
            .lock()
            .unwrap()
            .model
            .rows
            .iter()
            .find(|row| row.user_id == user_id)
            .cloned()
            .unwrap_or_else(|| panic!("{user_id} visible row"))
    }

    #[test]
    fn snapshot_and_is_running_use_mirror_when_manager_lock_is_busy() {
        let runtime = VrOverlayRuntime::new_for_test();
        runtime.running_mirror.store(true, Ordering::Release);
        *runtime.active_backend_mirror.lock().unwrap() = Some("openvr");
        let _manager = runtime.manager.lock().unwrap();

        assert!(runtime.is_running());
        let snapshot = runtime.snapshot();

        assert!(snapshot.running);
        assert_eq!(snapshot.active_backend.as_deref(), Some("openvr"));
    }

    #[test]
    fn locale_is_render_only_config() {
        let base = VrOverlayRuntimeConfig::default();
        let mut translated = base;
        translated.locale = OverlayLocale::ZhCn;

        assert_eq!(base.surface_config_key(), translated.surface_config_key());
        assert!(!base.should_clear_device_snapshot_for(translated));
    }

    #[test]
    fn clock_mode_is_render_only_config() {
        let base = VrOverlayRuntimeConfig::default();
        let mut hour12 = base;
        hour12.dt_hour12 = true;

        assert_eq!(base.surface_config_key(), hour12.surface_config_key());
        assert!(!base.should_clear_device_snapshot_for(hour12));
    }

    #[test]
    fn surface_config_key_tracks_surface_affecting_fields() {
        let base = VrOverlayRuntimeConfig::default();

        let mut resized = base;
        resized.render.size = WristOverlaySizePreset::Large;
        assert_ne!(base.surface_config_key(), resized.surface_config_key());

        let mut moved = base;
        moved.hand = WristOverlayHand::Right;
        assert_ne!(base.surface_config_key(), moved.surface_config_key());

        let mut button = base;
        button.button = OverlayActivationButton::Menu;
        assert_ne!(base.surface_config_key(), button.surface_config_key());
    }

    #[test]
    fn default_panel_enabled_starts_listener_when_steamvr_is_running() {
        let runtime = VrOverlayRuntime::new_for_test();

        assert!(runtime.current_runtime_config().panel_enabled);

        record_process_status(&runtime, false, true, false);

        assert!(runtime.is_running());
        assert!(
            runtime
                .active_surfaces(runtime.current_runtime_config())
                .panel_listener
        );
    }

    #[test]
    fn runtime_config_reads_interactive_panel_all_friends_setting() {
        let (_dir, _db, context) = test_context("vr-panel-all-friends-config");
        context
            .config()
            .set_bool(
                VR_OVERLAY_PANEL_ALL_FRIENDS_INCLUDES_FAVORITES_CONFIG_KEY,
                false,
            )
            .unwrap();

        let config = load_runtime_config(context.config());

        assert!(!config.panel_all_friends_includes_favorites);
    }

    #[test]
    fn changing_all_friends_setting_rebuilds_visible_friends_panel_model() {
        let runtime = VrOverlayRuntime::new_for_test();
        runtime.set_friends_panel_snapshot_provider(|| {
            Some(RealtimeFriendSnapshot {
                current_user_id: "usr_self".to_string(),
                friends_by_id: [
                    (
                        "usr_favorite".to_string(),
                        FriendRecord {
                            id: "usr_favorite".to_string(),
                            display_name: "Favorite".to_string(),
                            state_bucket: "online".to_string(),
                            location: "wrld_home:123".to_string(),
                            world_id: "wrld_home".to_string(),
                            ..FriendRecord::default()
                        },
                    ),
                    (
                        "usr_other".to_string(),
                        FriendRecord {
                            id: "usr_other".to_string(),
                            display_name: "Other".to_string(),
                            state_bucket: "online".to_string(),
                            location: "wrld_home:123".to_string(),
                            world_id: "wrld_home".to_string(),
                            ..FriendRecord::default()
                        },
                    ),
                ]
                .into_iter()
                .collect(),
                ..RealtimeFriendSnapshot::default()
            })
        });
        set_friends_panel_favorite(&runtime, "usr_favorite");
        runtime.apply_friends_panel_input(friends_panel_summon_input(OverlayTransform::identity()));
        assert_eq!(
            runtime
                .interactive_panel
                .lock()
                .unwrap()
                .model
                .rows
                .iter()
                .map(|row| row.user_id.as_str())
                .collect::<Vec<_>>(),
            vec!["usr_favorite", "usr_other"]
        );

        runtime.commit_runtime_config(
            VrOverlayRuntimeConfig {
                panel_all_friends_includes_favorites: false,
                ..VrOverlayRuntimeConfig::default()
            },
            false,
        );
        {
            let mut manager = runtime.manager.lock().unwrap();
            runtime.push_friends_panel_frame(&mut manager);
        }

        assert_eq!(
            runtime
                .interactive_panel
                .lock()
                .unwrap()
                .model
                .rows
                .iter()
                .map(|row| row.user_id.as_str())
                .collect::<Vec<_>>(),
            vec!["usr_other"]
        );
    }

    #[test]
    fn panel_enabled_false_disables_listener_even_when_steamvr_is_running() {
        let config = VrOverlayRuntimeConfig {
            panel_enabled: false,
            ..VrOverlayRuntimeConfig::default()
        };
        let runtime = VrOverlayRuntime::new_for_test_with_config_and_frame_producer_factory(
            true,
            config,
            Box::new(|| Box::<StaticWristFrameProducer>::default()),
        );

        record_process_status(&runtime, false, true, false);

        assert!(!runtime.is_running());
        assert!(!runtime.active_surfaces(config).panel_listener);
    }

    #[test]
    fn panel_disabled_ignores_summon_input_even_if_backend_is_running() {
        let config = VrOverlayRuntimeConfig {
            panel_enabled: false,
            hmd: HmdNotificationConfig {
                enabled: true,
                start_mode: WristOverlayStartMode::SteamVr,
                ..HmdNotificationConfig::default()
            },
            ..VrOverlayRuntimeConfig::default()
        };
        let runtime = VrOverlayRuntime::new_for_test_with_config_and_frame_producer_factory(
            true,
            config,
            Box::new(|| Box::<StaticWristFrameProducer>::default()),
        );

        record_process_status(&runtime, false, true, false);
        assert!(runtime.is_running());

        let outcome = runtime
            .apply_friends_panel_input(friends_panel_summon_input(OverlayTransform::identity()));

        assert!(!outcome.surface_config_changed);
        assert!(!outcome.frame_changed);
        assert!(runtime.friends_panel_surface_config().is_none());
        assert!(!runtime.interactive_panel.lock().unwrap().visible);
    }

    #[test]
    fn disabling_panel_closes_visible_friends_panel() {
        let runtime = VrOverlayRuntime::new_for_test();
        runtime.apply_friends_panel_input(friends_panel_summon_input(OverlayTransform::identity()));
        assert!(runtime.friends_panel_surface_config().is_some());

        runtime.commit_runtime_config(
            VrOverlayRuntimeConfig {
                panel_enabled: false,
                ..VrOverlayRuntimeConfig::default()
            },
            false,
        );

        assert!(runtime.friends_panel_surface_config().is_none());
        assert!(!runtime.interactive_panel.lock().unwrap().visible);
    }

    #[test]
    fn input_drain_interval_is_fast_while_panel_listener_is_available() {
        let runtime = VrOverlayRuntime::new_for_test();

        assert_eq!(runtime.input_drain_interval(), WRIST_FRAME_REFRESH_INTERVAL);

        record_process_status(&runtime, false, true, false);

        assert!(
            runtime
                .active_surfaces(runtime.current_runtime_config())
                .panel_listener
        );
        assert!(runtime.input_drain_interval() <= Duration::from_millis(100));
    }

    #[test]
    fn friends_panel_summon_toggles_absolute_surface_and_refresh_rate() {
        let runtime = VrOverlayRuntime::new_for_test();
        let transform = OverlayTransform::from_translation([1.0, 1.2, -2.0]);

        assert_eq!(runtime.refresh_interval(), WRIST_FRAME_REFRESH_INTERVAL);

        let summon_outcome =
            runtime.apply_friends_panel_input(friends_panel_summon_input(transform));
        assert!(summon_outcome.surface_config_changed);

        assert_eq!(runtime.refresh_interval(), WRIST_FRAME_REFRESH_INTERVAL);
        let config = runtime
            .friends_panel_surface_config()
            .expect("friends surface config");
        assert!(config.interactive);
        assert_eq!(config.surface_id.as_str(), FRIENDS_PANEL_SURFACE_ID);
        assert!(matches!(
            config.placement,
            OverlayPlacement::Absolute { transform: value } if value == transform
        ));
        let configs = overlay_surface_configs(
            ActiveOverlaySurfaces {
                friends_panel: true,
                ..ActiveOverlaySurfaces::default()
            },
            runtime.current_runtime_config(),
            &runtime,
        );
        let laser_configs = configs
            .iter()
            .filter(|config| {
                matches!(
                    config.surface_id.as_str(),
                    FRIENDS_PANEL_LASER_LEFT_SURFACE_ID | FRIENDS_PANEL_LASER_RIGHT_SURFACE_ID
                )
            })
            .collect::<Vec<_>>();
        assert_eq!(laser_configs.len(), 2);
        assert!(laser_configs
            .iter()
            .all(|config| !config.interactive && config.size == FRIENDS_PANEL_LASER_SIZE));

        let dismiss_outcome =
            runtime.apply_friends_panel_input(friends_panel_summon_input(transform));
        assert!(dismiss_outcome.surface_config_changed);

        assert_eq!(runtime.refresh_interval(), WRIST_FRAME_REFRESH_INTERVAL);
        assert!(runtime.friends_panel_surface_config().is_none());
    }

    #[test]
    fn friends_panel_visible_without_traveling_keeps_stale_refresh_interval() {
        let runtime = VrOverlayRuntime::new_for_test();
        runtime.apply_friends_panel_input(friends_panel_summon_input(OverlayTransform::identity()));
        {
            let mut panel = runtime.interactive_panel.lock().unwrap();
            panel.model.rows = vec![friend_panel_test_row(
                "usr_1",
                "Friend",
                FriendPanelStatusTone::Online,
            )];
        }

        assert_eq!(runtime.refresh_interval(), WRIST_FRAME_REFRESH_INTERVAL);
    }

    #[test]
    fn friends_panel_visible_traveling_row_uses_low_frequency_animation_refresh() {
        let runtime = VrOverlayRuntime::new_for_test();
        runtime.apply_friends_panel_input(friends_panel_summon_input(OverlayTransform::identity()));
        {
            let mut panel = runtime.interactive_panel.lock().unwrap();
            panel.model.rows = vec![FriendPanelRow {
                is_traveling: true,
                traveling_text: Some("Target".to_string()),
                ..friend_panel_test_row("usr_1", "Friend", FriendPanelStatusTone::Active)
            }];
        }

        assert_eq!(
            runtime.refresh_interval(),
            FRIENDS_PANEL_ANIMATION_REFRESH_INTERVAL
        );
    }

    #[test]
    fn friends_panel_frame_advances_visible_traveling_spinner_phase() {
        let runtime = VrOverlayRuntime::new_for_test();
        runtime.apply_friends_panel_input(friends_panel_summon_input(OverlayTransform::identity()));
        {
            let mut panel = runtime.interactive_panel.lock().unwrap();
            panel.model.rows = vec![FriendPanelRow {
                is_traveling: true,
                traveling_text: Some("Target".to_string()),
                ..friend_panel_test_row("usr_1", "Friend", FriendPanelStatusTone::Active)
            }];
        }
        let before = runtime
            .interactive_panel
            .lock()
            .unwrap()
            .model
            .spinner_phase;
        {
            let mut manager = runtime.manager.lock().unwrap();
            runtime.push_friends_panel_frame(&mut manager);
        }
        let after = runtime
            .interactive_panel
            .lock()
            .unwrap()
            .model
            .spinner_phase;

        assert_ne!(after, before);
    }

    #[test]
    fn overlay_activity_snapshot_marks_friends_panel_dirty_for_presence_changes() {
        let runtime = Arc::new(VrOverlayRuntime::new_for_test());
        let snapshot_slot = Arc::new(Mutex::new(friends_panel_snapshot(FriendRecord {
            id: "usr_friend".to_string(),
            display_name: "Friend".to_string(),
            state_bucket: "online".to_string(),
            location: "wrld_home:123".to_string(),
            world_id: "wrld_home".to_string(),
            ..FriendRecord::default()
        })));
        runtime.set_friends_panel_snapshot_provider({
            let snapshot_slot = Arc::clone(&snapshot_slot);
            move || snapshot_slot.lock().ok().map(|snapshot| snapshot.clone())
        });
        set_friends_panel_favorite(&runtime, "usr_friend");
        runtime.apply_friends_panel_input(friends_panel_summon_input(OverlayTransform::identity()));
        {
            let mut manager = runtime.manager.lock().unwrap();
            runtime.push_friends_panel_frame(&mut manager);
        }
        assert!(!visible_friends_panel_row(&runtime, "usr_friend").is_traveling);

        *snapshot_slot.lock().unwrap() = friends_panel_snapshot(FriendRecord {
            id: "usr_friend".to_string(),
            display_name: "Friend".to_string(),
            state_bucket: "active".to_string(),
            location: "traveling".to_string(),
            traveling_to_location: "wrld_target:456".to_string(),
            ..FriendRecord::default()
        });
        let sink = VrOverlayActivitySink::new(Arc::clone(&runtime));
        sink.emit_overlay_activity_snapshot(OverlayActivitySnapshot::default());
        {
            let mut manager = runtime.manager.lock().unwrap();
            runtime.push_friends_panel_frame(&mut manager);
        }

        assert!(visible_friends_panel_row(&runtime, "usr_friend").is_traveling);
    }

    #[test]
    fn friends_panel_presence_rebuild_reuses_open_memo_cache() {
        let (_dir, db, context) = test_context("friends-panel-memo-cache");
        vrcx_0_persistence::memos::memo_save_user(
            db.as_ref(),
            "usr_friend".to_string(),
            "Cached memo".to_string(),
        )
        .unwrap();
        let runtime = VrOverlayRuntime::new(context);
        runtime.set_friends_panel_snapshot_provider(|| {
            Some(friends_panel_snapshot(FriendRecord {
                id: "usr_friend".to_string(),
                display_name: "Friend".to_string(),
                state_bucket: "online".to_string(),
                location: "wrld_home:123".to_string(),
                world_id: "wrld_home".to_string(),
                ..FriendRecord::default()
            }))
        });
        set_friends_panel_favorite(&runtime, "usr_friend");
        runtime.apply_friends_panel_input(friends_panel_summon_input(OverlayTransform::identity()));
        assert_eq!(
            visible_friends_panel_row(&runtime, "usr_friend")
                .memo
                .as_deref(),
            Some("Cached memo")
        );

        vrcx_0_persistence::memos::memo_save_user(
            db.as_ref(),
            "usr_friend".to_string(),
            "Updated memo".to_string(),
        )
        .unwrap();
        runtime
            .friends_panel_model_dirty
            .store(true, Ordering::Release);
        {
            let mut manager = runtime.manager.lock().unwrap();
            runtime.push_friends_panel_frame(&mut manager);
        }

        assert_eq!(
            visible_friends_panel_row(&runtime, "usr_friend")
                .memo
                .as_deref(),
            Some("Cached memo")
        );
    }

    #[test]
    fn legacy_dummy_panel_id_routes_to_friends_panel() {
        let runtime = VrOverlayRuntime::new_for_test();
        let transform = OverlayTransform::identity();
        let outcome = runtime.apply_friends_panel_input(legacy_dummy_summon_input(transform));

        assert!(outcome.surface_config_changed);
        assert_eq!(
            runtime
                .friends_panel_surface_config()
                .expect("friends surface config")
                .surface_id
                .as_str(),
            FRIENDS_PANEL_SURFACE_ID
        );
    }

    #[test]
    fn friends_panel_routes_hover_category_click_and_row_scroll_to_model() {
        let runtime = VrOverlayRuntime::new_for_test();
        let transform = OverlayTransform::identity();
        runtime.apply_friends_panel_input(friends_panel_summon_input(transform));
        {
            let mut panel = runtime.interactive_panel.lock().unwrap();
            panel.model.categories = vec![
                FriendPanelCategory {
                    key: FRIENDS_PANEL_CATEGORY_ALL.to_string(),
                    label: "All".to_string(),
                    count: 7,
                },
                FriendPanelCategory {
                    key: "group:local:Best".to_string(),
                    label: "Best".to_string(),
                    count: 2,
                },
            ];
            panel.model.rows = (0..7)
                .map(|index| {
                    friend_panel_test_row(
                        format!("usr_{index}"),
                        format!("Friend {index}"),
                        FriendPanelStatusTone::Active,
                    )
                })
                .collect();
        }
        let best_category_uv = friends_panel_region_uv(&runtime, "cat:group:local:Best");
        let list_uv = friends_panel_region_uv(&runtime, "list");
        runtime.apply_friends_panel_input(friends_panel_input(
            OverlayInputKind::Hover,
            best_category_uv,
        ));
        runtime.apply_friends_panel_input(friends_panel_input(
            OverlayInputKind::ClickDown,
            best_category_uv,
        ));
        runtime.apply_friends_panel_input(friends_panel_input(
            OverlayInputKind::ClickUp,
            best_category_uv,
        ));
        runtime.apply_friends_panel_input(friends_panel_input(
            OverlayInputKind::Scroll { delta: 10.0 },
            list_uv,
        ));

        let panel = runtime.interactive_panel.lock().unwrap();
        assert_eq!(
            panel.model.hovered_region_id.as_deref(),
            Some("cat:group:local:Best")
        );
        assert_eq!(panel.model.selected_category_key, "group:local:Best");
        assert_eq!(
            panel.model.row_scroll_offset,
            panel.model.max_row_scroll_offset()
        );
    }

    #[test]
    fn friends_panel_persists_selected_category_and_maps_legacy_group_key() {
        let (_dir, _db, context) = test_context("friends-panel-category-config");
        context
            .config()
            .set_string(VR_OVERLAY_FRIENDS_PANEL_GROUP_CONFIG_KEY, "friend:group_0")
            .unwrap();
        let runtime = VrOverlayRuntime::new(Arc::clone(&context));

        assert_eq!(
            runtime.load_friends_panel_selected_category(),
            "group:friend:group_0"
        );

        runtime.apply_friends_panel_input(friends_panel_summon_input(OverlayTransform::identity()));
        {
            let mut panel = runtime.interactive_panel.lock().unwrap();
            panel.model.categories = vec![
                FriendPanelCategory {
                    key: "all".to_string(),
                    label: "All".to_string(),
                    count: 0,
                },
                FriendPanelCategory {
                    key: "favOnline".to_string(),
                    label: "Favorites Online".to_string(),
                    count: 0,
                },
            ];
        }
        let category_uv = friends_panel_region_uv(&runtime, "cat:favOnline");
        runtime.apply_friends_panel_input(friends_panel_input(
            OverlayInputKind::ClickDown,
            category_uv,
        ));
        runtime
            .apply_friends_panel_input(friends_panel_input(OverlayInputKind::ClickUp, category_uv));

        assert_eq!(
            context
                .config()
                .get_string(VR_OVERLAY_PANEL_SELECTED_CATEGORY_CONFIG_KEY, "")
                .unwrap(),
            "favOnline"
        );
    }

    #[test]
    fn friends_panel_clears_hover_and_pressed_state_on_pointer_miss() {
        let runtime = VrOverlayRuntime::new_for_test();
        let transform = OverlayTransform::identity();
        runtime.apply_friends_panel_input(friends_panel_summon_input(transform));
        {
            let mut panel = runtime.interactive_panel.lock().unwrap();
            panel.model.rows = vec![friend_panel_test_row(
                "usr_1",
                "Friend",
                FriendPanelStatusTone::Online,
            )];
        }
        let row_uv = friends_panel_region_uv(&runtime, "row:usr_1");

        runtime.apply_friends_panel_input(friends_panel_input(OverlayInputKind::Hover, row_uv));
        runtime.apply_friends_panel_input(friends_panel_input(OverlayInputKind::ClickDown, row_uv));

        let miss_uv = UvPoint::new(-1.0, -1.0);
        runtime.apply_friends_panel_input(friends_panel_input(OverlayInputKind::Hover, miss_uv));
        runtime.apply_friends_panel_input(friends_panel_input(OverlayInputKind::ClickUp, miss_uv));

        let panel = runtime.interactive_panel.lock().unwrap();
        assert_eq!(panel.model.hovered_region_id, None);
        assert_eq!(panel.model.pressed_region_id, None);
    }

    #[test]
    fn favorite_friend_groups_snapshot_preserves_remote_and_local_labels() {
        let snapshot = serde_json::json!({
            "favoriteFriendGroups": [
                {
                    "key": "friend:group_0",
                    "name": "group_0",
                    "displayName": "VIP",
                    "count": 1
                }
            ],
            "groupedFavoriteFriendIdsByGroupKey": {
                "friend:group_0": ["usr_a"]
            },
            "localFriendFavoriteGroups": [
                {
                    "key": "Best",
                    "displayName": "Best Local",
                    "count": 1
                }
            ],
            "localFriendFavorites": {
                "Best": ["usr_b"]
            }
        });

        let groups = favorite_friend_groups_snapshot_from_baseline(&snapshot);

        assert_eq!(groups.all_user_ids(), vec!["usr_a", "usr_b"]);
        assert_eq!(groups.groups.len(), 2);
        assert_eq!(groups.groups[0].key, "friend:group_0");
        assert_eq!(groups.groups[0].label, "VIP");
        assert_eq!(groups.groups[0].user_ids, vec!["usr_a"]);
        assert_eq!(groups.groups[1].key, "local:Best");
        assert_eq!(groups.groups[1].label, "Best Local");
        assert_eq!(groups.groups[1].user_ids, vec!["usr_b"]);
    }

    #[test]
    fn friends_panel_session_clear_drops_cached_favorite_groups() {
        let runtime = VrOverlayRuntime::new_for_test();
        let snapshot = serde_json::json!({
            "favoriteFriendGroups": [
                {
                    "key": "friend:group_0",
                    "displayName": "VIP"
                }
            ],
            "groupedFavoriteFriendIdsByGroupKey": {
                "friend:group_0": ["usr_a"]
            }
        });
        runtime.update_friends_panel_favorite_groups_from_baseline(&snapshot);
        assert!(!runtime
            .current_friends_panel_favorite_groups()
            .groups
            .is_empty());

        runtime.clear_friends_panel_session_state();

        assert!(runtime
            .current_friends_panel_favorite_groups()
            .groups
            .is_empty());
    }

    #[test]
    fn friends_panel_model_filters_favorites_and_keeps_note_memo_traveling() {
        let snapshot = vrcx_0_application::RealtimeFriendSnapshot {
            current_user_id: "usr_self".to_string(),
            friends_by_id: [
                (
                    "usr_online".to_string(),
                    vrcx_0_core::friends::FriendRecord {
                        id: "usr_online".to_string(),
                        display_name: "Online Friend".to_string(),
                        state_bucket: "online".to_string(),
                        status: "join me".to_string(),
                        location: "wrld_home:123".to_string(),
                        world_id: "wrld_home".to_string(),
                        ..vrcx_0_core::friends::FriendRecord::default()
                    },
                ),
                (
                    "usr_traveling".to_string(),
                    vrcx_0_core::friends::FriendRecord {
                        id: "usr_traveling".to_string(),
                        display_name: "Traveling Friend".to_string(),
                        state_bucket: "active".to_string(),
                        location: "traveling".to_string(),
                        traveling_to_location: "wrld_target:456".to_string(),
                        ..vrcx_0_core::friends::FriendRecord::default()
                    },
                ),
                (
                    "usr_offline".to_string(),
                    vrcx_0_core::friends::FriendRecord {
                        id: "usr_offline".to_string(),
                        display_name: "Offline Friend".to_string(),
                        state_bucket: "offline".to_string(),
                        location: "offline".to_string(),
                        ..vrcx_0_core::friends::FriendRecord::default()
                    },
                ),
            ]
            .into_iter()
            .collect(),
            ..vrcx_0_application::RealtimeFriendSnapshot::default()
        };
        let groups = FavoriteFriendGroupsSnapshot {
            groups: vec![FavoriteFriendGroupSnapshot {
                key: "friend:group_0".to_string(),
                label: "VIP".to_string(),
                user_ids: vec![
                    "usr_online".to_string(),
                    "usr_traveling".to_string(),
                    "usr_offline".to_string(),
                ],
            }],
        };
        let input = FriendsPanelModelInput {
            selected_category_key: "missing".to_string(),
            friend_snapshot: Some(snapshot),
            favorite_groups: groups,
            notes_by_user_id: [("usr_online".to_string(), "VRChat note".to_string())]
                .into_iter()
                .collect(),
            memos_by_user_id: [("usr_online".to_string(), "Local memo".to_string())]
                .into_iter()
                .collect(),
            world_names_by_id: [
                ("wrld_home".to_string(), "Home World".to_string()),
                ("wrld_target".to_string(), "Target World".to_string()),
            ]
            .into_iter()
            .collect(),
            avatars_by_user_id: HashMap::new(),
            locale: OverlayLocale::En,
            all_friends_includes_favorites: true,
            spinner_phase: 0.25,
        };

        let model = build_friends_panel_model(input);

        assert_eq!(model.selected_category_key, "all");
        assert_eq!(
            model
                .categories
                .iter()
                .map(|category| {
                    (
                        category.key.as_str(),
                        category.label.as_str(),
                        category.count,
                    )
                })
                .collect::<Vec<_>>(),
            vec![
                ("all", "All", 3),
                ("favOnline", "Favorites Online", 2),
                ("favLocal", "Local Favorites", 0),
                ("group:friend:group_0", "VIP", 3),
            ]
        );
        assert_eq!(
            model
                .rows
                .iter()
                .map(|row| row.user_id.as_str())
                .collect::<Vec<_>>(),
            vec!["usr_online", "usr_traveling", "usr_offline"]
        );
        let online = model
            .rows
            .iter()
            .find(|row| row.user_id == "usr_online")
            .expect("online row");
        assert_eq!(online.location_text, "Home World Public");
        assert_eq!(online.note.as_deref(), Some("VRChat note"));
        assert_eq!(online.memo.as_deref(), Some("Local memo"));

        let traveling = model
            .rows
            .iter()
            .find(|row| row.user_id == "usr_traveling")
            .expect("traveling row");
        assert!(traveling.is_traveling);
        assert_eq!(traveling.location_text, "Traveling");
        assert_eq!(
            traveling.traveling_text.as_deref(),
            Some("Target World Public")
        );
    }

    #[test]
    fn friends_panel_model_builds_categories_and_respects_all_friends_setting() {
        let snapshot = RealtimeFriendSnapshot {
            current_user_id: "usr_self".to_string(),
            friends_by_id: [
                (
                    "usr_favorite".to_string(),
                    FriendRecord {
                        id: "usr_favorite".to_string(),
                        display_name: "Favorite".to_string(),
                        state_bucket: "online".to_string(),
                        location: "wrld_home:123".to_string(),
                        world_id: "wrld_home".to_string(),
                        ..FriendRecord::default()
                    },
                ),
                (
                    "usr_local".to_string(),
                    FriendRecord {
                        id: "usr_local".to_string(),
                        display_name: "Local".to_string(),
                        state_bucket: "active".to_string(),
                        location: "wrld_home:123".to_string(),
                        world_id: "wrld_home".to_string(),
                        ..FriendRecord::default()
                    },
                ),
                (
                    "usr_other".to_string(),
                    FriendRecord {
                        id: "usr_other".to_string(),
                        display_name: "Other".to_string(),
                        state_bucket: "online".to_string(),
                        location: "wrld_home:123".to_string(),
                        world_id: "wrld_home".to_string(),
                        ..FriendRecord::default()
                    },
                ),
            ]
            .into_iter()
            .collect(),
            ..RealtimeFriendSnapshot::default()
        };
        let groups = FavoriteFriendGroupsSnapshot {
            groups: vec![
                FavoriteFriendGroupSnapshot {
                    key: "friend:group_0".to_string(),
                    label: "VIP".to_string(),
                    user_ids: vec!["usr_favorite".to_string()],
                },
                FavoriteFriendGroupSnapshot {
                    key: "local:Best".to_string(),
                    label: "Best".to_string(),
                    user_ids: vec!["usr_local".to_string()],
                },
            ],
        };

        let excluded = build_friends_panel_model(FriendsPanelModelInput {
            selected_category_key: "all".to_string(),
            friend_snapshot: Some(snapshot.clone()),
            favorite_groups: groups.clone(),
            locale: OverlayLocale::En,
            all_friends_includes_favorites: false,
            ..FriendsPanelModelInput::default()
        });

        assert_eq!(
            excluded
                .categories
                .iter()
                .map(|category| (category.key.as_str(), category.count))
                .collect::<Vec<_>>(),
            vec![
                ("all", 1),
                ("favOnline", 2),
                ("favLocal", 1),
                ("group:friend:group_0", 1),
                ("group:local:Best", 1),
            ]
        );
        assert_eq!(
            excluded
                .rows
                .iter()
                .map(|row| row.user_id.as_str())
                .collect::<Vec<_>>(),
            vec!["usr_other"]
        );

        let included = build_friends_panel_model(FriendsPanelModelInput {
            selected_category_key: "all".to_string(),
            friend_snapshot: Some(snapshot),
            favorite_groups: groups,
            locale: OverlayLocale::En,
            all_friends_includes_favorites: true,
            ..FriendsPanelModelInput::default()
        });

        assert_eq!(included.categories[0].count, 3);
        assert_eq!(
            included
                .rows
                .iter()
                .map(|row| row.user_id.as_str())
                .collect::<Vec<_>>(),
            vec!["usr_favorite", "usr_other", "usr_local"]
        );
    }

    #[test]
    fn friends_panel_model_prefers_live_friend_note_over_cached_note_map() {
        let mut friend = FriendRecord {
            id: "usr_friend".to_string(),
            display_name: "Friend".to_string(),
            state_bucket: "online".to_string(),
            location: "wrld_home:123".to_string(),
            world_id: "wrld_home".to_string(),
            ..FriendRecord::default()
        };
        friend.extra.insert(
            "note".to_string(),
            serde_json::Value::String("Live note".to_string()),
        );
        let model = build_friends_panel_model(FriendsPanelModelInput {
            selected_category_key: "all".to_string(),
            friend_snapshot: Some(RealtimeFriendSnapshot {
                current_user_id: "usr_self".to_string(),
                friends_by_id: [("usr_friend".to_string(), friend)].into_iter().collect(),
                ..RealtimeFriendSnapshot::default()
            }),
            favorite_groups: FavoriteFriendGroupsSnapshot {
                groups: vec![FavoriteFriendGroupSnapshot {
                    key: "friend:group_0".to_string(),
                    label: "VIP".to_string(),
                    user_ids: vec!["usr_friend".to_string()],
                }],
            },
            notes_by_user_id: [("usr_friend".to_string(), "Cached note".to_string())]
                .into_iter()
                .collect(),
            memos_by_user_id: HashMap::new(),
            world_names_by_id: HashMap::new(),
            avatars_by_user_id: HashMap::new(),
            locale: OverlayLocale::En,
            all_friends_includes_favorites: true,
            spinner_phase: 0.0,
        });

        assert_eq!(model.rows[0].note.as_deref(), Some("Live note"));
    }

    #[test]
    fn render_options_do_not_rebuild_surface_except_size() {
        let base = VrOverlayRuntimeConfig::default();

        let mut dark_background = base;
        dark_background.render.dark_background = !dark_background.render.dark_background;
        assert_eq!(
            base.surface_config_key(),
            dark_background.surface_config_key()
        );

        let mut percent = base;
        percent.render.show_battery_percent = !percent.render.show_battery_percent;
        assert_eq!(base.surface_config_key(), percent.surface_config_key());
    }

    #[test]
    fn hmd_toast_queue_caps_at_three_and_drops_oldest() {
        let runtime = VrOverlayRuntime::new_for_test();
        let now = Instant::now();
        for index in 0..4 {
            runtime.enqueue_hmd_toast(
                hmd_entry(
                    &format!("source-{index}"),
                    "Status",
                    OverlayActivityActorRelation::Favorite,
                    "wrld_a:123",
                ),
                now + Duration::from_millis(index),
                Duration::from_secs(5),
            );
        }

        let toasts = runtime.hmd_toast_views(now + Duration::from_secs(1));

        assert_eq!(toasts.len(), 3);
        assert_eq!(toasts[0].entry.source_id, "source-1");
        assert_eq!(toasts[2].entry.source_id, "source-3");
    }

    #[test]
    fn hmd_toast_queue_merges_non_friend_join_leave_by_instance_only() {
        let runtime = VrOverlayRuntime::new_for_test();
        let now = Instant::now();
        runtime.enqueue_hmd_toast(
            hmd_entry(
                "join-1",
                "OnPlayerJoined",
                OverlayActivityActorRelation::None,
                "wrld_a:123",
            ),
            now,
            Duration::from_secs(5),
        );
        runtime.enqueue_hmd_toast(
            hmd_entry(
                "join-2",
                "OnPlayerJoined",
                OverlayActivityActorRelation::None,
                "wrld_a:123",
            ),
            now + Duration::from_secs(2),
            Duration::from_secs(5),
        );
        runtime.enqueue_hmd_toast(
            hmd_entry(
                "friend-join",
                "OnPlayerJoined",
                OverlayActivityActorRelation::Friend,
                "wrld_a:123",
            ),
            now + Duration::from_secs(3),
            Duration::from_secs(5),
        );

        let toasts = runtime.hmd_toast_views(now + Duration::from_secs(3));

        assert_eq!(toasts.len(), 2);
        assert_eq!(toasts[0].merge_count, 2);
        assert_eq!(toasts[0].entry.source_id, "join-2");
        assert_eq!(toasts[1].merge_count, 1);
        assert_eq!(toasts[1].entry.source_id, "friend-join");
    }

    #[test]
    fn hmd_toast_queue_does_not_merge_join_leave_without_instance_key() {
        let runtime = VrOverlayRuntime::new_for_test();
        let now = Instant::now();
        runtime.enqueue_hmd_toast(
            hmd_entry(
                "join-1",
                "OnPlayerJoined",
                OverlayActivityActorRelation::None,
                "",
            ),
            now,
            Duration::from_secs(5),
        );
        runtime.enqueue_hmd_toast(
            hmd_entry(
                "join-2",
                "OnPlayerJoined",
                OverlayActivityActorRelation::None,
                "",
            ),
            now + Duration::from_secs(2),
            Duration::from_secs(5),
        );

        let toasts = runtime.hmd_toast_views(now + Duration::from_secs(3));

        assert_eq!(toasts.len(), 2);
        assert_eq!(toasts[0].merge_count, 1);
        assert_eq!(toasts[0].entry.source_id, "join-1");
        assert_eq!(toasts[1].merge_count, 1);
        assert_eq!(toasts[1].entry.source_id, "join-2");
    }

    #[test]
    fn hmd_toast_queue_does_not_merge_join_leave_across_instances() {
        let runtime = VrOverlayRuntime::new_for_test();
        let now = Instant::now();
        runtime.enqueue_hmd_toast(
            hmd_entry(
                "join-1",
                "OnPlayerJoined",
                OverlayActivityActorRelation::None,
                "wrld_a:123",
            ),
            now,
            Duration::from_secs(5),
        );
        runtime.enqueue_hmd_toast(
            hmd_entry(
                "join-2",
                "OnPlayerJoined",
                OverlayActivityActorRelation::None,
                "wrld_b:456",
            ),
            now + Duration::from_secs(2),
            Duration::from_secs(5),
        );

        let toasts = runtime.hmd_toast_views(now + Duration::from_secs(3));

        assert_eq!(toasts.len(), 2);
        assert_eq!(toasts[0].entry.source_id, "join-1");
        assert_eq!(toasts[1].entry.source_id, "join-2");
    }

    #[test]
    fn circular_avatar_mask_makes_corners_transparent() {
        let mut rgba = vec![255; (HMD_AVATAR_SIZE * HMD_AVATAR_SIZE * 4) as usize];
        apply_circular_avatar_mask(&mut rgba, HMD_AVATAR_SIZE, HMD_AVATAR_SIZE);

        assert_eq!(rgba[3], 0);
        let center_alpha =
            (((HMD_AVATAR_SIZE / 2) * HMD_AVATAR_SIZE + HMD_AVATAR_SIZE / 2) * 4 + 3) as usize;
        assert_eq!(rgba[center_alpha], 255);
    }

    #[test]
    fn frame_producer_is_created_only_while_runtime_can_render_and_released_when_ineligible() {
        let created = Arc::new(AtomicUsize::new(0));
        let dropped = Arc::new(AtomicUsize::new(0));
        let config = VrOverlayRuntimeConfig {
            panel_enabled: false,
            ..VrOverlayRuntimeConfig::default()
        };
        let runtime = VrOverlayRuntime::new_for_test_with_config_and_frame_producer_factory(
            true,
            config,
            counting_frame_producer_factory(Arc::clone(&created), Arc::clone(&dropped)),
        );

        assert_eq!(created.load(Ordering::SeqCst), 0);

        runtime.set_enabled(true);
        assert_eq!(created.load(Ordering::SeqCst), 0);

        record_process_status(&runtime, true, true, true);
        assert_eq!(created.load(Ordering::SeqCst), 0);

        runtime.set_vr_mode(true);
        assert!(runtime.is_running());
        assert_eq!(created.load(Ordering::SeqCst), 1);

        runtime.reconcile_current();
        assert_eq!(created.load(Ordering::SeqCst), 1);

        runtime.set_enabled(false);
        assert!(!runtime.is_running());
        assert_eq!(dropped.load(Ordering::SeqCst), 1);

        runtime.set_enabled(true);
        assert!(runtime.is_running());
        assert_eq!(created.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn steamvr_start_mode_releases_frame_producer_when_steamvr_stops_not_when_game_stops() {
        let created = Arc::new(AtomicUsize::new(0));
        let dropped = Arc::new(AtomicUsize::new(0));
        let config = VrOverlayRuntimeConfig {
            start_mode: WristOverlayStartMode::SteamVr,
            panel_enabled: false,
            ..VrOverlayRuntimeConfig::default()
        };
        let runtime = VrOverlayRuntime::new_for_test_with_config_and_frame_producer_factory(
            true,
            config,
            counting_frame_producer_factory(Arc::clone(&created), Arc::clone(&dropped)),
        );
        runtime.set_enabled(true);
        record_process_status(&runtime, true, true, true);
        assert!(runtime.is_running());
        assert_eq!(created.load(Ordering::SeqCst), 1);

        record_process_status(&runtime, false, true, true);
        assert!(runtime.is_running());
        assert_eq!(dropped.load(Ordering::SeqCst), 0);

        record_process_status(&runtime, false, false, false);
        assert!(!runtime.is_running());
        assert_eq!(dropped.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn hmd_default_start_mode_waits_for_vrchat_vr_mode() {
        let created = Arc::new(AtomicUsize::new(0));
        let dropped = Arc::new(AtomicUsize::new(0));
        let config = VrOverlayRuntimeConfig {
            panel_enabled: false,
            hmd: HmdNotificationConfig {
                enabled: true,
                ..HmdNotificationConfig::default()
            },
            ..VrOverlayRuntimeConfig::default()
        };
        let runtime = VrOverlayRuntime::new_for_test_with_config_and_frame_producer_factory(
            true,
            config,
            counting_frame_producer_factory(Arc::clone(&created), Arc::clone(&dropped)),
        );
        record_process_status(&runtime, false, true, false);
        assert!(!runtime.is_running());

        record_process_status(&runtime, true, true, true);
        assert!(!runtime.is_running());

        runtime.set_vr_mode(true);
        assert!(runtime.is_running());
        assert_eq!(created.load(Ordering::SeqCst), 0);

        record_process_status(&runtime, false, true, true);
        assert!(!runtime.is_running());
        assert_eq!(created.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn hmd_steamvr_start_mode_runs_with_steamvr_without_vrchat_vr_mode() {
        let created = Arc::new(AtomicUsize::new(0));
        let dropped = Arc::new(AtomicUsize::new(0));
        let config = VrOverlayRuntimeConfig {
            hmd: HmdNotificationConfig {
                enabled: true,
                start_mode: WristOverlayStartMode::SteamVr,
                ..HmdNotificationConfig::default()
            },
            ..VrOverlayRuntimeConfig::default()
        };
        let runtime = VrOverlayRuntime::new_for_test_with_config_and_frame_producer_factory(
            true,
            config,
            counting_frame_producer_factory(Arc::clone(&created), Arc::clone(&dropped)),
        );

        record_process_status(&runtime, false, true, false);
        assert!(runtime.is_running());
        assert_eq!(created.load(Ordering::SeqCst), 0);

        record_process_status(&runtime, false, false, false);
        assert!(!runtime.is_running());
        assert_eq!(created.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn format_local_time_respects_hour12_setting() {
        assert_eq!(format_local_time(0, 5, false), "00:05");
        assert_eq!(format_local_time(23, 7, false), "23:07");
        assert_eq!(format_local_time(0, 5, true), "12:05 AM");
        assert_eq!(format_local_time(12, 30, true), "12:30 PM");
        assert_eq!(format_local_time(23, 7, true), "11:07 PM");
    }

    fn counting_frame_producer_factory(
        created: Arc<AtomicUsize>,
        dropped: Arc<AtomicUsize>,
    ) -> Box<dyn Fn() -> Box<dyn VrOverlayFrameProducer> + Send + Sync> {
        Box::new(move || {
            created.fetch_add(1, Ordering::SeqCst);
            Box::new(CountingFrameProducer {
                dropped: Arc::clone(&dropped),
            })
        })
    }

    fn record_process_status(
        runtime: &VrOverlayRuntime,
        is_game_running: bool,
        is_steamvr_running: bool,
        game_changed: bool,
    ) {
        runtime
            .on_game_process_event(GameProcessEvent {
                is_game_running,
                is_steamvr_running,
                game_changed,
            })
            .expect("record process status");
    }

    fn hmd_entry(
        source_id: &str,
        activity_type: &str,
        relation: OverlayActivityActorRelation,
        location: &str,
    ) -> OverlayActivityEntry {
        OverlayActivityEntry {
            sequence: 1,
            source_id: source_id.to_string(),
            activity_type: activity_type.to_string(),
            category: vrcx_0_application::OverlayActivityCategory::CurrentInstance,
            created_at: "2026-01-01T00:00:00Z".to_string(),
            actor_user_id: "usr_actor".to_string(),
            actor_display_name: source_id.to_string(),
            content: vrcx_0_application::OverlayActivityContent {
                title: vrcx_0_application::OverlayActivityText {
                    key: String::new(),
                    fallback: source_id.to_string(),
                    params: serde_json::json!({}),
                },
                body: vrcx_0_application::OverlayActivityText {
                    key: String::new(),
                    fallback: activity_type.to_string(),
                    params: serde_json::json!({}),
                },
                location: location.to_string(),
                ..vrcx_0_application::OverlayActivityContent::default()
            },
            actor_relation: relation,
            payload: serde_json::json!({}),
        }
    }

    struct CountingFrameProducer {
        dropped: Arc<AtomicUsize>,
    }

    impl VrOverlayFrameProducer for CountingFrameProducer {
        fn next_frame(&mut self, _input: VrOverlayFrameInput) -> Result<RgbaFrame, String> {
            Ok(RgbaFrame::new(OverlaySize::new(16, 8), vec![0; 16 * 8 * 4]))
        }
    }

    impl Drop for CountingFrameProducer {
        fn drop(&mut self) {
            self.dropped.fetch_add(1, Ordering::SeqCst);
        }
    }
}
