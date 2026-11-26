use std::sync::{Arc, RwLock};
use vrcx_0_application_core::ConfigStore;

use crate::{ActivityDelivery, ActivitySink, ActivitySnapshot};
use vrcx_0_application_core::{
    HostSessionRuntime, RuntimeDiagnostics, TaskStopToken, TaskSupervisor,
};

use super::discord::{build_discord_payload, DiscordDeps};
use super::generic_webhook::generic_webhook_payload;
use super::preferences::{load_webhook_preferences, NotificationWebhookPreferences};
use super::webhook::{discord_webhook_url_with_wait, wait_for_webhook_stop};
use super::webhook_delivery::{WebhookDeliveryChannel, WebhookDeliveryMonitor};
use super::{
    load_notification_locale, render_delivery, send_json_webhook_with_retry, unresolved_group_id,
    NotificationResolver, NotificationWebhookFormat, NotificationWebhookTransport,
};

const NOTIFICATION_WEBHOOK_QUEUE_CAPACITY: usize = 64;

fn select_notification_webhook_format(
    preferences: &NotificationWebhookPreferences,
    do_not_disturb_active: bool,
) -> Option<NotificationWebhookFormat> {
    if !preferences.enabled || preferences.url.trim().is_empty() {
        return None;
    }
    if preferences.pause_with_do_not_disturb && do_not_disturb_active {
        return None;
    }
    Some(preferences.format)
}

pub trait NotificationDoNotDisturbProbe: Send + Sync {
    fn is_active(&self) -> bool;
}

#[derive(Clone, Default)]
pub struct NotificationDoNotDisturbSlot {
    probe: Arc<RwLock<Option<Arc<dyn NotificationDoNotDisturbProbe>>>>,
}

impl NotificationDoNotDisturbSlot {
    pub fn set(&self, probe: Arc<dyn NotificationDoNotDisturbProbe>) {
        if let Ok(mut slot) = self.probe.write() {
            *slot = Some(probe);
        }
    }

    fn is_active(&self) -> bool {
        self.probe
            .read()
            .ok()
            .and_then(|slot| slot.clone())
            .is_some_and(|probe| probe.is_active())
    }
}

pub struct NotificationWebhookSink {
    session: HostSessionRuntime,
    config: Arc<dyn ConfigStore>,
    do_not_disturb: NotificationDoNotDisturbSlot,
    diagnostics: RuntimeDiagnostics,
    monitor: WebhookDeliveryMonitor,
    queue: tokio::sync::mpsc::Sender<NotificationWebhookJob>,
}

struct NotificationWebhookJob {
    delivery: ActivityDelivery,
    preferences: NotificationWebhookPreferences,
    format: NotificationWebhookFormat,
    locale: super::OverlayLocale,
    vrchat_endpoint: String,
}

struct NotificationWebhookWorkerDeps {
    resolver: Arc<NotificationResolver>,
    webhook_transport: Arc<dyn NotificationWebhookTransport>,
    diagnostics: RuntimeDiagnostics,
    monitor: WebhookDeliveryMonitor,
}

pub struct NotificationWebhookSinkDeps {
    pub session: HostSessionRuntime,
    pub config: Arc<dyn ConfigStore>,
    pub do_not_disturb: NotificationDoNotDisturbSlot,
    pub resolver: Arc<NotificationResolver>,
    pub webhook_transport: Arc<dyn NotificationWebhookTransport>,
    pub diagnostics: RuntimeDiagnostics,
    pub monitor: WebhookDeliveryMonitor,
    pub tasks: TaskSupervisor,
}

impl NotificationWebhookSink {
    pub fn new(deps: NotificationWebhookSinkDeps) -> Self {
        let (queue, receiver) = tokio::sync::mpsc::channel(NOTIFICATION_WEBHOOK_QUEUE_CAPACITY);
        let worker_deps = NotificationWebhookWorkerDeps {
            resolver: deps.resolver,
            webhook_transport: deps.webhook_transport,
            diagnostics: deps.diagnostics.clone(),
            monitor: deps.monitor.clone(),
        };
        deps.tasks.spawn_cancellable(move |stop_token| {
            run_notification_webhook_worker(receiver, worker_deps, stop_token)
        });
        Self {
            session: deps.session,
            config: deps.config,
            do_not_disturb: deps.do_not_disturb,
            diagnostics: deps.diagnostics,
            monitor: deps.monitor,
            queue,
        }
    }
}

impl ActivitySink for NotificationWebhookSink {
    fn emit_overlay_activity_snapshot(&self, _snapshot: ActivitySnapshot) {}

    fn emit_overlay_activity_delivery(&self, delivery: ActivityDelivery) {
        if !delivery.webhook {
            return;
        }
        let preferences = load_webhook_preferences(self.config.as_ref());
        let Some(format) =
            select_notification_webhook_format(&preferences, self.do_not_disturb.is_active())
        else {
            return;
        };
        let locale = load_notification_locale(self.config.as_ref());
        let endpoint = self
            .session
            .snapshot()
            .realtime_context
            .map(|context| context.endpoint)
            .unwrap_or_default();
        let event_label = delivery.entry.kind.key();
        let job = NotificationWebhookJob {
            delivery,
            preferences,
            format,
            locale,
            vrchat_endpoint: endpoint,
        };
        if let Err(error) = self.queue.try_send(job) {
            let reason = match error {
                tokio::sync::mpsc::error::TrySendError::Full(_) => "queue full",
                tokio::sync::mpsc::error::TrySendError::Closed(_) => "worker stopped",
            };
            self.monitor.record_drop(
                &self.diagnostics,
                "notificationWebhook",
                WebhookDeliveryChannel::Notification,
                event_label,
                reason,
            );
        }
    }
}

async fn run_notification_webhook_worker(
    mut receiver: tokio::sync::mpsc::Receiver<NotificationWebhookJob>,
    deps: NotificationWebhookWorkerDeps,
    stop_token: TaskStopToken,
) {
    loop {
        let job = tokio::select! {
            job = receiver.recv() => job,
            _ = wait_for_webhook_stop(&stop_token) => return,
        };
        let Some(job) = job else {
            return;
        };
        tokio::select! {
            _ = deliver_notification_webhook(&deps, job) => {}
            _ = wait_for_webhook_stop(&stop_token) => return,
        }
    }
}

async fn deliver_notification_webhook(
    deps: &NotificationWebhookWorkerDeps,
    mut job: NotificationWebhookJob,
) {
    if let Some(group_id) = unresolved_group_id(&job.delivery.entry.content) {
        if let Some(group_name) = deps
            .resolver
            .group_name(&job.vrchat_endpoint, &group_id)
            .await
        {
            job.delivery.entry.content.group_name = group_name;
        }
    }
    if let Some((world_name, display_location)) = deps
        .resolver
        .world_name(&job.vrchat_endpoint, &job.delivery)
        .await
    {
        job.delivery.entry.content.world_name = world_name;
        if !display_location.trim().is_empty() {
            job.delivery.entry.content.display_location = display_location;
        }
    }
    let render = render_delivery(
        &job.delivery,
        job.locale,
        job.preferences.show_instance_id_in_location,
    );
    let payload = match job.format {
        NotificationWebhookFormat::Generic => {
            generic_webhook_payload(&job.delivery, &render, &job.preferences.fields)
        }
        NotificationWebhookFormat::Discord => {
            build_discord_payload(
                &DiscordDeps {
                    resolver: deps.resolver.as_ref(),
                    endpoint: &job.vrchat_endpoint,
                },
                &job.delivery,
                &render,
                job.locale,
            )
            .await
        }
    };
    let url = match job.format {
        NotificationWebhookFormat::Generic => job.preferences.url.trim().to_string(),
        NotificationWebhookFormat::Discord => {
            discord_webhook_url_with_wait(job.preferences.url.trim())
        }
    };
    let result = send_json_webhook_with_retry(deps.webhook_transport.as_ref(), &url, payload).await;
    deps.monitor.record_result(
        &deps.diagnostics,
        "notificationWebhook",
        WebhookDeliveryChannel::Notification,
        job.delivery.entry.kind.key(),
        &result,
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn webhook_format_is_selected_only_when_enabled_with_a_url() {
        let mut preferences = enabled_preferences();
        preferences.format = NotificationWebhookFormat::Discord;
        assert_eq!(
            select_notification_webhook_format(&preferences, false),
            Some(NotificationWebhookFormat::Discord)
        );

        preferences.enabled = false;
        assert_eq!(
            select_notification_webhook_format(&preferences, false),
            None
        );

        preferences.enabled = true;
        preferences.url = "  ".into();
        assert_eq!(
            select_notification_webhook_format(&preferences, false),
            None
        );
    }

    #[test]
    fn do_not_disturb_stops_the_webhook_only_when_opted_in() {
        let mut preferences = enabled_preferences();
        assert_eq!(
            select_notification_webhook_format(&preferences, true),
            Some(NotificationWebhookFormat::Generic)
        );

        preferences.pause_with_do_not_disturb = true;
        assert_eq!(select_notification_webhook_format(&preferences, true), None);
        assert_eq!(
            select_notification_webhook_format(&preferences, false),
            Some(NotificationWebhookFormat::Generic)
        );
    }

    #[test]
    fn an_empty_do_not_disturb_slot_is_inactive() {
        struct Active;
        impl NotificationDoNotDisturbProbe for Active {
            fn is_active(&self) -> bool {
                true
            }
        }

        let slot = NotificationDoNotDisturbSlot::default();
        assert!(!slot.is_active());
        slot.set(Arc::new(Active));
        assert!(slot.is_active());
    }

    fn enabled_preferences() -> NotificationWebhookPreferences {
        NotificationWebhookPreferences {
            enabled: true,
            url: "https://example.com/webhook".into(),
            format: NotificationWebhookFormat::Generic,
            fields: Vec::new(),
            show_instance_id_in_location: false,
            pause_with_do_not_disturb: false,
        }
    }
}
