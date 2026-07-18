use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use chrono::{SecondsFormat, Utc};
use serde::Serialize;

fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSyncDomainSnapshot {
    pub domain: String,
    pub status: String,
    pub detail: String,
    pub updated_at: String,
    pub revision: u64,
    pub pending_count: u64,
    pub failure_count: u64,
}

#[derive(Clone, Debug, Default, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSyncSnapshot {
    pub domains: Vec<RuntimeSyncDomainSnapshot>,
}

#[derive(Clone, Default)]
pub struct RuntimeSyncEngine {
    inner: Arc<Mutex<BTreeMap<String, RuntimeSyncDomainSnapshot>>>,
}

impl RuntimeSyncEngine {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn record(
        &self,
        domain: impl Into<String>,
        status: impl Into<String>,
        detail: impl Into<String>,
        pending_count: u64,
    ) {
        self.upsert(domain, status, detail, pending_count, false);
    }

    pub fn record_failure(&self, domain: impl Into<String>, detail: impl Into<String>) {
        self.upsert(domain, "error", detail, 0, true);
    }

    pub fn snapshot(&self) -> RuntimeSyncSnapshot {
        let domains = match self.inner.lock() {
            Ok(domains) => domains.values().cloned().collect(),
            Err(error) => {
                tracing::warn!("failed to lock runtime sync engine: {error}");
                Vec::new()
            }
        };
        RuntimeSyncSnapshot { domains }
    }

    fn upsert(
        &self,
        domain: impl Into<String>,
        status: impl Into<String>,
        detail: impl Into<String>,
        pending_count: u64,
        failed: bool,
    ) {
        let domain = domain.into();
        let status = status.into();
        let detail = detail.into();
        match self.inner.lock() {
            Ok(mut domains) => {
                let entry =
                    domains
                        .entry(domain.clone())
                        .or_insert_with(|| RuntimeSyncDomainSnapshot {
                            domain,
                            status: String::new(),
                            detail: String::new(),
                            updated_at: String::new(),
                            revision: 0,
                            pending_count: 0,
                            failure_count: 0,
                        });
                entry.status = status;
                entry.detail = detail;
                entry.updated_at = now_iso();
                entry.revision = entry.revision.saturating_add(1);
                entry.pending_count = pending_count;
                if failed {
                    entry.failure_count = entry.failure_count.saturating_add(1);
                }
            }
            Err(error) => tracing::warn!("failed to lock runtime sync engine: {error}"),
        }
    }
}
