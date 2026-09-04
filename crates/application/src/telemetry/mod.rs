mod accumulator;
mod event;
mod privacy;
mod runtime;
mod scale;

pub use accumulator::TelemetryAccumulator;
pub use event::TelemetryClientEvent;
pub use privacy::{build_error_detail, sanitize_error_summary};
pub use runtime::{
    FeedbackSubmitError, TelemetryClientErrorInput, TelemetryEnvironment, TelemetryPostFuture,
    TelemetryRuntime, TelemetryRuntimeDeps, TelemetryTransport,
};
pub use scale::TelemetryDatabaseScale;
