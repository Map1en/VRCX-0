use std::collections::{BTreeSet, HashMap};

use serde_json::Value;
use vrcx_0_core::FavoriteEntityKind;

use super::group_refs::{quote, rewrite_config_references, table_exists};
use super::{GROUP_TABLE, ITEM_TABLE};
use crate::common::{normalize_text, now_iso, row_i64, row_string};
use crate::config::resolve_config_key;
use crate::migration::{Migration, MigrationTx, Step};
use crate::Error;

const DEFAULT_GROUP_NAME: &str = "Favorites";
const ITEM_INSERT_CHUNK: usize = 400;

const KINDS: [(FavoriteEntityKind, &str, &str, &str); 3] = [
    (
        FavoriteEntityKind::World,
        "favorite_world",
        "world_id",
        "localFavoriteWorldGroups",
    ),
    (
        FavoriteEntityKind::Avatar,
        "favorite_avatar",
        "avatar_id",
        "localFavoriteAvatarGroups",
    ),
    (
        FavoriteEntityKind::Friend,
        "favorite_friend",
        "user_id",
        "localFavoriteFriendGroups",
    ),
];

pub(crate) fn migration() -> Migration {
    Migration::new(1, "local favorite groups to id tables")
        .step(Step::custom(|tx, _| seed(tx)))
        .verify(|tx, _| verify(tx))
}

struct LegacyRow {
    owner_id: i64,
    group_name: String,
    entity_id: String,
    created_at: String,
    sort_order: Option<i64>,
}

struct LegacyKind {
    kind: FavoriteEntityKind,
    realms: Vec<(i64, Vec<String>)>,
    rows: Vec<LegacyRow>,
}

impl LegacyKind {
    fn realm_mut(&mut self, owner_id: i64) -> &mut Vec<String> {
        let index = match self.realms.iter().position(|(owner, _)| *owner == owner_id) {
            Some(index) => index,
            None => {
                self.realms.push((owner_id, Vec::new()));
                self.realms.len() - 1
            }
        };
        &mut self.realms[index].1
    }

    fn fold_account_names_into_shared(&mut self) {
        let Some((_, shared)) = self.realms.iter().find(|(owner, _)| *owner == 0) else {
            return;
        };
        let shared = shared.iter().cloned().collect::<BTreeSet<_>>();
        for (owner_id, names) in self.realms.iter_mut() {
            if *owner_id != 0 {
                names.retain(|name| !shared.contains(name));
            }
        }
        for row in self.rows.iter_mut() {
            if shared.contains(&row.group_name) {
                row.owner_id = 0;
            }
        }
    }

    fn add_group_name(&mut self, owner_id: i64, name: String) {
        let realm = self.realm_mut(owner_id);
        if !name.is_empty() && !realm.contains(&name) {
            realm.push(name);
        }
    }
}

fn seed(tx: &dyn MigrationTx) -> Result<(), Error> {
    let legacy = collect_legacy(tx)?;
    let mut group_ids: HashMap<(&'static str, String), Vec<i64>> = HashMap::new();
    for data in &legacy {
        let kind = data.kind.as_str();
        let mut realm_group_ids: HashMap<(i64, &str), i64> = HashMap::new();
        for (owner_id, names) in &data.realms {
            for (position, name) in names.iter().enumerate() {
                let created_at = data
                    .rows
                    .iter()
                    .filter(|row| row.owner_id == *owner_id && &row.group_name == name)
                    .map(|row| row.created_at.as_str())
                    .filter(|value| !value.is_empty())
                    .min()
                    .map(str::to_string)
                    .unwrap_or_else(now_iso);
                tx.execute_non_query(&format!(
                    "INSERT INTO {GROUP_TABLE} (kind, owner_id, name, sort_order, created_at) VALUES ({}, {owner_id}, {}, {position}, {})",
                    quote(kind),
                    quote(name),
                    quote(&created_at)
                ))?;
                let group_id = tx
                    .query("SELECT last_insert_rowid()")?
                    .first()
                    .map(|row| row_i64(row, 0))
                    .ok_or_else(|| Error::Database("Missing inserted favorite group id.".into()))?;
                realm_group_ids.insert((*owner_id, name.as_str()), group_id);
                group_ids
                    .entry((kind, name.clone()))
                    .or_default()
                    .push(group_id);
            }
        }

        let values = data
            .rows
            .iter()
            .filter(|row| !row.entity_id.is_empty())
            .map(|row| {
                let group_id = realm_group_ids[&(row.owner_id, row.group_name.as_str())];
                let sort_order = row
                    .sort_order
                    .map_or_else(|| "NULL".to_string(), |value| value.to_string());
                let created_at = if row.created_at.is_empty() {
                    now_iso()
                } else {
                    row.created_at.clone()
                };
                format!(
                    "({group_id}, {}, {sort_order}, {})",
                    quote(&row.entity_id),
                    quote(&created_at)
                )
            })
            .collect::<Vec<_>>();
        for chunk in values.chunks(ITEM_INSERT_CHUNK) {
            tx.execute_non_query(&format!(
                "INSERT OR IGNORE INTO {ITEM_TABLE} (group_id, entity_id, sort_order, created_at) VALUES {}",
                chunk.join(", ")
            ))?;
        }
    }

    rewrite_config_references(tx, &|kind, token| {
        group_ids
            .get(&(kind.as_str(), token.to_string()))
            .cloned()
            .unwrap_or_default()
    })
}

fn verify(tx: &dyn MigrationTx) -> Result<(), Error> {
    let legacy = collect_legacy(tx)?;
    let mut expected_groups = BTreeSet::new();
    let mut expected_items = BTreeSet::new();
    for data in &legacy {
        for (owner_id, names) in &data.realms {
            for name in names {
                expected_groups.insert((data.kind.as_str().to_string(), *owner_id, name.clone()));
            }
        }
        for row in data.rows.iter().filter(|row| !row.entity_id.is_empty()) {
            expected_items.insert((
                data.kind.as_str().to_string(),
                row.owner_id,
                row.group_name.clone(),
                row.entity_id.clone(),
            ));
        }
    }

    let groups = tx
        .query(&format!("SELECT kind, owner_id, name FROM {GROUP_TABLE}"))?
        .into_iter()
        .map(|row| (row_string(&row, 0), row_i64(&row, 1), row_string(&row, 2)))
        .collect::<BTreeSet<_>>();
    if groups != expected_groups {
        return Err(Error::Database(format!(
            "Favorite group migration produced {} groups, expected {}.",
            groups.len(),
            expected_groups.len()
        )));
    }

    let items = tx
        .query(&format!(
            "SELECT g.kind, g.owner_id, g.name, i.entity_id FROM {ITEM_TABLE} i JOIN {GROUP_TABLE} g ON g.id = i.group_id"
        ))?
        .into_iter()
        .map(|row| {
            (
                row_string(&row, 0),
                row_i64(&row, 1),
                row_string(&row, 2),
                row_string(&row, 3),
            )
        })
        .collect::<BTreeSet<_>>();
    let item_count = tx
        .query(&format!("SELECT COUNT(*) FROM {ITEM_TABLE}"))?
        .first()
        .map(|row| row_i64(row, 0))
        .unwrap_or_default();
    if items != expected_items || item_count != expected_items.len() as i64 {
        return Err(Error::Database(format!(
            "Favorite item migration produced {item_count} items, expected {}.",
            expected_items.len()
        )));
    }
    Ok(())
}

fn collect_legacy(tx: &dyn MigrationTx) -> Result<Vec<LegacyKind>, Error> {
    let owners = owner_ids_by_user(tx)?;
    let mut legacy = Vec::with_capacity(KINDS.len());
    for (kind, table, column, config_key) in KINDS {
        let mut data = LegacyKind {
            kind,
            realms: Vec::new(),
            rows: Vec::new(),
        };
        let base_key = resolve_config_key(config_key);
        for name in config_names(tx, &base_key)? {
            data.add_group_name(0, name);
        }
        if kind == FavoriteEntityKind::Friend {
            for (stored_key, user_id) in account_group_keys(tx, &base_key)? {
                let owner_id = match owners.get(&user_id) {
                    Some(owner_id) => *owner_id,
                    None => insert_owner(tx, &user_id)?,
                };
                for name in config_names(tx, &stored_key)? {
                    data.add_group_name(owner_id, name);
                }
            }
        }
        if table_exists(tx, table)? {
            let columns = table_columns(tx, table)?;
            let owner_sql = if columns.contains("owner_id") {
                "owner_id"
            } else {
                "0"
            };
            let sort_sql = if columns.contains("sort_order") {
                "sort_order"
            } else {
                "NULL"
            };
            for row in tx.query(&format!(
                "SELECT {owner_sql}, group_name, {column}, created_at, {sort_sql} FROM {table} ORDER BY id"
            ))? {
                let group_name = match normalize_text(row_string(&row, 1)) {
                    name if name.is_empty() => DEFAULT_GROUP_NAME.to_string(),
                    name => name,
                };
                let owner_id = row_i64(&row, 0);
                data.add_group_name(owner_id, group_name.clone());
                data.rows.push(LegacyRow {
                    owner_id,
                    group_name,
                    entity_id: normalize_text(row_string(&row, 2)),
                    created_at: normalize_text(row_string(&row, 3)),
                    sort_order: row.get(4).and_then(Value::as_i64),
                });
            }
        }
        data.fold_account_names_into_shared();
        legacy.push(data);
    }
    Ok(legacy)
}

fn config_names(tx: &dyn MigrationTx, stored_key: &str) -> Result<Vec<String>, Error> {
    if !table_exists(tx, "configs")? {
        return Ok(Vec::new());
    }
    let raw = tx
        .query(&format!(
            "SELECT value FROM configs WHERE key = {}",
            quote(stored_key)
        ))?
        .first()
        .map(|row| row_string(row, 0))
        .unwrap_or_default();
    let mut names = Vec::new();
    for value in serde_json::from_str::<Vec<Value>>(&raw).unwrap_or_default() {
        let name = normalize_text(value.as_str().unwrap_or_default());
        if !name.is_empty() && !names.contains(&name) {
            names.push(name);
        }
    }
    Ok(names)
}

fn account_group_keys(
    tx: &dyn MigrationTx,
    base_key: &str,
) -> Result<Vec<(String, String)>, Error> {
    if !table_exists(tx, "configs")? {
        return Ok(Vec::new());
    }
    let prefix = format!("{base_key}:");
    Ok(tx
        .query("SELECT key FROM configs ORDER BY key")?
        .into_iter()
        .map(|row| row_string(&row, 0))
        .filter_map(|key| {
            let user_id = normalize_text(key.strip_prefix(&prefix)?);
            (!user_id.is_empty()).then_some((key, user_id))
        })
        .collect())
}

fn owner_ids_by_user(tx: &dyn MigrationTx) -> Result<HashMap<String, i64>, Error> {
    if !table_exists(tx, "owners")? {
        return Ok(HashMap::new());
    }
    Ok(tx
        .query("SELECT id, user_id FROM owners")?
        .into_iter()
        .map(|row| (row_string(&row, 1).to_lowercase(), row_i64(&row, 0)))
        .collect())
}

fn insert_owner(tx: &dyn MigrationTx, user_id: &str) -> Result<i64, Error> {
    tx.execute_non_query(&format!(
        "INSERT OR IGNORE INTO owners (user_id) VALUES ({})",
        quote(user_id)
    ))?;
    tx.query(&format!(
        "SELECT id FROM owners WHERE user_id = {}",
        quote(user_id)
    ))?
    .first()
    .map(|row| row_i64(row, 0))
    .ok_or_else(|| Error::Database("Owner row was not available after insertion.".into()))
}

fn table_columns(tx: &dyn MigrationTx, table: &str) -> Result<BTreeSet<String>, Error> {
    Ok(tx
        .query(&format!(
            "SELECT name FROM pragma_table_info({})",
            quote(table)
        ))?
        .into_iter()
        .map(|row| row_string(&row, 0))
        .collect())
}

#[cfg(test)]
mod tests;
