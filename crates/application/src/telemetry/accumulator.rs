use std::collections::HashMap;

use vrcx_0_contracts::telemetry::{RouteUsageEntry, TelemetryErrorDetail, ToolUsageEntry};

use super::event::TelemetryClientEvent;
use super::privacy::{build_error_detail, sanitize_error_summary};

const MAX_ROUTE_KEYS: usize = 64;
const MAX_TOOL_KEYS: usize = 32;
const MAX_VALUE_LENGTH: usize = 64;
const MAX_DETAILS_PER_CHANNEL: usize = 64;
pub(super) const MAX_DETAILS_PER_PAYLOAD: usize = 20;
const MAX_COUNT: u32 = 100_000;
const DATABASE_UPGRADE_FAILURE_PREFIX: &str = "database upgrade failure [";

#[derive(Default)]
pub struct TelemetryAccumulator {
    current_route: Option<String>,
    routes: HashMap<String, RouteUsage>,
    tools: HashMap<String, ToolUsage>,
    assistant: AssistantHealthAccumulator,
    client_errors: DetailAccumulator,
    revision: u64,
    routes_sent_revision: u64,
    tools_sent_revision: u64,
    assistant_sent_revision: u64,
    client_errors_revision: u64,
    client_errors_sent_revision: u64,
}

#[derive(Default)]
struct RouteUsage {
    visits: u32,
    landings: u32,
    load_fail: u32,
    render_crash: u32,
    details: DetailAccumulator,
    revision: u64,
}

#[derive(Default)]
struct ToolUsage {
    opens: u32,
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

pub(super) struct ToolSnapshot {
    pub entries: Vec<ToolUsageEntry>,
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
            TelemetryClientEvent::PageVisit { route, landing } => {
                self.record_page_visit(route, landing)
            }
            TelemetryClientEvent::ToolOpen { tool } => self.record_tool_open(tool),
            TelemetryClientEvent::RouteError {
                error_class,
                name,
                summary,
            } => self.record_route_error(error_class, name, summary),
            TelemetryClientEvent::AssistantToolError { source, summary } => {
                if !should_record_assistant_tool_detail(summary.as_deref()) {
                    return;
                }
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
                if should_record_assistant_turn_detail(&code, summary.as_deref()) {
                    let summary = summary.as_deref().map(|summary| {
                        llm_transport_error_category(&code, summary).unwrap_or(summary)
                    });
                    self.assistant.details.record(build_error_detail(
                        "turn_error",
                        None,
                        Some(code.as_str()),
                        None,
                        summary,
                        None,
                    ));
                }
                let revision = self.advance_revision();
                self.assistant.revision = revision;
            }
        }
    }

    pub fn record_rust_error(
        &mut self,
        source: &str,
        app_version: &str,
        fingerprint_message: &str,
        telemetry_message: &str,
    ) {
        let detail = match source {
            "rust:panic" => {
                let mut detail = build_error_detail(
                    "panic",
                    Some(source),
                    None,
                    None,
                    Some(fingerprint_message),
                    Some(app_version),
                );
                detail.summary = Some(sanitize_error_summary(telemetry_message));
                detail
            }
            "rust:tracing" => database_upgrade_error_detail(telemetry_message, app_version)
                .unwrap_or_else(|| {
                    build_error_detail(
                        "rust_error",
                        Some(source),
                        None,
                        None,
                        Some(telemetry_message),
                        Some(app_version),
                    )
                }),
            _ => return,
        };
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

    pub fn tool_entries(&self) -> Vec<ToolUsageEntry> {
        let mut entries = self
            .tools
            .iter()
            .map(|(tool, usage)| tool_usage_entry(tool, usage))
            .collect::<Vec<_>>();
        entries.sort_by(|left, right| left.tool.cmp(&right.tool));
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

    pub(super) fn tool_snapshot(&self) -> Option<ToolSnapshot> {
        let revision = self.revision;
        let mut entries = self
            .tools
            .iter()
            .filter(|(_, usage)| usage.revision > self.tools_sent_revision)
            .map(|(tool, usage)| tool_usage_entry(tool, usage))
            .collect::<Vec<_>>();
        if entries.is_empty() {
            return None;
        }
        entries.sort_by(|left, right| left.tool.cmp(&right.tool));
        Some(ToolSnapshot { entries, revision })
    }

    pub(super) fn mark_tools_sent(&mut self, revision: u64) {
        self.tools_sent_revision = self.tools_sent_revision.max(revision);
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

    fn record_page_visit(&mut self, route: String, landing: bool) {
        let Some(route) = sanitize_dimension_value(route) else {
            self.current_route = None;
            return;
        };
        self.current_route = Some(route.clone());
        self.record_visit(route, landing);
    }

    fn record_tool_open(&mut self, tool: String) {
        let Some(tool) = sanitize_dimension_value(tool) else {
            return;
        };
        let Some(usage) = ensure_entry(&mut self.tools, tool.clone(), MAX_TOOL_KEYS) else {
            return;
        };
        usage.opens = increment(usage.opens);
        let revision = self.advance_revision();
        if let Some(usage) = self.tools.get_mut(&tool) {
            usage.revision = revision;
        }
    }

    fn record_visit(&mut self, route: String, landing: bool) {
        let Some(usage) = ensure_entry(&mut self.routes, route.clone(), MAX_ROUTE_KEYS) else {
            return;
        };
        usage.visits = increment(usage.visits);
        if landing {
            usage.landings = increment(usage.landings);
        }
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
        landings: (usage.landings > 0).then_some(usage.landings),
        load_fail: (usage.load_fail > 0).then_some(usage.load_fail),
        render_crash: (usage.render_crash > 0).then_some(usage.render_crash),
        details: usage.details.serialize(),
    }
}

fn tool_usage_entry(tool: &str, usage: &ToolUsage) -> ToolUsageEntry {
    ToolUsageEntry {
        tool: tool.to_string(),
        opens: usage.opens,
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

fn database_upgrade_error_detail(
    message: &str,
    fallback_app_version: &str,
) -> Option<TelemetryErrorDetail> {
    let (_, envelope) = message.split_once(DATABASE_UPGRADE_FAILURE_PREFIX)?;
    let (metadata, reason) = envelope.split_once("]: ")?;
    let mut status = None;
    let mut stage = None;
    let mut operation = None;
    let mut sqlite_category = None;
    let mut from_version = None;
    let mut to_version = None;
    let mut started_app_version = None;
    for field in metadata.split_ascii_whitespace() {
        let (key, value) = field.split_once('=')?;
        match key {
            "status" => status = Some(value),
            "stage" => stage = Some(value),
            "operation" => operation = Some(value),
            "sqliteCategory" => sqlite_category = Some(value),
            "from" => from_version = value.parse::<i64>().ok(),
            "to" => to_version = value.parse::<i64>().ok(),
            "appVersion" => started_app_version = Some(value),
            _ => return None,
        }
    }
    let status = status.filter(|value| matches!(*value, "interrupted" | "failed"))?;
    let stage = stage.filter(|value| !value.is_empty())?;
    let operation = operation.filter(|value| !value.is_empty());
    let sqlite_category = sqlite_category.filter(|value| !value.is_empty());
    let from_version = from_version?;
    let to_version = to_version?;
    let started_app_version = started_app_version.filter(|value| !value.is_empty())?;
    let detail_app_version = if started_app_version == "unknown" {
        fallback_app_version
    } else {
        started_app_version
    };
    let operation_summary = operation.unwrap_or("unknown");
    let sqlite_category_summary = sqlite_category.unwrap_or("unknown");
    let fingerprint_summary = if status == "interrupted" {
        format!(
            "stage={stage}; operation={operation_summary}; sqliteCategory={sqlite_category_summary}; fromVersion={from_version}; toVersion={to_version}"
        )
    } else {
        format!(
            "stage={stage}; operation={operation_summary}; sqliteCategory={sqlite_category_summary}; fromVersion={from_version}; toVersion={to_version}; reason={reason}"
        )
    };
    let code = match (status, sqlite_category) {
        ("failed", Some(category)) if category != "none" => {
            format!("failed.sqlite_{category}")
        }
        _ => status.to_string(),
    };
    let mut detail = build_error_detail(
        "rust_error",
        Some("database_upgrade"),
        Some(&code),
        Some(operation.unwrap_or(stage)),
        Some(&fingerprint_summary),
        Some(detail_app_version),
    );
    let summary = sanitize_error_summary(format!(
        "stage={stage}; operation={operation_summary}; sqliteCategory={sqlite_category_summary}; fromVersion={from_version}; toVersion={to_version}; startedVersion={started_app_version}; reason={reason}"
    ));
    detail.summary = (!summary.is_empty()).then_some(summary);
    Some(detail)
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

fn should_record_assistant_tool_detail(summary: Option<&str>) -> bool {
    !matches!(
        assistant_result_category(summary),
        Some("not_found" | "precondition" | "<id>")
    )
}

fn assistant_result_category(summary: Option<&str>) -> Option<&str> {
    summary?
        .split("; ")
        .find_map(|part| part.strip_prefix("result="))
}

fn should_record_assistant_turn_detail(code: &str, summary: Option<&str>) -> bool {
    code != "llm" || !is_llm_http_error_summary(summary)
}

fn llm_transport_error_category<'a>(code: &str, summary: &'a str) -> Option<&'a str> {
    const PREFIX: &str = "LLM transport error";
    if code != "llm" || !summary.starts_with(PREFIX) {
        return None;
    }
    let kind_len = summary[PREFIX.len()..]
        .strip_prefix(": ")
        .and_then(|detail| detail.split_once(": "))
        .map(|(kind, _)| kind)
        .filter(|kind| !kind.is_empty() && kind.chars().all(|ch| ch.is_ascii_lowercase()))
        .map_or(0, |kind| ": ".len() + kind.len());
    Some(&summary[..PREFIX.len() + kind_len])
}

fn is_llm_http_error_summary(summary: Option<&str>) -> bool {
    let Some(status) = summary
        .and_then(|value| value.strip_prefix("LLM API error ("))
        .and_then(|value| value.strip_suffix(')'))
        .and_then(|value| value.parse::<u16>().ok())
    else {
        return false;
    };
    (400..=599).contains(&status)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn panic_backtrace_frames_do_not_split_telemetry_identity() {
        let mut acc = TelemetryAccumulator::default();
        acc.record_rust_error(
            "rust:panic",
            "2.9.2",
            "panicked at crates/runtime.rs:42",
            "panicked at crates/runtime.rs:42\nframes: tao::runner::advance_state@runner.rs:371:7",
        );
        acc.record_rust_error(
            "rust:panic",
            "2.9.2",
            "panicked at crates/runtime.rs:42",
            "panicked at crates/runtime.rs:42",
        );

        let entries = acc.client_error_entries();
        assert_eq!(entries.len(), 1);
        assert_eq!(
            entries[0].summary.as_deref(),
            Some("panicked at crates/runtime.rs:42 frames: tao::runner::advance_state@runner.rs:371:7")
        );
        assert_eq!(entries[0].count, 2);
    }

    #[test]
    fn accumulator_caps_routes_and_error_details() {
        let mut acc = TelemetryAccumulator::default();
        for index in 0..70 {
            acc.record(TelemetryClientEvent::PageVisit {
                route: format!("route_{index}"),
                landing: false,
            });
        }
        assert_eq!(acc.route_entries().len(), MAX_ROUTE_KEYS);

        let mut detail_acc = TelemetryAccumulator::default();
        detail_acc.record(TelemetryClientEvent::PageVisit {
            route: "game_log".into(),
            landing: false,
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
    fn landing_visits_are_counted_within_route_visits() {
        let mut acc = TelemetryAccumulator::default();
        acc.record(TelemetryClientEvent::PageVisit {
            route: "feed".into(),
            landing: true,
        });
        acc.record(TelemetryClientEvent::PageVisit {
            route: "feed".into(),
            landing: false,
        });
        acc.record(TelemetryClientEvent::PageVisit {
            route: "game_log".into(),
            landing: false,
        });

        let routes = acc.route_entries();
        assert_eq!(routes[0].route, "feed");
        assert_eq!(routes[0].visits, 2);
        assert_eq!(routes[0].landings, Some(1));
        assert_eq!(routes[1].route, "game_log");
        assert_eq!(routes[1].landings, None);
    }

    #[test]
    fn collector_snapshots_become_dirty_again_after_acknowledgement() {
        let mut acc = TelemetryAccumulator::default();
        acc.record(TelemetryClientEvent::PageVisit {
            route: "game_log".into(),
            landing: false,
        });

        let first = acc.route_snapshot().expect("route should be dirty");
        assert_eq!(first.entries[0].visits, 1);
        acc.mark_routes_sent(first.revision);
        assert!(acc.route_snapshot().is_none());

        acc.record(TelemetryClientEvent::PageVisit {
            route: "game_log".into(),
            landing: false,
        });
        let second = acc.route_snapshot().expect("new visit should be dirty");
        assert_eq!(second.entries[0].visits, 2);

        acc.record(TelemetryClientEvent::ToolOpen {
            tool: "inventory".into(),
        });
        let tools = acc.tool_snapshot().expect("tool should be dirty");
        assert_eq!(tools.entries[0].opens, 1);
        acc.mark_tools_sent(tools.revision);
        assert!(acc.tool_snapshot().is_none());
    }

    #[test]
    fn llm_transport_turn_errors_keep_only_the_error_kind() {
        let mut acc = TelemetryAccumulator::default();
        for summary in [
            "LLM transport error: connect: error sending request for url (https://llm.corp.internal/v1/chat): client error (Connect): invalid peer certificate: certificate not valid for name \"llm.corp.internal\"; certificate is only valid for DnsName(\"proxy.corp.internal\")",
            "LLM transport error: error decoding response body from 10.0.0.5",
        ] {
            acc.record(TelemetryClientEvent::AssistantTurnError {
                code: "llm".into(),
                summary: Some(summary.into()),
            });
        }

        let snapshot = acc
            .assistant_health_snapshot()
            .expect("assistant health should be dirty");
        let summaries = snapshot
            .entry
            .details
            .unwrap_or_default()
            .into_iter()
            .filter_map(|detail| detail.summary)
            .collect::<Vec<_>>();
        assert_eq!(
            summaries,
            vec!["LLM transport error", "LLM transport error: connect"]
        );
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
