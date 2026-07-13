use std::path::PathBuf;

use chrono::{DateTime, Duration, Utc};
use vrcx_0_persistence::config::ConfigRepository;

use crate::{Result, PROFILE_BACKUP_DIRECTORY_CONFIG_KEY};

pub const PROFILE_BACKUP_AUTOMATIC_ENABLED_CONFIG_KEY: &str = "profileBackupAutomaticEnabled";
pub const PROFILE_BACKUP_INTERVAL_DAYS_CONFIG_KEY: &str = "profileBackupIntervalDays";
pub const PROFILE_BACKUP_RETENTION_COUNT_CONFIG_KEY: &str = "profileBackupRetentionCount";
pub const PROFILE_BACKUP_LAST_AUTOMATIC_AT_CONFIG_KEY: &str = "profileBackupLastAutomaticAt";

pub const PROFILE_BACKUP_INTERVAL_DAYS_DEFAULT: u32 = 7;
pub const PROFILE_BACKUP_INTERVAL_DAYS_MIN: u32 = 1;
pub const PROFILE_BACKUP_INTERVAL_DAYS_MAX: u32 = 30;
pub const PROFILE_BACKUP_RETENTION_COUNT_DEFAULT: usize = 3;
pub const PROFILE_BACKUP_RETENTION_COUNT_MIN: usize = 1;
pub const PROFILE_BACKUP_RETENTION_COUNT_MAX: usize = 10;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AutomaticProfileBackupPolicy {
    pub enabled: bool,
    pub target_directory: PathBuf,
    pub interval_days: u32,
    pub retention_count: usize,
    pub last_success_at: Option<DateTime<Utc>>,
}

impl AutomaticProfileBackupPolicy {
    pub fn load(config: &ConfigRepository) -> Result<Self> {
        let enabled = config.get_bool(PROFILE_BACKUP_AUTOMATIC_ENABLED_CONFIG_KEY, false)?;
        let target_directory = PathBuf::from(
            config
                .get_string(PROFILE_BACKUP_DIRECTORY_CONFIG_KEY, "")?
                .trim(),
        );
        let interval_days = parse_bounded_u32(
            &config.get_string(PROFILE_BACKUP_INTERVAL_DAYS_CONFIG_KEY, "")?,
            PROFILE_BACKUP_INTERVAL_DAYS_MIN,
            PROFILE_BACKUP_INTERVAL_DAYS_MAX,
            PROFILE_BACKUP_INTERVAL_DAYS_DEFAULT,
        );
        let retention_count = parse_bounded_usize(
            &config.get_string(PROFILE_BACKUP_RETENTION_COUNT_CONFIG_KEY, "")?,
            PROFILE_BACKUP_RETENTION_COUNT_MIN,
            PROFILE_BACKUP_RETENTION_COUNT_MAX,
            PROFILE_BACKUP_RETENTION_COUNT_DEFAULT,
        );
        let last_success_at = config
            .get_string(PROFILE_BACKUP_LAST_AUTOMATIC_AT_CONFIG_KEY, "")?
            .trim()
            .parse::<DateTime<Utc>>()
            .ok();

        Ok(Self {
            enabled,
            target_directory,
            interval_days,
            retention_count,
            last_success_at,
        })
    }

    pub fn is_configured(&self) -> bool {
        !self.target_directory.as_os_str().is_empty()
    }

    pub fn is_due_at(&self, now: DateTime<Utc>) -> bool {
        if !self.enabled || !self.is_configured() {
            return false;
        }
        self.last_success_at.is_none_or(|last_success_at| {
            now >= last_success_at + Duration::days(i64::from(self.interval_days))
        })
    }

    pub fn seconds_until_due_at(&self, now: DateTime<Utc>) -> u64 {
        self.last_success_at
            .map(|last_success_at| {
                (last_success_at + Duration::days(i64::from(self.interval_days)) - now)
                    .to_std()
                    .map_or(0, |remaining| remaining.as_secs())
            })
            .unwrap_or(0)
    }
}

fn parse_bounded_u32(value: &str, min: u32, max: u32, default_value: u32) -> u32 {
    value
        .trim()
        .parse::<u32>()
        .ok()
        .filter(|value| (min..=max).contains(value))
        .unwrap_or(default_value)
}

fn parse_bounded_usize(value: &str, min: usize, max: usize, default_value: usize) -> usize {
    value
        .trim()
        .parse::<usize>()
        .ok()
        .filter(|value| (min..=max).contains(value))
        .unwrap_or(default_value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn policy(last_success_at: Option<DateTime<Utc>>) -> AutomaticProfileBackupPolicy {
        AutomaticProfileBackupPolicy {
            enabled: true,
            target_directory: PathBuf::from("backups"),
            interval_days: 7,
            retention_count: 3,
            last_success_at,
        }
    }

    #[test]
    fn first_automatic_backup_is_due_when_enabled_and_configured() {
        let now = Utc.with_ymd_and_hms(2026, 7, 13, 12, 0, 0).unwrap();
        assert!(policy(None).is_due_at(now));
    }

    #[test]
    fn automatic_backup_becomes_due_at_the_configured_interval() {
        let last_success = Utc.with_ymd_and_hms(2026, 7, 6, 12, 0, 0).unwrap();
        let automatic = policy(Some(last_success));

        assert!(!automatic.is_due_at(last_success + Duration::days(7) - Duration::seconds(1)));
        assert_eq!(
            automatic.seconds_until_due_at(last_success + Duration::days(6)),
            24 * 60 * 60
        );
        assert!(automatic.is_due_at(last_success + Duration::days(7)));
    }

    #[test]
    fn disabled_or_unconfigured_policy_is_never_due() {
        let now = Utc.with_ymd_and_hms(2026, 7, 13, 12, 0, 0).unwrap();
        let mut automatic = policy(None);
        automatic.enabled = false;
        assert!(!automatic.is_due_at(now));

        automatic.enabled = true;
        automatic.target_directory = PathBuf::new();
        assert!(!automatic.is_due_at(now));
    }

    #[test]
    fn invalid_values_fall_back_to_bounded_defaults() {
        assert_eq!(
            parse_bounded_u32("0", 1, 30, PROFILE_BACKUP_INTERVAL_DAYS_DEFAULT),
            PROFILE_BACKUP_INTERVAL_DAYS_DEFAULT
        );
        assert_eq!(
            parse_bounded_u32("30", 1, 30, PROFILE_BACKUP_INTERVAL_DAYS_DEFAULT),
            30
        );
        assert_eq!(
            parse_bounded_usize("11", 1, 10, PROFILE_BACKUP_RETENTION_COUNT_DEFAULT),
            PROFILE_BACKUP_RETENTION_COUNT_DEFAULT
        );
    }
}
