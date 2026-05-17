use std::time::Duration;

use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};

const CRASH_RELAUNCH_DEDUPE_MS: i64 = 120_000;
const NOVR_RELAUNCH_DELAY: Duration = Duration::from_secs(2);
const VR_RELAUNCH_DELAY: Duration = Duration::from_secs(8);

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CrashRelaunchPlan {
    pub location: String,
    pub desktop_mode: bool,
    pub delay: Duration,
    pub launch_arguments: String,
    pub launch_path_override: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CrashRelaunchConfig {
    pub enabled: bool,
    pub is_game_no_vr: bool,
    pub launch_arguments: String,
    pub launch_path_override: String,
}

pub fn plan_crash_relaunch(
    config: &CrashRelaunchConfig,
    location: &str,
    closed_gracefully: bool,
    now_ms: i64,
    last_crash_at_ms: Option<i64>,
) -> Option<CrashRelaunchPlan> {
    if !config.enabled || closed_gracefully || !is_real_instance(location) {
        return None;
    }
    if last_crash_at_ms.is_some_and(|last| now_ms - last < CRASH_RELAUNCH_DEDUPE_MS) {
        return None;
    }

    Some(CrashRelaunchPlan {
        location: location.to_string(),
        desktop_mode: config.is_game_no_vr,
        delay: if config.is_game_no_vr {
            NOVR_RELAUNCH_DELAY
        } else {
            VR_RELAUNCH_DELAY
        },
        launch_arguments: build_launch_arguments(
            location,
            &config.launch_arguments,
            config.is_game_no_vr,
        ),
        launch_path_override: config.launch_path_override.clone(),
    })
}

fn build_launch_arguments(location: &str, launch_arguments: &str, desktop_mode: bool) -> String {
    let launch_url = format!(
        "vrchat://launch?ref=vrcx.app&id={}",
        utf8_percent_encode(location, NON_ALPHANUMERIC)
    );
    let mut args = vec![launch_url];
    if !launch_arguments.trim().is_empty() {
        args.push(launch_arguments.trim().to_string());
    }
    if desktop_mode {
        args.push("--no-vr".into());
    }
    args.join(" ")
}

fn is_real_instance(location: &str) -> bool {
    if location.is_empty() {
        return false;
    }
    match location {
        ":"
        | "offline"
        | "offline:offline"
        | "private"
        | "private:private"
        | "traveling"
        | "traveling:traveling" => return false,
        _ => {}
    }
    !location.starts_with("local")
}

#[cfg(test)]
mod tests {
    use super::{plan_crash_relaunch, CrashRelaunchConfig};

    fn config() -> CrashRelaunchConfig {
        CrashRelaunchConfig {
            enabled: true,
            is_game_no_vr: false,
            launch_arguments: "--profile=0".into(),
            launch_path_override: String::new(),
        }
    }

    #[test]
    fn skips_crash_relaunch_when_disabled_or_not_real_location() {
        let mut disabled = config();
        disabled.enabled = false;
        assert!(plan_crash_relaunch(&disabled, "wrld_test:1", false, 10_000, None).is_none());
        assert!(plan_crash_relaunch(&config(), "traveling", false, 10_000, None).is_none());
        assert!(plan_crash_relaunch(&config(), "wrld_test:1", true, 10_000, None).is_none());
    }

    #[test]
    fn builds_relaunch_plan_with_desktop_mode_arguments() {
        let mut cfg = config();
        cfg.is_game_no_vr = true;
        let plan = plan_crash_relaunch(&cfg, "wrld_test:1", false, 10_000, None).unwrap();
        assert!(plan
            .launch_arguments
            .contains("vrchat://launch?ref=vrcx.app&id=wrld"));
        assert!(plan.launch_arguments.contains("--profile=0"));
        assert!(plan.launch_arguments.ends_with("--no-vr"));
        assert_eq!(plan.delay.as_secs(), 2);
    }

    #[test]
    fn dedupes_recent_crash_relaunch_attempts() {
        assert!(
            plan_crash_relaunch(&config(), "wrld_test:1", false, 10_000, Some(9_000)).is_none()
        );
        assert!(
            plan_crash_relaunch(&config(), "wrld_test:1", false, 200_000, Some(9_000)).is_some()
        );
    }
}
