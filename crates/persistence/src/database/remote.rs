use std::collections::HashMap;
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::mpsc::{self, SyncSender, TrySendError};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::Error;

use super::remote_server::{DatabaseRpcRequest, DatabaseRpcResponse};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(8);
const REQUEST_DEADLINE: Duration = Duration::from_secs(20);
const RETRY_DELAY: Duration = Duration::from_millis(250);
const REQUEST_QUEUE_CAPACITY: usize = 32;

const STATUS_DISCONNECTED: u8 = 0;
const STATUS_CONNECTED: u8 = 1;
const REQUEST_PENDING: u8 = 0;
const REQUEST_STARTED: u8 = 1;
const REQUEST_CANCELLED: u8 = 2;

/// Current authenticated reachability of a remote database endpoint.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[repr(u8)]
#[serde(rename_all = "snake_case")]
pub enum RemoteConnectionStatus {
    Disconnected = STATUS_DISCONNECTED,
    Connected = STATUS_CONNECTED,
}

impl RemoteConnectionStatus {
    fn from_atomic(value: u8) -> Self {
        if value == STATUS_CONNECTED {
            Self::Connected
        } else {
            Self::Disconnected
        }
    }
}

type RemoteResult = Result<DatabaseRpcResponse, Error>;

struct RemoteJob {
    request: DatabaseRpcRequest,
    response: SyncSender<RemoteResult>,
    deadline: Instant,
    start_state: Arc<AtomicU8>,
    cancel_requested: Arc<std::sync::atomic::AtomicBool>,
}

#[derive(Clone)]
pub(super) struct RemoteDatabaseClient {
    endpoint: String,
    sender: SyncSender<RemoteJob>,
    status: Arc<AtomicU8>,
}

pub(super) struct RemoteTransaction {
    client: RemoteDatabaseClient,
    id: String,
    active: bool,
}

impl RemoteDatabaseClient {
    pub(super) fn new(server_url: &str, token: &str) -> Result<Self, Error> {
        if token.trim().is_empty() {
            return Err(Error::Database(
                "Remote database token cannot be empty.".into(),
            ));
        }
        let base = server_url.trim_end_matches('/');
        if base.is_empty() {
            return Err(Error::Database(
                "Remote database URL cannot be empty.".into(),
            ));
        }
        let endpoint = if base.ends_with("/api/database") {
            base.to_owned()
        } else {
            format!("{base}/api/database")
        };
        let parsed = reqwest::Url::parse(&endpoint)
            .map_err(|error| Error::Database(format!("Remote database URL is invalid: {error}")))?;
        if !matches!(parsed.scheme(), "http" | "https")
            || parsed.host_str().is_none()
            || !parsed.username().is_empty()
            || parsed.password().is_some()
            || parsed.query().is_some()
            || parsed.fragment().is_some()
        {
            return Err(Error::Database(
                "Remote database URL must be an HTTP(S) address without credentials, query, or fragment.".into(),
            ));
        }
        let (sender, receiver) = mpsc::sync_channel::<RemoteJob>(REQUEST_QUEUE_CAPACITY);
        let worker_endpoint = endpoint.clone();
        let worker_token = token.to_owned();
        let status = Arc::new(AtomicU8::new(STATUS_DISCONNECTED));
        let worker_status = Arc::clone(&status);
        thread::Builder::new()
            .name("remote-database-rpc".into())
            .spawn(move || {
                let runtime = match tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                {
                    Ok(runtime) => runtime,
                    Err(error) => {
                        while let Ok(job) = receiver.recv() {
                            let _ = job.response.send(Err(Error::Database(format!(
                                "Could not initialize remote database client: {error}"
                            ))));
                        }
                        return;
                    }
                };
                let client = match reqwest::Client::builder()
                    .timeout(REQUEST_TIMEOUT)
                    .connect_timeout(Duration::from_secs(4))
                    .redirect(reqwest::redirect::Policy::none())
                    .build()
                {
                    Ok(client) => client,
                    Err(error) => {
                        while let Ok(job) = receiver.recv() {
                            let _ = job.response.send(Err(Error::Database(format!(
                                "Could not initialize remote database client: {error}"
                            ))));
                        }
                        return;
                    }
                };
                while let Ok(job) = receiver.recv() {
                    let RemoteJob {
                        request,
                        response,
                        deadline,
                        start_state,
                        cancel_requested,
                    } = job;
                    if Instant::now() >= deadline
                        || start_state
                            .compare_exchange(
                                REQUEST_PENDING,
                                REQUEST_STARTED,
                                Ordering::AcqRel,
                                Ordering::Acquire,
                            )
                            .is_err()
                    {
                        let _ = response.send(Err(Error::Database(
                            "Remote database request was cancelled or expired in the local queue."
                                .into(),
                        )));
                        continue;
                    }

                    let retry_safe = matches!(
                        &request,
                        DatabaseRpcRequest::Read {
                            transaction_id: None,
                            ..
                        }
                    );
                    let mut attempts = 0;
                    loop {
                        let remaining = deadline.saturating_duration_since(Instant::now());
                        if remaining.is_zero() {
                            let _ = response.send(Err(Error::Database(
                                "Remote database request expired before it started.".into(),
                            )));
                            break;
                        }
                        let result = runtime.block_on(send_request(
                            &client,
                            &worker_endpoint,
                            &worker_token,
                            &request,
                            REQUEST_TIMEOUT.min(remaining),
                        ));
                        match result {
                            Ok(response_body) => {
                                worker_status.store(STATUS_CONNECTED, Ordering::Release);
                                let _ = response.send(Ok(response_body));
                                break;
                            }
                            Err(failure) => {
                                match failure.connection_effect {
                                    ConnectionEffect::Connected => {
                                        worker_status.store(STATUS_CONNECTED, Ordering::Release)
                                    }
                                    ConnectionEffect::Disconnected => {
                                        worker_status.store(STATUS_DISCONNECTED, Ordering::Release)
                                    }
                                    ConnectionEffect::Unchanged => {}
                                }
                                if retry_safe
                                    && failure.retryable
                                    && attempts == 0
                                    && !cancel_requested.load(Ordering::Acquire)
                                    && Instant::now() + RETRY_DELAY < deadline
                                {
                                    attempts += 1;
                                    thread::sleep(RETRY_DELAY);
                                    continue;
                                }
                                let _ = response.send(Err(failure.error));
                                break;
                            }
                        }
                    }
                }
            })
            .map_err(|error| {
                Error::Database(format!("Could not start remote database worker: {error}"))
            })?;
        let remote = Self {
            endpoint,
            sender,
            status,
        };
        remote.check_connection()?;
        Ok(remote)
    }

    pub(super) fn endpoint(&self) -> &str {
        &self.endpoint
    }

    pub(super) fn connection_status(&self) -> RemoteConnectionStatus {
        RemoteConnectionStatus::from_atomic(self.status.load(Ordering::Acquire))
    }

    pub(super) fn check_connection(&self) -> Result<(), Error> {
        let rows = self.read("SELECT 1", &HashMap::new(), None)?;
        if rows.first().and_then(|row| row.first()) != Some(&Value::from(1)) {
            self.status.store(STATUS_DISCONNECTED, Ordering::Release);
            return Err(Error::Database(
                "Remote database connection probe returned an unexpected result.".into(),
            ));
        }
        Ok(())
    }

    fn request(&self, request: DatabaseRpcRequest) -> RemoteResult {
        let write_outcome_may_be_unknown = matches!(
            &request,
            DatabaseRpcRequest::Execute { .. } | DatabaseRpcRequest::Commit { .. }
        );
        let (response, receiver) = mpsc::sync_channel(1);
        let start_state = Arc::new(AtomicU8::new(REQUEST_PENDING));
        let cancel_requested = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let job = RemoteJob {
            request,
            response,
            deadline: Instant::now() + REQUEST_DEADLINE,
            start_state: Arc::clone(&start_state),
            cancel_requested: Arc::clone(&cancel_requested),
        };
        match self.sender.try_send(job) {
            Ok(()) => {}
            Err(TrySendError::Full(_)) => {
                return Err(Error::Database(
                    "Remote database request queue is full; try again shortly.".into(),
                ));
            }
            Err(TrySendError::Disconnected(_)) => {
                self.status.store(STATUS_DISCONNECTED, Ordering::Release);
                return Err(Error::Database("Remote database worker stopped.".into()));
            }
        }
        match receiver.recv_timeout(REQUEST_DEADLINE) {
            Ok(result) => result,
            Err(mpsc::RecvTimeoutError::Timeout) => {
                cancel_requested.store(true, Ordering::Release);
                let _ = start_state.compare_exchange(
                    REQUEST_PENDING,
                    REQUEST_CANCELLED,
                    Ordering::AcqRel,
                    Ordering::Acquire,
                );
                self.status.store(STATUS_DISCONNECTED, Ordering::Release);
                Err(Error::Database(if write_outcome_may_be_unknown {
                    "Remote database request timed out; write outcome may be unknown.".into()
                } else {
                    "Remote database request timed out.".into()
                }))
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                self.status.store(STATUS_DISCONNECTED, Ordering::Release);
                Err(Error::Database("Remote database worker stopped.".into()))
            }
        }
    }

    pub(super) fn read(
        &self,
        sql: &str,
        args: &HashMap<String, Value>,
        transaction_id: Option<&str>,
    ) -> Result<Vec<Vec<Value>>, Error> {
        match self.request(DatabaseRpcRequest::Read {
            sql: sql.to_owned(),
            args: args.clone(),
            transaction_id: transaction_id.map(str::to_owned),
        })? {
            DatabaseRpcResponse::Rows(rows) => Ok(rows),
            response => Err(unexpected_response("read rows", response)),
        }
    }

    pub(super) fn execute(
        &self,
        sql: &str,
        args: &HashMap<String, Value>,
        transaction_id: Option<&str>,
    ) -> Result<i64, Error> {
        match self.request(DatabaseRpcRequest::Execute {
            sql: sql.to_owned(),
            args: args.clone(),
            transaction_id: transaction_id.map(str::to_owned),
        })? {
            DatabaseRpcResponse::Affected(count) => Ok(count),
            response => Err(unexpected_response("affected row count", response)),
        }
    }

    pub(super) fn begin(&self) -> Result<RemoteTransaction, Error> {
        let id = match self.request(DatabaseRpcRequest::Begin)? {
            DatabaseRpcResponse::Transaction(id) => id,
            response => return Err(unexpected_response("transaction id", response)),
        };
        Ok(RemoteTransaction {
            client: self.clone(),
            id,
            active: true,
        })
    }
}

impl RemoteTransaction {
    pub(super) fn read(
        &self,
        sql: &str,
        args: &HashMap<String, Value>,
    ) -> Result<Vec<Vec<Value>>, Error> {
        self.client.read(sql, args, Some(&self.id))
    }

    pub(super) fn execute(&self, sql: &str, args: &HashMap<String, Value>) -> Result<i64, Error> {
        self.client.execute(sql, args, Some(&self.id))
    }

    pub(super) fn commit(&mut self) -> Result<(), Error> {
        // Once a commit request has been sent, its outcome may be ambiguous. Do not
        // follow a lost acknowledgment with another write request; the server expires
        // any still-open session and rolls it back.
        self.active = false;
        let response = self.client.request(DatabaseRpcRequest::Commit {
            transaction_id: self.id.clone(),
        });
        match response {
            Err(error) => Err(Error::Database(format!(
                "Remote database commit outcome is unknown; do not automatically replay this transaction. {error}"
            ))),
            Ok(DatabaseRpcResponse::Done) => {
                self.active = false;
                Ok(())
            }
            Ok(response) => Err(unexpected_response("commit completion", response)),
        }
    }

    pub(super) fn rollback(&mut self) {
        if self.active {
            let _ = self.client.request(DatabaseRpcRequest::Rollback {
                transaction_id: self.id.clone(),
            });
            self.active = false;
        }
    }
}

#[derive(Clone, Copy)]
enum ConnectionEffect {
    Connected,
    Disconnected,
    Unchanged,
}

struct RequestFailure {
    error: Error,
    connection_effect: ConnectionEffect,
    retryable: bool,
}

async fn send_request(
    client: &reqwest::Client,
    endpoint: &str,
    token: &str,
    request: &DatabaseRpcRequest,
    timeout: Duration,
) -> Result<DatabaseRpcResponse, RequestFailure> {
    let body = serde_json::to_vec(request).map_err(|error| RequestFailure {
        error: Error::Json(error),
        connection_effect: ConnectionEffect::Unchanged,
        retryable: false,
    })?;
    let response = client
        .post(endpoint)
        .bearer_auth(token)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(body)
        .timeout(timeout)
        .send()
        .await
        .map_err(|error| RequestFailure {
            error: Error::Database(format!("Remote database request failed: {error}")),
            connection_effect: ConnectionEffect::Disconnected,
            retryable: true,
        })?;
    let status = response.status();
    let bytes = response.bytes().await.map_err(|error| RequestFailure {
        error: Error::Database(format!("Could not read remote database response: {error}")),
        connection_effect: ConnectionEffect::Disconnected,
        retryable: true,
    })?;
    if !status.is_success() {
        let disconnected = status == reqwest::StatusCode::UNAUTHORIZED
            || status == reqwest::StatusCode::FORBIDDEN
            || status == reqwest::StatusCode::NOT_FOUND
            || status.is_server_error();
        let retryable = status.is_server_error()
            || status == reqwest::StatusCode::REQUEST_TIMEOUT
            || status == reqwest::StatusCode::TOO_MANY_REQUESTS;
        let body = String::from_utf8_lossy(&bytes);
        return Err(RequestFailure {
            error: Error::Database(format!(
                "Remote database returned HTTP {status}: {}",
                body.chars().take(1024).collect::<String>()
            )),
            connection_effect: if disconnected {
                ConnectionEffect::Disconnected
            } else {
                ConnectionEffect::Connected
            },
            retryable,
        });
    }
    serde_json::from_slice(&bytes).map_err(|error| RequestFailure {
        error: Error::Json(error),
        connection_effect: ConnectionEffect::Connected,
        retryable: false,
    })
}

fn unexpected_response(expected: &str, actual: DatabaseRpcResponse) -> Error {
    Error::Database(format!(
        "Remote database returned {actual:?} while expecting {expected}."
    ))
}
