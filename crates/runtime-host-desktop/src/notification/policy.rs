use std::sync::{Arc, Mutex, Weak};

use vrcx_0_application_activity::notification::{load_notification_locale, OverlayLocale};
use vrcx_0_application_activity::ActivityDelivery;
use vrcx_0_application_core::HostSessionRuntime;
use vrcx_0_application_realtime::RealtimeHostRuntime;
use vrcx_0_outbound_adapters::LocalNotificationConfig;
use vrcx_0_persistence::config::ConfigRepository;

use crate::game_isolation::GameIsolationRuntime;
use crate::privacy_lock::PrivacyLockRuntime;

use super::delivery::should_play_for_condition;
use super::{
    decide_notification_plan, load_preferences, NotificationDeliveryGameState,
    NotificationDeliveryPlan, NotificationDeliveryPreferences, NotificationDoNotDisturbRuntime,
};

const BUSY_STATUS_DO_NOT_DISTURB_CONFIG_KEY: &str = "busyStatusDoNotDisturb";

pub(crate) struct NotificationSettings {
    pub(crate) preferences: NotificationDeliveryPreferences,
    pub(crate) locale: OverlayLocale,
    busy_status_do_not_disturb: bool,
    is_game_no_vr: bool,
}

impl NotificationSettings {
    fn load(config: &ConfigRepository) -> Self {
        Self {
            preferences: load_preferences(config),
            locale: load_notification_locale(&LocalNotificationConfig::new(config.clone())),
            busy_status_do_not_disturb: config
                .get_bool(BUSY_STATUS_DO_NOT_DISTURB_CONFIG_KEY, true)
                .unwrap_or(true),
            is_game_no_vr: config
                .get_bool(vrcx_0_application_game::IS_GAME_NO_VR_CONFIG_KEY, false)
                .unwrap_or(false),
        }
    }
}

pub(crate) struct LocalNotificationPolicy {
    config: ConfigRepository,
    session: HostSessionRuntime,
    do_not_disturb: NotificationDoNotDisturbRuntime,
    privacy_lock: Arc<PrivacyLockRuntime>,
    game_isolation: GameIsolationRuntime,
    realtime: Mutex<Weak<RealtimeHostRuntime>>,
    settings: Mutex<Option<(u64, Arc<NotificationSettings>)>>,
}

impl LocalNotificationPolicy {
    pub(crate) fn new(
        config: ConfigRepository,
        session: HostSessionRuntime,
        do_not_disturb: NotificationDoNotDisturbRuntime,
        privacy_lock: Arc<PrivacyLockRuntime>,
        game_isolation: GameIsolationRuntime,
    ) -> Self {
        Self {
            config,
            session,
            do_not_disturb,
            privacy_lock,
            game_isolation,
            realtime: Mutex::new(Weak::new()),
            settings: Mutex::new(None),
        }
    }

    pub(crate) fn attach_realtime(&self, realtime: &Arc<RealtimeHostRuntime>) {
        if let Ok(mut slot) = self.realtime.lock() {
            *slot = Arc::downgrade(realtime);
        }
    }

    pub(crate) fn settings(&self) -> Arc<NotificationSettings> {
        let generation = self.config.write_generation();
        if let Ok(cached) = self.settings.lock() {
            if let Some((cached_generation, settings)) = cached.as_ref() {
                if *cached_generation == generation {
                    return Arc::clone(settings);
                }
            }
        }
        let settings = Arc::new(NotificationSettings::load(&self.config));
        if let Ok(mut cached) = self.settings.lock() {
            *cached = Some((generation, Arc::clone(&settings)));
        }
        settings
    }

    pub(crate) fn paused(&self, settings: &NotificationSettings) -> bool {
        self.do_not_disturb.is_active()
            || self.privacy_lock.is_locked()
            || (settings.busy_status_do_not_disturb && self.current_user_is_busy())
    }

    pub(crate) fn plan(
        &self,
        delivery: &ActivityDelivery,
        settings: &NotificationSettings,
    ) -> NotificationDeliveryPlan {
        if self.paused(settings) {
            return NotificationDeliveryPlan::default();
        }
        let plan =
            decide_notification_plan(delivery, &settings.preferences, &self.game_state(settings));
        if self.game_isolation.is_enabled() {
            return NotificationDeliveryPlan {
                desktop: plan.desktop,
                ..NotificationDeliveryPlan::default()
            };
        }
        plan
    }

    pub(crate) fn hmd_allowed(&self) -> bool {
        let settings = self.settings();
        !self.game_isolation.is_enabled()
            && !self.paused(&settings)
            && should_play_for_condition(
                settings.preferences.overlay_toast,
                &self.game_state(&settings),
            )
    }

    fn game_state(&self, settings: &NotificationSettings) -> NotificationDeliveryGameState {
        let snapshot = self.session.snapshot();
        NotificationDeliveryGameState {
            is_game_running: snapshot.is_game_running,
            is_steamvr_running: snapshot.is_steamvr_running,
            is_game_no_vr: settings.is_game_no_vr,
            is_hmd_afk: snapshot.is_hmd_afk,
        }
    }

    fn current_user_is_busy(&self) -> bool {
        self.realtime
            .lock()
            .ok()
            .and_then(|slot| slot.upgrade())
            .and_then(|realtime| realtime.current_user_snapshot())
            .is_some_and(|snapshot| {
                snapshot.get("status").and_then(|status| status.as_str()) == Some("busy")
            })
    }
}

#[cfg(test)]
mod tests;
