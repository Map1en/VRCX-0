mod aggregate;
mod build;
mod people;
mod store;
#[cfg(test)]
mod tests;

pub use build::activity_page_view_build;
pub use store::ActivityPageStore;
pub use vrcx_0_contracts::activity_page::{
    ActivityCompanionOrder, ActivityPageBuildInput, ActivityPageView, ActivitySeriesBucket,
};

const PAYLOAD_VERSION: i64 = 4;

fn activity_iso_from_ms(ms: i64) -> String {
    chrono::DateTime::<chrono::Utc>::from_timestamp_millis(ms)
        .unwrap_or_else(chrono::Utc::now)
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}
