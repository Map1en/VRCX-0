use std::collections::HashMap;

use vrcx_0_integrations::telemetry::{build_error_detail, RouteUsageEntry, TelemetryErrorDetail};

use super::event::TelemetryClientEvent;

const MAX_ROUTE_KEYS: usize = 64;
const MAX_VALUE_LENGTH: usize = 64;
const MAX_DETAILS_PER_CHANNEL: usize = 64;
pub(super) const MAX_DETAILS_PER_PAYLOAD: usize = 20;
const MAX_COUNT: u32 = 100_000;

#[derive(Default)]
pub struct TelemetryAccumulator {
    current_route: Option<String>,
    routes: HashMap<String, RouteUsage>,
    assistant: AssistantHealthAccumulator,
    client_errors: DetailAccumulator,
    revision: u64,
    routes_sent_revision: u64,
    assistant_sent_revision: u64,
    client_errors_revision: u64,
    client_errors_sent_revision: u64,
}

#[derive(Default)]
struct RouteUsage {
    visits: u32,
    load_fail: u32,
    render_crash: u32,
    details: DetailAccumulator,
    revision: u64,
}

#[derive(Default)]
struct AssistantHealthAccumulator {
    tool_errors: u32,
    turn_errors: u32,
    details: DetailAccumulator,
    revision: u64,
}

#[derive(Default)]
struct DetailAccumulator {
    details: HashMap<String, TelemetryErrorDetail>,
}

#[derive(Default)]
pub struct AssistantHealthEntry {
    pub tool_errors: u32,
    pub turn_errors: u32,
    pub details: Option<Vec<TelemetryErrorDetail>>,
}

pub(super) struct RouteSnapshot {
    pub entries: Vec<RouteUsageEntry>,
    pub revision: u64,
}

pub(super) struct AssistantHealthSnapshot {
    pub entry: AssistantHealthEntry,
    pub revision: u64,
}

pub(super) struct ClientErrorSnapshot {
    pub entries: Vec<TelemetryErrorDetail>,
    pub revision: u64,
}

impl TelemetryAccumulator {
    pub fn record(&mut self, event: TelemetryClientEvent) {
        match event {
            TelemetryClientEvent::PageVisit { route } => self.record_page_visit(route),
            TelemetryClientEvent::RouteError {
                error_class,
                name,
                summary,
            } => self.record_route_error(error_class, name, summary),
            TelemetryClientEvent::ViewModeSwitch { .. } => {}
            TelemetryClientEvent::AssistantToolError { source, summary } => {
                self.assistant.tool_errors = increment(self.assistant.tool_errors);
                self.assistant.details.record(build_error_detail(
                    "tool_error",
                    source.as_deref(),
                    None,
                    None,
                    summary.as_deref(),
                    None,
                ));
                let revision = self.advance_revision();
                self.assistant.revision = revision;
            }
            TelemetryClientEvent::AssistantTurnError { code, summary } => {
                if code == "cancelled" {
                    return;
                }
                self.assistant.turn_errors = increment(self.assistant.turn_errors);
                self.assistant.details.record(build_error_detail(
                    "turn_error",
                    None,
                    Some(code.as_str()),
                    None,
                    summary.as_deref(),
                    None,
                ));
                let revision = self.advance_revision();
                self.assistant.revision = revision;
            }
        }
    }

    pub fn record_rust_error(&mut self, source: &str, app_version: &str, message: &str) {
        let (kind, summary) = match source {
            "rust:panic" => (
                "panic",
                vrcx_0_host::error_log::panic_summary_for_telemetry(message),
            ),
            "rust:tracing" => ("rust_error", message),
            _ => return,
        };
        let detail = build_error_detail(
            kind,
            Some(source),
            None,
            None,
            Some(summary),
            Some(app_version),
        );
        if self.client_errors.record(detail) {
            let revision = self.advance_revision();
            self.client_errors_revision = revision;
        }
    }

    pub fn route_entries(&self) -> Vec<RouteUsageEntry> {
        let mut entries = self
            .routes
            .iter()
            .map(|(route, usage)| route_usage_entry(route, usage))
            .collect::<Vec<_>>();
        entries.sort_by(|left, right| left.route.cmp(&right.route));
        entries
    }

    pub fn assistant_health_entry(&self) -> Option<AssistantHealthEntry> {
        if self.assistant.tool_errors == 0 && self.assistant.turn_errors == 0 {
            return None;
        }
        Some(AssistantHealthEntry {
            tool_errors: self.assistant.tool_errors,
            turn_errors: self.assistant.turn_errors,
            details: self.assistant.details.serialize(),
        })
    }

    pub fn client_error_entries(&self) -> Vec<TelemetryErrorDetail> {
        self.client_errors
            .serialize_with_limit(self.client_errors.details.len())
            .unwrap_or_default()
    }

    pub(super) fn route_snapshot(&self) -> Option<RouteSnapshot> {
        let revision = self.revision;
        let mut entries = self
            .routes
            .iter()
            .filter(|(_, usage)| usage.revision > self.routes_sent_revision)
            .map(|(route, usage)| route_usage_entry(route, usage))
            .collect::<Vec<_>>();
        if entries.is_empty() {
            return None;
        }
        entries.sort_by(|left, right| left.route.cmp(&right.route));
        Some(RouteSnapshot { entries, revision })
    }

    pub(super) fn mark_routes_sent(&mut self, revision: u64) {
        self.routes_sent_revision = self.routes_sent_revision.max(revision);
    }

    pub(super) fn assistant_health_snapshot(&self) -> Option<AssistantHealthSnapshot> {
        if self.assistant.revision <= self.assistant_sent_revision {
            return None;
        }
        self.assistant_health_entry()
            .map(|entry| AssistantHealthSnapshot {
                entry,
                revision: self.assistant.revision,
            })
    }

    pub(super) fn mark_assistant_health_sent(&mut self, revision: u64) {
        self.assistant_sent_revision = self.assistant_sent_revision.max(revision);
    }

    pub(super) fn client_error_snapshot(&self) -> Option<ClientErrorSnapshot> {
        if self.client_errors_revision <= self.client_errors_sent_revision {
            return None;
        }
        let entries = self.client_error_entries();
        (!entries.is_empty()).then_some(ClientErrorSnapshot {
            entries,
            revision: self.client_errors_revision,
        })
    }

    pub(super) fn mark_client_errors_sent(&mut self, revision: u64) {
        self.client_errors_sent_revision = self.client_errors_sent_revision.max(revision);
    }

    fn record_page_visit(&mut self, route: String) {
        let Some(route) = sanitize_dimension_value(route) else {
            self.current_route = None;
            return;
        };
        self.current_route = Some(route.clone());
        let Some(usage) = ensure_entry(&mut self.routes, route.clone(), MAX_ROUTE_KEYS) else {
            return;
        };
        usage.visits = increment(usage.visits);
        let revision = self.advance_revision();
        if let Some(usage) = self.routes.get_mut(&route) {
            usage.revision = revision;
        }
    }

    fn record_route_error(
        &mut self,
        error_class: String,
        name: Option<String>,
        summary: Option<String>,
    ) {
        let Some(route) = self.current_route.clone() else {
            return;
        };
        {
            let Some(usage) = self.routes.get_mut(&route) else {
                return;
            };
            match error_class.as_str() {
                "load_fail" => usage.load_fail = increment(usage.load_fail),
                "render_crash" => usage.render_crash = increment(usage.render_crash),
                _ => return,
            }
            usage.details.record(build_error_detail(
                &error_class,
                None,
                None,
                name.as_deref(),
                summary.as_deref(),
                None,
            ));
        }
        let revision = self.advance_revision();
        if let Some(usage) = self.routes.get_mut(&route) {
            usage.revision = revision;
        }
    }

    fn advance_revision(&mut self) -> u64 {
        self.revision = self.revision.saturating_add(1);
        self.revision
    }
}

impl DetailAccumulator {
    fn record(&mut self, detail: TelemetryErrorDetail) -> bool {
        let key = detail_key(&detail);
        if !self.details.contains_key(&key) && self.details.len() >= MAX_DETAILS_PER_CHANNEL {
            tracing::debug!("telemetry detail cap reached; dropping detail");
            return false;
        }
        match self.details.get_mut(&key) {
            Some(existing) => existing.count = increment(existing.count),
            None => {
                self.details.insert(key, detail);
            }
        }
        true
    }

    fn serialize(&self) -> Option<Vec<TelemetryErrorDetail>> {
        self.serialize_with_limit(MAX_DETAILS_PER_PAYLOAD)
    }

    fn serialize_with_limit(&self, limit: usize) -> Option<Vec<TelemetryErrorDetail>> {
        if self.details.is_empty() {
            return None;
        }
        let mut details = self.details.values().cloned().collect::<Vec<_>>();
        details.sort_by(|left, right| {
            right
                .count
                .cmp(&left.count)
                .then_with(|| left.signature.cmp(&right.signature))
        });
        details.truncate(limit);
        Some(details)
    }
}

fn route_usage_entry(route: &str, usage: &RouteUsage) -> RouteUsageEntry {
    RouteUsageEntry {
        route: route.to_string(),
        visits: usage.visits,
        load_fail: (usage.load_fail > 0).then_some(usage.load_fail),
        render_crash: (usage.render_crash > 0).then_some(usage.render_crash),
        details: usage.details.serialize(),
    }
}

fn ensure_entry<T: Default>(
    map: &mut HashMap<String, T>,
    key: String,
    cap: usize,
) -> Option<&mut T> {
    if !map.contains_key(&key) && map.len() >= cap {
        tracing::debug!("telemetry dimension cap reached; dropping {key}");
        return None;
    }
    Some(map.entry(key).or_default())
}

fn sanitize_dimension_value(value: String) -> Option<String> {
    let value = value.trim();
    (!value.is_empty()).then(|| value.chars().take(MAX_VALUE_LENGTH).collect())
}

fn detail_key(detail: &TelemetryErrorDetail) -> String {
    match detail.app_version.as_deref() {
        Some(app_version) if !app_version.is_empty() => {
            format!("{app_version}:{}", detail.signature)
        }
        _ => detail.signature.clone(),
    }
}

fn increment(value: u32) -> u32 {
    value.saturating_add(1).min(MAX_COUNT)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn panic_backtrace_addresses_do_not_split_telemetry_identity() {
        let mut acc = TelemetryAccumulator::default();
        acc.record_rust_error(
            "rust:panic",
            "2.9.2",
            "panicked at crates/runtime.rs:42\n[backtrace]\n0: 0x1111",
        );
        acc.record_rust_error(
            "rust:panic",
            "2.9.2",
            "panicked at crates/runtime.rs:42\n[backtrace]\n0: 0x2222",
        );

        let entries = acc.client_error_entries();
        assert_eq!(entries.len(), 1);
        assert_eq!(
            entries[0].summary.as_deref(),
            Some("panicked at crates/runtime.rs:42")
        );
        assert_eq!(entries[0].count, 2);
    }

    #[test]
    fn accumulator_caps_routes_and_error_details() {
        let mut acc = TelemetryAccumulator::default();
        for index in 0..70 {
            acc.record(TelemetryClientEvent::PageVisit {
                route: format!("route_{index}"),
            });
        }
        assert_eq!(acc.route_entries().len(), MAX_ROUTE_KEYS);

        let mut detail_acc = TelemetryAccumulator::default();
        detail_acc.record(TelemetryClientEvent::PageVisit {
            route: "game_log".into(),
        });
        for index in 0..70 {
            detail_acc.record(TelemetryClientEvent::RouteError {
                error_class: "render_crash".into(),
                name: Some("TypeError".into()),
                summary: Some(format!("failure {index}")),
            });
        }
        let routes = detail_acc.route_entries();
        let details = routes[0]
            .details
            .as_ref()
            .expect("details should be serialized");
        assert_eq!(details.len(), MAX_DETAILS_PER_PAYLOAD);
    }

    #[test]
    fn collector_snapshots_only_include_changes_after_acknowledgement() {
        let mut acc = TelemetryAccumulator::default();
        acc.record(TelemetryClientEvent::PageVisit {
            route: "game_log".into(),
        });

        let first = acc.route_snapshot().expect("route should be dirty");
        assert_eq!(first.entries[0].visits, 1);
        acc.mark_routes_sent(first.revision);
        assert!(acc.route_snapshot().is_none());

        acc.record(TelemetryClientEvent::PageVisit {
            route: "game_log".into(),
        });
        let second = acc.route_snapshot().expect("new visit should be dirty");
        assert_eq!(second.entries[0].visits, 2);
    }

    #[test]
    fn collector_snapshot_remains_dirty_until_acknowledged() {
        let mut acc = TelemetryAccumulator::default();
        acc.record(TelemetryClientEvent::AssistantTurnError {
            code: "provider_error".into(),
            summary: Some("request failed".into()),
        });

        let first = acc
            .assistant_health_snapshot()
            .expect("assistant health should be dirty");
        let retry = acc
            .assistant_health_snapshot()
            .expect("failed send must remain dirty");
        assert_eq!(retry.entry.turn_errors, first.entry.turn_errors);

        acc.mark_assistant_health_sent(first.revision);
        assert!(acc.assistant_health_snapshot().is_none());
    }
}
