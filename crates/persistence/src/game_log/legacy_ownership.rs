use crate::common::{normalize_text, row_i64, ParamsBuilder};
use crate::config::{self, ensure_config_table, resolve_config_key};
use crate::database::schema::{ensure_assistant_tables, ensure_global_store_tables};
use crate::database::{DatabaseService, DatabaseWriteTransaction};
use crate::favorites::GROUP_TABLE;
use crate::ownership::{owner_id_get_or_insert, OwnerId, OwnerRowId};
use crate::Error;

use super::schema::*;
use super::tables::ensure_game_log_tables;

const OWNERSHIP_DECIDED_KEY: &str = "VRCX_0_legacyOwnershipDecided";

pub(crate) fn claim_legacy_ownership(
    db: &DatabaseService,
    owner_user_id: &OwnerId,
) -> Result<(), Error> {
    let owner_user_id = OwnerId::new(normalize_text(owner_user_id.as_str()));
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
        OwnerRowId::UNASSIGNED
    };
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
                "assistant_session",
            ] {
                tx.execute_non_query(
                    &format!(
                        "UPDATE {table} SET {COL_OWNER_ID} = @owner_id WHERE {COL_OWNER_ID} = 0"
                    ),
                    &params,
                )?;
            }
            claim_shared_friend_groups(tx, owner_id)?;
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

fn claim_shared_friend_groups(
    tx: &DatabaseWriteTransaction<'_>,
    owner_id: OwnerRowId,
) -> Result<(), Error> {
    let params = ParamsBuilder::new().set("owner_id", owner_id).build();
    let next_sort_order = tx
        .execute(
            &format!(
                "SELECT COALESCE(MAX(sort_order) + 1, 0) FROM {GROUP_TABLE} WHERE kind = 'friend' AND owner_id = @owner_id"
            ),
            &params,
        )?
        .first()
        .map(|row| row_i64(row, 0))
        .unwrap_or_default();
    tx.execute_non_query(
        &format!(
            "UPDATE {GROUP_TABLE} SET owner_id = @owner_id, sort_order = sort_order + @offset WHERE kind = 'friend' AND owner_id = 0"
        ),
        &ParamsBuilder::new()
            .set("owner_id", owner_id)
            .set("offset", next_sort_order)
            .build(),
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::favorites::{
        favorite_add, favorite_group_create, favorite_group_list, favorite_list,
    };
    use crate::ownership::owner_id_get;
    use vrcx_0_core::FavoriteEntityKind;

    fn friend_groups(db: &DatabaseService, owner: &str) -> Vec<(String, bool)> {
        favorite_group_list(db, Some(&OwnerId::new(owner)), FavoriteEntityKind::Friend)
            .unwrap()
            .into_iter()
            .map(|group| (group.name, group.shared))
            .collect()
    }

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
        for (name, user_id) in [("legacy", "usr_friend"), ("same", "usr_shared")] {
            let group = favorite_group_create(db, None, FavoriteEntityKind::Friend, name).unwrap();
            favorite_add(
                db,
                None,
                FavoriteEntityKind::Friend,
                user_id.into(),
                group.id,
            )
            .unwrap();
        }
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
        let owner_a = OwnerId::new("usr_a");
        let mine =
            favorite_group_create(&db, Some(&owner_a), FavoriteEntityKind::Friend, "mine").unwrap();
        favorite_add(
            &db,
            Some(&owner_a),
            FavoriteEntityKind::Friend,
            "usr_account".into(),
            mine.id,
        )
        .unwrap();
        let ids_before = favorite_group_list(&db, Some(&owner_a), FavoriteEntityKind::Friend)
            .unwrap()
            .into_iter()
            .map(|group| group.id)
            .collect::<Vec<_>>();

        claim_legacy_ownership(&db, &owner_a).unwrap();
        claim_legacy_ownership(&db, &OwnerId::new("usr_b")).unwrap();

        let owner_id = owner_id_get(&db, &OwnerId::new("usr_a")).unwrap().unwrap();
        for table in [
            TABLE_LOCATION,
            TABLE_JOIN_LEAVE,
            TABLE_PORTAL_SPAWN,
            TABLE_VIDEO_PLAY,
            TABLE_RESOURCE_LOAD,
            TABLE_EVENT,
            TABLE_EXTERNAL,
            "assistant_session",
        ] {
            let sql = format!("SELECT owner_id FROM {table} LIMIT 1");
            assert_eq!(
                row_i64(&db.execute(&sql, &Default::default()).unwrap()[0], 0),
                owner_id.value()
            );
        }
        assert_eq!(
            friend_groups(&db, "usr_a"),
            vec![
                ("mine".to_string(), false),
                ("legacy".to_string(), false),
                ("same".to_string(), false)
            ]
        );
        assert_eq!(
            favorite_group_list(&db, Some(&owner_a), FavoriteEntityKind::Friend)
                .unwrap()
                .into_iter()
                .map(|group| group.id)
                .collect::<Vec<_>>(),
            ids_before
        );
        assert!(friend_groups(&db, "usr_b").is_empty());
        let mut members = favorite_list(&db, Some(&owner_a), FavoriteEntityKind::Friend)
            .unwrap()
            .into_iter()
            .map(|row| (row.group_name.clone(), row.entity_id().to_string()))
            .collect::<Vec<_>>();
        members.sort();
        assert_eq!(
            members,
            vec![
                ("legacy".to_string(), "usr_friend".to_string()),
                ("mine".to_string(), "usr_account".to_string()),
                ("same".to_string(), "usr_shared".to_string()),
            ]
        );
        assert_eq!(
            config::get_string(&db, OWNERSHIP_DECIDED_KEY, "0").unwrap(),
            "1"
        );
        assert_eq!(owner_id_get(&db, &OwnerId::new("usr_b")).unwrap(), None);
    }

    #[test]
    fn multiple_prefixes_keep_shared_legacy_rows_and_finish_decision() {
        let db = test_db("multiple");
        seed_legacy_rows(&db);
        create_prefix_marker(&db, "usr_a");
        create_prefix_marker(&db, "usr_b");

        claim_legacy_ownership(&db, &OwnerId::new("usr_a")).unwrap();

        for table in [
            TABLE_LOCATION,
            TABLE_JOIN_LEAVE,
            TABLE_PORTAL_SPAWN,
            TABLE_VIDEO_PLAY,
            TABLE_RESOURCE_LOAD,
            TABLE_EVENT,
            TABLE_EXTERNAL,
            "assistant_session",
        ] {
            let sql = format!("SELECT owner_id FROM {table} LIMIT 1");
            assert_eq!(
                row_i64(&db.execute(&sql, &Default::default()).unwrap()[0], 0),
                0
            );
        }
        assert_eq!(
            friend_groups(&db, "usr_a"),
            vec![("legacy".to_string(), true), ("same".to_string(), true)]
        );
        assert_eq!(
            config::get_string(&db, OWNERSHIP_DECIDED_KEY, "0").unwrap(),
            "1"
        );
        assert_eq!(owner_id_get(&db, &OwnerId::new("usr_a")).unwrap(), None);
    }
}
