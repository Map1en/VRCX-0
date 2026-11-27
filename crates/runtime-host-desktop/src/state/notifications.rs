use std::sync::Arc;

use crate::notification::{NotificationDoNotDisturbMode, NotificationDoNotDisturbSnapshot};
use serde_json::Value;
use vrcx_0_composition::Result;

use super::DesktopRuntimeHostState;

impl DesktopRuntimeHostState {
    pub fn set_notification_desktop_notifier(
        &self,
        notifier: Arc<dyn crate::notification::DesktopNotifier>,
    ) {
        self.desktop
            .services
            .set_notification_desktop_notifier(notifier);
    }

    pub async fn mark_notifications_seen_batch(
        &self,
        input: vrcx_0_application::social::NotificationMarkSeenBatchInput,
    ) -> Result<vrcx_0_application::social::NotificationMarkSeenBatchResult> {
        let mutation = vrcx_0_application_core::AuthenticatedMutationContext::capture(
            self.runtime.desktop_assembly().auth_scope(),
            self.runtime.desktop_assembly().remote_mutations(),
            "Notification action",
        )?;
        let result = vrcx_0_application::social::mark_notifications_seen_batch(
            &vrcx_0_outbound_adapters::LocalNotificationMarkSeenActions::new(
                self.runtime.database().as_ref(),
                self.runtime.web_client().as_ref(),
                mutation,
            ),
            input,
        )
        .await?;
        self.refresh_tray_notification();
        Ok(result)
    }

    pub async fn sync_notifications(
        &self,
    ) -> Result<vrcx_0_application::social::NotificationSyncOutcome> {
        let expected_scope = self.require_active_scope("Batch action")?;
        let result = vrcx_0_application::social::sync_notifications(
            &vrcx_0_application::social::NotificationSyncDeps::new(
                &self.notification_sync,
                self.runtime.desktop_assembly().auth_scope(),
                expected_scope,
            ),
        )
        .await?;
        self.refresh_tray_notification();
        Ok(result)
    }

    pub fn send_test_notification(&self, message: &str) {
        self.desktop
            .services
            .activity_router()
            .deliver_test_notification(message);
    }

    pub fn notification_activity_filter_profiles(
        &self,
    ) -> vrcx_0_application_activity::notification::NotificationActivityFilterProfiles {
        self.runtime
            .desktop_assembly()
            .notification_activity_filter_profiles()
    }

    pub fn set_notification_activity_filters(
        &self,
        input: vrcx_0_application_activity::notification::NotificationActivityFiltersSetInput,
    ) -> Result<vrcx_0_application_activity::notification::ActivityFilterProfile> {
        let profile = self
            .runtime
            .desktop_assembly()
            .set_notification_activity_filters(input)?;
        self.desktop.vr_overlay_runtime.reconcile_current();
        Ok(profile)
    }

    pub fn set_frontend_tray_notification(&self, notify: bool) {
        self.desktop.services.set_frontend_tray_notification(notify);
    }

    pub fn refresh_tray_notification(&self) {
        self.desktop.services.refresh_tray_notification();
    }

    pub async fn send_test_webhook(
        &self,
        url: String,
        format: vrcx_0_application_activity::notification::NotificationWebhookFormat,
        payload: Value,
    ) -> Result<vrcx_0_application_activity::notification::WebhookDeliveryOutcome> {
        let url = if format
            == vrcx_0_application_activity::notification::NotificationWebhookFormat::Discord
        {
            vrcx_0_application_activity::notification::discord_webhook_url_with_wait(&url)
        } else {
            url
        };
        vrcx_0_application_activity::notification::send_json_webhook_with_retry(
            &self.webhook_transport,
            &url,
            payload,
        )
        .await
        .map_err(|error| vrcx_0_application_core::Error::Custom(error.to_string()).into())
    }

    pub fn webhook_delivery_snapshot(
        &self,
    ) -> vrcx_0_application_activity::notification::WebhookDeliverySnapshot {
        self.runtime.desktop_assembly().webhook_delivery_snapshot()
    }

    pub fn notification_do_not_disturb_snapshot(&self) -> NotificationDoNotDisturbSnapshot {
        self.desktop
            .services
            .notification_do_not_disturb()
            .snapshot()
    }

    pub fn set_notification_do_not_disturb_mode(
        &self,
        mode: NotificationDoNotDisturbMode,
    ) -> Result<NotificationDoNotDisturbSnapshot> {
        let snapshot = self
            .desktop
            .services
            .notification_do_not_disturb()
            .set_mode(mode)?;
        if snapshot.mode != NotificationDoNotDisturbMode::Off {
            self.desktop.vr_overlay_runtime.clear_hmd_notifications();
        }
        Ok(snapshot)
    }
}
