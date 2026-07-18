use vrcx_0_host_desktop::overlay_notifications::send_xs_notification;
use vrcx_0_runtime_host::notification::{NotificationDeliveryPreferences, RenderedNotification};

const NOTIFICATION_APP_TITLE: &str = "VRCX-0";

pub(super) fn send_xs_overlay_notification(
    render: &RenderedNotification,
    preferences: &NotificationDeliveryPreferences,
    local_image: Option<&str>,
) {
    let timeout_seconds = preferences.notification_timeout_ms.max(0) / 1000;
    let opacity = (preferences.notification_opacity_percent.clamp(0, 100) as f64) / 100.0;
    if let Err(error) = send_xs_notification(
        NOTIFICATION_APP_TITLE,
        &render.text,
        timeout_seconds,
        opacity,
        local_image,
    ) {
        tracing::warn!("[XSOverlay] notification send failed: {error}");
    }
}
