use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::{Arc, Mutex, Weak};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use specta::Type;

use crate::charts::AssistantChart;
use crate::config::PlaybookMode;
use crate::endpoints::AssistantRuntimeSelection;
use crate::entities::Entity;
use crate::ports::{
    AssistantMessageInsert, AssistantPortResult, AssistantSessionPersistence,
    AssistantSessionRuntimeUpdate, AssistantSessionUpsert,
};
use crate::screenshots::AssistantScreenshots;
use vrcx_0_core::OwnerId;

const SESSION_CONTENT_CACHE_CAPACITY: usize = 8;
const RENAMED_TITLE_LIMIT: usize = 80;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum Role {
    User,
    Assistant,
    ToolCall,
    ToolResult,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallRecord {
    pub id: String,
    pub name: String,
    pub arguments: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extra_content: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ToolResultRecord {
    pub tool_call_id: String,
    pub name: String,
    pub ok: bool,
    pub summary: String,
    pub entities: Vec<Entity>,
    #[serde(default)]
    pub charts: Vec<AssistantChart>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub screenshots: Option<AssistantScreenshots>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredToolResult {
    #[serde(flatten)]
    record: ToolResultRecord,
    content: String,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub id: String,
    pub seq: u64,
    pub role: Role,
    pub content: String,
    pub created_at: String,
    pub tool_call: Option<ToolCallRecord>,
    pub tool_result: Option<ToolResultRecord>,
    /// Full tool output as sent to the model. Kept out of the UI payload;
    /// only the context builder reads it.
    #[serde(skip)]
    #[specta(skip)]
    pub tool_content: Option<String>,
}

impl Message {
    fn stored_content(&self) -> String {
        match self.role {
            Role::User | Role::Assistant => self.content.clone(),
            Role::ToolCall => self
                .tool_call
                .as_ref()
                .and_then(|record| serde_json::to_string(record).ok())
                .unwrap_or_default(),
            Role::ToolResult => self
                .tool_result
                .as_ref()
                .map(|record| StoredToolResult {
                    record: record.clone(),
                    content: self.tool_content.clone().unwrap_or_default(),
                })
                .and_then(|stored| serde_json::to_string(&stored).ok())
                .unwrap_or_default(),
        }
    }

    fn from_stored(id: String, seq: u64, role: Role, content: String, created_at: String) -> Self {
        let mut message = Self {
            id,
            seq,
            role,
            content: String::new(),
            created_at,
            tool_call: None,
            tool_result: None,
            tool_content: None,
        };
        match role {
            Role::User | Role::Assistant => message.content = content,
            Role::ToolCall => message.tool_call = serde_json::from_str(&content).ok(),
            Role::ToolResult => {
                if let Ok(stored) = serde_json::from_str::<StoredToolResult>(&content) {
                    message.tool_result = Some(stored.record);
                    message.tool_content = Some(stored.content);
                }
            }
        }
        message
    }
}

enum MessageBody {
    Text(String),
    ToolCall(ToolCallRecord),
    ToolResult(Box<ToolResultRecord>, String),
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
    pub pinned: bool,
    pub busy: bool,
    pub updated_at: String,
}

#[derive(Clone)]
struct StoredSession {
    owner_user_id: OwnerId,
    title: String,
    pinned: bool,
    active_turn: Option<ActiveTurn>,
    endpoint_id: Option<String>,
    model: Option<String>,
    allow_writes: bool,
    playbook_mode: PlaybookMode,
    entity_panel_open: bool,
    surfaced_entities: Vec<Entity>,
    created_at: String,
    updated_at: String,
}

impl StoredSession {
    fn materialize(&self, id: String, messages: Vec<Message>) -> Session {
        Session {
            id,
            title: self.title.clone(),
            messages,
            active_turn: self.active_turn.clone(),
            endpoint_id: self.endpoint_id.clone(),
            model: self.model.clone(),
            allow_writes: self.allow_writes,
            playbook_mode: self.playbook_mode,
            entity_panel_open: self.entity_panel_open,
            surfaced_entities: self.surfaced_entities.clone(),
            created_at: self.created_at.clone(),
            updated_at: self.updated_at.clone(),
        }
    }
}

struct SessionContent {
    messages: Vec<Message>,
    pending_writes: usize,
    write_failed: bool,
}

impl SessionContent {
    fn loaded(messages: Vec<Message>) -> Self {
        Self {
            messages,
            pending_writes: 0,
            write_failed: false,
        }
    }
}

#[derive(Default)]
struct SessionStoreState {
    sessions: HashMap<String, StoredSession>,
    contents: HashMap<String, SessionContent>,
    content_lru: VecDeque<String>,
}

impl SessionStoreState {
    fn touch_content(&mut self, session_id: &str) {
        self.content_lru
            .retain(|cached_session_id| cached_session_id != session_id);
        self.content_lru.push_back(session_id.to_string());
    }

    fn remove_content(&mut self, session_id: &str) {
        self.contents.remove(session_id);
        self.content_lru
            .retain(|cached_session_id| cached_session_id != session_id);
    }

    fn evict_contents(&mut self, can_reload: bool) {
        if !can_reload {
            return;
        }
        while self.contents.len() > SESSION_CONTENT_CACHE_CAPACITY {
            let candidate = self.content_lru.iter().position(|session_id| {
                let running = self
                    .sessions
                    .get(session_id)
                    .and_then(|session| session.active_turn.as_ref())
                    .is_some_and(|turn| matches!(turn.status, TurnStatus::Running));
                self.contents.get(session_id).is_some_and(|content| {
                    !running && content.pending_writes == 0 && !content.write_failed
                })
            });
            let Some(candidate) = candidate else {
                break;
            };
            let Some(session_id) = self.content_lru.remove(candidate) else {
                break;
            };
            self.contents.remove(&session_id);
        }
    }

    fn materialize_loaded(&mut self, session_id: &str) -> Option<Session> {
        let session = self.sessions.get(session_id)?.clone();
        let messages = self.contents.get(session_id)?.messages.clone();
        self.touch_content(session_id);
        Some(session.materialize(session_id.to_string(), messages))
    }
}

#[derive(Default)]
pub struct SessionStore {
    state: Mutex<SessionStoreState>,
    content_loads: Mutex<HashMap<String, Weak<Mutex<()>>>>,
    loaded_owners: Mutex<HashSet<String>>,
    seq: Mutex<u64>,
    persistence: Option<AssistantSessionPersistence>,
}

impl SessionStore {
    pub fn with_persistence(persistence: AssistantSessionPersistence) -> Self {
        Self {
            state: Mutex::new(SessionStoreState::default()),
            content_loads: Mutex::new(HashMap::new()),
            loaded_owners: Mutex::new(HashSet::new()),
            seq: Mutex::new(0),
            persistence: Some(persistence),
        }
    }

    fn ensure_owner_loaded(&self, owner_user_id: &OwnerId) {
        let owner_user_id = owner_user_id.as_str().trim();
        let mut loaded_owners = self.loaded_owners.lock().unwrap();
        if loaded_owners.contains(owner_user_id) {
            return;
        }
        let Some(persistence) = self.persistence.as_ref() else {
            loaded_owners.insert(owner_user_id.to_string());
            return;
        };
        match persistence.load_sessions(&OwnerId::new(owner_user_id)) {
            Ok(persisted) => {
                let mut state = self.state.lock().unwrap();
                for entry in persisted {
                    if state.sessions.contains_key(&entry.id) {
                        continue;
                    }
                    state.sessions.insert(
                        entry.id.clone(),
                        StoredSession {
                            owner_user_id: entry.owner_user_id,
                            title: entry.title,
                            pinned: entry.pinned,
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
                loaded_owners.insert(owner_user_id.to_string());
            }
            Err(error) => {
                tracing::warn!(%error, "assistant: failed to load persisted sessions");
            }
        }
    }

    fn content_load(&self, session_id: &str) -> Arc<Mutex<()>> {
        let mut loads = self.content_loads.lock().unwrap();
        if let Some(load) = loads.get(session_id).and_then(Weak::upgrade) {
            return load;
        }
        loads.retain(|_, load| load.strong_count() > 0);
        let load = Arc::new(Mutex::new(()));
        loads.insert(session_id.to_string(), Arc::downgrade(&load));
        load
    }

    fn persisted_messages(
        &self,
        owner_user_id: &OwnerId,
        session_id: &str,
    ) -> AssistantPortResult<Vec<Message>> {
        let Some(persistence) = self.persistence.as_ref() else {
            return Ok(Vec::new());
        };
        let history = persistence
            .load_messages(owner_user_id, session_id)?
            .into_iter()
            .map(|message| {
                Message::from_stored(
                    message.id,
                    message.seq.max(0) as u64,
                    parse_role(&message.role),
                    message.content,
                    message.created_at,
                )
            })
            .collect::<Vec<_>>();
        if let Some(max_seq) = history.iter().map(|message| message.seq).max() {
            let mut seq = self.seq.lock().unwrap();
            *seq = (*seq).max(max_seq);
        }
        Ok(history)
    }

    fn with_loaded_session<R>(
        &self,
        session_id: &str,
        operation: impl FnOnce(&mut SessionStoreState) -> Option<R>,
    ) -> AssistantPortResult<Option<R>> {
        let mut operation = Some(operation);
        let owner_user_id = {
            let mut state = self.state.lock().unwrap();
            let Some(session) = state.sessions.get(session_id) else {
                return Ok(None);
            };
            let owner_user_id = session.owner_user_id.clone();
            if state.contents.contains_key(session_id) {
                let result = operation.take().expect("session operation is available")(&mut state);
                state.evict_contents(self.persistence.is_some());
                return Ok(result);
            }
            owner_user_id
        };
        let loaded = self.persisted_messages(&owner_user_id, session_id)?;
        let mut state = self.state.lock().unwrap();
        if !state.sessions.contains_key(session_id) {
            return Ok(None);
        }
        state
            .contents
            .entry(session_id.to_string())
            .or_insert_with(|| SessionContent::loaded(loaded));
        let result = operation.expect("session operation is available")(&mut state);
        state.evict_contents(self.persistence.is_some());
        Ok(result)
    }

    fn upsert_row(
        &self,
        owner_user_id: &OwnerId,
        id: &str,
        title: &str,
        created_at: &str,
        updated_at: &str,
    ) -> bool {
        let Some(persistence) = self.persistence.as_ref() else {
            return false;
        };
        match persistence.upsert_session(AssistantSessionUpsert {
            owner_user_id,
            id,
            title,
            created_at,
            updated_at,
        }) {
            Ok(()) => true,
            Err(error) => {
                tracing::warn!(%error, "assistant: failed to persist session");
                false
            }
        }
    }

    fn persist_session(&self, id: &str, session: &StoredSession) {
        self.upsert_row(
            &session.owner_user_id,
            id,
            &session.title,
            &session.created_at,
            &session.updated_at,
        );
        persist_runtime(self.persistence.as_deref(), id, session);
    }

    fn persist_message(
        &self,
        id: &str,
        title: &str,
        created_at: &str,
        updated_at: &str,
        message: &Message,
        owner_user_id: &OwnerId,
    ) -> bool {
        let session_persisted = self.upsert_row(owner_user_id, id, title, created_at, updated_at);
        let Some(persistence) = self.persistence.as_ref() else {
            return false;
        };
        let content = message.stored_content();
        let message_persisted = match persistence.insert_message(AssistantMessageInsert {
            id: &message.id,
            session_id: id,
            seq: message.seq as i64,
            role: role_str(message.role),
            content: &content,
            created_at: &message.created_at,
        }) {
            Ok(()) => true,
            Err(error) => {
                tracing::warn!(%error, "assistant: failed to persist message");
                false
            }
        };
        session_persisted && message_persisted
    }

    pub fn next_seq(&self) -> u64 {
        let mut guard = self.seq.lock().unwrap();
        *guard += 1;
        *guard
    }

    fn insert_new(
        &self,
        owner_user_id: &OwnerId,
        id: String,
        runtime: AssistantRuntimeSelection,
    ) -> Session {
        let load = self.content_load(&id);
        let _load = load.lock().unwrap();
        let now = now_rfc3339();
        let stored = StoredSession {
            owner_user_id: OwnerId::new(owner_user_id.as_str().trim()),
            title: String::new(),
            pinned: false,
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
            let mut state = self.state.lock().unwrap();
            state.sessions.insert(id.clone(), stored.clone());
            state
                .contents
                .insert(id.clone(), SessionContent::loaded(Vec::new()));
            state.touch_content(&id);
            state.evict_contents(self.persistence.is_some());
        }
        self.persist_session(&id, &stored);
        stored.materialize(id, Vec::new())
    }

    pub fn create_session_with_runtime(
        &self,
        owner_user_id: &OwnerId,
        runtime: AssistantRuntimeSelection,
    ) -> Session {
        self.ensure_owner_loaded(owner_user_id);
        self.insert_new(owner_user_id, format!("ses_{}", random_hex()), runtime)
    }

    pub fn ensure_session_with_runtime(
        &self,
        owner_user_id: &OwnerId,
        session_id: Option<String>,
        runtime: AssistantRuntimeSelection,
    ) -> AssistantPortResult<Option<Session>> {
        self.ensure_owner_loaded(owner_user_id);
        let Some(id) = session_id else {
            return Ok(Some(self.insert_new(
                owner_user_id,
                format!("ses_{}", random_hex()),
                runtime,
            )));
        };
        let load = self.content_load(&id);
        let _load = load.lock().unwrap();
        let visible = {
            let state = self.state.lock().unwrap();
            state
                .sessions
                .get(&id)
                .map(|session| owner_visible(session.owner_user_id.as_str(), owner_user_id))
        };
        if visible == Some(false) {
            return Ok(None);
        }
        if visible.is_none() {
            drop(_load);
            return Ok(Some(self.insert_new(owner_user_id, id, runtime)));
        }
        let mut seeded = false;
        let session = self.with_loaded_session(&id, |state| {
            let session = state.sessions.get_mut(&id)?;
            if session.endpoint_id.is_none() && session.model.is_none() {
                apply_runtime(session, runtime);
                session.updated_at = now_rfc3339();
                seeded = true;
            }
            state.materialize_loaded(&id)
        })?;
        if seeded {
            let stored = self.state.lock().unwrap().sessions.get(&id).cloned();
            if let Some(stored) = stored {
                persist_runtime(self.persistence.as_deref(), &id, &stored);
            }
        }
        Ok(session)
    }

    pub fn get(
        &self,
        owner_user_id: &OwnerId,
        session_id: &str,
    ) -> AssistantPortResult<Option<Session>> {
        if !self.is_visible_to(session_id, owner_user_id) {
            return Ok(None);
        }
        let load = self.content_load(session_id);
        let _load = load.lock().unwrap();
        self.with_loaded_session(session_id, |state| state.materialize_loaded(session_id))
    }

    pub(crate) fn get_unscoped(&self, session_id: &str) -> Option<Session> {
        self.state.lock().unwrap().materialize_loaded(session_id)
    }

    pub fn list(&self, owner_user_id: &OwnerId) -> Vec<SessionSummary> {
        self.ensure_owner_loaded(owner_user_id);
        let state = self.state.lock().unwrap();
        let mut summaries: Vec<SessionSummary> = state
            .sessions
            .iter()
            .filter(|(_, session)| owner_visible(session.owner_user_id.as_str(), owner_user_id))
            .map(|(id, session)| SessionSummary {
                id: id.clone(),
                title: session.title.clone(),
                pinned: session.pinned,
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

    pub fn rename(
        &self,
        owner_user_id: &OwnerId,
        session_id: &str,
        title: &str,
    ) -> AssistantPortResult<()> {
        let title: String = title.trim().chars().take(RENAMED_TITLE_LIMIT).collect();
        if title.is_empty() || !self.is_visible_to(session_id, owner_user_id) {
            return Ok(());
        }
        let stored = {
            let mut state = self.state.lock().unwrap();
            let Some(session) = state.sessions.get_mut(session_id) else {
                return Ok(());
            };
            session.title = title;
            session.clone()
        };
        if let Some(persistence) = self.persistence.as_ref() {
            persistence.upsert_session(AssistantSessionUpsert {
                owner_user_id: &stored.owner_user_id,
                id: session_id,
                title: &stored.title,
                created_at: &stored.created_at,
                updated_at: &stored.updated_at,
            })?;
        }
        Ok(())
    }

    pub fn set_pinned(
        &self,
        owner_user_id: &OwnerId,
        session_id: &str,
        pinned: bool,
    ) -> AssistantPortResult<()> {
        if !self.is_visible_to(session_id, owner_user_id) {
            return Ok(());
        }
        if let Some(session) = self.state.lock().unwrap().sessions.get_mut(session_id) {
            session.pinned = pinned;
        }
        if let Some(persistence) = self.persistence.as_ref() {
            persistence.set_pinned(session_id, pinned)?;
        }
        Ok(())
    }

    pub fn delete(&self, owner_user_id: &OwnerId, session_id: &str) {
        if !self.is_visible_to(session_id, owner_user_id) {
            return;
        }
        let load = self.content_load(session_id);
        let _load = load.lock().unwrap();
        {
            let mut state = self.state.lock().unwrap();
            state.sessions.remove(session_id);
            state.remove_content(session_id);
        }
        if let Some(persistence) = self.persistence.as_ref() {
            if let Err(error) = persistence.delete_session(owner_user_id, session_id) {
                tracing::warn!(%error, "assistant: failed to delete persisted session");
            }
        }
    }

    pub fn set_active_turn(&self, session_id: &str, turn: Option<ActiveTurn>) {
        let mut state = self.state.lock().unwrap();
        if let Some(session) = state.sessions.get_mut(session_id) {
            session.active_turn = turn;
            session.updated_at = now_rfc3339();
            if state.contents.contains_key(session_id) {
                state.touch_content(session_id);
            }
            state.evict_contents(self.persistence.is_some());
        }
    }

    /// Whether `turn_id` is still the session's active turn — false once a newer
    /// turn has taken over, so a superseded turn can bow out without clobbering it.
    pub fn is_current_turn(&self, session_id: &str, turn_id: &str) -> bool {
        self.state
            .lock()
            .unwrap()
            .sessions
            .get(session_id)
            .and_then(|session| session.active_turn.as_ref())
            .is_some_and(|turn| turn.turn_id == turn_id)
    }

    pub fn push_message(
        &self,
        session_id: &str,
        role: Role,
        content: String,
    ) -> AssistantPortResult<bool> {
        self.push(session_id, role, MessageBody::Text(content))
    }

    pub fn push_tool_call(
        &self,
        session_id: &str,
        record: ToolCallRecord,
    ) -> AssistantPortResult<bool> {
        self.push(session_id, Role::ToolCall, MessageBody::ToolCall(record))
    }

    pub fn push_tool_result(
        &self,
        session_id: &str,
        record: ToolResultRecord,
        content: String,
    ) -> AssistantPortResult<bool> {
        self.push(
            session_id,
            Role::ToolResult,
            MessageBody::ToolResult(Box::new(record), content),
        )
    }

    fn push(&self, session_id: &str, role: Role, body: MessageBody) -> AssistantPortResult<bool> {
        let load = self.content_load(session_id);
        let _load = load.lock().unwrap();
        let row = self.with_loaded_session(session_id, |state| {
            let session = state.sessions.get_mut(session_id)?;
            let now = now_rfc3339();
            let mut message = Message {
                id: format!("msg_{}", random_hex()),
                seq: self.next_seq(),
                role,
                content: String::new(),
                created_at: now.clone(),
                tool_call: None,
                tool_result: None,
                tool_content: None,
            };
            match body {
                MessageBody::Text(content) => {
                    if matches!(role, Role::User) && session.title.is_empty() {
                        session.title = derive_title(&content);
                    }
                    message.content = content;
                }
                MessageBody::ToolCall(record) => message.tool_call = Some(record),
                MessageBody::ToolResult(record, content) => {
                    message.tool_result = Some(*record);
                    message.tool_content = Some(content);
                }
            }
            session.updated_at = now;
            let owner_user_id = session.owner_user_id.clone();
            let title = session.title.clone();
            let created_at = session.created_at.clone();
            let updated_at = session.updated_at.clone();
            let cached = state.contents.get_mut(session_id)?;
            cached.messages.push(message.clone());
            cached.pending_writes = cached.pending_writes.saturating_add(1);
            state.touch_content(session_id);
            Some((owner_user_id, title, created_at, updated_at, message))
        })?;
        let Some((owner_user_id, title, created_at, updated_at, message)) = row else {
            return Ok(false);
        };
        let persisted = self.persist_message(
            session_id,
            &title,
            &created_at,
            &updated_at,
            &message,
            &owner_user_id,
        );
        let mut state = self.state.lock().unwrap();
        if let Some(cached) = state.contents.get_mut(session_id) {
            cached.pending_writes = cached.pending_writes.saturating_sub(1);
            if !persisted {
                cached.write_failed = true;
            }
        }
        state.evict_contents(self.persistence.is_some());
        Ok(true)
    }

    pub fn history(&self, session_id: &str) -> Vec<Message> {
        let mut state = self.state.lock().unwrap();
        let history = state
            .contents
            .get(session_id)
            .map(|content| content.messages.clone())
            .unwrap_or_default();
        if state.contents.contains_key(session_id) {
            state.touch_content(session_id);
        }
        history
    }

    /// Persist the entities a turn surfaced (and auto-open the panel for them),
    /// so a reopened session restores its right-panel contents.
    pub fn set_surfaced_entities(&self, session_id: &str, entities: &[Entity]) {
        // Mutate and persist under one lock so the in-memory change and the DB
        // write stay ordered together — a manual toggle racing a turn end can't
        // land its UPDATE out of order and desync the persisted panel state.
        let mut state = self.state.lock().unwrap();
        let Some(session) = state.sessions.get_mut(session_id) else {
            return;
        };
        session.surfaced_entities = entities.to_vec();
        if !entities.is_empty() {
            session.entity_panel_open = true;
        }
        persist_ui_state(
            self.persistence.as_deref(),
            session_id,
            session.entity_panel_open,
            &session.surfaced_entities,
        );
    }

    pub fn set_entity_panel_open(&self, session_id: &str, open: bool) {
        let mut state = self.state.lock().unwrap();
        let Some(session) = state.sessions.get_mut(session_id) else {
            return;
        };
        session.entity_panel_open = open;
        persist_ui_state(
            self.persistence.as_deref(),
            session_id,
            open,
            &session.surfaced_entities,
        );
    }

    pub fn set_runtime(
        &self,
        owner_user_id: &OwnerId,
        session_id: &str,
        runtime: AssistantRuntimeSelection,
    ) -> AssistantPortResult<Option<Session>> {
        if !self.is_visible_to(session_id, owner_user_id) {
            return Ok(None);
        }
        let load = self.content_load(session_id);
        let _load = load.lock().unwrap();
        let updated = self.with_loaded_session(session_id, |state| {
            let session = state.sessions.get_mut(session_id)?;
            apply_runtime(session, runtime);
            session.updated_at = now_rfc3339();
            let stored = session.clone();
            let materialized = state.materialize_loaded(session_id)?;
            Some((stored, materialized))
        })?;
        let Some((stored, materialized)) = updated else {
            return Ok(None);
        };
        persist_runtime(self.persistence.as_deref(), session_id, &stored);
        Ok(Some(materialized))
    }

    pub fn is_visible_to(&self, session_id: &str, owner_user_id: &OwnerId) -> bool {
        self.ensure_owner_loaded(owner_user_id);
        self.is_loaded_session_visible_to(session_id, owner_user_id)
    }

    fn is_loaded_session_visible_to(&self, session_id: &str, owner_user_id: &OwnerId) -> bool {
        self.state
            .lock()
            .unwrap()
            .sessions
            .get(session_id)
            .is_some_and(|session| owner_visible(session.owner_user_id.as_str(), owner_user_id))
    }
}

fn owner_visible(session_owner: &str, owner_user_id: &OwnerId) -> bool {
    session_owner.is_empty() || session_owner == owner_user_id.as_str().trim()
}

fn persist_ui_state(
    persistence: Option<&dyn crate::ports::AssistantSessionPersistencePort>,
    session_id: &str,
    open: bool,
    entities: &[Entity],
) {
    let Some(persistence) = persistence else {
        return;
    };
    let json = serde_json::to_string(entities).unwrap_or_else(|_| "[]".into());
    if let Err(error) = persistence.set_ui_state(session_id, open, &json) {
        tracing::warn!(%error, "assistant: failed to persist panel state");
    }
}

fn persist_runtime(
    persistence: Option<&dyn crate::ports::AssistantSessionPersistencePort>,
    session_id: &str,
    session: &StoredSession,
) {
    let Some(persistence) = persistence else {
        return;
    };
    if let Err(error) = persistence.set_runtime(AssistantSessionRuntimeUpdate {
        id: session_id,
        endpoint_id: session.endpoint_id.as_deref(),
        model: session.model.as_deref(),
        allow_writes: session.allow_writes,
        playbook_mode: session.playbook_mode.as_config_str(),
    }) {
        tracing::warn!(%error, "assistant: failed to persist runtime selection");
    }
}

fn apply_runtime(session: &mut StoredSession, runtime: AssistantRuntimeSelection) {
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
        Role::ToolCall => "tool_call",
        Role::ToolResult => "tool_result",
    }
}

fn parse_role(role: &str) -> Role {
    match role {
        "assistant" => Role::Assistant,
        "tool_call" => Role::ToolCall,
        "tool_result" => Role::ToolResult,
        _ => Role::User,
    }
}

fn derive_title(content: &str) -> String {
    let plain = plain_mentions(content);
    let trimmed = plain.trim();
    let title: String = trimmed.chars().take(40).collect();
    if trimmed.chars().count() > 40 {
        format!("{title}…")
    } else {
        title
    }
}

fn plain_mentions(text: &str) -> String {
    const MARKERS: [&str; 2] = ["](vrcx-0://user/open?id=", "](vrcx-0://world/open?id="];
    let mut plain = String::with_capacity(text.len());
    let mut rest = text;
    while let Some((marker, marker_len)) = MARKERS
        .iter()
        .filter_map(|marker| rest.find(marker).map(|index| (index, marker.len())))
        .min()
    {
        let after = &rest[marker + marker_len..];
        match (rest[..marker].rfind("[@"), after.find(')')) {
            (Some(open), Some(close)) => {
                plain.push_str(&rest[..open]);
                plain.push_str(&rest[open + 1..marker]);
                rest = &after[close + 1..];
            }
            _ => {
                plain.push_str(&rest[..marker + marker_len]);
                rest = after;
            }
        }
    }
    plain.push_str(rest);
    plain
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
mod tests;
