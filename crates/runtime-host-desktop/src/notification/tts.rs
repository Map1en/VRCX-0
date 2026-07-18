use std::borrow::Cow;

use vrcx_0_application_activity::OverlayActivityDelivery;
use vrcx_0_host_desktop::tts::TtsEngine;
use vrcx_0_persistence::DatabaseService;
use vrcx_0_runtime_host::notification::{
    notification_tts_name_mode, render_delivery, NotificationDeliveryPreferences, OverlayLocale,
    RenderedNotification,
};

pub(super) fn send_tts_notification(
    tts: &dyn TtsEngine,
    db: &DatabaseService,
    delivery: &OverlayActivityDelivery,
    render: &RenderedNotification,
    preferences: &NotificationDeliveryPreferences,
    locale: OverlayLocale,
) {
    let text = notification_tts_text(db, delivery, render, preferences, locale);
    if let Err(error) = tts.speak(&text, non_empty(&preferences.notification_tts_voice_native)) {
        tracing::warn!("[TTS] notification speak failed: {error}");
    }
}

pub(super) fn notification_tts_text(
    db: &DatabaseService,
    delivery: &OverlayActivityDelivery,
    render: &RenderedNotification,
    preferences: &NotificationDeliveryPreferences,
    locale: OverlayLocale,
) -> String {
    let render = if preferences.show_instance_id_in_location {
        Cow::Owned(render_delivery(delivery, locale, false))
    } else {
        Cow::Borrowed(render)
    };
    let name_mode = notification_tts_name_mode(&preferences.notification_tts_name_mode);
    if name_mode == "username" {
        return render.text.clone();
    }
    let title = render.title.trim();
    let actor_user_id = delivery.entry.actor_user_id.trim();
    if title.is_empty() || actor_user_id.is_empty() {
        return render.text.clone();
    }
    let Some(memo_first_line) = user_memo_first_line(db, actor_user_id) else {
        return render.text.clone();
    };
    let replacement = match name_mode {
        "note" => memo_first_line,
        "usernameAndNote" => format!("{title}, {memo_first_line}"),
        _ => return render.text.clone(),
    };
    render.text.replacen(title, &replacement, 1)
}

fn user_memo_first_line(db: &DatabaseService, actor_user_id: &str) -> Option<String> {
    match vrcx_0_persistence::memos::memo_get_user(db, actor_user_id.to_string()) {
        Ok(Some(memo)) => memo
            .memo
            .lines()
            .next()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string),
        Ok(None) => None,
        Err(error) => {
            tracing::debug!("failed to load TTS nickname memo: {error}");
            None
        }
    }
}

fn non_empty(value: &str) -> Option<&str> {
    let value = value.trim();
    (!value.is_empty()).then_some(value)
}
