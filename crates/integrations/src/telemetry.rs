use std::time::Duration;

use reqwest::Client;
use serde::Serialize;

const DEFAULT_PRODUCTION_ENDPOINT: &str = "https://stats.vrcx-0.dev";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug, thiserror::Error)]
pub enum TelemetryError {
    #[error("telemetry transport error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("telemetry rejected ({status})")]
    Rejected { status: u16 },
}

#[derive(Clone)]
pub struct TelemetryClient {
    http: Client,
    endpoint: String,
}

impl TelemetryClient {
    pub fn new(endpoint: String) -> Self {
        let http = Client::builder()
            .timeout(REQUEST_TIMEOUT)
            .build()
            .unwrap_or_default();
        Self {
            http,
            endpoint: normalize_endpoint(&endpoint),
        }
    }

    pub fn is_enabled(&self) -> bool {
        !self.endpoint.is_empty()
    }

    pub async fn post<T>(&self, path: &str, payload: &T) -> Result<(), TelemetryError>
    where
        T: Serialize + ?Sized,
    {
        if !self.is_enabled() {
            return Ok(());
        }
        let response = self
            .http
            .post(format!("{}{}", self.endpoint, normalize_path(path)))
            .json(payload)
            .send()
            .await?;
        if response.status().is_success() {
            return Ok(());
        }
        Err(TelemetryError::Rejected {
            status: response.status().as_u16(),
        })
    }
}

pub fn resolve_endpoint() -> String {
    if cfg!(debug_assertions) {
        resolve_endpoint_for(
            true,
            std::env::var("VRCX_0_TELEMETRY_ENDPOINT").ok().as_deref(),
            option_env!("VRCX_0_TELEMETRY_ENDPOINT"),
        )
    } else {
        resolve_endpoint_for(
            false,
            std::env::var("VRCX_0_TELEMETRY_ENDPOINT").ok().as_deref(),
            option_env!("VRCX_0_TELEMETRY_ENDPOINT"),
        )
    }
}

pub fn resolve_endpoint_for(
    debug_assertions: bool,
    runtime_env: Option<&str>,
    compile_env: Option<&str>,
) -> String {
    if debug_assertions {
        return normalize_endpoint(runtime_env.unwrap_or_default());
    }
    normalize_endpoint(compile_env.unwrap_or(DEFAULT_PRODUCTION_ENDPOINT))
}

fn normalize_endpoint(value: &str) -> String {
    value.trim().trim_end_matches('/').to_string()
}

fn normalize_path(path: &str) -> String {
    if path.starts_with('/') {
        path.to_string()
    } else {
        format!("/{path}")
    }
}
