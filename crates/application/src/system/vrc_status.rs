use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::future::{BoxFuture, FutureExt, Shared};
use serde_json::Value;
use tokio::sync::Mutex as AsyncMutex;
use vrcx_0_application_core::{
    sleep_until_due_or_stopped, RuntimeEventBus, TaskSupervisor, VrcStatusSnapshot, WebClient,
};
use vrcx_0_core::time::now_iso;
use vrcx_0_integrations::external_api::{self, ExternalApiScope};

use crate::{Error, Result};

const OK_POLL_MS: u32 = 5 * 60 * 1_000;
const ISSUE_POLL_MS: u32 = 2 * 60 * 1_000;
const ALL_SYSTEMS_OPERATIONAL: &str = "All Systems Operational";
const ISSUE_FALLBACK_STATUS: &str = "VRChat Server Issues";

type SharedRefresh = Shared<BoxFuture<'static, std::result::Result<VrcStatusSnapshot, String>>>;

struct VrcStatusServiceInner {
    web: Arc<WebClient>,
    event_bus: RuntimeEventBus,
    snapshot: Mutex<VrcStatusSnapshot>,
    refresh_in_flight: AsyncMutex<Option<(u64, SharedRefresh)>>,
    next_refresh_id: AtomicU64,
    loop_started: AtomicBool,
}

#[derive(Clone)]
pub struct VrcStatusService {
    inner: Arc<VrcStatusServiceInner>,
}

impl VrcStatusService {
    pub fn new(web: Arc<WebClient>, event_bus: RuntimeEventBus) -> Self {
        Self {
            inner: Arc::new(VrcStatusServiceInner {
                web,
                event_bus,
                snapshot: Mutex::new(VrcStatusSnapshot {
                    polling_interval_ms: OK_POLL_MS,
                    ..VrcStatusSnapshot::default()
                }),
                refresh_in_flight: AsyncMutex::new(None),
                next_refresh_id: AtomicU64::new(1),
                loop_started: AtomicBool::new(false),
            }),
        }
    }

    pub fn snapshot(&self) -> VrcStatusSnapshot {
        self.inner.snapshot.lock().unwrap().clone()
    }

    pub async fn refresh(&self) -> Result<VrcStatusSnapshot> {
        let (refresh_id, refresh) = {
            let mut current = self.inner.refresh_in_flight.lock().await;
            if let Some((refresh_id, refresh)) = current.as_ref() {
                (*refresh_id, refresh.clone())
            } else {
                let refresh_id = self.inner.next_refresh_id.fetch_add(1, Ordering::Relaxed);
                let service = self.clone();
                let refresh = async move {
                    service
                        .perform_refresh()
                        .await
                        .map_err(|error| error.to_string())
                }
                .boxed()
                .shared();
                *current = Some((refresh_id, refresh.clone()));
                (refresh_id, refresh)
            }
        };
        let result = refresh.await.map_err(Error::Custom);
        let mut current = self.inner.refresh_in_flight.lock().await;
        if current
            .as_ref()
            .is_some_and(|(current_id, _)| *current_id == refresh_id)
        {
            *current = None;
        }
        result
    }

    async fn perform_refresh(&self) -> Result<VrcStatusSnapshot> {
        self.update_snapshot(|snapshot| snapshot.refreshing = true);

        let result = self.fetch_snapshot().await;
        match result {
            Ok(snapshot) => {
                self.replace_snapshot(snapshot.clone());
                Ok(snapshot)
            }
            Err(error) => {
                let message = error.to_string();
                let snapshot = self.update_snapshot(|snapshot| {
                    snapshot.last_fetched_at = Some(now_iso());
                    snapshot.polling_interval_ms = ISSUE_POLL_MS;
                    snapshot.refreshing = false;
                    snapshot.error = message;
                });
                Err(Error::Custom(format!(
                    "VRChat status refresh failed: {}",
                    snapshot.error
                )))
            }
        }
    }

    pub fn start_loop(&self, tasks: TaskSupervisor) {
        if self.inner.loop_started.swap(true, Ordering::AcqRel) {
            return;
        }

        let service = self.clone();
        tasks.spawn_cancellable(move |stop_token| async move {
            loop {
                let interval_ms = match service.refresh().await {
                    Ok(snapshot) => snapshot.polling_interval_ms,
                    Err(error) => {
                        tracing::warn!(error = %error, "failed to refresh VRChat status");
                        ISSUE_POLL_MS
                    }
                };
                if !sleep_until_due_or_stopped(
                    Duration::from_millis(u64::from(interval_ms)),
                    &stop_token,
                )
                .await
                {
                    service.inner.loop_started.store(false, Ordering::Release);
                    return;
                }
            }
        });
    }

    async fn fetch_snapshot(&self) -> Result<VrcStatusSnapshot> {
        let status = self.fetch_json("status.json").await?;
        let description = text_at(&status, &["status", "description"]);
        let indicator = text_at(&status, &["status", "indicator"]);
        let updated_at = optional_text_at(&status, &["page", "updated_at"]);
        let summary = match self.fetch_json("summary.json").await {
            Ok(summary) => summarize_components(&summary),
            Err(error) => {
                tracing::warn!(error = %error, "failed to fetch VRChat status summary");
                SummaryIssue::default()
            }
        };
        let effective_indicator = stronger_indicator(&indicator, &summary.indicator).to_string();
        let has_issue = has_status_issue(&effective_indicator, &description);

        Ok(VrcStatusSnapshot {
            status: if has_issue {
                if description.is_empty() || description == ALL_SYSTEMS_OPERATIONAL {
                    ISSUE_FALLBACK_STATUS.to_string()
                } else {
                    description
                }
            } else {
                String::new()
            },
            indicator: if has_issue {
                effective_indicator
            } else {
                String::new()
            },
            summary: if has_issue {
                summary.summary
            } else {
                String::new()
            },
            updated_at,
            last_fetched_at: Some(now_iso()),
            polling_interval_ms: if has_issue { ISSUE_POLL_MS } else { OK_POLL_MS },
            refreshing: false,
            error: String::new(),
        })
    }

    async fn fetch_json(&self, path: &str) -> Result<Value> {
        let response = self
            .inner
            .web
            .execute_external_api(
                external_api::vrc_status_json_get_input(path),
                ExternalApiScope::VrcStatus,
            )
            .await?;
        if response.status != 200 {
            return Err(Error::Custom(format!(
                "VRChat status request failed ({}).",
                response.status
            )));
        }
        serde_json::from_str(&response.data).map_err(Error::from)
    }

    fn update_snapshot(&self, update: impl FnOnce(&mut VrcStatusSnapshot)) -> VrcStatusSnapshot {
        let snapshot = {
            let mut current = self.inner.snapshot.lock().unwrap();
            update(&mut current);
            current.clone()
        };
        self.inner.event_bus.emit(snapshot.clone());
        snapshot
    }

    fn replace_snapshot(&self, snapshot: VrcStatusSnapshot) {
        *self.inner.snapshot.lock().unwrap() = snapshot.clone();
        self.inner.event_bus.emit(snapshot);
    }
}

#[derive(Default)]
struct SummaryIssue {
    indicator: String,
    summary: String,
}

fn summarize_components(value: &Value) -> SummaryIssue {
    let mut indicator = "";
    let mut names = Vec::new();
    for component in value
        .get("components")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let status = component
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if status.is_empty() || status == "operational" {
            continue;
        }
        indicator = stronger_indicator(indicator, component_indicator(status));
        if let Some(name) = component
            .get("name")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|name| !name.is_empty())
        {
            names.push(name.to_string());
        }
    }
    SummaryIssue {
        indicator: indicator.to_string(),
        summary: names.join(", "),
    }
}

fn text_at(value: &Value, path: &[&str]) -> String {
    optional_text_at(value, path).unwrap_or_default()
}

fn optional_text_at(value: &Value, path: &[&str]) -> Option<String> {
    let mut current = value;
    for segment in path {
        current = current.get(*segment)?;
    }
    current
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn has_status_issue(indicator: &str, description: &str) -> bool {
    (!indicator.is_empty() && indicator != "none")
        || (!description.is_empty() && description != ALL_SYSTEMS_OPERATIONAL)
}

fn component_indicator(status: &str) -> &'static str {
    match status {
        "major_outage" => "major",
        "partial_outage" | "degraded_performance" | "under_maintenance" => "minor",
        _ => "",
    }
}

fn stronger_indicator<'a>(left: &'a str, right: &'a str) -> &'a str {
    if indicator_severity(right) > indicator_severity(left) {
        right
    } else {
        left
    }
}

fn indicator_severity(indicator: &str) -> u8 {
    match indicator {
        "critical" => 3,
        "major" => 2,
        "minor" | "maintenance" => 1,
        _ => 0,
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn summary_uses_strongest_component_indicator_and_names() {
        let issue = summarize_components(&json!({
            "components": [
                { "name": "API", "status": "degraded_performance" },
                { "name": "Realtime", "status": "major_outage" },
                { "name": "Website", "status": "operational" }
            ]
        }));

        assert_eq!(issue.indicator, "major");
        assert_eq!(issue.summary, "API, Realtime");
    }

    #[test]
    fn operational_status_is_not_reported_as_an_issue() {
        assert!(!has_status_issue("none", ALL_SYSTEMS_OPERATIONAL));
        assert!(has_status_issue("minor", ALL_SYSTEMS_OPERATIONAL));
        assert!(has_status_issue("none", "Partial System Outage"));
    }
}
