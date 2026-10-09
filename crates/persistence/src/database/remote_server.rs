use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, Weak};
use std::time::{Duration, Instant};

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::Error;

use super::service::{
    execute_non_query_on_connection, execute_on_connection, open_remote_transaction_connection,
};
use super::DatabaseService;

const SESSION_IDLE_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_SESSIONS: usize = 32;

/// JSON request body used by the authenticated `POST /api/database` endpoint.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "operation", rename_all = "snake_case")]
pub enum DatabaseRpcRequest {
    Read {
        sql: String,
        #[serde(default)]
        args: HashMap<String, Value>,
        #[serde(default)]
        transaction_id: Option<String>,
    },
    Execute {
        sql: String,
        #[serde(default)]
        args: HashMap<String, Value>,
        #[serde(default)]
        transaction_id: Option<String>,
    },
    Begin,
    Commit {
        transaction_id: String,
    },
    Rollback {
        transaction_id: String,
    },
}

/// JSON response body returned by the authenticated database endpoint.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum DatabaseRpcResponse {
    Rows(Vec<Vec<Value>>),
    Affected(i64),
    Transaction(String),
    Done,
}

pub(super) struct RemoteDatabaseServer {
    db_path: PathBuf,
    sessions: Arc<Mutex<HashMap<String, RemoteSession>>>,
    cleaner_started: AtomicBool,
}

struct RemoteSession {
    connection: Connection,
    last_used: Instant,
}

impl RemoteDatabaseServer {
    pub(super) fn new(db_path: PathBuf) -> Self {
        Self {
            db_path,
            sessions: Arc::new(Mutex::new(HashMap::new())),
            cleaner_started: AtomicBool::new(false),
        }
    }

    pub(super) fn handle(
        &self,
        database: &DatabaseService,
        request: DatabaseRpcRequest,
    ) -> Result<DatabaseRpcResponse, Error> {
        self.start_cleaner();

        match request {
            DatabaseRpcRequest::Read {
                sql,
                args,
                transaction_id: Some(id),
            } => {
                let mut sessions = self
                    .sessions
                    .lock()
                    .map_err(|error| Error::Database(error.to_string()))?;
                expire_sessions(&mut sessions);
                let session = session_mut(&mut sessions, &id)?;
                session.last_used = Instant::now();
                Ok(DatabaseRpcResponse::Rows(execute_on_connection(
                    &session.connection,
                    &sql,
                    &args,
                )?))
            }
            DatabaseRpcRequest::Execute {
                sql,
                args,
                transaction_id: Some(id),
            } => {
                let mut sessions = self
                    .sessions
                    .lock()
                    .map_err(|error| Error::Database(error.to_string()))?;
                expire_sessions(&mut sessions);
                let session = session_mut(&mut sessions, &id)?;
                session.last_used = Instant::now();
                let affected = execute_non_query_on_connection(&session.connection, &sql, &args)?;
                database.bump_config_generation();
                Ok(DatabaseRpcResponse::Affected(affected))
            }
            DatabaseRpcRequest::Read {
                sql,
                args,
                transaction_id: None,
            } => Ok(DatabaseRpcResponse::Rows(database.execute(&sql, &args)?)),
            DatabaseRpcRequest::Execute {
                sql,
                args,
                transaction_id: None,
            } => {
                let affected = database.execute_non_query(&sql, &args)?;
                database.bump_config_generation();
                Ok(DatabaseRpcResponse::Affected(affected))
            }
            DatabaseRpcRequest::Begin => {
                let connection = open_remote_transaction_connection(&self.db_path)?;
                connection
                    .execute_batch("BEGIN IMMEDIATE")
                    .map_err(Error::sqlite)?;
                let mut sessions = self
                    .sessions
                    .lock()
                    .map_err(|error| Error::Database(error.to_string()))?;
                expire_sessions(&mut sessions);
                if sessions.len() >= MAX_SESSIONS {
                    let _ = connection.execute_batch("ROLLBACK");
                    return Err(Error::Database(
                        "Too many remote database transactions are active.".into(),
                    ));
                }
                let id = Uuid::new_v4().to_string();
                sessions.insert(
                    id.clone(),
                    RemoteSession {
                        connection,
                        last_used: Instant::now(),
                    },
                );
                Ok(DatabaseRpcResponse::Transaction(id))
            }
            DatabaseRpcRequest::Commit { transaction_id } => {
                let session = {
                    let mut sessions = self
                        .sessions
                        .lock()
                        .map_err(|error| Error::Database(error.to_string()))?;
                    expire_sessions(&mut sessions);
                    sessions.remove(&transaction_id).ok_or_else(|| {
                        Error::Database(
                            "Remote database transaction expired or was not found.".into(),
                        )
                    })?
                };
                session
                    .connection
                    .execute_batch("COMMIT")
                    .map_err(Error::sqlite)?;
                database.bump_config_generation();
                Ok(DatabaseRpcResponse::Done)
            }
            DatabaseRpcRequest::Rollback { transaction_id } => {
                let session = {
                    let mut sessions = self
                        .sessions
                        .lock()
                        .map_err(|error| Error::Database(error.to_string()))?;
                    expire_sessions(&mut sessions);
                    sessions.remove(&transaction_id)
                };
                if let Some(session) = session {
                    session
                        .connection
                        .execute_batch("ROLLBACK")
                        .map_err(Error::sqlite)?;
                }
                Ok(DatabaseRpcResponse::Done)
            }
        }
    }

    pub(super) fn expire(&self) -> usize {
        let Ok(mut sessions) = self.sessions.lock() else {
            return 0;
        };
        let before = sessions.len();
        expire_sessions(&mut sessions);
        before - sessions.len()
    }

    fn start_cleaner(&self) {
        if self.cleaner_started.swap(true, Ordering::AcqRel) {
            return;
        }
        let weak_sessions: Weak<Mutex<HashMap<String, RemoteSession>>> =
            Arc::downgrade(&self.sessions);
        if std::thread::Builder::new()
            .name("remote-database-session-cleanup".into())
            .spawn(move || loop {
                std::thread::sleep(Duration::from_secs(1));
                let Some(sessions) = weak_sessions.upgrade() else {
                    break;
                };
                if let Ok(mut sessions) = sessions.lock() {
                    expire_sessions(&mut sessions);
                };
            })
            .is_err()
        {
            self.cleaner_started.store(false, Ordering::Release);
        }
    }
}

fn expire_sessions(sessions: &mut HashMap<String, RemoteSession>) {
    sessions.retain(|_, session| session.last_used.elapsed() <= SESSION_IDLE_TIMEOUT);
}

fn session_mut<'a>(
    sessions: &'a mut HashMap<String, RemoteSession>,
    id: &str,
) -> Result<&'a mut RemoteSession, Error> {
    sessions.get_mut(id).ok_or_else(|| {
        Error::Database("Remote database transaction expired or was not found.".into())
    })
}
