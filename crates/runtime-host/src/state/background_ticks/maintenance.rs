use std::sync::Arc;

use vrcx_0_application::{PrintCleanupDeps, PrintCleanupTrigger};

use super::super::{
    background_capability_session, BACKGROUND_PRINT_CLEANUP_CADENCE_SECONDS,
    BACKGROUND_PRINT_CLEANUP_JOB,
};
use super::BackgroundTickContext;

pub(in crate::state) fn run_background_print_cleanup(context: &BackgroundTickContext<'_>) {
    context.background_jobs.mark_running(
        BACKGROUND_PRINT_CLEANUP_JOB,
        "Scheduling print auto cleanup.",
    );
    let Some(session) = background_capability_session(context.session_slot) else {
        context.background_jobs.mark_scheduled(
            BACKGROUND_PRINT_CLEANUP_JOB,
            "Print auto cleanup is waiting for an authenticated session.",
            BACKGROUND_PRINT_CLEANUP_CADENCE_SECONDS,
        );
        return;
    };

    context.runtime_context.print_cleanup.schedule(
        &context.runtime_context.tasks,
        PrintCleanupDeps {
            db: Arc::clone(context.db),
            web: Arc::clone(context.web),
            event_bus: context.runtime_context.event_bus.clone(),
        },
        PrintCleanupTrigger {
            user_id: session.current_user_id,
            endpoint: session.endpoint,
            reason: "background".to_string(),
        },
    );
    context
        .background_jobs
        .mark_completed(BACKGROUND_PRINT_CLEANUP_JOB, "Print auto cleanup queued.");
    context.background_jobs.mark_scheduled(
        BACKGROUND_PRINT_CLEANUP_JOB,
        "Next print auto cleanup fallback is waiting.",
        BACKGROUND_PRINT_CLEANUP_CADENCE_SECONDS,
    );
}
