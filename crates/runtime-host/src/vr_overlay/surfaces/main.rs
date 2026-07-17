use vrcx_0_application::{
    OverlayActivityActorRelation, OverlayActivityCategory, OverlayActivityEntry,
    OverlayActivityText,
};
use vrcx_0_i18n::OverlayMessage;
use vrcx_0_vr_overlay::{
    AvatarBitmap, Color, FeedRelation, FeedSeverity, MainSurfaceModel, OverlaySize, ToastCard,
};

use super::super::localization::{OverlayLocale, OverlayLocalizer};

#[derive(Clone, Debug)]
pub(crate) struct HmdToastView {
    pub entry: OverlayActivityEntry,
    pub avatar: Option<AvatarBitmap>,
    pub show_avatar: bool,
    pub merge_count: u32,
}

#[derive(Clone, Debug)]
pub(crate) struct MainOverlayFrameInput {
    pub toasts: Vec<HmdToastView>,
    pub locale: OverlayLocale,
    pub show_instance_id_in_location: bool,
}

pub(crate) fn build_main_surface_model(input: MainOverlayFrameInput) -> MainSurfaceModel {
    let localizer =
        OverlayLocalizer::with_instance_id(input.locale, input.show_instance_id_in_location);
    MainSurfaceModel {
        size: OverlaySize::new(960, 528),
        dark_background: true,
        accent: Color::rgba(94, 234, 212, 255),
        toasts: input
            .toasts
            .into_iter()
            .map(|toast| toast_card_from_activity(toast, &localizer))
            .collect(),
    }
}

fn toast_card_from_activity(toast: HmdToastView, localizer: &OverlayLocalizer) -> ToastCard {
    let entry = toast.entry;
    ToastCard {
        actor_name: actor_text(&entry, localizer),
        relation: feed_relation(entry.actor_relation),
        action: action_text(&entry, toast.merge_count, localizer),
        severity: feed_severity(&entry),
        avatar: toast.avatar,
        show_avatar: toast.show_avatar,
    }
}

fn actor_text(entry: &OverlayActivityEntry, localizer: &OverlayLocalizer) -> String {
    let localized_title = localized_entry_text(entry, localizer, &entry.content.title);
    let source_title = entry.content.title.source_text();
    first_non_empty([
        localized_title.as_str(),
        source_title.as_str(),
        entry.actor_display_name.as_str(),
    ])
}

fn action_text(
    entry: &OverlayActivityEntry,
    merge_count: u32,
    localizer: &OverlayLocalizer,
) -> String {
    if merge_count > 1 {
        let others = merge_count - 1;
        let message = match entry.activity_type.as_str() {
            "OnPlayerLeft" => OverlayMessage::notifications_left_with_others(others),
            _ => OverlayMessage::notifications_joined_with_others(others),
        };
        return localizer.text(&OverlayActivityText::message(message));
    }
    let localized_body = localized_entry_text(entry, localizer, &entry.content.body);
    let source_body = entry.content.body.source_text();
    first_non_empty([
        localized_body.as_str(),
        source_body.as_str(),
        entry.content.summary.as_str(),
        entry.content.detail.as_str(),
        entry.activity_type.as_str(),
    ])
}

fn localized_entry_text(
    entry: &OverlayActivityEntry,
    localizer: &OverlayLocalizer,
    text: &OverlayActivityText,
) -> String {
    localizer.activity_text(
        text,
        &entry.content.location,
        &entry.content.world_name,
        &entry.content.group_name,
    )
}

fn feed_relation(relation: OverlayActivityActorRelation) -> FeedRelation {
    match relation {
        OverlayActivityActorRelation::Favorite => FeedRelation::Favorite,
        OverlayActivityActorRelation::Friend => FeedRelation::Friend,
        OverlayActivityActorRelation::None => FeedRelation::None,
    }
}

fn feed_severity(entry: &OverlayActivityEntry) -> FeedSeverity {
    match entry.category {
        OverlayActivityCategory::ActionRequired => FeedSeverity::Important,
        OverlayActivityCategory::SystemSafety => FeedSeverity::Warning,
        _ => FeedSeverity::Normal,
    }
}

fn first_non_empty<'a>(values: impl IntoIterator<Item = &'a str>) -> String {
    values
        .into_iter()
        .map(str::trim)
        .find(|value| !value.is_empty())
        .unwrap_or_default()
        .to_string()
}
