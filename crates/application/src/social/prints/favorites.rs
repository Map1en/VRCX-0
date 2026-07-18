use std::collections::HashSet;

use serde_json::Value;
use vrcx_0_persistence::config as config_store;
use vrcx_0_persistence::DatabaseService;

use super::cleanup::{
    clamp_print_limit, favorite_limit_for_print_limit, CleanupWarning, PRINT_AUTO_DELETE_LIMIT_MAX,
    PRINT_HARD_CAP,
};
use crate::Result;

pub use super::cleanup::CleanupWarningKind;

pub const AUTO_DELETE_OLD_PRINTS_CONFIG_KEY: &str = "autoDeleteOldPrints";
pub const AUTO_DELETE_PRINTS_LIMIT_CONFIG_KEY: &str = "autoDeletePrintsLimit";
pub const AUTO_DELETE_PRINTS_FAVORITE_IDS_CONFIG_KEY: &str = "autoDeletePrintsFavoriteIds";
pub const DEFAULT_AUTO_DELETE_PRINTS_LIMIT: i64 = 60;

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PrintFavoriteState {
    pub favorite_ids: Vec<String>,
    pub max_favorites: usize,
    pub warning: Option<CleanupWarning>,
}

pub fn favorite_ids_from_json(value: &Value) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut ids = Vec::new();
    let Some(array) = value.as_array() else {
        return ids;
    };

    for entry in array {
        let id = entry
            .as_str()
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let Some(id) = id else {
            continue;
        };
        if seen.insert(id.to_string()) {
            ids.push(id.to_string());
        }
        if ids.len() >= PRINT_HARD_CAP as usize {
            break;
        }
    }
    ids
}

pub fn set_favorite_id(
    current: &[String],
    print_id: &str,
    favorite: bool,
    max_favorites: usize,
) -> Vec<String> {
    let mut ids = favorite_ids_from_json(&serde_json::json!(current));
    let print_id = print_id.trim();
    if print_id.is_empty() {
        return ids;
    }

    if favorite {
        if ids.iter().all(|id| id != print_id) && ids.len() < max_favorites {
            ids.push(print_id.to_string());
        }
    } else {
        ids.retain(|id| id != print_id);
    }
    ids
}

pub fn favorite_warning(favorite_count: usize, limit: i64) -> Option<CleanupWarning> {
    let max_favorites = favorite_limit_for_print_limit(limit);
    if favorite_count > max_favorites {
        return Some(CleanupWarning {
            kind: CleanupWarningKind::TooManyFavorites,
            favorites: favorite_count,
            max: max_favorites,
            over: favorite_count - max_favorites,
        });
    }
    None
}

pub fn read_auto_delete_old_prints_enabled(db: &DatabaseService) -> Result<bool> {
    Ok(config_store::get_bool(
        db,
        AUTO_DELETE_OLD_PRINTS_CONFIG_KEY,
        false,
    )?)
}

pub fn read_auto_delete_prints_limit(db: &DatabaseService) -> Result<i64> {
    let raw = config_store::get_string(
        db,
        AUTO_DELETE_PRINTS_LIMIT_CONFIG_KEY,
        &DEFAULT_AUTO_DELETE_PRINTS_LIMIT.to_string(),
    )?;
    let parsed = raw
        .trim()
        .parse::<i64>()
        .unwrap_or(DEFAULT_AUTO_DELETE_PRINTS_LIMIT);
    Ok(clamp_print_limit(parsed) as i64)
}

pub fn effective_favorite_limit(db: &DatabaseService) -> Result<i64> {
    if read_auto_delete_old_prints_enabled(db)? {
        read_auto_delete_prints_limit(db)
    } else {
        Ok(PRINT_AUTO_DELETE_LIMIT_MAX)
    }
}

pub fn read_favorite_ids(db: &DatabaseService) -> Result<Vec<String>> {
    let value = config_store::get_json(
        db,
        AUTO_DELETE_PRINTS_FAVORITE_IDS_CONFIG_KEY,
        serde_json::json!([]),
    )?;
    Ok(favorite_ids_from_json(&value))
}

pub fn write_favorite_ids(db: &DatabaseService, ids: &[String]) -> Result<()> {
    let ids = favorite_ids_from_json(&serde_json::json!(ids));
    config_store::set_json(
        db,
        AUTO_DELETE_PRINTS_FAVORITE_IDS_CONFIG_KEY,
        &serde_json::json!(ids),
    )?;
    Ok(())
}

pub fn favorite_state(db: &DatabaseService) -> Result<PrintFavoriteState> {
    let favorite_ids = read_favorite_ids(db)?;
    let limit = effective_favorite_limit(db)?;
    let max_favorites = favorite_limit_for_print_limit(limit);
    Ok(PrintFavoriteState {
        warning: favorite_warning(favorite_ids.len(), limit),
        favorite_ids,
        max_favorites,
    })
}

pub fn set_print_favorite(
    db: &DatabaseService,
    print_id: &str,
    favorite: bool,
) -> Result<PrintFavoriteState> {
    let current = read_favorite_ids(db)?;
    let limit = effective_favorite_limit(db)?;
    let max_favorites = favorite_limit_for_print_limit(limit);
    let next = set_favorite_id(&current, print_id, favorite, max_favorites);
    write_favorite_ids(db, &next)?;
    Ok(PrintFavoriteState {
        warning: favorite_warning(next.len(), limit),
        favorite_ids: next,
        max_favorites,
    })
}

#[cfg(test)]
mod tests {
    use super::{favorite_ids_from_json, favorite_warning, set_favorite_id, CleanupWarningKind};
    use serde_json::json;

    #[test]
    fn normalizes_favorite_ids_from_json() {
        let raw = json!([" prnt_a ", "", "prnt_b", "prnt_a", 42, "prnt_c"]);

        let ids = favorite_ids_from_json(&raw);

        assert_eq!(ids, vec!["prnt_a", "prnt_b", "prnt_c"]);
    }

    #[test]
    fn caps_favorite_ids_from_json_to_the_vrchat_hard_limit() {
        let raw = json!((0..80)
            .map(|index| format!("prnt_{index:02}"))
            .collect::<Vec<_>>());

        let ids = favorite_ids_from_json(&raw);

        assert_eq!(ids.len(), 64);
        assert_eq!(ids.first().map(String::as_str), Some("prnt_00"));
        assert_eq!(ids.last().map(String::as_str), Some("prnt_63"));
    }

    #[test]
    fn toggles_favorite_ids_without_duplicates() {
        let current = vec!["prnt_a".to_string(), "prnt_b".to_string()];

        assert_eq!(
            set_favorite_id(&current, " prnt_c ", true, 3),
            vec!["prnt_a", "prnt_b", "prnt_c"]
        );
        assert_eq!(
            set_favorite_id(&current, " prnt_c ", true, 2),
            vec!["prnt_a", "prnt_b"]
        );
        assert_eq!(
            set_favorite_id(&current, "prnt_a", false, 2),
            vec!["prnt_b"]
        );
        assert_eq!(set_favorite_id(&current, "prnt_b", true, 2), current);
    }

    #[test]
    fn reports_favorite_warning_from_count_and_limit() {
        assert_eq!(
            favorite_warning(26, 30).map(|warning| warning.kind),
            Some(CleanupWarningKind::TooManyFavorites)
        );
        assert_eq!(favorite_warning(25, 30), None);
    }
}
