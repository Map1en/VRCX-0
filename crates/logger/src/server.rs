use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::{FromRequest, Request, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::Utc;
use serde::de::DeserializeOwned;
use serde::Serialize;
use vrcx_0_logger_protocol::envelope::{
    open_request, seal_response, Nonce, PROTOCOL_HEADER, TIMESTAMP_HEADER,
};
use vrcx_0_logger_protocol::wire::{
    AckRequest, CredentialsRequest, DeviceLoginRequest, ErrorResponse, FramesRequest,
    FramesResponse, HelloResponse, OkResponse, PresenceRequest, PresenceResponse, TwoFactorRequest,
    WebhookRequest, CAPTURE_FORMAT_VERSION, MIN_CLIENT_PROTOCOL_VERSION, PROTOCOL_VERSION,
};

use crate::app::{now_unix, App, LOGGER_VERSION};

pub fn router(app: Arc<App>) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/hello", get(hello))
        .route("/status", post(status))
        .route("/credentials", post(credentials))
        .route("/two-factor", post(two_factor))
        .route("/device-login", post(device_login))
        .route("/device-login-cancel", post(device_login_cancel))
        .route("/presence", post(presence))
        .route("/unpair", post(unpair))
        .route("/webhook", post(webhook))
        .route("/webhook-test", post(webhook_test))
        .route("/frames", post(frames))
        .route("/ack", post(ack))
        .with_state(app)
}

struct Rejection(Box<Response>);

impl IntoResponse for Rejection {
    fn into_response(self) -> Response {
        *self.0
    }
}

impl From<Response> for Rejection {
    fn from(response: Response) -> Self {
        Self(Box::new(response))
    }
}

struct Opened<T>(T, Nonce);

impl<T: DeserializeOwned> FromRequest<Arc<App>> for Opened<T> {
    type Rejection = Rejection;

    async fn from_request(request: Request, app: &Arc<App>) -> Result<Self, Rejection> {
        let path = request.uri().path().to_owned();
        let headers = request.headers().clone();
        let body = Bytes::from_request(request, app)
            .await
            .map_err(|rejection| Rejection::from(rejection.into_response()))?;
        open(app, &path, &headers, &body)
    }
}

async fn health(State(app): State<Arc<App>>) -> StatusCode {
    match app.store.last_seq() {
        Ok(_) => StatusCode::OK,
        Err(_) => StatusCode::SERVICE_UNAVAILABLE,
    }
}

async fn hello() -> Json<HelloResponse> {
    Json(HelloResponse {
        protocol_version: PROTOCOL_VERSION,
        min_client_protocol_version: MIN_CLIENT_PROTOCOL_VERSION,
        capture_format_version: CAPTURE_FORMAT_VERSION,
        logger_version: LOGGER_VERSION.to_string(),
        server_time: now_unix(),
    })
}

async fn status(
    State(app): State<Arc<App>>,
    Opened(OkResponse {}, nonce): Opened<OkResponse>,
) -> Response {
    match app.status() {
        Ok(status) => seal(&app, &nonce, StatusCode::OK, &status),
        Err(error) => {
            tracing::error!(error = %error, "failed to read logger status");
            internal_error(&app, &nonce)
        }
    }
}

async fn credentials(
    State(app): State<Arc<App>>,
    Opened(request, nonce): Opened<CredentialsRequest>,
) -> Response {
    match app.session.set_credentials(request).await {
        Ok(state) => seal(&app, &nonce, StatusCode::OK, &state),
        Err(message) => seal_error(&app, &nonce, StatusCode::BAD_REQUEST, &message),
    }
}

async fn two_factor(
    State(app): State<Arc<App>>,
    Opened(request, nonce): Opened<TwoFactorRequest>,
) -> Response {
    match app.session.two_factor(request).await {
        Ok(state) => seal(&app, &nonce, StatusCode::OK, &state),
        Err(message) => seal_error(&app, &nonce, StatusCode::CONFLICT, &message),
    }
}

async fn device_login(
    State(app): State<Arc<App>>,
    Opened(request, nonce): Opened<DeviceLoginRequest>,
) -> Response {
    match app.session.start_device_login(request).await {
        Ok(state) => seal(&app, &nonce, StatusCode::OK, &state),
        Err(message) => seal_error(&app, &nonce, StatusCode::BAD_REQUEST, &message),
    }
}

async fn device_login_cancel(
    State(app): State<Arc<App>>,
    Opened(OkResponse {}, nonce): Opened<OkResponse>,
) -> Response {
    if app.session.cancel_device_login().await {
        seal(&app, &nonce, StatusCode::OK, &OkResponse {})
    } else {
        internal_error(&app, &nonce)
    }
}

async fn presence(
    State(app): State<Arc<App>>,
    Opened(request, nonce): Opened<PresenceRequest>,
) -> Response {
    app.profile_scan
        .configure(request.profile_scan, request.profile_checks);
    let resumed = if request.leaving {
        app.presence.leave(&request.account_id);
        false
    } else {
        app.presence.touch(request.account_id)
    };
    seal(
        &app,
        &nonce,
        StatusCode::OK,
        &PresenceResponse {
            server_time_ms: Utc::now().timestamp_millis(),
            resumed,
        },
    )
}

async fn unpair(
    State(app): State<Arc<App>>,
    Opened(OkResponse {}, nonce): Opened<OkResponse>,
) -> Response {
    if app.session.unpair().await {
        seal(&app, &nonce, StatusCode::OK, &OkResponse {})
    } else {
        internal_error(&app, &nonce)
    }
}

async fn webhook(
    State(app): State<Arc<App>>,
    Opened(request, nonce): Opened<WebhookRequest>,
) -> Response {
    match app.notifier.configure(request) {
        Ok(()) => seal(&app, &nonce, StatusCode::OK, &OkResponse {}),
        Err(message) => seal_error(&app, &nonce, StatusCode::BAD_REQUEST, &message),
    }
}

async fn webhook_test(
    State(app): State<Arc<App>>,
    Opened(OkResponse {}, nonce): Opened<OkResponse>,
) -> Response {
    match app.notifier.send_test().await {
        Ok(()) => seal(&app, &nonce, StatusCode::OK, &OkResponse {}),
        Err(message) => seal_error(&app, &nonce, StatusCode::BAD_GATEWAY, &message),
    }
}

async fn frames(
    State(app): State<Arc<App>>,
    Opened(request, nonce): Opened<FramesRequest>,
) -> Response {
    app.record_pull();
    match app
        .store
        .frames_after(&request.account_id, request.after, request.limit)
    {
        Ok((frames, has_more)) => seal(
            &app,
            &nonce,
            StatusCode::OK,
            &FramesResponse { frames, has_more },
        ),
        Err(error) => {
            tracing::error!(error = %error, "failed to read frames");
            internal_error(&app, &nonce)
        }
    }
}

async fn ack(State(app): State<Arc<App>>, Opened(request, nonce): Opened<AckRequest>) -> Response {
    match app.store.ack(&request.account_id, request.up_to) {
        Ok(()) => seal(&app, &nonce, StatusCode::OK, &OkResponse {}),
        Err(error) => {
            tracing::error!(error = %error, "failed to acknowledge frames");
            internal_error(&app, &nonce)
        }
    }
}

fn open<T: DeserializeOwned>(
    app: &App,
    path: &str,
    headers: &HeaderMap,
    body: &[u8],
) -> Result<Opened<T>, Rejection> {
    let protocol =
        header_value(headers, PROTOCOL_HEADER).and_then(|value| value.parse::<u32>().ok());
    if protocol.is_none_or(|version| version < MIN_CLIENT_PROTOCOL_VERSION) {
        return Err((
            StatusCode::UPGRADE_REQUIRED,
            Json(ErrorResponse {
                message: format!(
                    "this logger requires client protocol {MIN_CLIENT_PROTOCOL_VERSION} or newer"
                ),
            }),
        )
            .into_response()
            .into());
    }

    let Some(timestamp) =
        header_value(headers, TIMESTAMP_HEADER).and_then(|value| value.parse::<i64>().ok())
    else {
        return Err(StatusCode::UNAUTHORIZED.into_response().into());
    };
    let now = now_unix();
    let opened =
        open_request(&app.transport_key, "POST", path, timestamp, now, body).map_err(|error| {
            tracing::debug!(error = %error, path, "rejected logger request");
            Rejection::from(StatusCode::UNAUTHORIZED.into_response())
        })?;
    if !app.accept_request(opened.nonce, timestamp, now) {
        tracing::debug!(path, "rejected a replayed or pre-start logger request");
        return Err(StatusCode::UNAUTHORIZED.into_response().into());
    }

    serde_json::from_slice::<T>(&opened.plaintext)
        .map(|request| Opened(request, opened.nonce))
        .map_err(|error| {
            seal_error(
                app,
                &opened.nonce,
                StatusCode::BAD_REQUEST,
                &error.to_string(),
            )
            .into()
        })
}

fn seal<T: Serialize>(app: &App, nonce: &Nonce, status: StatusCode, value: &T) -> Response {
    let sealed = serde_json::to_vec(value)
        .ok()
        .and_then(|json| seal_response(&app.transport_key, nonce, &json).ok());
    match sealed {
        Some(sealed) => (
            status,
            [(header::CONTENT_TYPE, "application/octet-stream")],
            sealed,
        )
            .into_response(),
        None => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

fn seal_error(app: &App, nonce: &Nonce, status: StatusCode, message: &str) -> Response {
    seal(
        app,
        nonce,
        status,
        &ErrorResponse {
            message: message.to_string(),
        },
    )
}

fn internal_error(app: &App, nonce: &Nonce) -> Response {
    seal_error(
        app,
        nonce,
        StatusCode::INTERNAL_SERVER_ERROR,
        "logger internal error",
    )
}

fn header_value<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers.get(name).and_then(|value| value.to_str().ok())
}

#[cfg(test)]
mod tests {
    mod desktop_connection {
        use axum::body::Body;
        use axum::http::{Request, StatusCode};
        use tower::ServiceExt;
        use vrcx_0_logger_protocol::envelope::{
            open_response, SecretKey, MAX_CLOCK_SKEW_SECS, PROTOCOL_HEADER,
        };
        use vrcx_0_logger_protocol::wire::{
            OkResponse, SessionState, StatusResponse, PROTOCOL_VERSION,
        };

        use crate::app::now_unix;
        use crate::server::router;
        use crate::test_support::{fresh_app, presence, Desktop, ACCOUNT};

        const OTHER_PASSWORD: &str = "some other long password";

        #[tokio::test]
        async fn a_desktop_that_knows_the_password_can_read_the_recorder_status() {
            let desktop = Desktop::new(&fresh_app());

            let status = desktop.status().await;

            assert_eq!(status.protocol_version, PROTOCOL_VERSION);
            assert_eq!(status.session, SessionState::NoCredentials);
        }

        #[tokio::test]
        async fn a_desktop_with_the_wrong_password_is_told_the_password_is_incorrect() {
            let stranger = Desktop::with_password(&fresh_app(), OTHER_PASSWORD);

            let reply = stranger
                .send(&stranger.seal("/status", &OkResponse {}))
                .await;

            assert_eq!(reply.status, StatusCode::UNAUTHORIZED);
        }

        #[tokio::test]
        async fn someone_without_the_password_cannot_read_the_answer() {
            let desktop = Desktop::new(&fresh_app());
            let sealed = desktop.seal("/status", &OkResponse {});

            let reply = desktop.send(&sealed).await;

            let eavesdropper = SecretKey::transport(OTHER_PASSWORD).unwrap();
            assert_eq!(reply.status, StatusCode::OK);
            assert!(open_response(&eavesdropper, &sealed.nonce, &reply.body).is_err());
        }

        #[tokio::test]
        async fn a_captured_request_cannot_be_replayed() {
            let desktop = Desktop::new(&fresh_app());
            let sealed = desktop.seal("/status", &OkResponse {});

            let first = desktop.send(&sealed).await;
            let replay = desktop.send(&sealed).await;

            assert_eq!(first.status, StatusCode::OK);
            assert_eq!(replay.status, StatusCode::UNAUTHORIZED);
        }

        #[tokio::test]
        async fn a_captured_request_cannot_be_redirected_to_another_action() {
            let desktop = Desktop::new(&fresh_app());
            let sealed = desktop.seal("/presence", &presence(ACCOUNT, true, false));

            let redirected = desktop
                .post("/unpair", sealed.timestamp, sealed.body.clone())
                .await;

            assert_eq!(redirected.status, StatusCode::UNAUTHORIZED);
        }

        #[tokio::test]
        async fn a_captured_request_cannot_be_moved_to_another_time() {
            let desktop = Desktop::new(&fresh_app());
            let sealed = desktop.seal("/status", &OkResponse {});

            let moved = desktop
                .post("/status", sealed.timestamp + 1, sealed.body.clone())
                .await;

            assert_eq!(moved.status, StatusCode::UNAUTHORIZED);
        }

        #[tokio::test]
        async fn a_tampered_request_is_refused() {
            let desktop = Desktop::new(&fresh_app());
            let mut sealed = desktop.seal("/status", &OkResponse {});
            let last = sealed.body.len() - 1;
            sealed.body[last] ^= 1;

            assert_eq!(desktop.send(&sealed).await.status, StatusCode::UNAUTHORIZED);
        }

        #[tokio::test]
        async fn requests_sealed_before_the_recorder_started_are_refused() {
            let desktop = Desktop::new(&fresh_app());
            let sealed = desktop.seal_at("/status", now_unix() - 60, &OkResponse {});

            assert_eq!(desktop.send(&sealed).await.status, StatusCode::UNAUTHORIZED);
        }

        #[tokio::test]
        async fn a_desktop_clock_a_little_ahead_is_still_accepted() {
            let desktop = Desktop::new(&fresh_app());
            let sealed = desktop.seal_at("/status", now_unix() + 120, &OkResponse {});

            assert_eq!(desktop.send(&sealed).await.status, StatusCode::OK);
        }

        #[tokio::test]
        async fn a_stale_request_from_a_clock_too_far_off_is_refused() {
            let desktop = Desktop::new(&fresh_app());
            let sealed = desktop.seal_at(
                "/status",
                now_unix() + MAX_CLOCK_SKEW_SECS + 60,
                &OkResponse {},
            );

            assert_eq!(desktop.send(&sealed).await.status, StatusCode::UNAUTHORIZED);
        }

        #[tokio::test]
        async fn an_absurd_timestamp_is_refused_and_the_recorder_keeps_answering() {
            let desktop = Desktop::new(&fresh_app());
            let sealed = desktop.seal_at("/status", i64::MIN, &OkResponse {});

            assert_eq!(desktop.send(&sealed).await.status, StatusCode::UNAUTHORIZED);
            assert_eq!(desktop.status().await.protocol_version, PROTOCOL_VERSION);
        }

        #[tokio::test]
        async fn a_response_only_opens_for_the_request_it_answers() {
            let desktop = Desktop::new(&fresh_app());
            let answered = desktop.seal("/status", &OkResponse {});
            let unrelated = desktop.seal("/status", &OkResponse {});

            let reply = desktop.send(&answered).await;

            let status: StatusResponse = desktop.read(&answered, &reply);
            assert_eq!(status.protocol_version, PROTOCOL_VERSION);
            assert!(desktop.try_read(&unrelated, &reply).is_err());
        }

        #[tokio::test]
        async fn an_outdated_desktop_is_told_to_update() {
            let request = Request::post("/status")
                .header(PROTOCOL_HEADER, "0")
                .body(Body::empty())
                .unwrap();

            let response = router(fresh_app()).oneshot(request).await.unwrap();

            assert_eq!(response.status(), StatusCode::UPGRADE_REQUIRED);
        }
    }

    mod desktop_presence {
        use chrono::Utc;

        use crate::test_support::{fresh_app, presence, Desktop, ACCOUNT, OTHER_ACCOUNT};

        #[tokio::test]
        async fn every_presence_reply_carries_the_recorder_clock_in_milliseconds() {
            let desktop = Desktop::new(&fresh_app());

            for leaving in [false, true] {
                let before = Utc::now().timestamp_millis();
                let reply = desktop
                    .report_presence(presence(ACCOUNT, leaving, false))
                    .await;
                let after = Utc::now().timestamp_millis();

                assert!((before..=after).contains(&reply.server_time_ms));
            }
        }

        #[tokio::test]
        async fn a_heartbeat_says_whether_it_brings_the_desktop_back() {
            let desktop = Desktop::new(&fresh_app());
            let heartbeat = || desktop.report_presence(presence(ACCOUNT, false, false));

            assert!(heartbeat().await.resumed);
            assert!(!heartbeat().await.resumed);

            let leave = desktop
                .report_presence(presence(ACCOUNT, true, false))
                .await;
            assert!(!leave.resumed);
            assert!(heartbeat().await.resumed);
        }

        #[tokio::test]
        async fn another_accounts_heartbeat_does_not_count_as_this_desktop_being_back() {
            let desktop = Desktop::new(&fresh_app());

            let other = desktop
                .report_presence(presence(OTHER_ACCOUNT, false, false))
                .await;
            let own = desktop
                .report_presence(presence(ACCOUNT, false, false))
                .await;

            assert!(other.resumed);
            assert!(own.resumed);
        }
    }

    mod pulling_records {
        use crate::test_support::{
            at, fresh_app, record, record_for, sign_in, Desktop, ACCOUNT, OTHER_ACCOUNT,
        };

        #[tokio::test]
        async fn the_desktop_pulls_records_in_recording_order_one_page_at_a_time() {
            let app = fresh_app();
            for (second, payload) in [(100, "first"), (101, "second"), (102, "third")] {
                record(&app.store, at(second), payload);
            }
            let desktop = Desktop::new(&app);

            let page = desktop.pull(0, 2).await;
            assert!(page.has_more);
            let payloads: Vec<&str> = page
                .frames
                .iter()
                .map(|frame| frame.payload.as_str())
                .collect();
            assert_eq!(payloads, ["first", "second"]);
            assert_eq!(page.frames[0].received_at, at(100).to_rfc3339());
            assert_eq!(page.frames[0].account_id, ACCOUNT);

            let page = desktop.pull(page.frames[1].seq, 2).await;
            assert!(!page.has_more);
            let payloads: Vec<&str> = page
                .frames
                .iter()
                .map(|frame| frame.payload.as_str())
                .collect();
            assert_eq!(payloads, ["third"]);
            assert!(desktop.status().await.last_pull_at.is_some());
        }

        #[tokio::test]
        async fn acknowledged_records_are_removed_from_the_recorder() {
            let app = fresh_app();
            sign_in(&app, ACCOUNT);
            record(&app.store, at(100), "synced");
            record(&app.store, at(101), "not yet synced");
            let desktop = Desktop::new(&app);
            let synced = desktop.pull(0, 1).await.frames[0].seq;

            desktop.acknowledge(ACCOUNT, synced).await;

            let remaining = desktop.pull_all().await;
            assert_eq!(remaining.len(), 1);
            assert_eq!(remaining[0].payload, "not yet synced");
            assert_eq!(desktop.status().await.unsynced_frames, 1);
        }

        #[tokio::test]
        async fn a_record_captured_after_an_acknowledgement_is_still_delivered() {
            let app = fresh_app();
            let desktop = Desktop::new(&app);
            record(&app.store, at(100), "synced");
            let synced = desktop.pull(0, 10).await.frames[0].seq;
            desktop.acknowledge(ACCOUNT, synced).await;

            record(&app.store, at(101), "captured later");

            let page = desktop.pull(synced, 10).await;
            let payloads: Vec<&str> = page
                .frames
                .iter()
                .map(|frame| frame.payload.as_str())
                .collect();
            assert_eq!(payloads, ["captured later"]);
        }

        #[tokio::test]
        async fn another_accounts_records_are_neither_pulled_nor_removed_by_an_acknowledgement() {
            let app = fresh_app();
            let own = record(&app.store, at(100), "own");
            record_for(&app.store, OTHER_ACCOUNT, at(101), "other");
            let desktop = Desktop::new(&app);

            let pulled = desktop.pull_all().await;
            assert_eq!(pulled.len(), 1);
            assert_eq!(pulled[0].payload, "own");

            desktop.acknowledge(ACCOUNT, own + 1).await;

            assert!(desktop.pull_all().await.is_empty());
            let others = desktop.pull_account(OTHER_ACCOUNT, 0, 10).await.frames;
            assert_eq!(others.len(), 1);
            assert_eq!(others[0].payload, "other");
            assert_eq!(others[0].account_id, OTHER_ACCOUNT);
        }

        #[tokio::test]
        async fn the_status_counts_only_unsynced_records_of_the_signed_in_account() {
            let app = fresh_app();
            sign_in(&app, ACCOUNT);
            record(&app.store, at(100), "own");
            record_for(&app.store, OTHER_ACCOUNT, at(50), "older other");
            record_for(&app.store, OTHER_ACCOUNT, at(200), "newer other");

            let status = Desktop::new(&app).status().await;

            assert_eq!(status.unsynced_frames, 1);
            assert_eq!(status.oldest_unsynced_at, Some(100));
            assert_eq!(status.newest_unsynced_at, Some(100));
        }

        #[tokio::test]
        async fn without_a_signed_in_account_the_status_counts_no_unsynced_records() {
            let app = fresh_app();
            record(&app.store, at(100), "recorded");

            let status = Desktop::new(&app).status().await;

            assert_eq!(status.unsynced_frames, 0);
            assert_eq!(status.oldest_unsynced_at, None);
            assert_eq!(status.newest_unsynced_at, None);
        }
    }
}
