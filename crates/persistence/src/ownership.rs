use crate::common::{normalize_text, row_i64, DbWriteTarget, ParamsBuilder};
use crate::database::DatabaseService;
use crate::Error;

pub(crate) const COL_OWNER_ID: &str = "owner_id";

pub(crate) fn ensure_owner_table(db: &DatabaseService) -> Result<(), Error> {
    ensure_owner_table_on(db)
}

pub(crate) fn ensure_owner_table_on(target: &impl DbWriteTarget) -> Result<(), Error> {
    target.execute_non_query(
        "CREATE TABLE IF NOT EXISTS owners (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL UNIQUE)",
        &Default::default(),
    )?;
    Ok(())
}

pub(crate) fn owner_id_get(
    db: &DatabaseService,
    owner_user_id: &str,
) -> Result<Option<i64>, Error> {
    let owner_user_id = normalize_text(owner_user_id);
    if owner_user_id.is_empty() {
        return Ok(None);
    }
    ensure_owner_table(db)?;
    Ok(db
        .execute(
            "SELECT id FROM owners WHERE user_id = @user_id LIMIT 1",
            &ParamsBuilder::new().set("user_id", owner_user_id).build(),
        )?
        .first()
        .map(|row| row_i64(row, 0)))
}

pub(crate) fn owner_id_get_or_insert(
    db: &DatabaseService,
    owner_user_id: &str,
) -> Result<i64, Error> {
    let owner_user_id = normalize_text(owner_user_id);
    if owner_user_id.is_empty() {
        return Ok(0);
    }
    ensure_owner_table(db)?;
    db.execute_non_query(
        "INSERT OR IGNORE INTO owners (user_id) VALUES (@user_id)",
        &ParamsBuilder::new()
            .set("user_id", owner_user_id.clone())
            .build(),
    )?;
    owner_id_get(db, &owner_user_id)?.ok_or_else(|| {
        Error::Database("Owner dictionary row was not available after insertion.".into())
    })
}

pub(crate) fn owner_id_for_filter(db: &DatabaseService, owner_user_id: &str) -> Result<i64, Error> {
    Ok(owner_id_get(db, owner_user_id)?.unwrap_or(0))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_db(name: &str) -> DatabaseService {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "vrcx-0-owner-{name}-{}-{nonce}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        DatabaseService::new(&dir.join("VRCX-0.sqlite3")).unwrap()
    }

    #[test]
    fn owner_dictionary_is_idempotent_and_read_does_not_insert() {
        let db = test_db("dictionary");

        assert_eq!(owner_id_get(&db, "usr_missing").unwrap(), None);
        let first = owner_id_get_or_insert(&db, " usr_owner ").unwrap();
        let second = owner_id_get_or_insert(&db, "usr_owner").unwrap();

        assert!(first > 0);
        assert_eq!(first, second);
        assert_eq!(owner_id_get(&db, "usr_missing").unwrap(), None);
        let rows = db
            .execute(
                "SELECT user_id FROM owners ORDER BY id",
                &Default::default(),
            )
            .unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0][0].as_str(), Some("usr_owner"));
    }
}
