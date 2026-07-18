use std::path::PathBuf;
use std::sync::atomic::Ordering;

use chrono::{DateTime, Utc};
use vrcx_0_persistence::profile_backup::has_pending_profile_restore;
use vrcx_0_persistence::storage::StorageService;

use vrcx_0_application_core::sleep_until_due_or_stopped;

use super::super::ProfileBackupSettings;
use super::{
    ProfileBackupRuntime, AUTO_CADENCE, AUTO_ENABLED_KEY, AUTO_INTERVAL_DAYS_KEY, AUTO_JOB,
    AUTO_RETAIN_EXTRA_KEY, AUTO_START_DELAY, AUTO_TARGET_DIR_KEY, LAST_AUTO_AT_KEY,
};

impl ProfileBackupRuntime {
    pub fn settings(&self) -> ProfileBackupSettings {
        read_settings(&self.inner.storage)
    }

    pub fn target_dir_requiring_grant(&self, requested: &ProfileBackupSettings) -> Option<String> {
        let target = requested.auto_target_dir.trim();
        if target.is_empty() || target == self.settings().auto_target_dir {
            None
        } else {
            Some(target.to_string())
        }
    }

    pub fn set_settings(&self, settings: ProfileBackupSettings) -> ProfileBackupSettings {
        let previous = self.settings();
        let target_dir = settings.auto_target_dir.trim().to_string();
        let normalized = ProfileBackupSettings {
            auto_enabled: settings.auto_enabled && !target_dir.is_empty(),
            auto_interval_days: settings.auto_interval_days.clamp(1, 30),
            auto_retain_extra: settings.auto_retain_extra.clamp(1, 5),
            auto_target_dir: target_dir,
            last_auto_at: previous.last_auto_at.clone(),
        };
        write_settings(&self.inner.storage, &normalized);
        if !previous.auto_enabled && normalized.auto_enabled && normalized.last_auto_at.is_none() {
            self.schedule_auto_check();
        }
        normalized
    }

    pub fn start_scheduler(&self) {
        if self
            .inner
            .scheduler_started
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return;
        }
        self.inner.background_jobs.register_job(
            AUTO_JOB,
            "rust",
            Some(AUTO_CADENCE.as_secs()),
            "scheduled",
            "Profile backup scheduler is waiting.",
        );
        let runtime = self.clone();
        self.inner
            .tasks
            .spawn_cancellable(move |stop_token| async move {
                loop {
                    runtime.schedule_auto_check();
                    if !sleep_until_due_or_stopped(AUTO_CADENCE, &stop_token).await {
                        return;
                    }
                }
            });
    }

    fn schedule_auto_check(&self) {
        if self
            .inner
            .auto_check_scheduled
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return;
        }
        self.inner.background_jobs.mark_scheduled(
            AUTO_JOB,
            "Profile backup eligibility check is scheduled.",
            AUTO_START_DELAY.as_secs(),
        );
        let runtime = self.clone();
        self.inner
            .tasks
            .spawn_cancellable(move |stop_token| async move {
                if sleep_until_due_or_stopped(AUTO_START_DELAY, &stop_token).await {
                    runtime.run_auto_if_due();
                }
                runtime
                    .inner
                    .auto_check_scheduled
                    .store(false, Ordering::Release);
            });
    }

    fn run_auto_if_due(&self) {
        let settings = self.settings();
        if !settings.auto_enabled
            || settings.auto_target_dir.is_empty()
            || !is_auto_backup_due(
                settings.last_auto_at.as_deref(),
                Utc::now(),
                settings.auto_interval_days,
            )
        {
            return;
        }
        if self.inner.operation_running.load(Ordering::Acquire)
            || has_pending_profile_restore(&self.inner.app_data)
        {
            return;
        }
        self.inner
            .background_jobs
            .mark_running(AUTO_JOB, "Profile backup is running.");
        let outcome = self.start_auto_backup(PathBuf::from(settings.auto_target_dir));
        if !outcome.accepted {
            self.inner.background_jobs.mark_scheduled(
                AUTO_JOB,
                "Profile backup was deferred.",
                AUTO_CADENCE.as_secs(),
            );
        }
    }
}

fn read_settings(storage: &StorageService) -> ProfileBackupSettings {
    ProfileBackupSettings {
        auto_enabled: storage
            .get(AUTO_ENABLED_KEY)
            .is_some_and(|value| value == "true"),
        auto_interval_days: parse_clamped_u8(storage.get(AUTO_INTERVAL_DAYS_KEY), 7, 1, 30),
        auto_retain_extra: parse_clamped_u8(storage.get(AUTO_RETAIN_EXTRA_KEY), 2, 1, 5),
        auto_target_dir: storage.get(AUTO_TARGET_DIR_KEY).unwrap_or_default(),
        last_auto_at: storage
            .get(LAST_AUTO_AT_KEY)
            .filter(|value| !value.is_empty()),
    }
}

fn write_settings(storage: &StorageService, settings: &ProfileBackupSettings) {
    storage.set(AUTO_ENABLED_KEY.into(), settings.auto_enabled.to_string());
    storage.set(
        AUTO_INTERVAL_DAYS_KEY.into(),
        settings.auto_interval_days.to_string(),
    );
    storage.set(
        AUTO_RETAIN_EXTRA_KEY.into(),
        settings.auto_retain_extra.to_string(),
    );
    storage.set(AUTO_TARGET_DIR_KEY.into(), settings.auto_target_dir.clone());
}

fn parse_clamped_u8(value: Option<String>, default: u8, min: u8, max: u8) -> u8 {
    value
        .and_then(|value| value.parse::<u8>().ok())
        .unwrap_or(default)
        .clamp(min, max)
}

pub(super) fn is_auto_backup_due(
    last: Option<&str>,
    now: DateTime<Utc>,
    interval_days: u8,
) -> bool {
    let Some(last) = last.and_then(|value| DateTime::parse_from_rfc3339(value).ok()) else {
        return true;
    };
    let last = last.with_timezone(&Utc);
    last > now || now.signed_duration_since(last).num_days() >= i64::from(interval_days)
}
