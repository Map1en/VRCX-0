use std::collections::BTreeSet;

use crate::common::{normalize_text, row_i64, ParamsBuilder};
use crate::config::{self, ensure_config_table, resolve_config_key};
use crate::database::schema::{ensure_assistant_tables, ensure_global_store_tables};
use crate::database::DatabaseService;
use crate::ownership::owner_id_get_or_insert;
use crate::Error;

use super::schema::*;
use super::tables::ensure_game_log_tables;

const OWNERSHIP_DECIDED_KEY: &str = "VRCX_0_legacyOwnershipDecided";
const LEGACY_FRIEND_GROUPS_KEY: &str = "localFavoriteFriendGroups";

pub(crate) fn claim_legacy_ownership(
    db: &DatabaseService,
    owner_user_id: &str,
) -> Result<(), Error> {
    let owner_user_id = normalize_text(owner_user_id);
    if owner_user_id.is_empty() || config::get_string(db, OWNERSHIP_DECIDED_KEY, "0")? == "1" {
        return Ok(());
    }

    ensure_game_log_tables(db)?;
    ensure_global_store_tables(db)?;
    ensure_assistant_tables(db)?;
    ensure_config_table(db)?;

    let should_claim = count_user_table_prefixes(db)? == 1;
    let owner_id = if should_claim {
        owner_id_get_or_insert(db, &owner_user_id)?
    } else {
        0
    };
    let legacy_groups = should_claim
        .then(|| config::get_raw(db, LEGACY_FRIEND_GROUPS_KEY))
        .transpose()?
        .flatten();
    let account_groups_key = format!("{LEGACY_FRIEND_GROUPS_KEY}:{owner_user_id}");
    let account_groups = should_claim
        .then(|| config::get_raw(db, &account_groups_key))
        .transpose()?
        .flatten();

    db.write_transaction(|tx| {
        if should_claim {
            let params = ParamsBuilder::new().set("owner_id", owner_id).build();
            for table in [
                TABLE_LOCATION,
                TABLE_JOIN_LEAVE,
                TABLE_PORTAL_SPAWN,
                TABLE_VIDEO_PLAY,
                TABLE_RESOURCE_LOAD,
                TABLE_EVENT,
                TABLE_EXTERNAL,
                "favorite_friend",
                "assistant_session",
            ] {
                tx.execute_non_query(
                    &format!(
                        "UPDATE {table} SET {COL_OWNER_ID} = @owner_id WHERE {COL_OWNER_ID} = 0"
                    ),
                    &params,
                )?;
            }

            if let Some(groups) =
                merge_group_configs(account_groups.as_deref(), legacy_groups.as_deref())
            {
                tx.execute_non_query(
                    "INSERT OR REPLACE INTO configs (key, value) VALUES (@key, @value)",
                    &ParamsBuilder::new()
                        .set("key", resolve_config_key(&account_groups_key))
                        .set("value", groups)
                        .build(),
                )?;
            }
            tx.execute_non_query(
                "DELETE FROM configs WHERE key = @key",
                &ParamsBuilder::new()
                    .set("key", resolve_config_key(LEGACY_FRIEND_GROUPS_KEY))
                    .build(),
            )?;
        }

        tx.execute_non_query(
            "INSERT OR REPLACE INTO configs (key, value) VALUES (@key, '1')",
            &ParamsBuilder::new()
                .set("key", resolve_config_key(OWNERSHIP_DECIDED_KEY))
                .build(),
        )?;
        Ok(())
    })
}

fn count_user_table_prefixes(db: &DatabaseService) -> Result<i64, Error> {
    Ok(db
        .execute(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name LIKE '%\\_feed\\_gps' ESCAPE '\\'",
            &Default::default(),
        )?
        .first()
        .map(|row| row_i64(row, 0))
        .unwrap_or(0))
}

fn merge_group_configs(account: Option<&str>, legacy: Option<&str>) -> Option<String> {
    match (account, legacy) {
        (None, None) => None,
        (Some(value), None) | (None, Some(value)) => Some(value.to_string()),
        (Some(account), Some(legacy)) => {
            let mut groups = parse_group_config(account);
            groups.extend(parse_group_config(legacy));
            serde_json::to_string(&groups).ok()
        }
    }
}

fn parse_group_config(value: &str) -> BTreeSet<String> {
    serde_json::from_str::<Vec<String>>(value)
        .unwrap_or_default()
        .into_iter()
        .map(normalize_text)
        .filter(|value| !value.is_empty())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ownership::owner_id_get;

    fn test_db(name: &str) -> DatabaseService {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "vrcx-0-legacy-owner-{name}-{}-{nonce}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        DatabaseService::new(&dir.join("VRCX-0.sqlite3")).unwrap()
    }

    fn seed_legacy_rows(db: &DatabaseService) {
        ensure_game_log_tables(db).unwrap();
        ensure_global_store_tables(db).unwrap();
        ensure_assistant_tables(db).unwrap();
        for table in [
            TABLE_LOCATION,
            TABLE_JOIN_LEAVE,
            TABLE_PORTAL_SPAWN,
            TABLE_VIDEO_PLAY,
            TABLE_RESOURCE_LOAD,
            TABLE_EVENT,
            TABLE_EXTERNAL,
        ] {
            db.execute_non_query(
                &format!("INSERT INTO {table} DEFAULT VALUES"),
                &Default::default(),
            )
            .unwrap();
        }
        db.execute_non_query(
            "INSERT INTO favorite_friend (created_at, user_id, group_name) VALUES ('t0', 'usr_friend', 'legacy')",
            &Default::default(),
        )
        .unwrap();
        db.execute_non_query(
            "INSERT INTO assistant_session (id) VALUES ('ses_legacy')",
            &Default::default(),
        )
        .unwrap();
    }

    fn create_prefix_marker(db: &DatabaseService, prefix: &str) {
        db.execute_non_query(
            &format!("CREATE TABLE {prefix}_feed_gps (id INTEGER PRIMARY KEY)"),
            &Default::default(),
        )
        .unwrap();
    }

    #[test]
    fn single_prefix_claims_all_domains_once() {
        let db = test_db("single");
        seed_legacy_rows(&db);
        create_prefix_marker(&db, "usr_a");
        config::set_json(
            &db,
            LEGACY_FRIEND_GROUPS_KEY,
            &serde_json::json!(["legacy", "same"]),
        )
        .unwrap();
        config::set_json(
            &db,
            "localFavoriteFriendGroups:usr_a",
            &serde_json::json!(["account", "same"]),
        )
        .unwrap();

        claim_legacy_ownership(&db, "usr_a").unwrap();
        claim_legacy_ownership(&db, "usr_b").unwrap();

        let owner_id = owner_id_get(&db, "usr_a").unwrap().unwrap();
        for table in [
            TABLE_LOCATION,
            TABLE_JOIN_LEAVE,
            TABLE_PORTAL_SPAWN,
            TABLE_VIDEO_PLAY,
            TABLE_RESOURCE_LOAD,
            TABLE_EVENT,
            TABLE_EXTERNAL,
            "favorite_friend",
            "assistant_session",
        ] {
            let sql = format!("SELECT owner_id FROM {table} LIMIT 1");
            assert_eq!(
                row_i64(&db.execute(&sql, &Default::default()).unwrap()[0], 0),
                owner_id
            );
        }
        assert_eq!(
            config::get_json(
                &db,
                "localFavoriteFriendGroups:usr_a",
                serde_json::Value::Null
            )
            .unwrap(),
            serde_json::json!(["account", "legacy", "same"])
        );
        assert_eq!(
            config::get_raw(&db, LEGACY_FRIEND_GROUPS_KEY).unwrap(),
            None
        );
        assert_eq!(
            config::get_string(&db, OWNERSHIP_DECIDED_KEY, "0").unwrap(),
            "1"
        );
        assert_eq!(owner_id_get(&db, "usr_b").unwrap(), None);
    }

    #[test]
    fn multiple_prefixes_keep_shared_legacy_rows_and_finish_decision() {
        let db = test_db("multiple");
        seed_legacy_rows(&db);
        create_prefix_marker(&db, "usr_a");
        create_prefix_marker(&db, "usr_b");

        claim_legacy_ownership(&db, "usr_a").unwrap();

        for table in [
            TABLE_LOCATION,
            TABLE_JOIN_LEAVE,
            TABLE_PORTAL_SPAWN,
            TABLE_VIDEO_PLAY,
            TABLE_RESOURCE_LOAD,
            TABLE_EVENT,
            TABLE_EXTERNAL,
            "favorite_friend",
            "assistant_session",
        ] {
            let sql = format!("SELECT owner_id FROM {table} LIMIT 1");
            assert_eq!(
                row_i64(&db.execute(&sql, &Default::default()).unwrap()[0], 0),
                0
            );
        }
        assert_eq!(
            config::get_string(&db, OWNERSHIP_DECIDED_KEY, "0").unwrap(),
            "1"
        );
        assert_eq!(owner_id_get(&db, "usr_a").unwrap(), None);
    }
}
