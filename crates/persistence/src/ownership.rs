use serde_json::Value;
pub(crate) use vrcx_0_core::OwnerId;

use crate::common::{normalize_text, row_i64, DbWriteTarget, ParamsBuilder};
use crate::database::DatabaseService;
use crate::Error;

pub(crate) const COL_OWNER_ID: &str = "owner_id";

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub(crate) struct OwnerRowId(i64);

impl OwnerRowId {
    pub(crate) const UNASSIGNED: Self = Self(0);

    pub(crate) fn value(self) -> i64 {
        self.0
    }

    pub(crate) fn from_value(value: i64) -> Self {
        Self(value)
    }
}

impl From<OwnerRowId> for Value {
    fn from(owner_id: OwnerRowId) -> Self {
        Value::from(owner_id.value())
    }
}

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
    owner_user_id: &OwnerId,
) -> Result<Option<OwnerRowId>, Error> {
    owner_row_id_lookup(db, &normalize_text(owner_user_id.as_str()))
}

pub(crate) fn owner_id_get_or_insert(
    db: &DatabaseService,
    owner_user_id: &OwnerId,
) -> Result<OwnerRowId, Error> {
    let owner_user_id = normalize_text(owner_user_id.as_str());
    if owner_user_id.is_empty() {
        return Ok(OwnerRowId::UNASSIGNED);
    }
    ensure_owner_table(db)?;
    db.execute_non_query(
        "INSERT OR IGNORE INTO owners (user_id) VALUES (@user_id)",
        &ParamsBuilder::new()
            .set("user_id", owner_user_id.clone())
            .build(),
    )?;
    owner_row_id_lookup(db, &owner_user_id)?.ok_or_else(|| {
        Error::Database("Owner dictionary row was not available after insertion.".into())
    })
}

pub(crate) fn owner_id_for_filter(
    db: &DatabaseService,
    owner_user_id: &OwnerId,
) -> Result<OwnerRowId, Error> {
    Ok(owner_id_get(db, owner_user_id)?.unwrap_or(OwnerRowId::UNASSIGNED))
}

fn owner_row_id_lookup(
    db: &DatabaseService,
    normalized_owner_user_id: &str,
) -> Result<Option<OwnerRowId>, Error> {
    if normalized_owner_user_id.is_empty() {
        return Ok(None);
    }
    if !owner_table_exists(db)? {
        return Ok(None);
    }
    Ok(db
        .execute(
            "SELECT id FROM owners WHERE user_id = @user_id LIMIT 1",
            &ParamsBuilder::new()
                .set("user_id", normalized_owner_user_id)
                .build(),
        )?
        .first()
        .map(|row| OwnerRowId(row_i64(row, 0))))
}

fn owner_table_exists(db: &DatabaseService) -> Result<bool, Error> {
    Ok(!db
        .execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'owners' LIMIT 1",
            &Default::default(),
        )?
        .is_empty())
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

        let missing = OwnerId::new("usr_missing");
        assert_eq!(owner_id_get(&db, &missing).unwrap(), None);
        assert!(!owner_table_exists(&db).unwrap());
        let first = owner_id_get_or_insert(&db, &OwnerId::new(" usr_owner ")).unwrap();
        let second = owner_id_get_or_insert(&db, &OwnerId::new("usr_owner")).unwrap();

        assert!(first > OwnerRowId::UNASSIGNED);
        assert_eq!(first, second);
        assert_eq!(owner_id_get(&db, &missing).unwrap(), None);
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
