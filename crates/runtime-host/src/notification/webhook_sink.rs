use std::sync::Arc;

use vrcx_0_application_activity::{
    OverlayActivityDelivery, OverlayActivitySink, OverlayActivitySnapshot,
};
use vrcx_0_application_core::{
    HostSessionRuntime, RuntimeDiagnostics, TaskSupervisor, WebClient, WorldCache,
};
use vrcx_0_persistence::{config::ConfigRepository, DatabaseService};

use super::discord::{build_discord_payload, DiscordDeps};
use super::generic_webhook::generic_webhook_payload;
use super::preferences::{load_webhook_preferences, NotificationWebhookPreferences};
use super::{
    config_bool, load_notification_locale, render_delivery, resolve_delivery_world_name,
    send_json_webhook_with_retry, UserImageCache,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum NotificationWebhookFormat {
    Generic,
    Discord,
}

fn select_notification_webhook_format(
    preferences: &NotificationWebhookPreferences,
) -> Option<NotificationWebhookFormat> {
    if !preferences.enabled || preferences.url.trim().is_empty() {
        return None;
    }
    Some(if preferences.format == "discord" {
        NotificationWebhookFormat::Discord
    } else {
        NotificationWebhookFormat::Generic
    })
}

pub(crate) struct NotificationWebhookSink {
    session: HostSessionRuntime,
    config: ConfigRepository,
    db: Arc<DatabaseService>,
    web: Arc<WebClient>,
    world_cache: Arc<WorldCache>,
    user_image_cache: Arc<UserImageCache>,
    diagnostics: RuntimeDiagnostics,
    tasks: TaskSupervisor,
}

pub(crate) struct NotificationWebhookSinkDeps {
    pub(crate) session: HostSessionRuntime,
    pub(crate) config: ConfigRepository,
    pub(crate) db: Arc<DatabaseService>,
    pub(crate) web: Arc<WebClient>,
    pub(crate) world_cache: Arc<WorldCache>,
    pub(crate) user_image_cache: Arc<UserImageCache>,
    pub(crate) diagnostics: RuntimeDiagnostics,
    pub(crate) tasks: TaskSupervisor,
}

impl NotificationWebhookSink {
    pub(crate) fn new(deps: NotificationWebhookSinkDeps) -> Self {
        Self {
            session: deps.session,
            config: deps.config,
            db: deps.db,
            web: deps.web,
            world_cache: deps.world_cache,
            user_image_cache: deps.user_image_cache,
            diagnostics: deps.diagnostics,
            tasks: deps.tasks,
        }
    }
}

impl OverlayActivitySink for NotificationWebhookSink {
    fn emit_overlay_activity_snapshot(&self, _snapshot: OverlayActivitySnapshot) {}

    fn emit_overlay_activity_delivery(&self, delivery: OverlayActivityDelivery) {
        if !delivery.webhook {
            return;
        }
        let preferences = load_webhook_preferences(&self.config);
        let Some(format) = select_notification_webhook_format(&preferences) else {
            return;
        };
        let locale = load_notification_locale(&self.config);
        let endpoint = self
            .session
            .snapshot()
            .realtime_context
            .map(|context| context.endpoint)
            .unwrap_or_default();
        let allow_user_icon = config_bool(&self.config, "displayVRCPlusIconsAsAvatar", true);
        let world_cache = Arc::clone(&self.world_cache);
        let user_image_cache = Arc::clone(&self.user_image_cache);
        let web = Arc::clone(&self.web);
        let db = Arc::clone(&self.db);
        let diagnostics = self.diagnostics.clone();

        self.tasks.spawn(async move {
            let mut delivery = delivery;
            if let Some((world_name, display_location)) = resolve_delivery_world_name(
                world_cache.as_ref(),
                web.as_ref(),
                &endpoint,
                &delivery,
            )
            .await
            {
                delivery.entry.content.world_name = world_name;
                if !display_location.trim().is_empty() {
                    delivery.entry.content.display_location = display_location;
                }
            }
            let render =
                render_delivery(&delivery, locale, preferences.show_instance_id_in_location);
            let payload = match format {
                NotificationWebhookFormat::Generic => {
                    generic_webhook_payload(&delivery, &render, &preferences.fields)
                }
                NotificationWebhookFormat::Discord => {
                    build_discord_payload(
                        &DiscordDeps {
                            world_cache: world_cache.as_ref(),
                            user_image_cache: user_image_cache.as_ref(),
                            web: web.as_ref(),
                            db: db.as_ref(),
                            endpoint: &endpoint,
                            allow_user_icon,
                        },
                        &delivery,
                        &render,
                        locale,
                    )
                    .await
                }
            };
            send_json_webhook_with_retry(
                web.as_ref(),
                &diagnostics,
                preferences.url.trim(),
                payload,
                "notificationWebhook",
                &delivery.entry.activity_type,
            )
            .await;
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn webhook_format_selects_exactly_one_payload_family() {
        let mut preferences = enabled_preferences();
        assert_eq!(
            select_notification_webhook_format(&preferences),
            Some(NotificationWebhookFormat::Generic)
        );

        preferences.format = "discord".into();
        assert_eq!(
            select_notification_webhook_format(&preferences),
            Some(NotificationWebhookFormat::Discord)
        );
    }

    #[test]
    fn disabled_or_empty_webhook_configuration_does_not_send() {
        let mut preferences = enabled_preferences();
        preferences.enabled = false;
        assert_eq!(select_notification_webhook_format(&preferences), None);

        preferences.enabled = true;
        preferences.url = "  ".into();
        assert_eq!(select_notification_webhook_format(&preferences), None);
    }

    fn enabled_preferences() -> NotificationWebhookPreferences {
        NotificationWebhookPreferences {
            enabled: true,
            url: "https://example.com/webhook".into(),
            format: "generic".into(),
            fields: Vec::new(),
            show_instance_id_in_location: false,
        }
    }
}
