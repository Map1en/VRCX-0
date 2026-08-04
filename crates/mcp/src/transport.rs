use std::net::{SocketAddr, SocketAddrV4};
use std::pin::Pin;
use std::sync::{
    atomic::{AtomicU32, Ordering},
    Arc,
};
use std::task::{Context, Poll};

use axum::body::{Body, Bytes, HttpBody};
use axum::extract::{Request, State};
use axum::http::header::{AUTHORIZATION, HOST, ORIGIN};
use axum::http::StatusCode;
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use http::HeaderMap;
use rmcp::transport::streamable_http_server::{
    session::local::LocalSessionManager, StreamableHttpServerConfig, StreamableHttpService,
};
use serde_json::json;
use socket2::{Domain, Protocol, Socket, Type as SocketType};
use tokio::net::TcpListener;
use tokio_util::sync::CancellationToken;

use crate::auth::{authorize_mcp_request, McpAuthError, McpAuthPolicy};
use crate::runtime::McpRuntime;
use crate::server::VrcxMcpServer;

pub(crate) fn build_mcp_router(
    runtime: McpRuntime,
    policy: McpAuthPolicy,
    active_connections: Arc<AtomicU32>,
    cancel: CancellationToken,
) -> Router {
    let service = StreamableHttpService::new(
        move || Ok(VrcxMcpServer::new(runtime.clone())),
        LocalSessionManager::default().into(),
        streamable_http_server_config(cancel, policy.allow_lan_connections),
    );
    let auth_state = McpAuthMiddlewareState {
        policy,
        active_connections,
    };
    Router::new()
        .route("/health", get(mcp_health))
        .nest_service("/mcp", service)
        .layer(middleware::from_fn_with_state(
            auth_state,
            mcp_auth_middleware,
        ))
}

fn streamable_http_server_config(
    cancel: CancellationToken,
    allow_lan_connections: bool,
) -> StreamableHttpServerConfig {
    let mut config = StreamableHttpServerConfig::default();
    config.legacy_session_mode = true;
    config.cancellation_token = cancel;
    if allow_lan_connections {
        config.allowed_hosts.clear();
    }
    config
}

async fn mcp_health() -> impl IntoResponse {
    axum::Json(json!({ "ok": true }))
}

#[derive(Clone)]
struct McpAuthMiddlewareState {
    policy: McpAuthPolicy,
    active_connections: Arc<AtomicU32>,
}

async fn mcp_auth_middleware(
    State(state): State<McpAuthMiddlewareState>,
    request: Request<Body>,
    next: Next,
) -> Response {
    let auth = header_to_str(request.headers(), AUTHORIZATION.as_str());
    let host = header_to_str(request.headers(), HOST.as_str());
    let origin = header_to_str(request.headers(), ORIGIN.as_str());
    match authorize_mcp_request(&state.policy, auth, host, origin) {
        Ok(()) => {
            let guard = ActiveConnectionGuard::new(Arc::clone(&state.active_connections));
            response_with_connection_guard(next.run(request).await, guard)
        }
        Err(McpAuthError::InvalidHost | McpAuthError::InvalidOrigin) => {
            (StatusCode::FORBIDDEN, "forbidden").into_response()
        }
        Err(McpAuthError::MissingBearerToken | McpAuthError::InvalidBearerToken) => {
            (StatusCode::UNAUTHORIZED, "unauthorized").into_response()
        }
    }
}

fn response_with_connection_guard(response: Response, guard: ActiveConnectionGuard) -> Response {
    let (parts, body) = response.into_parts();
    Response::from_parts(
        parts,
        Body::new(ConnectionCountingBody {
            body,
            _guard: guard,
        }),
    )
}

struct ConnectionCountingBody {
    body: Body,
    _guard: ActiveConnectionGuard,
}

impl HttpBody for ConnectionCountingBody {
    type Data = Bytes;
    type Error = <Body as HttpBody>::Error;

    fn poll_frame(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Result<http_body::Frame<Self::Data>, Self::Error>>> {
        let this = self.get_mut();
        Pin::new(&mut this.body).poll_frame(cx)
    }

    fn is_end_stream(&self) -> bool {
        self.body.is_end_stream()
    }

    fn size_hint(&self) -> http_body::SizeHint {
        self.body.size_hint()
    }
}

struct ActiveConnectionGuard {
    active_connections: Arc<AtomicU32>,
}

impl ActiveConnectionGuard {
    fn new(active_connections: Arc<AtomicU32>) -> Self {
        active_connections.fetch_add(1, Ordering::Relaxed);
        Self { active_connections }
    }
}

impl Drop for ActiveConnectionGuard {
    fn drop(&mut self) {
        self.active_connections.fetch_sub(1, Ordering::Relaxed);
    }
}

fn header_to_str<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers.get(name).and_then(|value| value.to_str().ok())
}

pub(crate) fn bind_mcp_listener(
    port: u16,
    allow_lan_connections: bool,
) -> Result<TcpListener, std::io::Error> {
    let socket = Socket::new(Domain::IPV4, SocketType::STREAM, Some(Protocol::TCP))?;
    #[cfg(not(windows))]
    socket.set_reuse_address(true)?;
    let address = if allow_lan_connections {
        [0, 0, 0, 0]
    } else {
        [127, 0, 0, 1]
    };
    socket.bind(&SocketAddr::V4(SocketAddrV4::new(address.into(), port)).into())?;
    socket.listen(1024)?;
    socket.set_nonblocking(true)?;
    TcpListener::from_std(socket.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn streamable_http_allows_lan_host_validation_to_be_owned_by_middleware() {
        let config = streamable_http_server_config(CancellationToken::new(), true);

        assert!(config.allowed_hosts.is_empty());
    }

    #[test]
    fn streamable_http_keeps_default_host_validation_for_loopback_mode() {
        let config = streamable_http_server_config(CancellationToken::new(), false);

        assert!(!config.allowed_hosts.is_empty());
    }

    #[test]
    fn active_connection_count_stays_until_response_body_drops() {
        let active_connections = Arc::new(AtomicU32::new(0));
        let guard = ActiveConnectionGuard::new(Arc::clone(&active_connections));
        let response = Response::new(Body::from("ok"));

        let response = response_with_connection_guard(response, guard);

        assert_eq!(active_connections.load(Ordering::Relaxed), 1);
        drop(response);
        assert_eq!(active_connections.load(Ordering::Relaxed), 0);
    }
}
