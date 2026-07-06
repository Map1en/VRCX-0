use std::collections::{BTreeSet, HashMap};

use vrcx_0_integrations::telemetry::{
    build_error_detail, RouteUsageEntry, TelemetryErrorDetail, ViewModeUsageEntry,
};

use super::event::TelemetryClientEvent;

const MAX_DIMENSION_KEYS: usize = 16;
const MAX_ROUTE_KEYS: usize = 64;
const MAX_VALUE_LENGTH: usize = 64;
const MAX_DETAILS_PER_CHANNEL: usize = 64;
pub(super) const MAX_DETAILS_PER_PAYLOAD: usize = 20;
const MAX_COUNT: u32 = 100_000;

#[derive(Default)]
pub struct TelemetryAccumulator {
    current_route: Option<String>,
    view_modes: HashMap<String, ViewModeUsage>,
    routes: HashMap<String, RouteUsage>,
    assistant: AssistantHealthAccumulator,
    assistant_usage: AssistantUsageEntry,
    client_errors: DetailAccumulator,
}

#[derive(Default)]
struct ViewModeUsage {
    used: BTreeSet<String>,
    switches: u32,
}

#[derive(Default)]
struct RouteUsage {
    visits: u32,
    load_fail: u32,
    render_crash: u32,
    details: DetailAccumulator,
}

#[derive(Default)]
struct AssistantHealthAccumulator {
    tool_errors: u32,
    turn_errors: u32,
    details: DetailAccumulator,
}

#[derive(Default)]
pub(super) struct AssistantUsageEntry {
    pub(super) opens: u32,
    pub(super) api_key_configured: bool,
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

impl TelemetryAccumulator {
    pub fn record(&mut self, event: TelemetryClientEvent) {
        match event {
            TelemetryClientEvent::PageVisit { route } => self.record_page_visit(route),
            TelemetryClientEvent::RouteError {
                error_class,
                name,
                summary,
            } => self.record_route_error(error_class, name, summary),
            TelemetryClientEvent::ViewModeSwitch { dimension, value } => {
                self.record_view_mode_switch(dimension, value)
            }
            TelemetryClientEvent::AssistantOpen => {
                self.assistant_usage.opens = increment(self.assistant_usage.opens);
            }
            TelemetryClientEvent::AssistantApiKeyConfigured => {
                self.assistant_usage.api_key_configured = true;
            }
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
            }
        }
    }

    pub fn record_rust_error(&mut self, source: &str, app_version: &str, message: &str) {
        let kind = match source {
            "rust:panic" => "panic",
            "rust:tracing" => "rust_error",
            _ => return,
        };
        let detail = build_error_detail(
            kind,
            Some(source),
            None,
            None,
            Some(message),
            Some(app_version),
        );
        self.client_errors.record(detail);
    }

    pub fn route_entries(&self) -> Vec<RouteUsageEntry> {
        let mut entries = self
            .routes
            .iter()
            .map(|(route, usage)| RouteUsageEntry {
                route: route.clone(),
                visits: usage.visits,
                load_fail: (usage.load_fail > 0).then_some(usage.load_fail),
                render_crash: (usage.render_crash > 0).then_some(usage.render_crash),
                details: usage.details.serialize(),
            })
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

    pub(super) fn assistant_usage_entry(&self) -> Option<AssistantUsageEntry> {
        if self.assistant_usage.opens == 0 && !self.assistant_usage.api_key_configured {
            return None;
        }
        Some(AssistantUsageEntry {
            opens: self.assistant_usage.opens,
            api_key_configured: self.assistant_usage.api_key_configured,
        })
    }

    pub(super) fn view_mode_entries(&self) -> Vec<ViewModeUsageEntry> {
        let mut entries = self
            .view_modes
            .iter()
            .filter(|(_, usage)| !usage.used.is_empty())
            .map(|(dimension, usage)| ViewModeUsageEntry {
                dimension: dimension.clone(),
                used: usage.used.iter().cloned().collect(),
                switches: usage.switches,
            })
            .collect::<Vec<_>>();
        entries.sort_by(|left, right| left.dimension.cmp(&right.dimension));
        entries
    }

    fn record_page_visit(&mut self, route: String) {
        let Some(route) = sanitize_dimension_value(route) else {
            self.current_route = None;
            return;
        };
        self.current_route = Some(route.clone());
        let Some(usage) = ensure_entry(&mut self.routes, route, MAX_ROUTE_KEYS) else {
            return;
        };
        usage.visits = increment(usage.visits);
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

    fn record_view_mode_switch(&mut self, dimension: String, value: String) {
        let Some(dimension) = sanitize_dimension_value(dimension) else {
            return;
        };
        let Some(value) = sanitize_dimension_value(value) else {
            return;
        };
        let Some(usage) = ensure_entry(&mut self.view_modes, dimension, MAX_DIMENSION_KEYS) else {
            return;
        };
        usage.used.insert(value);
        usage.switches = increment(usage.switches);
    }

    pub(super) fn seed_view_mode(&mut self, dimension: &str, value: &str) {
        let Some(usage) = ensure_entry(
            &mut self.view_modes,
            dimension.to_string(),
            MAX_DIMENSION_KEYS,
        ) else {
            return;
        };
        usage.used.insert(value.to_string());
    }
}

impl DetailAccumulator {
    fn record(&mut self, detail: TelemetryErrorDetail) {
        let key = detail_key(&detail);
        if !self.details.contains_key(&key) && self.details.len() >= MAX_DETAILS_PER_CHANNEL {
            tracing::debug!("telemetry detail cap reached; dropping detail");
            return;
        }
        match self.details.get_mut(&key) {
            Some(existing) => existing.count = increment(existing.count),
            None => {
                self.details.insert(key, detail);
            }
        }
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
}
