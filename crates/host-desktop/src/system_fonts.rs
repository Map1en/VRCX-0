use std::collections::BTreeMap;

use fontdb::{Database, Language};

pub fn normalize_font_family_names<I, S>(names: I) -> Vec<String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let mut seen = BTreeMap::<String, String>::new();
    for name in names {
        let trimmed = name.as_ref().trim();
        if trimmed.is_empty() || trimmed.starts_with('@') {
            continue;
        }
        seen.entry(trimmed.to_lowercase())
            .or_insert_with(|| trimmed.to_string());
    }
    seen.into_values().collect()
}

pub fn list_installed_font_families() -> Vec<String> {
    let mut db = Database::new();
    db.load_system_fonts();

    normalize_font_family_names(db.faces().filter_map(|face| {
        face.families
            .iter()
            .find(|(_, language)| *language == Language::English_UnitedStates)
            .or_else(|| face.families.first())
            .map(|(name, _)| name.clone())
    }))
}
