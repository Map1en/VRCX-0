use std::sync::Arc;

use super::RuntimeHostState;

impl RuntimeHostState {
    pub fn release_profile_lock(&self) {
        self._profile_lock.release();
    }

    pub fn start_data_services(&self) {
        self.runtime_context
            .runtime
            .set_host_services_started(true, "Runtime host services installed.");
        self.runtime_context
            .background_jobs
            .register_frontend_job_catalog();
        self.runtime_context.background_jobs.register_job(
            "startupRecovery",
            "rust-host",
            None,
            "checkpoint",
            "Rust runtime startup recovery checkpoint recorded; no durable recovery queue is configured.",
        );
        self.runtime_context.runtime.record_phase(
            "startupRecovery",
            "checkpoint",
            "Rust runtime startup recovery checkpoint recorded; no durable recovery queue is configured.",
        );
        self.runtime_context.sync.record(
            "startupRecovery",
            "observed",
            "Rust runtime startup recovery checkpoint recorded; no durable recovery queue is configured.",
            0,
        );
        self.runtime_context
            .background_jobs
            .start_database_optimize_loop(Arc::clone(&self.db), self.runtime_context.tasks.clone());
        self.runtime_context
            .vrc_status
            .start_loop(self.runtime_context.tasks.clone());
        self.profile_backup.start_scheduler();
    }
}
