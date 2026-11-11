use crate::ActivityDelivery;
use vrcx_0_application_core::ConfigStore;
use vrcx_0_contracts::activity::ActivityKind;

use super::{OverlayLocale, OverlayLocalizer, RenderedNotification};

const APP_LANGUAGE_CONFIG_KEY: &str = "appLanguage";

pub fn load_notification_locale(config: &dyn ConfigStore) -> OverlayLocale {
    config
        .get_string(APP_LANGUAGE_CONFIG_KEY, "en")
        .map(|value| OverlayLocale::from_config(&value))
        .unwrap_or_default()
}

pub fn render_delivery(
    delivery: &ActivityDelivery,
    locale: OverlayLocale,
    show_instance_id: bool,
) -> RenderedNotification {
    let localizer = OverlayLocalizer::with_instance_id(locale, show_instance_id);
    let entry = &delivery.entry;
    let title = localizer.activity_text(
        &entry.content.title,
        &entry.content.location,
        &entry.content.world_name,
        &entry.content.group_name,
    );
    let body = localizer.activity_text(
        &entry.content.body,
        &entry.content.location,
        &entry.content.world_name,
        &entry.content.group_name,
    );
    let text = localizer
        .activity_sentence(
            &entry.content.title,
            &entry.content.body,
            &entry.content.location,
            &entry.content.world_name,
            &entry.content.group_name,
        )
        .unwrap_or_else(|| combine_text(entry.kind, &title, &body));
    let display_location = localizer.display_location(
        &entry.content.location,
        &entry.content.world_name,
        &entry.content.group_name,
    );
    RenderedNotification {
        title,
        body,
        text,
        display_location,
        image_url: entry.content.image_url.clone(),
    }
}

fn combine_text(kind: ActivityKind, title: &str, body: &str) -> String {
    let title = title.trim();
    let body = body.trim();
    if title.is_empty() || body.is_empty() {
        return if body.is_empty() { title } else { body }.to_string();
    }
    match kind {
        ActivityKind::Boop
        | ActivityKind::GroupAnnouncement
        | ActivityKind::GroupInformative
        | ActivityKind::GroupInvite
        | ActivityKind::GroupJoinRequest
        | ActivityKind::GroupTransfer
        | ActivityKind::GroupQueueReady
        | ActivityKind::InstanceClosed
        | ActivityKind::Event
        | ActivityKind::External => body.to_string(),
        ActivityKind::GroupChange | ActivityKind::VideoPlay => format!("{title}: {body}"),
        ActivityKind::BlockedOnPlayerJoined
        | ActivityKind::BlockedOnPlayerLeft
        | ActivityKind::MutedOnPlayerJoined
        | ActivityKind::MutedOnPlayerLeft => format!("{body}: {title}"),
        _ => format!("{title} {body}"),
    }
}
