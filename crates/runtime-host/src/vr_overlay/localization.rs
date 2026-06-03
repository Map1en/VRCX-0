use std::{collections::BTreeMap, sync::OnceLock};

use serde::Deserialize;
use serde_json::Value;
use vrcx_0_application::OverlayActivityText;

const OVERLAY_NOTIFICATIONS_JSON: &str =
    include_str!("localization/overlay_notifications.json");
const EN_LOCALE: &str = "en";

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(super) enum OverlayLocale {
    #[default]
    En,
    ZhCn,
    ZhTw,
    Ja,
    Ko,
}

impl OverlayLocale {
    pub(super) fn from_config(value: &str) -> Self {
        match value.trim() {
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

pub(super) struct OverlayLocalizer {
    locale: OverlayLocale,
}

impl OverlayLocalizer {
    pub(super) fn new(locale: OverlayLocale) -> Self {
        Self { locale }
    }

    pub(super) fn text(&self, text: &OverlayActivityText) -> String {
        let key = text.key.trim();
        let fallback = text.fallback.trim();
        if key.is_empty() {
            return collapse_whitespace(fallback);
        }

        let catalog = catalog();
        let template = localized_template(catalog, self.locale.as_str(), key)
            .or_else(|| localized_template(catalog, &catalog.fallback_locale, key))
            .unwrap_or(fallback);

        collapse_whitespace(&interpolate(template, &text.params))
    }

    pub(super) fn generic_instance_location(&self) -> &'static str {
        match self.locale {
            OverlayLocale::En => "an instance",
            OverlayLocale::ZhCn => "某个房间",
            OverlayLocale::ZhTw => "某個房間",
            OverlayLocale::Ja => "インスタンス",
            OverlayLocale::Ko => "인스턴스",
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OverlayLocaleCatalog {
    fallback_locale: String,
    locales: BTreeMap<String, BTreeMap<String, String>>,
}

fn catalog() -> &'static OverlayLocaleCatalog {
    static CATALOG: OnceLock<OverlayLocaleCatalog> = OnceLock::new();
    CATALOG.get_or_init(|| {
        serde_json::from_str(OVERLAY_NOTIFICATIONS_JSON)
            .expect("overlay notification locale catalog must be valid JSON")
    })
}

fn localized_template<'a>(
    catalog: &'a OverlayLocaleCatalog,
    locale: &str,
    key: &str,
) -> Option<&'a str> {
    catalog
        .locales
        .get(locale)
        .and_then(|values| values.get(key))
        .map(String::as_str)
}

fn interpolate(template: &str, params: &Value) -> String {
    let Some(params) = params.as_object() else {
        return template.to_string();
    };
    let chars = template.chars().collect::<Vec<_>>();
    let mut output = String::with_capacity(template.len());
    let mut index = 0;

    while index < chars.len() {
        if chars[index] != '{' {
            output.push(chars[index]);
            index += 1;
            continue;
        }

        let mut end = index + 1;
        while end < chars.len() && chars[end] != '}' {
            end += 1;
        }

        if end >= chars.len() {
            output.push(chars[index]);
            index += 1;
            continue;
        }

        let key = chars[index + 1..end].iter().collect::<String>();
        output.push_str(&param_value(params.get(key.trim())));
        index = end + 1;
    }

    output
}

fn param_value(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(value)) => value.trim().to_string(),
        Some(Value::Bool(value)) => value.to_string(),
        Some(Value::Number(value)) => value.to_string(),
        _ => String::new(),
    }
}

fn collapse_whitespace(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use serde_json::{json, Value};

    use super::*;

    #[test]
    fn zh_cn_renders_joined_keyword() {
        let localizer = OverlayLocalizer::new(OverlayLocale::ZhCn);

        assert_eq!(
            localizer.text(&activity_text("notifications.has_joined", json!({}), "has joined")),
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

    fn activity_text(key: &str, params: Value, fallback: &str) -> OverlayActivityText {
        OverlayActivityText {
            key: key.to_string(),
            fallback: fallback.to_string(),
            params,
        }
    }
}
