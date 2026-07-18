use serde_json::Value;

pub use vrcx_0_application_core::BackgroundCapabilitySession;

pub(super) fn parse_response_json(data: &str) -> Option<Value> {
    serde_json::from_str(data).ok()
}
