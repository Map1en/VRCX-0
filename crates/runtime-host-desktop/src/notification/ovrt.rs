use vrcx_0_host_desktop::overlay_notifications::OvrToolkit;
use vrcx_0_runtime_host::notification::{
    NotificationDeliveryPlan, NotificationDeliveryPreferences, RenderedNotification,
};

const NOTIFICATION_APP_TITLE: &str = "VRCX-0";

pub(super) fn send_ovrt_notification(
    ovrt: &OvrToolkit,
    plan: NotificationDeliveryPlan,
    render: &RenderedNotification,
    preferences: &NotificationDeliveryPreferences,
    local_image: Option<&str>,
) {
    let timeout_seconds = preferences.notification_timeout_ms.max(0) / 1000;
    let opacity = (preferences.notification_opacity_percent.clamp(0, 100) as f64) / 100.0;
    ovrt.send_notification(
        plan.ovrt_hud,
        plan.ovrt_wrist,
        NOTIFICATION_APP_TITLE,
        &render.text,
        timeout_seconds,
        opacity,
        local_image,
    );
}
