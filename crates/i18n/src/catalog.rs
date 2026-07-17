use std::{collections::BTreeMap, sync::OnceLock};

use serde::Deserialize;

use crate::{resolve_locale, CatalogKey};

const NATIVE_CATALOG_JSON: &str = include_str!(concat!(env!("OUT_DIR"), "/native_catalog.json"));

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Catalog {
    fallback_locale: String,
    locales: BTreeMap<String, BTreeMap<String, String>>,
}

impl Catalog {
    fn fallback_locale(&self) -> &str {
        &self.fallback_locale
    }

    fn localized_text<K: CatalogKey>(&self, locale: &str, key: K) -> Option<&str> {
        self.locales
            .get(locale)
            .and_then(|values| values.get(key.as_str()))
            .map(String::as_str)
    }

    fn resolve_locale(&self, language: &str) -> String {
        resolve_locale(language, self.locales.keys(), self.fallback_locale())
    }

    fn text<K: CatalogKey>(&self, language: &str, key: K) -> String {
        let locale = self.resolve_locale(language);
        self.localized_text(&locale, key)
            .or_else(|| self.localized_text(self.fallback_locale(), key))
            .unwrap_or_else(|| panic!("generated native catalog is missing {}", key.as_str()))
            .to_string()
    }
}

fn parse_catalog(source: &str, label: &str) -> Catalog {
    serde_json::from_str(source)
        .unwrap_or_else(|error| panic!("{label} must be valid JSON: {error}"))
}

fn native_catalog() -> &'static Catalog {
    static CATALOG: OnceLock<Catalog> = OnceLock::new();
    CATALOG.get_or_init(|| parse_catalog(NATIVE_CATALOG_JSON, "native locale catalog"))
}

pub fn text<K: CatalogKey>(language: &str, key: K) -> String {
    native_catalog().text(language, key)
}
