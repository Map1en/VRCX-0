use crate::common::{row_i64, row_string, ParamsBuilder};
use crate::database::schema::ensure_assistant_tables;
use crate::database::DatabaseService;
use crate::ownership::{owner_id_for_filter, owner_id_get_or_insert, OwnerId};
use crate::Error;

#[derive(Debug, Clone)]
pub struct PersistedMessage {
    pub id: String,
    pub seq: i64,
    pub role: String,
    pub content: String,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct PersistedSession {
    pub owner_user_id: OwnerId,
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    pub entity_panel_open: bool,
    pub surfaced_entities: String,
    pub endpoint_id: String,
    pub model: String,
    pub allow_writes: bool,
    pub playbook_mode: String,
    pub pinned: bool,
}

pub fn assistant_sessions_load(
    db: &DatabaseService,
    owner_user_id: &OwnerId,
) -> Result<Vec<PersistedSession>, Error> {
    ensure_assistant_tables(db)?;
    let owner_id = owner_id_for_filter(db, owner_user_id)?;
    let params = ParamsBuilder::new().set("owner_id", owner_id).build();
    let sessions = db
        .execute(
            "SELECT s.id, s.title, s.created_at, s.updated_at, s.entity_panel_open, s.surfaced_entities, s.endpoint_id, s.model, s.allow_writes, s.playbook_mode, COALESCE(o.user_id, ''), s.pinned FROM assistant_session s LEFT JOIN owners o ON o.id = s.owner_id WHERE s.owner_id IN (0, @owner_id) ORDER BY s.updated_at DESC",
            &params,
        )?
        .into_iter()
        .map(|row| PersistedSession {
            owner_user_id: OwnerId::new(row_string(&row, 10)),
            id: row_string(&row, 0),
            title: row_string(&row, 1),
            created_at: row_string(&row, 2),
            updated_at: row_string(&row, 3),
            entity_panel_open: row_i64(&row, 4) != 0,
            surfaced_entities: row_string(&row, 5),
            endpoint_id: row_string(&row, 6),
            model: row_string(&row, 7),
            allow_writes: row_i64(&row, 8) != 0,
            playbook_mode: row_string(&row, 9),
            pinned: row_i64(&row, 11) != 0,
        })
        .collect();
    Ok(sessions)
}

pub fn assistant_session_messages_load(
    db: &DatabaseService,
    owner_user_id: &OwnerId,
    session_id: &str,
) -> Result<Vec<PersistedMessage>, Error> {
    ensure_assistant_tables(db)?;
    let owner_id = owner_id_for_filter(db, owner_user_id)?;
    let params = ParamsBuilder::new()
        .set("owner_id", owner_id)
        .set("session_id", session_id.to_string())
        .build();
    let messages = db
        .execute(
            "SELECT m.id, m.seq, m.role, m.content, m.created_at FROM assistant_message m JOIN assistant_session s ON s.id = m.session_id WHERE m.session_id = @session_id AND s.owner_id IN (0, @owner_id) ORDER BY m.seq ASC",
            &params,
        )?
        .into_iter()
        .map(|row| PersistedMessage {
            id: row_string(&row, 0),
            seq: row_i64(&row, 1),
            role: row_string(&row, 2),
            content: row_string(&row, 3),
            created_at: row_string(&row, 4),
        })
        .collect();
    Ok(messages)
}

pub fn assistant_session_upsert(
    db: &DatabaseService,
    owner_user_id: &OwnerId,
    id: &str,
    title: &str,
    created_at: &str,
    updated_at: &str,
) -> Result<(), Error> {
    ensure_assistant_tables(db)?;
    let owner_id = owner_id_get_or_insert(db, owner_user_id)?;
    db.execute_non_query(
        "INSERT INTO assistant_session (id, title, created_at, updated_at, owner_id) \
         VALUES (@id, @title, @created_at, @updated_at, @owner_id) \
         ON CONFLICT(id) DO UPDATE SET title = excluded.title, updated_at = excluded.updated_at",
        &ParamsBuilder::new()
            .set("id", id.to_string())
            .set("title", title.to_string())
            .set("created_at", created_at.to_string())
            .set("updated_at", updated_at.to_string())
            .set("owner_id", owner_id)
            .build(),
    )?;
    Ok(())
}

pub fn assistant_session_set_ui_state(
    db: &DatabaseService,
    id: &str,
    entity_panel_open: bool,
    surfaced_entities: &str,
) -> Result<(), Error> {
    ensure_assistant_tables(db)?;
    db.execute_non_query(
        "UPDATE assistant_session SET entity_panel_open = @open, surfaced_entities = @entities WHERE id = @id",
        &ParamsBuilder::new()
            .set("open", i64::from(entity_panel_open))
            .set("entities", surfaced_entities.to_string())
            .set("id", id.to_string())
            .build(),
    )?;
    Ok(())
}

pub fn assistant_session_set_runtime(
    db: &DatabaseService,
    id: &str,
    endpoint_id: Option<&str>,
    model: Option<&str>,
    allow_writes: bool,
    playbook_mode: &str,
) -> Result<(), Error> {
    ensure_assistant_tables(db)?;
    db.execute_non_query(
        "UPDATE assistant_session SET endpoint_id = @endpoint_id, model = @model, allow_writes = @allow_writes, playbook_mode = @playbook_mode WHERE id = @id",
        &ParamsBuilder::new()
            .set("endpoint_id", endpoint_id.unwrap_or("").to_string())
            .set("model", model.unwrap_or("").to_string())
            .set("allow_writes", i64::from(allow_writes))
            .set("playbook_mode", playbook_mode.to_string())
            .set("id", id.to_string())
            .build(),
    )?;
    Ok(())
}

pub fn assistant_session_set_pinned(
    db: &DatabaseService,
    id: &str,
    pinned: bool,
) -> Result<(), Error> {
    ensure_assistant_tables(db)?;
    db.execute_non_query(
        "UPDATE assistant_session SET pinned = @pinned WHERE id = @id",
        &ParamsBuilder::new()
            .set("pinned", i64::from(pinned))
            .set("id", id.to_string())
            .build(),
    )?;
    Ok(())
}

pub fn assistant_session_delete(
    db: &DatabaseService,
    owner_user_id: &OwnerId,
    id: &str,
) -> Result<(), Error> {
    ensure_assistant_tables(db)?;
    let owner_id = owner_id_for_filter(db, owner_user_id)?;
    let params = ParamsBuilder::new()
        .set("session_id", id.to_string())
        .set("owner_id", owner_id)
        .build();
    db.write_transaction(|tx| {
        let visible = !tx
            .execute(
                "SELECT id FROM assistant_session WHERE id = @session_id AND owner_id IN (0, @owner_id) LIMIT 1",
                &params,
            )?
            .is_empty();
        if visible {
            tx.execute_non_query(
                "DELETE FROM assistant_message WHERE session_id = @session_id",
                &params,
            )?;
            tx.execute_non_query(
                "DELETE FROM assistant_session WHERE id = @session_id AND owner_id IN (0, @owner_id)",
                &params,
            )?;
        }
        Ok(())
    })?;
    Ok(())
}

pub fn assistant_message_insert(
    db: &DatabaseService,
    id: &str,
    session_id: &str,
    seq: i64,
    role: &str,
    content: &str,
    created_at: &str,
) -> Result<(), Error> {
    ensure_assistant_tables(db)?;
    db.execute_non_query(
        "INSERT OR REPLACE INTO assistant_message (id, session_id, seq, role, content, created_at) \
         VALUES (@id, @session_id, @seq, @role, @content, @created_at)",
        &ParamsBuilder::new()
            .set("id", id.to_string())
            .set("session_id", session_id.to_string())
            .set("seq", seq)
            .set("role", role.to_string())
            .set("content", content.to_string())
            .set("created_at", created_at.to_string())
            .build(),
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_db(name: &str) -> DatabaseService {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir =
            std::env::temp_dir().join(format!("vrcx-0-{name}-{}-{nonce}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        DatabaseService::new(&dir.join("VRCX-0.sqlite3")).unwrap()
    }

    #[test]
    fn round_trips_sessions_and_messages() {
        let db = test_db("assistant-roundtrip");
        assistant_session_upsert(&db, &OwnerId::new("usr_a"), "ses_1", "", "t0", "t0").unwrap();
        assistant_session_set_runtime(&db, "ses_1", Some("ep_1"), Some("model-a"), true, "guided")
            .unwrap();
        assistant_message_insert(&db, "msg_1", "ses_1", 1, "user", "hi", "t1").unwrap();
        assistant_session_upsert(&db, &OwnerId::new("usr_a"), "ses_1", "hi", "t0", "t1").unwrap();
        assistant_message_insert(&db, "msg_2", "ses_1", 2, "assistant", "hello", "t2").unwrap();
        assistant_session_set_pinned(&db, "ses_1", true).unwrap();

        let loaded = assistant_sessions_load(&db, &OwnerId::new("usr_a")).unwrap();
        assert_eq!(loaded.len(), 1);
        let session = &loaded[0];
        assert_eq!(session.title, "hi");
        assert_eq!(session.endpoint_id, "ep_1");
        assert_eq!(session.model, "model-a");
        assert!(session.allow_writes);
        assert_eq!(session.playbook_mode, "guided");
        assert!(session.pinned);
        let messages =
            assistant_session_messages_load(&db, &OwnerId::new("usr_a"), "ses_1").unwrap();
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].seq, 1);
        assert_eq!(messages[1].role, "assistant");
    }

    #[test]
    fn delete_removes_session_and_messages() {
        let db = test_db("assistant-delete");
        assistant_session_upsert(&db, &OwnerId::new("usr_a"), "ses_1", "x", "t0", "t0").unwrap();
        assistant_message_insert(&db, "msg_1", "ses_1", 1, "user", "hi", "t1").unwrap();

        assistant_session_delete(&db, &OwnerId::new("usr_a"), "ses_1").unwrap();

        assert!(assistant_sessions_load(&db, &OwnerId::new("usr_a"))
            .unwrap()
            .is_empty());
        let remaining = db
            .execute(
                "SELECT id FROM assistant_message WHERE session_id = @session_id",
                &ParamsBuilder::new().set("session_id", "ses_1").build(),
            )
            .unwrap();
        assert!(remaining.is_empty());
    }

    #[test]
    fn sessions_are_scoped_and_cross_owner_delete_is_ignored() {
        let db = test_db("assistant-owner-scope");
        assistant_session_upsert(&db, &OwnerId::new("usr_a"), "ses_a", "a", "t0", "t0").unwrap();
        assistant_session_upsert(&db, &OwnerId::new("usr_b"), "ses_b", "b", "t0", "t0").unwrap();
        assistant_session_upsert(&db, &OwnerId::new(""), "ses_shared", "shared", "t0", "t0")
            .unwrap();

        let mut a_ids = assistant_sessions_load(&db, &OwnerId::new("usr_a"))
            .unwrap()
            .into_iter()
            .map(|session| session.id)
            .collect::<Vec<_>>();
        a_ids.sort();
        assert_eq!(a_ids, vec!["ses_a", "ses_shared"]);

        assistant_session_delete(&db, &OwnerId::new("usr_b"), "ses_a").unwrap();
        assert!(assistant_sessions_load(&db, &OwnerId::new("usr_a"))
            .unwrap()
            .iter()
            .any(|session| session.id == "ses_a"));
    }
}
