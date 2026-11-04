use std::sync::Arc;

use chrono::Utc;
use vrcx_0_application::social::{
    scan_next_profile_bio, ProfileBioOutcome, ProfileBioScanDeps, ProfileBioScanOutcome,
    ProfileBioScanPacer, BACKGROUND_PROFILE_BIO_SCAN_JOB, PROFILE_BIO_SCAN_CONFIG_KEY,
    PROFILE_BIO_SCAN_INTERVAL, PROFILE_BIO_SCAN_PAUSE,
};
use vrcx_0_core::OwnerId;

use super::super::{background_capability_session_identity, emit_background_warning};
use super::BackgroundTickContext;

pub(in crate::state) async fn run_background_profile_bio_scan(
    context: &BackgroundTickContext<'_>,
    pacer: &ProfileBioScanPacer,
) {
    let enabled = context
        .runtime_context
        .config_store()
        .get_bool(PROFILE_BIO_SCAN_CONFIG_KEY, false)
        .unwrap_or(false);
    let Some(session) =
        background_capability_session_identity(context.session_slot).filter(|_| enabled)
    else {
        context.background_jobs.mark_scheduled(
            BACKGROUND_PROFILE_BIO_SCAN_JOB,
            "Background profile bio scan is disabled or waiting for an authenticated session.",
            PROFILE_BIO_SCAN_INTERVAL.as_secs(),
        );
        return;
    };
    let now = Utc::now();
    context.background_jobs.mark_running(
        BACKGROUND_PROFILE_BIO_SCAN_JOB,
        "Checking the next friend profile bio.",
    );
    let store = vrcx_0_outbound_adapters::LocalProfileBioStore::new(Arc::clone(context.db));
    let remote = vrcx_0_outbound_adapters::VrchatRequestAdapter::new(Arc::clone(context.web));
    let deps = ProfileBioScanDeps {
        store: &store,
        remote: &remote,
        realtime: context.realtime_runtime,
        pacer,
        owner: OwnerId::new(session.current_user_id),
        endpoint: session.endpoint,
    };
    match scan_next_profile_bio(&deps, now).await {
        Ok(outcome) => {
            context
                .background_jobs
                .mark_completed(BACKGROUND_PROFILE_BIO_SCAN_JOB, scan_detail(&outcome));
        }
        Err(error) => {
            tracing::warn!(error = %error, "background profile bio scan failed");
            emit_background_warning(
                context.runtime_context,
                context.backend_runtime,
                format!("profile bio scan failed: {error}."),
            );
            context
                .background_jobs
                .mark_failed(BACKGROUND_PROFILE_BIO_SCAN_JOB, error.to_string());
            pacer.pause(now);
        }
    }
    let delay = if pacer.is_paused(now) {
        PROFILE_BIO_SCAN_PAUSE
    } else {
        PROFILE_BIO_SCAN_INTERVAL
    };
    context.background_jobs.mark_scheduled(
        BACKGROUND_PROFILE_BIO_SCAN_JOB,
        "Next profile bio check is waiting.",
        delay.as_secs(),
    );
}

fn scan_detail(outcome: &ProfileBioScanOutcome) -> String {
    match outcome {
        ProfileBioScanOutcome::Paused => "profile bio scan is paused.".into(),
        ProfileBioScanOutcome::Idle => "all friend bios are fresh.".into(),
        ProfileBioScanOutcome::Checked { user_id, outcome } => {
            let result = match outcome {
                ProfileBioOutcome::Baseline => "first bio recorded",
                ProfileBioOutcome::Unchanged => "bio unchanged",
                ProfileBioOutcome::Changed => "bio change recorded",
                ProfileBioOutcome::Deferred => "bio change deferred",
            };
            format!("checked {user_id}: {result}.")
        }
        ProfileBioScanOutcome::Throttled { status } => {
            format!("VRChat pushed back with HTTP {status}; scan paused.")
        }
        ProfileBioScanOutcome::Unavailable { user_id, status } => {
            format!("profile {user_id} unavailable (HTTP {status}).")
        }
    }
}
