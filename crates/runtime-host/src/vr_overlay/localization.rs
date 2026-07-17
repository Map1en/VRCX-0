use std::{borrow::Cow, collections::BTreeMap};

use vrcx_0_application::OverlayActivityText;
use vrcx_0_core::location::{
    access_type_label, format_display_location_with_labels,
    format_display_location_with_labels_and_instance, parse_location, DisplayLocationLabels,
    ParsedLocation,
};
use vrcx_0_i18n::{
    collapse_whitespace, interpolate, resolve_locale, text as native_text, OverlayMessageKey,
};

const ACCESS_LABEL_KEYS: [OverlayMessageKey; 8] = [
    OverlayMessageKey::OverlayAccessPublic,
    OverlayMessageKey::OverlayAccessInvite,
    OverlayMessageKey::OverlayAccessInvitePlus,
    OverlayMessageKey::OverlayAccessFriends,
    OverlayMessageKey::OverlayAccessFriendsPlus,
    OverlayMessageKey::OverlayAccessGroup,
    OverlayMessageKey::OverlayAccessGroupPublic,
    OverlayMessageKey::OverlayAccessGroupPlus,
];

const DISCORD_TITLE_KEYS: &[(&str, OverlayMessageKey)] = &[
    ("invite", OverlayMessageKey::OverlayDiscordTitleInvite),
    (
        "requestInvite",
        OverlayMessageKey::OverlayDiscordTitleRequestInvite,
    ),
    (
        "inviteResponse",
        OverlayMessageKey::OverlayDiscordTitleInviteResponse,
    ),
    (
        "requestInviteResponse",
        OverlayMessageKey::OverlayDiscordTitleRequestInviteResponse,
    ),
    ("GPS", OverlayMessageKey::OverlayDiscordTitleGps),
    ("Status", OverlayMessageKey::OverlayDiscordTitleStatus),
    (
        "AvatarChange",
        OverlayMessageKey::OverlayDiscordTitleAvatarChange,
    ),
    ("Online", OverlayMessageKey::OverlayDiscordTitleOnline),
    ("Offline", OverlayMessageKey::OverlayDiscordTitleOffline),
];

const STATUS_LABEL_KEYS: &[(&[&str], OverlayMessageKey)] = &[
    (&["active"], OverlayMessageKey::OverlayStatusActive),
    (
        &["join me", "joinme"],
        OverlayMessageKey::OverlayStatusJoinMe,
    ),
    (&["ask me", "askme"], OverlayMessageKey::OverlayStatusAskMe),
    (&["busy"], OverlayMessageKey::OverlayStatusBusy),
];
const EN_LOCALE: &str = "en";

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) enum OverlayLocale {
    #[default]
    En,
    ZhCn,
    ZhTw,
    Ja,
    Ko,
}

impl OverlayLocale {
    pub(crate) fn from_config(value: &str) -> Self {
        match resolve_locale(value, ["en", "zh-CN", "zh-TW", "ja", "ko"], EN_LOCALE).as_str() {
            "zh-CN" => Self::ZhCn,
            "zh-TW" => Self::ZhTw,
            "ja" => Self::Ja,
            "ko" => Self::Ko,
            _ => Self::En,
        }
    }

    pub(super) fn as_str(self) -> &'static str {
        match self {
            Self::En => EN_LOCALE,
            Self::ZhCn => "zh-CN",
            Self::ZhTw => "zh-TW",
            Self::Ja => "ja",
            Self::Ko => "ko",
        }
    }
}

pub(crate) struct OverlayLocalizer {
    locale: OverlayLocale,
    show_instance_id: bool,
}

impl OverlayLocalizer {
    pub(crate) fn new(locale: OverlayLocale) -> Self {
        Self::with_instance_id(locale, false)
    }

    pub(crate) fn with_instance_id(locale: OverlayLocale, show_instance_id: bool) -> Self {
        Self {
            locale,
            show_instance_id,
        }
    }

    pub(crate) fn text(&self, text: &OverlayActivityText) -> String {
        match text {
            OverlayActivityText::Message(message) => {
                self.message_text(message.key(), message.params())
            }
            OverlayActivityText::Literal(value) => collapse_whitespace(value),
        }
    }

    pub(crate) fn activity_text(
        &self,
        text: &OverlayActivityText,
        location: &str,
        world_name: &str,
        group_name: &str,
    ) -> String {
        let Some(message) = text.as_message() else {
            return self.text(text);
        };
        let should_replace = message
            .params()
            .get("location")
            .is_some_and(|value| should_localize_location_param(value, location));
        if !should_replace {
            return self.text(text);
        }
        let mut params = message.params().clone();
        let display_location = self.display_location(location, world_name, group_name);
        if !display_location.is_empty() {
            params.insert("location".to_string(), display_location);
        }
        self.message_text(message.key(), &params)
    }

    pub(crate) fn display_location(
        &self,
        location: &str,
        world_name: &str,
        group_name: &str,
    ) -> String {
        let parsed = parse_location(location);
        let labels = self.access_labels();
        let labels = labels.as_display();
        format_display_location_with_labels_and_instance(
            &parsed,
            world_name,
            group_name,
            &labels,
            self.show_instance_id,
        )
    }

    pub(crate) fn panel_display_location(
        &self,
        location: &str,
        world_name: &str,
        group_name: &str,
    ) -> String {
        let parsed = parse_location(location);
        let labels = self.access_labels();
        let labels = labels.as_display();
        format_display_location_with_labels(&parsed, world_name, group_name, &labels)
    }

    pub(crate) fn friends_panel_strings(&self) -> vrcx_0_vr_overlay::FriendPanelStrings {
        vrcx_0_vr_overlay::FriendPanelStrings {
            title: self.label(OverlayMessageKey::OverlayFriendsPanelTitle),
            all_label: self.label(OverlayMessageKey::OverlayFriendsPanelAll),
            empty_label: self.label(OverlayMessageKey::OverlayFriendsPanelEmpty),
            note_label: self.label(OverlayMessageKey::OverlayFriendsPanelNote),
            memo_label: self.label(OverlayMessageKey::OverlayFriendsPanelMemo),
            open_label: self.label(OverlayMessageKey::OverlayFriendsPanelOpen),
            request_label: self.label(OverlayMessageKey::OverlayFriendsPanelRequest),
            invite_label: self.label(OverlayMessageKey::OverlayFriendsPanelInvite),
        }
    }

    pub(crate) fn friends_panel_traveling_label(&self) -> String {
        self.label(OverlayMessageKey::OverlayFriendsPanelTraveling)
    }

    pub(crate) fn friends_panel_favorites_online_label(&self) -> String {
        self.label(OverlayMessageKey::OverlayFriendsPanelFavoritesOnline)
    }

    pub(crate) fn friends_panel_same_instance_label(&self) -> String {
        self.label(OverlayMessageKey::OverlayFriendsPanelSameInstance)
    }

    pub(crate) fn friends_panel_local_favorites_label(&self) -> String {
        self.label(OverlayMessageKey::OverlayFriendsPanelLocalFavorites)
    }

    pub(crate) fn friends_panel_private_label(&self) -> String {
        self.label(OverlayMessageKey::OverlayFriendsPanelPrivate)
    }

    pub(crate) fn friends_panel_offline_label(&self) -> String {
        self.label(OverlayMessageKey::OverlayFriendsPanelOffline)
    }

    pub(super) fn generic_instance_location(&self) -> String {
        self.label(OverlayMessageKey::OverlayGenericInstanceLocation)
    }

    pub(crate) fn discord_title(&self, activity_type: &str, name: &str) -> String {
        let name = name.trim();
        let Some(key) = discord_title_key(activity_type) else {
            return name.to_string();
        };
        let params = BTreeMap::from([("name".to_string(), name.to_string())]);
        self.message_text(key, &params)
    }

    pub(crate) fn status_text(&self, status: &str) -> String {
        let status = status.trim();
        if status.is_empty() {
            return String::new();
        }
        match status_label_key(status) {
            Some(key) => self.label(key),
            None => status.to_string(),
        }
    }

    pub(crate) fn access_label(&self, parsed: &ParsedLocation) -> String {
        let labels = self.access_labels();
        let labels = labels.as_display();
        access_type_label(parsed, &labels).to_string()
    }

    fn access_labels(&self) -> LocalizedAccessLabels {
        let [public_key, invite_key, invite_plus_key, friends_key, friends_plus_key, group_key, group_public_key, group_plus_key] =
            ACCESS_LABEL_KEYS;
        let group = self.label(group_key);
        LocalizedAccessLabels {
            public: self.label(public_key),
            invite: self.label(invite_key),
            invite_plus: self.label(invite_plus_key),
            friends: self.label(friends_key),
            friends_plus: self.label(friends_plus_key),
            group_public: self.group_access_label(&group, group_public_key),
            group_plus: self.group_access_label(&group, group_plus_key),
            group,
        }
    }

    fn group_access_label(&self, group: &str, key: OverlayMessageKey) -> String {
        let label = self.label(key);
        if label.starts_with(group) {
            label
        } else {
            collapse_whitespace(&format!("{group} {label}"))
        }
    }

    fn label(&self, key: OverlayMessageKey) -> String {
        collapse_whitespace(&native_text(self.locale.as_str(), key))
    }

    fn message_text(&self, key: OverlayMessageKey, params: &BTreeMap<String, String>) -> String {
        let template = native_text(self.locale.as_str(), key);
        let params = self.localized_status_params(params);
        collapse_whitespace(&interpolate(&template, params.as_ref()))
    }

    fn localized_status_params<'a>(
        &self,
        params: &'a BTreeMap<String, String>,
    ) -> Cow<'a, BTreeMap<String, String>> {
        let Some(status) = params.get("status") else {
            return Cow::Borrowed(params);
        };
        let Some(label_key) = status_label_key(status) else {
            return Cow::Borrowed(params);
        };
        let label = self.label(label_key);
        let mut localized = params.clone();
        localized.insert("status".to_string(), label);
        Cow::Owned(localized)
    }
}

struct LocalizedAccessLabels {
    public: String,
    invite: String,
    invite_plus: String,
    friends: String,
    friends_plus: String,
    group: String,
    group_public: String,
    group_plus: String,
}

impl LocalizedAccessLabels {
    fn as_display(&self) -> DisplayLocationLabels<'_> {
        DisplayLocationLabels {
            public: &self.public,
            invite: &self.invite,
            invite_plus: &self.invite_plus,
            friends: &self.friends,
            friends_plus: &self.friends_plus,
            group: &self.group,
            group_public: &self.group_public,
            group_plus: &self.group_plus,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum DiscordEmbedKind {
    Invite,
    Gps,
    Status,
    AvatarChange,
    Other,
}

pub(crate) fn discord_embed_kind(activity_type: &str) -> DiscordEmbedKind {
    match activity_type {
        "invite" | "requestInvite" | "inviteResponse" | "requestInviteResponse" => {
            DiscordEmbedKind::Invite
        }
        "GPS" => DiscordEmbedKind::Gps,
        "Status" => DiscordEmbedKind::Status,
        "AvatarChange" => DiscordEmbedKind::AvatarChange,
        _ => DiscordEmbedKind::Other,
    }
}

pub(crate) fn discord_title_key(activity_type: &str) -> Option<OverlayMessageKey> {
    DISCORD_TITLE_KEYS
        .iter()
        .find_map(|(candidate, key)| (*candidate == activity_type).then_some(*key))
}

fn status_label_key(status: &str) -> Option<OverlayMessageKey> {
    let normalized = status.trim().to_ascii_lowercase();
    STATUS_LABEL_KEYS
        .iter()
        .find_map(|(aliases, key)| aliases.contains(&normalized.as_str()).then_some(*key))
}

fn should_localize_location_param(value: &str, location: &str) -> bool {
    let value = value.trim();
    if value.is_empty() || value == location.trim() {
        return false;
    }
    !value.starts_with("wrld_")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_locale_uses_shared_language_normalization() {
        assert_eq!(OverlayLocale::from_config("zh-Hant"), OverlayLocale::ZhTw);
        assert_eq!(OverlayLocale::from_config("zh_HK"), OverlayLocale::ZhTw);
        assert_eq!(OverlayLocale::from_config("zh-MO"), OverlayLocale::ZhTw);
        assert_eq!(OverlayLocale::from_config("zh-Hans"), OverlayLocale::ZhCn);
        assert_eq!(OverlayLocale::from_config("ja-JP"), OverlayLocale::Ja);
        assert_eq!(OverlayLocale::from_config("ko-KR"), OverlayLocale::Ko);
        assert_eq!(OverlayLocale::from_config("de-DE"), OverlayLocale::En);
    }

    #[test]
    fn status_label_mapping_accepts_known_aliases_and_rejects_unknown_values() {
        assert_eq!(
            status_label_key("joinme"),
            Some(OverlayMessageKey::OverlayStatusJoinMe)
        );
        assert_eq!(
            status_label_key("ASK ME"),
            Some(OverlayMessageKey::OverlayStatusAskMe)
        );
        assert_eq!(status_label_key("something custom"), None);
    }

    #[test]
    fn display_location_appends_instance_id_when_enabled() {
        let localizer = OverlayLocalizer::with_instance_id(OverlayLocale::En, true);

        assert_eq!(
            localizer.display_location("wrld_a:12345~region(use)", "Public World", ""),
            "Public World Public #12345"
        );
        assert_eq!(
            localizer.display_location(
                "wrld_a:12345~group(grp_a)~groupAccessType(plus)",
                "Group World",
                "Group Name",
            ),
            "Group World Group+(Group Name) #12345"
        );
    }

    #[test]
    fn display_location_omits_instance_id_when_disabled() {
        let localizer = OverlayLocalizer::new(OverlayLocale::En);

        assert_eq!(
            localizer.display_location("wrld_a:12345~region(use)", "Public World", ""),
            "Public World Public"
        );
    }

    #[test]
    fn panel_display_location_never_appends_instance_id() {
        let localizer = OverlayLocalizer::with_instance_id(OverlayLocale::En, true);

        assert_eq!(
            localizer.panel_display_location("wrld_a:12345~region(use)", "Public World", ""),
            "Public World Public"
        );
    }
}
