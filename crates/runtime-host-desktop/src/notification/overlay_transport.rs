use vrcx_0_runtime_host::notification::{
    NotificationDeliveryPlan, NotificationDeliveryPreferences, RenderedNotification,
};

#[cfg(any(windows, target_os = "linux"))]
use vrcx_0_host_desktop::overlay_notifications::OvrToolkit;

#[cfg(any(windows, target_os = "linux"))]
use super::ovrt::send_ovrt_notification;
#[cfg(any(windows, target_os = "linux"))]
use super::xs_overlay::send_xs_overlay_notification;

pub(super) struct OverlayNotificationTransport {
    #[cfg(any(windows, target_os = "linux"))]
    ovrt: OvrToolkit,
}

impl OverlayNotificationTransport {
    pub(super) fn new() -> Self {
        Self {
            #[cfg(any(windows, target_os = "linux"))]
            ovrt: OvrToolkit::new(),
        }
    }

    pub(super) fn send(
        &self,
        plan: NotificationDeliveryPlan,
        render: &RenderedNotification,
        preferences: &NotificationDeliveryPreferences,
        local_image: Option<&str>,
    ) {
        #[cfg(any(windows, target_os = "linux"))]
        {
            if plan.xs {
                send_xs_overlay_notification(render, preferences, local_image);
            }
            if plan.ovrt {
                send_ovrt_notification(&self.ovrt, plan, render, preferences, local_image);
            }
        }

        #[cfg(not(any(windows, target_os = "linux")))]
        let _ = (plan, render, preferences, local_image);
    }
}
