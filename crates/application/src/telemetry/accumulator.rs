use std::collections::HashMap;

use vrcx_0_contracts::telemetry::{
    DialogTabUsageEntry, LongFrameEntry, RouteUsageEntry, SlowCommandEntry, SlowDurationStats,
    TelemetryErrorDetail, ToolUsageEntry,
};

use super::event::TelemetryClientEvent;
use super::privacy::{build_error_detail, sanitize_error_summary};

const MAX_ROUTE_KEYS: usize = 64;
const MAX_TOOL_KEYS: usize = 32;
const MAX_DIALOG_TAB_KEYS: usize = 64;
const MAX_LONG_FRAME_KEYS: usize = 128;
const MAX_SLOW_COMMAND_KEYS: usize = 64;
const SLOW_DURATION_THRESHOLD_MS: u32 = 200;
const SLOW_DURATION_REPORT_MIN_TOTAL_MS: u32 = 1_000;
const SLOW_DURATION_BUCKET_BOUNDS_MS: [u32; 3] = [500, 1_000, 3_000];
const MAX_DURATION_MS: u32 = 600_000;
const MAX_TOTAL_MS: u32 = 1_000_000_000;
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
    dialog_tabs: HashMap<(String, String), DialogTabUsage>,
    long_frames: HashMap<(String, Option<String>), SlowDurationUsage>,
    slow_commands: HashMap<String, SlowDurationUsage>,
    assistant: AssistantHealthAccumulator,
    client_errors: DetailAccumulator,
    revision: u64,
    routes_sent_revision: u64,
    tools_sent_revision: u64,
    dialog_tabs_sent_revision: u64,
    performance_sent_revision: u64,
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
struct DialogTabUsage {
    views: u32,
    landings: u32,
    revision: u64,
}

#[derive(Default)]
struct SlowDurationUsage {
    count: u32,
    total_ms: u32,
    max_ms: u32,
    buckets: [u32; 4],
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

pub(super) struct DialogTabSnapshot {
    pub entries: Vec<DialogTabUsageEntry>,
    pub revision: u64,
}

pub(super) struct PerformanceSnapshot {
    pub frames: Vec<LongFrameEntry>,
    pub commands: Vec<SlowCommandEntry>,
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
            TelemetryClientEvent::DialogTabView {
                dialog,
                tab,
                landing,
            } => self.record_dialog_tab_view(dialog, tab, landing),
            TelemetryClientEvent::LongFrame {
                route,
                dialog,
                duration_ms,
            } => self.record_long_frame(route, dialog, duration_ms),
            TelemetryClientEvent::SlowCommand {
                command,
                duration_ms,
            } => self.record_slow_command(command, duration_ms),
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
        self.record_client_error(detail);
    }

    pub(super) fn record_client_error(&mut self, detail: TelemetryErrorDetail) {
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

    pub(super) fn dialog_tab_snapshot(&self) -> Option<DialogTabSnapshot> {
        let revision = self.revision;
        let mut entries = self
            .dialog_tabs
            .iter()
            .filter(|(_, usage)| usage.revision > self.dialog_tabs_sent_revision)
            .map(|((dialog, tab), usage)| DialogTabUsageEntry {
                dialog: dialog.clone(),
                tab: tab.clone(),
                views: usage.views,
                landings: (usage.landings > 0).then_some(usage.landings),
            })
            .collect::<Vec<_>>();
        entries.sort_by(|left, right| {
            left.dialog
                .cmp(&right.dialog)
                .then_with(|| left.tab.cmp(&right.tab))
        });
        (!entries.is_empty()).then_some(DialogTabSnapshot { entries, revision })
    }

    pub(super) fn mark_dialog_tabs_sent(&mut self, revision: u64) {
        self.dialog_tabs_sent_revision = self.dialog_tabs_sent_revision.max(revision);
    }

    pub(super) fn performance_snapshot(&self) -> Option<PerformanceSnapshot> {
        let sent = self.performance_sent_revision;
        let mut frames = self
            .long_frames
            .iter()
            .filter(|(_, usage)| usage.is_reportable_since(sent))
            .map(|((route, dialog), usage)| LongFrameEntry {
                route: route.clone(),
                dialog: dialog.clone(),
                stats: usage.stats(),
            })
            .collect::<Vec<_>>();
        frames.sort_by(|left, right| {
            left.route
                .cmp(&right.route)
                .then_with(|| left.dialog.cmp(&right.dialog))
        });
        let mut commands = self
            .slow_commands
            .iter()
            .filter(|(_, usage)| usage.is_reportable_since(sent))
            .map(|(command, usage)| SlowCommandEntry {
                command: command.clone(),
                stats: usage.stats(),
            })
            .collect::<Vec<_>>();
        commands.sort_by(|left, right| left.command.cmp(&right.command));
        (!frames.is_empty() || !commands.is_empty()).then_some(PerformanceSnapshot {
            frames,
            commands,
            revision: self.revision,
        })
    }

    pub(super) fn mark_performance_sent(&mut self, revision: u64) {
        self.performance_sent_revision = self.performance_sent_revision.max(revision);
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

    fn record_dialog_tab_view(&mut self, dialog: String, tab: String, landing: bool) {
        let (Some(dialog), Some(tab)) = (
            sanitize_dimension_value(dialog),
            sanitize_dimension_value(tab),
        ) else {
            return;
        };
        let key = (dialog, tab);
        let Some(usage) = ensure_entry(&mut self.dialog_tabs, key.clone(), MAX_DIALOG_TAB_KEYS)
        else {
            return;
        };
        usage.views = increment(usage.views);
        if landing {
            usage.landings = increment(usage.landings);
        }
        let revision = self.advance_revision();
        if let Some(usage) = self.dialog_tabs.get_mut(&key) {
            usage.revision = revision;
        }
    }

    fn record_long_frame(&mut self, route: String, dialog: Option<String>, duration_ms: u32) {
        let Some(route) = sanitize_dimension_value(route) else {
            return;
        };
        let dialog = dialog.and_then(sanitize_dimension_value);
        let key = (route, dialog);
        record_slow_duration(
            &mut self.long_frames,
            key,
            MAX_LONG_FRAME_KEYS,
            duration_ms,
            &mut self.revision,
        );
    }

    fn record_slow_command(&mut self, command: String, duration_ms: u32) {
        let Some(command) = sanitize_dimension_value(command) else {
            return;
        };
        record_slow_duration(
            &mut self.slow_commands,
            command,
            MAX_SLOW_COMMAND_KEYS,
            duration_ms,
            &mut self.revision,
        );
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

impl SlowDurationUsage {
    fn record(&mut self, duration_ms: u32) -> bool {
        if self.count >= MAX_COUNT {
            return false;
        }
        let duration_ms = duration_ms.min(MAX_DURATION_MS);
        self.count += 1;
        self.total_ms = self.total_ms.saturating_add(duration_ms).min(MAX_TOTAL_MS);
        self.max_ms = self.max_ms.max(duration_ms);
        let bucket = SLOW_DURATION_BUCKET_BOUNDS_MS
            .iter()
            .take_while(|bound| duration_ms >= **bound)
            .count();
        self.buckets[bucket] += 1;
        true
    }

    fn is_reportable_since(&self, sent_revision: u64) -> bool {
        self.revision > sent_revision && self.total_ms >= SLOW_DURATION_REPORT_MIN_TOTAL_MS
    }

    fn stats(&self) -> SlowDurationStats {
        SlowDurationStats {
            count: self.count,
            total_ms: self.total_ms,
            max_ms: self.max_ms,
            buckets: self.buckets,
        }
    }
}

fn record_slow_duration<K: Eq + std::hash::Hash + std::fmt::Debug + Clone>(
    map: &mut HashMap<K, SlowDurationUsage>,
    key: K,
    cap: usize,
    duration_ms: u32,
    revision: &mut u64,
) {
    if duration_ms < SLOW_DURATION_THRESHOLD_MS {
        return;
    }
    let Some(usage) = ensure_entry(map, key, cap) else {
        return;
    };
    if !usage.record(duration_ms) {
        return;
    }
    *revision = revision.saturating_add(1);
    usage.revision = *revision;
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

fn ensure_entry<K: Eq + std::hash::Hash + std::fmt::Debug, T: Default>(
    map: &mut HashMap<K, T>,
    key: K,
    cap: usize,
) -> Option<&mut T> {
    if !map.contains_key(&key) && map.len() >= cap {
        tracing::debug!("telemetry dimension cap reached; dropping {key:?}");
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
    fn dialog_tab_views_keep_landings_separate_from_chosen_views() {
        let mut acc = TelemetryAccumulator::default();
        for (tab, landing) in [("info", true), ("groups", false), ("info", true)] {
            acc.record(TelemetryClientEvent::DialogTabView {
                dialog: "user".into(),
                tab: tab.into(),
                landing,
            });
        }
        acc.record(TelemetryClientEvent::DialogTabView {
            dialog: "world".into(),
            tab: "info".into(),
            landing: false,
        });

        let first = acc
            .dialog_tab_snapshot()
            .expect("dialog tabs should be dirty");
        let rows = first
            .entries
            .iter()
            .map(|entry| {
                (
                    entry.dialog.as_str(),
                    entry.tab.as_str(),
                    entry.views,
                    entry.landings,
                )
            })
            .collect::<Vec<_>>();
        assert_eq!(
            rows,
            vec![
                ("user", "groups", 1, None),
                ("user", "info", 2, Some(2)),
                ("world", "info", 1, None),
            ]
        );
        acc.mark_dialog_tabs_sent(first.revision);
        assert!(acc.dialog_tab_snapshot().is_none());

        acc.record(TelemetryClientEvent::DialogTabView {
            dialog: "user".into(),
            tab: "groups".into(),
            landing: false,
        });
        let second = acc.dialog_tab_snapshot().expect("new view should be dirty");
        assert_eq!(second.entries.len(), 1);
        assert_eq!(second.entries[0].views, 2);
    }

    fn long_frame(route: &str, dialog: Option<&str>, duration_ms: u32) -> TelemetryClientEvent {
        TelemetryClientEvent::LongFrame {
            route: route.into(),
            dialog: dialog.map(Into::into),
            duration_ms,
        }
    }

    #[test]
    fn long_frames_below_threshold_or_report_floor_stay_unreported() {
        let mut acc = TelemetryAccumulator::default();
        acc.record(long_frame("feed", None, 199));
        acc.record(long_frame("feed", None, 400));
        acc.record(long_frame("feed", None, 500));
        assert!(acc.performance_snapshot().is_none());

        acc.record(long_frame("feed", None, 3_000));
        acc.record(long_frame("feed", Some("user"), 1_200));
        let snapshot = acc.performance_snapshot().expect("frames over the floor");
        let rows = snapshot
            .frames
            .iter()
            .map(|entry| {
                (
                    entry.route.as_str(),
                    entry.dialog.as_deref(),
                    entry.stats.clone(),
                )
            })
            .collect::<Vec<_>>();
        assert_eq!(
            rows,
            vec![
                (
                    "feed",
                    None,
                    SlowDurationStats {
                        count: 3,
                        total_ms: 3_900,
                        max_ms: 3_000,
                        buckets: [1, 1, 0, 1],
                    }
                ),
                (
                    "feed",
                    Some("user"),
                    SlowDurationStats {
                        count: 1,
                        total_ms: 1_200,
                        max_ms: 1_200,
                        buckets: [0, 0, 1, 0],
                    }
                ),
            ]
        );
        assert!(snapshot.commands.is_empty());
    }

    #[test]
    fn slow_commands_resend_cumulative_stats_only_after_new_slow_calls() {
        let mut acc = TelemetryAccumulator::default();
        for duration_ms in [150, 600, 700] {
            acc.record(TelemetryClientEvent::SlowCommand {
                command: "app__example".into(),
                duration_ms,
            });
        }
        let first = acc.performance_snapshot().expect("command over the floor");
        assert_eq!(first.commands.len(), 1);
        assert_eq!(first.commands[0].stats.count, 2);
        assert_eq!(first.commands[0].stats.total_ms, 1_300);
        acc.mark_performance_sent(first.revision);
        assert!(acc.performance_snapshot().is_none());

        acc.record(TelemetryClientEvent::SlowCommand {
            command: "app__example".into(),
            duration_ms: 100,
        });
        assert!(acc.performance_snapshot().is_none());

        acc.record(TelemetryClientEvent::SlowCommand {
            command: "app__example".into(),
            duration_ms: 250,
        });
        let second = acc.performance_snapshot().expect("new slow call");
        assert_eq!(second.commands[0].stats.count, 3);
        assert_eq!(second.commands[0].stats.buckets, [1, 2, 0, 0]);
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
