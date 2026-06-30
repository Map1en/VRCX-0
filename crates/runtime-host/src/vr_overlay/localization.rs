use std::{borrow::Cow, sync::OnceLock};

use serde_json::{json, Value};
use vrcx_0_application::OverlayActivityText;
use vrcx_0_core::location::{
    format_display_location_with_labels, parse_location, DisplayLocationLabels,
};
use vrcx_0_i18n::{collapse_whitespace, interpolate, parse_catalog, Catalog};

const OVERLAY_NOTIFICATIONS_JSON: &str = include_str!("localization/overlay_notifications.json");
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
        match catalog().resolve_locale(value).as_str() {
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
}

impl OverlayLocalizer {
    pub(crate) fn new(locale: OverlayLocale) -> Self {
        Self { locale }
    }

    pub(crate) fn text(&self, text: &OverlayActivityText) -> String {
        let key = text.key.trim();
        let fallback = text.fallback.trim();
        if key.is_empty() {
            return collapse_whitespace(fallback);
        }

        let template = catalog().text(self.locale.as_str(), key, fallback);
        let params = self.localized_status_params(&text.params);
        collapse_whitespace(&interpolate(&template, params.as_ref()))
    }

    pub(crate) fn activity_text(
        &self,
        text: &OverlayActivityText,
        location: &str,
        world_name: &str,
        group_name: &str,
    ) -> String {
        let mut localized = text.clone();
        let Some(params) = localized.params.as_object_mut() else {
            return self.text(text);
        };
        let should_replace = params
            .get("location")
            .and_then(Value::as_str)
            .is_some_and(|value| should_localize_location_param(value, location));
        if !should_replace {
            return self.text(text);
        }
        let display_location = self.display_location(location, world_name, group_name);
        if !display_location.is_empty() {
            params.insert("location".to_string(), Value::String(display_location));
        }
        self.text(&localized)
    }

    pub(crate) fn display_location(
        &self,
        location: &str,
        world_name: &str,
        group_name: &str,
    ) -> String {
        let parsed = parse_location(location);
        let public = self.label("overlay.access.public", "public");
        let invite = self.label("overlay.access.invite", "invite");
        let invite_plus = self.label("overlay.access.invite_plus", "invite+");
        let friends = self.label("overlay.access.friends", "friends");
        let friends_plus = self.label("overlay.access.friends_plus", "friends+");
        let group = self.label("overlay.access.group", "group");
        let group_public =
            self.group_access_label(&group, "overlay.access.group_public", "groupPublic");
        let group_plus = self.group_access_label(&group, "overlay.access.group_plus", "groupPlus");
        let labels = DisplayLocationLabels {
            public: &public,
            invite: &invite,
            invite_plus: &invite_plus,
            friends: &friends,
            friends_plus: &friends_plus,
            group: &group,
            group_public: &group_public,
            group_plus: &group_plus,
        };
        format_display_location_with_labels(&parsed, world_name, group_name, &labels)
    }

    pub(super) fn generic_instance_location(&self) -> String {
        self.label("overlay.generic_instance_location", "an instance")
    }

    pub(crate) fn discord_title(&self, activity_type: &str, name: &str) -> String {
        let name = name.trim();
        let Some(key) = discord_title_key(activity_type) else {
            return name.to_string();
        };
        let template = catalog().text(self.locale.as_str(), key, "{name}");
        collapse_whitespace(&interpolate(&template, &json!({ "name": name })))
    }

    pub(crate) fn status_text(&self, status: &str) -> String {
        let status = status.trim();
        if status.is_empty() {
            return String::new();
        }
        match status_label_key(status) {
            Some(key) => self.label(key, status),
            None => status.to_string(),
        }
    }

    pub(crate) fn access_label(&self, location: &str) -> String {
        let parsed = parse_location(location);
        match parsed.access_type_name.as_str() {
            "" => String::new(),
            "public" => self.label("overlay.access.public", "Public"),
            "invite" => self.label("overlay.access.invite", "Invite"),
            "invite+" => self.label("overlay.access.invite_plus", "Invite+"),
            "friends" => self.label("overlay.access.friends", "Friends"),
            "friends+" => self.label("overlay.access.friends_plus", "Friends+"),
            "group" => self.label("overlay.access.group", "Group"),
            "groupPublic" => {
                let group = self.label("overlay.access.group", "Group");
                self.group_access_label(&group, "overlay.access.group_public", "groupPublic")
            }
            "groupPlus" => {
                let group = self.label("overlay.access.group", "Group");
                self.group_access_label(&group, "overlay.access.group_plus", "groupPlus")
            }
            other => other.to_string(),
        }
    }

    fn group_access_label(&self, group: &str, key: &str, fallback: &str) -> String {
        let label = self.label(key, fallback);
        if label.starts_with(group) {
            label
        } else {
            collapse_whitespace(&format!("{group} {label}"))
        }
    }

    fn label(&self, key: &str, fallback: &str) -> String {
        collapse_whitespace(&catalog().text(self.locale.as_str(), key, fallback))
    }

    fn localized_status_params<'a>(&self, params: &'a Value) -> Cow<'a, Value> {
        let Some(object) = params.as_object() else {
            return Cow::Borrowed(params);
        };
        let Some(status) = object.get("status").and_then(Value::as_str) else {
            return Cow::Borrowed(params);
        };
        let Some(label_key) = status_label_key(status) else {
            return Cow::Borrowed(params);
        };
        let label = self.label(label_key, status.trim());
        let mut localized = object.clone();
        localized.insert("status".to_string(), Value::String(label));
        Cow::Owned(Value::Object(localized))
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

pub(crate) fn discord_title_key(activity_type: &str) -> Option<&'static str> {
    match activity_type {
        "invite" => Some("overlay.discord.title.invite"),
        "requestInvite" => Some("overlay.discord.title.request_invite"),
        "inviteResponse" => Some("overlay.discord.title.invite_response"),
        "requestInviteResponse" => Some("overlay.discord.title.request_invite_response"),
        "GPS" => Some("overlay.discord.title.gps"),
        "Status" => Some("overlay.discord.title.status"),
        "AvatarChange" => Some("overlay.discord.title.avatar_change"),
        "Online" => Some("overlay.discord.title.online"),
        "Offline" => Some("overlay.discord.title.offline"),
        _ => None,
    }
}

fn status_label_key(status: &str) -> Option<&'static str> {
    match status.trim().to_ascii_lowercase().as_str() {
        "active" => Some("overlay.status.active"),
        "join me" | "joinme" => Some("overlay.status.join_me"),
        "ask me" | "askme" => Some("overlay.status.ask_me"),
        "busy" => Some("overlay.status.busy"),
        _ => None,
    }
}

fn catalog() -> &'static Catalog {
    static CATALOG: OnceLock<Catalog> = OnceLock::new();
    CATALOG.get_or_init(|| {
        parse_catalog(
            OVERLAY_NOTIFICATIONS_JSON,
            "overlay notification locale catalog",
        )
    })
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
    use serde_json::{json, Value};

    use super::*;

    #[test]
    fn zh_cn_renders_joined_keyword() {
        let localizer = OverlayLocalizer::new(OverlayLocale::ZhCn);

        assert_eq!(
            localizer.text(&activity_text(
                "notifications.has_joined",
                json!({}),
                "has joined"
            )),
            "加入了房间"
        );
    }

    #[test]
    fn ja_and_ko_replace_parameters() {
        let ja = OverlayLocalizer::new(OverlayLocale::Ja);
        let ko = OverlayLocalizer::new(OverlayLocale::Ko);

        assert_eq!(
            ja.text(&activity_text(
                "notifications.gps",
                json!({ "location": "Test World" }),
                "is in Test World"
            )),
            "は Test World にいます"
        );
        assert_eq!(
            ko.text(&activity_text(
                "notifications.invite",
                json!({ "location": "Test World", "message": "Join?" }),
                "invite Test World Join?"
            )),
            "님이 귀하를 Test World Join?에 초대했습니다."
        );
    }

    #[test]
    fn unsupported_locale_falls_back_to_english() {
        let localizer = OverlayLocalizer::new(OverlayLocale::from_config("fr"));

        assert_eq!(
            localizer.text(&activity_text("notifications.has_left", json!({}), "left")),
            "has left"
        );
    }

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
    fn status_update_localizes_status_keyword() {
        let en = OverlayLocalizer::new(OverlayLocale::En);

        assert_eq!(
            en.text(&activity_text(
                "notifications.status_update",
                json!({ "status": "ask me", "description": "" }),
                "status is now ask me"
            )),
            "status is now Ask Me"
        );
    }

    #[test]
    fn status_update_translates_status_for_locale() {
        let ja = OverlayLocalizer::new(OverlayLocale::Ja);

        let result = ja.text(&activity_text(
            "notifications.status_update",
            json!({ "status": "join me", "description": "" }),
            "status is now join me",
        ));

        assert!(result.contains("だれでもおいで"), "got: {result}");
        assert!(!result.contains("join me"));
    }

    #[test]
    fn unknown_status_value_is_left_untouched() {
        let en = OverlayLocalizer::new(OverlayLocale::En);

        assert_eq!(
            en.text(&activity_text(
                "notifications.status_update",
                json!({ "status": "something custom", "description": "" }),
                "status is now something custom"
            )),
            "status is now something custom"
        );
    }

    #[test]
    fn missing_key_uses_fallback() {
        let localizer = OverlayLocalizer::new(OverlayLocale::ZhCn);

        assert_eq!(
            localizer.text(&activity_text(
                "notifications.not_real",
                json!({}),
                "fallback value"
            )),
            "fallback value"
        );
    }

    #[test]
    fn missing_parameter_is_empty_and_whitespace_is_collapsed() {
        let localizer = OverlayLocalizer::new(OverlayLocale::En);

        assert_eq!(
            localizer.text(&activity_text(
                "notifications.invite",
                json!({ "message": "hello" }),
                "invite"
            )),
            "has invited you to hello"
        );
    }

    #[test]
    fn display_location_uses_overlay_locale_access_labels() {
        let zh_cn = OverlayLocalizer::new(OverlayLocale::ZhCn);

        assert_eq!(
            zh_cn.display_location(
                "wrld_a:1~group(grp_a)~groupAccessType(plus)",
                "Group World",
                "Group Name",
            ),
            "Group World 群组+(Group Name)"
        );

        assert_eq!(
            zh_cn.display_location("wrld_a:1~friends(usr_a)", "Friend World", ""),
            "Friend World 仅限好友"
        );
    }

    fn activity_text(key: &str, params: Value, fallback: &str) -> OverlayActivityText {
        OverlayActivityText {
            key: key.to_string(),
            fallback: fallback.to_string(),
            params,
        }
    }
}
