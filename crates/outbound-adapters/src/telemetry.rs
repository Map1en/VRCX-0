use std::{path::PathBuf, sync::Arc};

use vrcx_0_application::telemetry::{
    TelemetryClientErrorInput, TelemetryDatabaseScale, TelemetryEnvironment, TelemetryPostFuture,
    TelemetryTransport,
};
use vrcx_0_integrations::telemetry::TelemetryClient;
use vrcx_0_persistence::{database_scale_estimate, DatabaseService};

pub struct LocalTelemetryEnvironment {
    database: Arc<DatabaseService>,
    app_data: PathBuf,
    system_theme_category: Arc<dyn Fn() -> String + Send + Sync>,
}

impl LocalTelemetryEnvironment {
    pub fn new(
        database: Arc<DatabaseService>,
        app_data: PathBuf,
        system_theme_category: Arc<dyn Fn() -> String + Send + Sync>,
    ) -> Self {
        Self {
            database,
            app_data,
            system_theme_category,
        }
    }
}

impl TelemetryEnvironment for LocalTelemetryEnvironment {
    fn drain_client_errors(
        &self,
        since: Option<&str>,
        limit: usize,
    ) -> Vec<TelemetryClientErrorInput> {
        vrcx_0_platform::error_log::drain_client_error_log(&self.app_data, since, limit)
            .into_iter()
            .map(|entry| {
                let (fingerprint_message, telemetry_message) = if entry.source == "rust:panic" {
                    (
                        vrcx_0_platform::error_log::panic_fingerprint_summary(&entry.message)
                            .to_string(),
                        vrcx_0_platform::error_log::panic_summary_for_telemetry(&entry.message),
                    )
                } else {
                    (entry.message.clone(), entry.message)
                };
                TelemetryClientErrorInput {
                    ts_iso: entry.ts_iso,
                    app_version: entry.app_version,
                    source: entry.source,
                    fingerprint_message,
                    telemetry_message,
                }
            })
            .collect()
    }

    fn platform(&self) -> String {
        vrcx_0_platform::host_capabilities::current_platform().to_string()
    }

    fn arch(&self) -> String {
        vrcx_0_platform::host_capabilities::current_arch().to_string()
    }

    fn system_locale(&self) -> Option<String> {
        sys_locale::get_locale()
    }

    fn timezone(&self) -> Option<String> {
        iana_time_zone::get_timezone().ok()
    }

    fn system_theme_category(&self) -> String {
        (self.system_theme_category)()
    }

    fn database_scale(&self) -> TelemetryDatabaseScale {
        match database_scale_estimate(&self.database) {
            Ok(estimate) => TelemetryDatabaseScale {
                db_bytes: estimate.db_bytes,
                feed_rows: estimate.feed_rows,
                gamelog_rows: estimate.gamelog_rows,
                friend_log_rows: estimate.friend_log_rows,
                friend_count: estimate.friend_count,
            },
            Err(error) => {
                tracing::debug!("failed to estimate telemetry database scale: {error}");
                TelemetryDatabaseScale::default()
            }
        }
    }

    fn legacy_vrcx_detected(&self) -> bool {
        vrcx_0_persistence::legacy_vrcx::discover_supported_legacy_source()
            .status
            .detected
    }
}

pub struct HttpTelemetryTransport {
    client: TelemetryClient,
}

impl HttpTelemetryTransport {
    pub fn new(endpoint: String) -> Self {
        Self {
            client: TelemetryClient::new(endpoint),
        }
    }

    pub fn production() -> Self {
        Self::new(vrcx_0_integrations::telemetry::resolve_endpoint())
    }
}

impl TelemetryTransport for HttpTelemetryTransport {
    fn is_enabled(&self) -> bool {
        self.client.is_enabled()
    }

    fn post<'a>(&'a self, path: &'a str, payload: serde_json::Value) -> TelemetryPostFuture<'a> {
        Box::pin(async move {
            self.client
                .post(path, &payload)
                .await
                .map_err(|error| error.to_string())
        })
    }
}
