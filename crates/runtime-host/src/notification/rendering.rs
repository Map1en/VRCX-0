use vrcx_0_application_activity::OverlayActivityDelivery;
use vrcx_0_persistence::config::ConfigRepository;

use super::{OverlayLocale, OverlayLocalizer, RenderedNotification};

const APP_LANGUAGE_CONFIG_KEY: &str = "appLanguage";

pub fn load_notification_locale(config: &ConfigRepository) -> OverlayLocale {
    config
        .get_string(APP_LANGUAGE_CONFIG_KEY, "en")
        .map(|value| OverlayLocale::from_config(&value))
        .unwrap_or_default()
}

pub fn render_delivery(
    delivery: &OverlayActivityDelivery,
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
    let text = combine_text(&title, &body);
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

fn combine_text(title: &str, body: &str) -> String {
    let title = title.trim();
    let body = body.trim();
    match (title.is_empty(), body.is_empty()) {
        (false, false) => format!("{title} {body}"),
        (false, true) => title.to_string(),
        (true, false) => body.to_string(),
        (true, true) => String::new(),
    }
}
