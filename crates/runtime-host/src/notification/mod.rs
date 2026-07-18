mod activity_filters;
mod auth_webhook;
mod delivery;
mod discord;
mod enrichment;
mod generic_webhook;
mod image_file;
mod localization;
mod preferences;
mod rendered;
mod rendering;
#[cfg(test)]
mod tests;
mod user_image;
mod webhook;
mod webhook_sink;

pub use activity_filters::load_overlay_activity_filters;
pub use auth_webhook::{
    auth_webhook_generic_payload, auth_webhook_is_enabled, auth_webhook_should_recover,
    send_auth_webhook, AuthWebhookEvent, AuthWebhookEventKind,
};
pub use delivery::{
    decide_notification_plan, NotificationDeliveryGameState, NotificationDeliveryPlan,
    NotificationDeliveryPreferences,
};
pub use enrichment::{
    delivery_actor_image_user_id, resolve_delivery_actor_image, resolve_delivery_world_name,
    RealtimeUserImageResolverSlot,
};
pub use generic_webhook::{filter_generic_webhook_payload, generic_webhook_payload};
pub use image_file::{extract_file_id, extract_file_version, fallback_file_version};
pub use localization::{
    discord_embed_kind, discord_title_key, DiscordEmbedKind, OverlayLocale, OverlayLocalizer,
};
pub use preferences::{
    config_bool, config_tts_name_mode, load_preferences, notification_tts_name_mode,
    parse_webhook_fields,
};
pub use rendered::RenderedNotification;
pub use rendering::{load_notification_locale, render_delivery};
pub use user_image::{
    normalize_avatar_image_url_128, user_image_url_128, UserImageCache, UserImageSources,
};
pub use webhook::{send_json_webhook_with_retry, webhook_local_time_string};
pub(crate) use webhook_sink::{NotificationWebhookSink, NotificationWebhookSinkDeps};
