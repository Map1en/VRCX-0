use std::collections::BTreeMap;

use serde::Deserialize;

use crate::resolve_locale;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    fallback_locale: String,
    locales: BTreeMap<String, BTreeMap<String, String>>,
}

impl Catalog {
    pub fn fallback_locale(&self) -> &str {
        &self.fallback_locale
    }

    pub fn locales(&self) -> &BTreeMap<String, BTreeMap<String, String>> {
        &self.locales
    }

    pub fn localized_text(&self, locale: &str, key: &str) -> Option<&str> {
        self.locales
            .get(locale)
            .and_then(|values| values.get(key))
            .map(String::as_str)
    }

    pub fn resolve_locale(&self, language: &str) -> String {
        resolve_locale(language, self.locales.keys(), self.fallback_locale())
    }

    pub fn text(&self, language: &str, key: &str, fallback: &str) -> String {
        let locale = self.resolve_locale(language);
        self.localized_text(&locale, key)
            .or_else(|| self.localized_text(self.fallback_locale(), key))
            .unwrap_or(fallback)
            .to_string()
    }
}

pub fn parse_catalog(source: &str, label: &str) -> Catalog {
    serde_json::from_str(source)
        .unwrap_or_else(|error| panic!("{label} must be valid JSON: {error}"))
}
