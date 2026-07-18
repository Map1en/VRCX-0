use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use specta::Type;
use vrcx_0_persistence::assistant;
use vrcx_0_persistence::DatabaseService;

use crate::config::PlaybookMode;
use crate::endpoints::AssistantRuntimeSelection;
use crate::entities::Entity;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    User,
    Assistant,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub id: String,
    pub seq: u64,
    pub role: Role,
    pub content: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum TurnStatus {
    Running,
    Done,
    Error,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ActiveTurn {
    pub turn_id: String,
    pub status: TurnStatus,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub title: String,
    pub messages: Vec<Message>,
    pub active_turn: Option<ActiveTurn>,
    pub endpoint_id: Option<String>,
    pub model: Option<String>,
    pub allow_writes: bool,
    pub playbook_mode: PlaybookMode,
    pub entity_panel_open: bool,
    pub surfaced_entities: Vec<Entity>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub id: String,
    pub title: String,
    pub busy: bool,
    pub updated_at: String,
}

#[derive(Default)]
pub struct SessionStore {
    sessions: Mutex<HashMap<String, Session>>,
    owners: Mutex<HashMap<String, String>>,
    seq: Mutex<u64>,
    db: Option<Arc<DatabaseService>>,
}

impl SessionStore {
    /// Build a store backed by the database, hydrating any persisted sessions.
    pub fn with_db(db: Arc<DatabaseService>) -> Self {
        let store = Self {
            sessions: Mutex::new(HashMap::new()),
            owners: Mutex::new(HashMap::new()),
            seq: Mutex::new(0),
            db: Some(db),
        };
        store.load();
        store
    }

    fn load(&self) {
        let Some(db) = self.db.as_ref() else {
            return;
        };
        match assistant::assistant_sessions_load(db, None) {
            Ok(persisted) => {
                let mut max_seq = 0u64;
                let mut guard = self.sessions.lock().unwrap();
                let mut owners = self.owners.lock().unwrap();
                for entry in persisted {
                    owners.insert(entry.id.clone(), entry.owner_user_id.clone());
                    let messages = entry
                        .messages
                        .into_iter()
                        .map(|message| {
                            let seq = message.seq.max(0) as u64;
                            max_seq = max_seq.max(seq);
                            Message {
                                id: message.id,
                                seq,
                                role: parse_role(&message.role),
                                content: message.content,
                                created_at: message.created_at,
                            }
                        })
                        .collect();
                    guard.insert(
                        entry.id.clone(),
                        Session {
                            id: entry.id,
                            title: entry.title,
                            messages,
                            active_turn: None,
                            endpoint_id: optional_string(entry.endpoint_id),
                            model: optional_string(entry.model),
                            allow_writes: entry.allow_writes,
                            playbook_mode: PlaybookMode::parse(&entry.playbook_mode),
                            entity_panel_open: entry.entity_panel_open,
                            surfaced_entities: serde_json::from_str(&entry.surfaced_entities)
                                .unwrap_or_default(),
                            created_at: entry.created_at,
                            updated_at: entry.updated_at,
                        },
                    );
                }
                drop(guard);
                *self.seq.lock().unwrap() = max_seq;
            }
            Err(error) => {
                tracing::warn!(%error, "assistant: failed to load persisted sessions");
            }
        }
    }

    fn upsert_row(
        &self,
        owner_user_id: &str,
        id: &str,
        title: &str,
        created_at: &str,
        updated_at: &str,
    ) {
        let Some(db) = self.db.as_ref() else {
            return;
        };
        if let Err(error) = assistant::assistant_session_upsert(
            db,
            owner_user_id,
            id,
            title,
            created_at,
            updated_at,
        ) {
            tracing::warn!(%error, "assistant: failed to persist session");
        }
    }

    fn persist_session(&self, owner_user_id: &str, session: &Session) {
        self.upsert_row(
            owner_user_id,
            &session.id,
            &session.title,
            &session.created_at,
            &session.updated_at,
        );
        persist_runtime(self.db.as_deref(), session);
    }

    fn persist_message(
        &self,
        id: &str,
        title: &str,
        created_at: &str,
        updated_at: &str,
        message: &Message,
    ) {
        let owner_user_id = self
            .owners
            .lock()
            .unwrap()
            .get(id)
            .cloned()
            .unwrap_or_default();
        self.upsert_row(&owner_user_id, id, title, created_at, updated_at);
        let Some(db) = self.db.as_ref() else {
            return;
        };
        if let Err(error) = assistant::assistant_message_insert(
            db,
            &message.id,
            id,
            message.seq as i64,
            role_str(message.role),
            &message.content,
            &message.created_at,
        ) {
            tracing::warn!(%error, "assistant: failed to persist message");
        }
    }

    pub fn next_seq(&self) -> u64 {
        let mut guard = self.seq.lock().unwrap();
        *guard += 1;
        *guard
    }

    fn insert_new(
        &self,
        owner_user_id: &str,
        id: String,
        runtime: AssistantRuntimeSelection,
    ) -> Session {
        let now = now_rfc3339();
        let session = Session {
            id,
            title: String::new(),
            messages: Vec::new(),
            active_turn: None,
            endpoint_id: normalize_optional(runtime.endpoint_id),
            model: normalize_optional(runtime.model),
            allow_writes: runtime.allow_writes,
            playbook_mode: runtime.playbook_mode,
            entity_panel_open: false,
            surfaced_entities: Vec::new(),
            created_at: now.clone(),
            updated_at: now,
        };
        {
            let mut sessions = self.sessions.lock().unwrap();
            let mut owners = self.owners.lock().unwrap();
            sessions.insert(session.id.clone(), session.clone());
            owners.insert(session.id.clone(), owner_user_id.trim().to_string());
        }
        self.persist_session(owner_user_id, &session);
        session
    }

    pub fn create_session_with_runtime(
        &self,
        owner_user_id: &str,
        runtime: AssistantRuntimeSelection,
    ) -> Session {
        self.insert_new(owner_user_id, format!("ses_{}", random_hex()), runtime)
    }

    pub fn ensure_session_with_runtime(
        &self,
        owner_user_id: &str,
        session_id: Option<String>,
        runtime: AssistantRuntimeSelection,
    ) -> Option<Session> {
        let Some(id) = session_id else {
            return Some(self.create_session_with_runtime(owner_user_id, runtime));
        };
        if self.sessions.lock().unwrap().contains_key(&id)
            && !self.is_visible_to(&id, owner_user_id)
        {
            return None;
        }
        let seeded = {
            let mut guard = self.sessions.lock().unwrap();
            match guard.get_mut(&id) {
                Some(session) if session.endpoint_id.is_none() && session.model.is_none() => {
                    apply_runtime(session, runtime.clone());
                    session.updated_at = now_rfc3339();
                    Some((session.clone(), true))
                }
                Some(session) => Some((session.clone(), false)),
                None => None,
            }
        };
        match seeded {
            Some((session, true)) => {
                persist_runtime(self.db.as_deref(), &session);
                Some(session)
            }
            Some((session, false)) => Some(session),
            None => Some(self.insert_new(owner_user_id, id, runtime)),
        }
    }

    pub fn get(&self, owner_user_id: &str, session_id: &str) -> Option<Session> {
        self.is_visible_to(session_id, owner_user_id)
            .then(|| self.sessions.lock().unwrap().get(session_id).cloned())
            .flatten()
    }

    pub(crate) fn get_unscoped(&self, session_id: &str) -> Option<Session> {
        self.sessions.lock().unwrap().get(session_id).cloned()
    }

    pub fn list(&self, owner_user_id: &str) -> Vec<SessionSummary> {
        let sessions = self.sessions.lock().unwrap();
        let owners = self.owners.lock().unwrap();
        let mut summaries: Vec<SessionSummary> = sessions
            .values()
            .filter(|session| {
                owners
                    .get(&session.id)
                    .is_some_and(|owner| owner_visible(owner, owner_user_id))
            })
            .map(|session| SessionSummary {
                id: session.id.clone(),
                title: session.title.clone(),
                busy: session
                    .active_turn
                    .as_ref()
                    .is_some_and(|turn| matches!(turn.status, TurnStatus::Running)),
                updated_at: session.updated_at.clone(),
            })
            .collect();
        summaries.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        summaries
    }

    pub fn delete(&self, owner_user_id: &str, session_id: &str) {
        if !self.is_visible_to(session_id, owner_user_id) {
            return;
        }
        {
            let mut sessions = self.sessions.lock().unwrap();
            let mut owners = self.owners.lock().unwrap();
            sessions.remove(session_id);
            owners.remove(session_id);
        }
        if let Some(db) = self.db.as_ref() {
            if let Err(error) = assistant::assistant_session_delete(db, owner_user_id, session_id) {
                tracing::warn!(%error, "assistant: failed to delete persisted session");
            }
        }
    }

    pub fn set_active_turn(&self, session_id: &str, turn: Option<ActiveTurn>) {
        if let Some(session) = self.sessions.lock().unwrap().get_mut(session_id) {
            session.active_turn = turn;
            session.updated_at = now_rfc3339();
        }
    }

    /// Whether `turn_id` is still the session's active turn — false once a newer
    /// turn has taken over, so a superseded turn can bow out without clobbering it.
    pub fn is_current_turn(&self, session_id: &str, turn_id: &str) -> bool {
        self.sessions
            .lock()
            .unwrap()
            .get(session_id)
            .and_then(|session| session.active_turn.as_ref())
            .is_some_and(|turn| turn.turn_id == turn_id)
    }

    pub fn push_message(&self, session_id: &str, role: Role, content: String) {
        let seq = self.next_seq();
        let row = {
            let mut guard = self.sessions.lock().unwrap();
            let Some(session) = guard.get_mut(session_id) else {
                return;
            };
            let now = now_rfc3339();
            if matches!(role, Role::User) && session.title.is_empty() {
                session.title = derive_title(&content);
            }
            let message = Message {
                id: format!("msg_{}", random_hex()),
                seq,
                role,
                content,
                created_at: now.clone(),
            };
            session.messages.push(message.clone());
            session.updated_at = now;
            (
                session.id.clone(),
                session.title.clone(),
                session.created_at.clone(),
                session.updated_at.clone(),
                message,
            )
        };
        self.persist_message(&row.0, &row.1, &row.2, &row.3, &row.4);
    }

    pub fn history(&self, session_id: &str) -> Vec<Message> {
        self.sessions
            .lock()
            .unwrap()
            .get(session_id)
            .map(|session| session.messages.clone())
            .unwrap_or_default()
    }

    /// Persist the entities a turn surfaced (and auto-open the panel for them),
    /// so a reopened session restores its right-panel contents.
    pub fn set_surfaced_entities(&self, session_id: &str, entities: &[Entity]) {
        // Mutate and persist under one lock so the in-memory change and the DB
        // write stay ordered together — a manual toggle racing a turn end can't
        // land its UPDATE out of order and desync the persisted panel state.
        let mut guard = self.sessions.lock().unwrap();
        let Some(session) = guard.get_mut(session_id) else {
            return;
        };
        session.surfaced_entities = entities.to_vec();
        if !entities.is_empty() {
            session.entity_panel_open = true;
        }
        persist_ui_state(
            self.db.as_deref(),
            session_id,
            session.entity_panel_open,
            &session.surfaced_entities,
        );
    }

    pub fn set_entity_panel_open(&self, session_id: &str, open: bool) {
        let mut guard = self.sessions.lock().unwrap();
        let Some(session) = guard.get_mut(session_id) else {
            return;
        };
        session.entity_panel_open = open;
        persist_ui_state(
            self.db.as_deref(),
            session_id,
            open,
            &session.surfaced_entities,
        );
    }

    pub fn set_runtime(
        &self,
        owner_user_id: &str,
        session_id: &str,
        runtime: AssistantRuntimeSelection,
    ) -> Option<Session> {
        if !self.is_visible_to(session_id, owner_user_id) {
            return None;
        }
        let updated = {
            let mut guard = self.sessions.lock().unwrap();
            let session = guard.get_mut(session_id)?;
            apply_runtime(session, runtime);
            session.updated_at = now_rfc3339();
            session.clone()
        };
        persist_runtime(self.db.as_deref(), &updated);
        Some(updated)
    }

    pub fn is_visible_to(&self, session_id: &str, owner_user_id: &str) -> bool {
        self.owners
            .lock()
            .unwrap()
            .get(session_id)
            .is_some_and(|owner| owner_visible(owner, owner_user_id))
    }
}

fn owner_visible(session_owner: &str, owner_user_id: &str) -> bool {
    session_owner.is_empty() || session_owner == owner_user_id.trim()
}

fn persist_ui_state(
    db: Option<&DatabaseService>,
    session_id: &str,
    open: bool,
    entities: &[Entity],
) {
    let Some(db) = db else {
        return;
    };
    let json = serde_json::to_string(entities).unwrap_or_else(|_| "[]".into());
    if let Err(error) = assistant::assistant_session_set_ui_state(db, session_id, open, &json) {
        tracing::warn!(%error, "assistant: failed to persist panel state");
    }
}

fn persist_runtime(db: Option<&DatabaseService>, session: &Session) {
    let Some(db) = db else {
        return;
    };
    if let Err(error) = assistant::assistant_session_set_runtime(
        db,
        &session.id,
        session.endpoint_id.as_deref(),
        session.model.as_deref(),
        session.allow_writes,
        session.playbook_mode.as_config_str(),
    ) {
        tracing::warn!(%error, "assistant: failed to persist runtime selection");
    }
}

fn apply_runtime(session: &mut Session, runtime: AssistantRuntimeSelection) {
    session.endpoint_id = normalize_optional(runtime.endpoint_id);
    session.model = normalize_optional(runtime.model);
    session.allow_writes = runtime.allow_writes;
    session.playbook_mode = runtime.playbook_mode;
}

fn normalize_optional(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn optional_string(value: String) -> Option<String> {
    normalize_optional(Some(value))
}

fn role_str(role: Role) -> &'static str {
    match role {
        Role::User => "user",
        Role::Assistant => "assistant",
    }
}

fn parse_role(role: &str) -> Role {
    match role {
        "assistant" => Role::Assistant,
        _ => Role::User,
    }
}

fn derive_title(content: &str) -> String {
    let trimmed = content.trim();
    let title: String = trimmed.chars().take(40).collect();
    if trimmed.chars().count() > 40 {
        format!("{title}…")
    } else {
        title
    }
}

pub fn random_hex() -> String {
    let mut bytes = [0u8; 12];
    if getrandom::fill(&mut bytes).is_err() {
        return "000000000000".into();
    }
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::unique_test_database_path;

    const TEST_OWNER: &str = "usr_test";

    fn test_db() -> Arc<DatabaseService> {
        Arc::new(DatabaseService::new(&unique_test_database_path("vrcx-0-harness")).unwrap())
    }

    fn create_test_session(store: &SessionStore) -> Session {
        store.create_session_with_runtime(TEST_OWNER, AssistantRuntimeSelection::default())
    }

    #[test]
    fn reopened_session_keeps_history_for_followups() {
        let db = test_db();
        let session = {
            let store = SessionStore::with_db(db.clone());
            let session = create_test_session(&store);
            store.push_message(&session.id, Role::User, "who do I play with?".into());
            store.push_message(&session.id, Role::Assistant, "Alice and Bob.".into());
            session
        };

        // Simulate an app restart: a fresh store over the same database must
        // hydrate the prior turns so the next question is sent with context.
        let reopened = SessionStore::with_db(db);
        let history = reopened.history(&session.id);
        assert_eq!(history.len(), 2);
        assert_eq!(history[0].role, Role::User);
        assert_eq!(history[0].content, "who do I play with?");
        assert_eq!(history[1].role, Role::Assistant);
        assert_eq!(history[1].content, "Alice and Bob.");
    }

    #[test]
    fn reopened_session_restores_panel_state() {
        let db = test_db();
        let session_id = {
            let store = SessionStore::with_db(db.clone());
            let session = create_test_session(&store);
            store.set_surfaced_entities(
                &session.id,
                &[Entity {
                    kind: "user".into(),
                    id: "usr_1".into(),
                    display_name: "Alice".into(),
                }],
            );
            session.id
        };

        // Surfacing entities auto-opens the panel; both must survive a restart.
        let reopened = SessionStore::with_db(db)
            .get(TEST_OWNER, &session_id)
            .unwrap();
        assert!(reopened.entity_panel_open);
        assert_eq!(reopened.surfaced_entities.len(), 1);
        assert_eq!(reopened.surfaced_entities[0].id, "usr_1");
        assert_eq!(reopened.surfaced_entities[0].display_name, "Alice");
    }

    #[test]
    fn runtime_selection_round_trips_and_lazy_seeds_old_sessions() {
        let db = test_db();
        let session_id = {
            let store = SessionStore::with_db(db.clone());
            let session = create_test_session(&store);
            store
                .set_runtime(
                    TEST_OWNER,
                    &session.id,
                    AssistantRuntimeSelection {
                        endpoint_id: Some("ep_1".into()),
                        model: Some("model-a".into()),
                        allow_writes: true,
                        playbook_mode: PlaybookMode::Guided,
                    },
                )
                .unwrap()
                .id
        };

        let reopened = SessionStore::with_db(db.clone())
            .get(TEST_OWNER, &session_id)
            .unwrap();
        assert_eq!(reopened.endpoint_id.as_deref(), Some("ep_1"));
        assert_eq!(reopened.model.as_deref(), Some("model-a"));
        assert!(reopened.allow_writes);
        assert_eq!(reopened.playbook_mode, PlaybookMode::Guided);

        let old_session_id = {
            let store = SessionStore::with_db(db.clone());
            create_test_session(&store).id
        };
        let store = SessionStore::with_db(db);
        let seeded = store
            .ensure_session_with_runtime(
                TEST_OWNER,
                Some(old_session_id),
                AssistantRuntimeSelection {
                    endpoint_id: Some("ep_seed".into()),
                    model: Some("seed-model".into()),
                    allow_writes: false,
                    playbook_mode: PlaybookMode::Open,
                },
            )
            .unwrap();
        assert_eq!(seeded.endpoint_id.as_deref(), Some("ep_seed"));
        assert_eq!(seeded.model.as_deref(), Some("seed-model"));
        assert_eq!(seeded.playbook_mode, PlaybookMode::Open);
    }

    #[test]
    fn empty_surfaced_entities_clear_prior_references() {
        let db = test_db();
        let session_id = {
            let store = SessionStore::with_db(db.clone());
            let session = create_test_session(&store);
            store.set_surfaced_entities(
                &session.id,
                &[Entity {
                    kind: "user".into(),
                    id: "usr_1".into(),
                    display_name: "Alice".into(),
                }],
            );
            store.set_surfaced_entities(&session.id, &[]);
            assert!(store
                .get(TEST_OWNER, &session.id)
                .unwrap()
                .surfaced_entities
                .is_empty());
            session.id
        };

        let reopened = SessionStore::with_db(db)
            .get(TEST_OWNER, &session_id)
            .unwrap();
        assert!(reopened.surfaced_entities.is_empty());
    }

    #[test]
    fn manual_panel_toggle_persists() {
        let db = test_db();
        let session_id = {
            let store = SessionStore::with_db(db.clone());
            let session = create_test_session(&store);
            store.set_entity_panel_open(&session.id, true);
            store.set_entity_panel_open(&session.id, false);
            session.id
        };
        let reopened = SessionStore::with_db(db)
            .get(TEST_OWNER, &session_id)
            .unwrap();
        assert!(!reopened.entity_panel_open);
    }

    #[test]
    fn owner_switch_hides_other_sessions_and_keeps_shared_legacy_sessions() {
        let db = test_db();
        let store = SessionStore::with_db(db.clone());
        let session_a =
            store.create_session_with_runtime("usr_a", AssistantRuntimeSelection::default());
        let session_b =
            store.create_session_with_runtime("usr_b", AssistantRuntimeSelection::default());
        let shared = store.create_session_with_runtime("", AssistantRuntimeSelection::default());

        let visible_to_a = store
            .list("usr_a")
            .into_iter()
            .map(|session| session.id)
            .collect::<std::collections::HashSet<_>>();
        assert_eq!(
            visible_to_a,
            std::collections::HashSet::from([session_a.id.clone(), shared.id.clone()])
        );
        assert!(store.get("usr_a", &session_b.id).is_none());
        assert!(store
            .set_runtime("usr_b", &session_a.id, AssistantRuntimeSelection::default(),)
            .is_none());

        store.delete("usr_b", &session_a.id);
        assert!(SessionStore::with_db(db)
            .get("usr_a", &session_a.id)
            .is_some());
    }

    #[test]
    fn is_current_turn_tracks_the_latest_turn() {
        let store = SessionStore::with_db(test_db());
        let session = create_test_session(&store);

        store.set_active_turn(
            &session.id,
            Some(ActiveTurn {
                turn_id: "turn_a".into(),
                status: TurnStatus::Running,
            }),
        );
        assert!(store.is_current_turn(&session.id, "turn_a"));
        assert!(!store.is_current_turn(&session.id, "turn_b"));

        // A newer turn takes over: the superseded one is no longer current.
        store.set_active_turn(
            &session.id,
            Some(ActiveTurn {
                turn_id: "turn_b".into(),
                status: TurnStatus::Running,
            }),
        );
        assert!(!store.is_current_turn(&session.id, "turn_a"));
        assert!(store.is_current_turn(&session.id, "turn_b"));
        assert!(!store.is_current_turn("missing", "turn_b"));
    }
}
