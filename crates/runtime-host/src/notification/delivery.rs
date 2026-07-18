use vrcx_0_application_activity::OverlayActivityDelivery;

use super::generic_webhook::default_webhook_fields;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NotificationDeliveryPreferences {
    pub desktop_toast: String,
    pub desktop_notification_sound: bool,
    pub notification_tts: String,
    pub notification_tts_name_mode: String,
    pub notification_tts_voice_native: String,
    pub xs_notifications: bool,
    pub ovrt_hud_notifications: bool,
    pub ovrt_wrist_notifications: bool,
    pub image_notifications: bool,
    pub notification_timeout_ms: i32,
    pub notification_opacity_percent: i32,
    pub webhook_enabled: bool,
    pub webhook_url: String,
    pub webhook_format: String,
    pub webhook_fields: Vec<String>,
    pub show_instance_id_in_location: bool,
}

impl Default for NotificationDeliveryPreferences {
    fn default() -> Self {
        Self {
            desktop_toast: "Never".into(),
            desktop_notification_sound: false,
            notification_tts: "Never".into(),
            notification_tts_name_mode: "username".into(),
            notification_tts_voice_native: String::new(),
            xs_notifications: false,
            ovrt_hud_notifications: false,
            ovrt_wrist_notifications: false,
            image_notifications: true,
            notification_timeout_ms: 3000,
            notification_opacity_percent: 100,
            webhook_enabled: false,
            webhook_url: String::new(),
            webhook_format: "generic".into(),
            webhook_fields: default_webhook_fields(),
            show_instance_id_in_location: false,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct NotificationDeliveryGameState {
    pub is_game_running: bool,
    pub is_steamvr_running: bool,
    pub is_game_no_vr: bool,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct NotificationDeliveryPlan {
    pub desktop: bool,
    pub xs: bool,
    pub ovrt: bool,
    pub ovrt_hud: bool,
    pub ovrt_wrist: bool,
    pub webhook: bool,
    pub tts: bool,
}

impl NotificationDeliveryPlan {
    pub fn has_local_transport(self) -> bool {
        self.desktop || self.xs || self.ovrt || self.tts
    }

    pub fn needs_local_image(self) -> bool {
        self.desktop || self.xs || self.ovrt
    }
}

pub fn decide_notification_plan(
    delivery: &OverlayActivityDelivery,
    preferences: &NotificationDeliveryPreferences,
    game: &NotificationDeliveryGameState,
) -> NotificationDeliveryPlan {
    let desktop = delivery.desktop && should_play_for_condition(&preferences.desktop_toast, game);
    let vr = delivery.vr && game.is_steamvr_running;
    let xs = vr && preferences.xs_notifications;
    let ovrt_hud = vr && preferences.ovrt_hud_notifications;
    let ovrt_wrist = vr && preferences.ovrt_wrist_notifications;
    let ovrt = ovrt_hud || ovrt_wrist;
    let webhook = should_deliver_webhook(delivery, preferences);
    let tts = delivery.tts && should_play_for_condition(&preferences.notification_tts, game);

    NotificationDeliveryPlan {
        desktop,
        xs,
        ovrt,
        ovrt_hud,
        ovrt_wrist,
        webhook,
        tts,
    }
}

pub(crate) fn should_deliver_webhook(
    delivery: &OverlayActivityDelivery,
    preferences: &NotificationDeliveryPreferences,
) -> bool {
    delivery.webhook && preferences.webhook_enabled && !preferences.webhook_url.trim().is_empty()
}

fn should_play_for_condition(condition: &str, game: &NotificationDeliveryGameState) -> bool {
    match condition {
        "Always" => true,
        "Inside VR" => game.is_steamvr_running,
        "Outside VR" => !game.is_steamvr_running,
        "Game Closed" => !game.is_game_running,
        "Game Running" => game.is_game_running,
        "Desktop Mode" => game.is_game_no_vr && game.is_game_running,
        _ => false,
    }
}
