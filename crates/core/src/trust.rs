//! Port of TS `computeTrustLevel`/`computeUserPlatform` (`shared/utils/userTransforms.ts`); keep in lockstep.

#[derive(Clone, Debug, PartialEq)]
pub struct TrustLevelInfo {
    pub trust_level: String,
    pub trust_class: String,
    pub trust_sort_num: f64,
    pub is_moderator: bool,
    pub is_troll: bool,
    pub is_probable_troll: bool,
}

pub fn compute_trust_level(tags: &[String], developer_type: &str) -> TrustLevelInfo {
    let mut is_moderator = !developer_type.is_empty() && developer_type != "none";
    let mut is_troll = false;
    let mut is_probable_troll = false;
    let mut trust_level = "Visitor".to_string();
    let mut trust_class = "x-tag-untrusted".to_string();
    let mut trust_sort_num = 1.0;

    if tags.iter().any(|tag| tag == "admin_moderator") {
        is_moderator = true;
    }
    if tags.iter().any(|tag| tag == "system_troll") {
        is_troll = true;
    }
    if tags.iter().any(|tag| tag == "system_probable_troll") && !is_troll {
        is_probable_troll = true;
    }

    if tags.iter().any(|tag| tag == "system_trust_veteran") {
        trust_level = "Trusted User".into();
        trust_class = "x-tag-veteran".into();
        trust_sort_num = 5.0;
    } else if tags.iter().any(|tag| tag == "system_trust_trusted") {
        trust_level = "Known User".into();
        trust_class = "x-tag-trusted".into();
        trust_sort_num = 4.0;
    } else if tags.iter().any(|tag| tag == "system_trust_known") {
        trust_level = "User".into();
        trust_class = "x-tag-known".into();
        trust_sort_num = 3.0;
    } else if tags.iter().any(|tag| tag == "system_trust_basic") {
        trust_level = "New User".into();
        trust_class = "x-tag-basic".into();
        trust_sort_num = 2.0;
    }

    if is_troll || is_probable_troll {
        trust_sort_num += 0.1;
    }
    if is_moderator {
        trust_sort_num += 0.3;
    }

    TrustLevelInfo {
        trust_level,
        trust_class,
        trust_sort_num,
        is_moderator,
        is_troll,
        is_probable_troll,
    }
}

pub fn compute_user_platform(platform: &str, last_platform: &str) -> String {
    if !platform.is_empty() && platform != "offline" && platform != "web" {
        return platform.to_string();
    }
    last_platform.to_string()
}

pub fn trust_level_differs(previous: &str, next: &str) -> bool {
    let previous = previous.trim();
    let next = next.trim();
    !previous.is_empty() && !next.is_empty() && previous != next
}

pub fn trust_level_changed(previous: &str, next: &str) -> bool {
    let previous = previous.trim();
    let next = next.trim();
    trust_level_differs(previous, next)
        && !matches!(
            (previous, next),
            ("Trusted User", "Veteran User") | ("Veteran User", "Trusted User")
        )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tags(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    #[test]
    fn no_tags_is_untrusted_visitor() {
        let trust = compute_trust_level(&[], "");
        assert_eq!(trust.trust_level, "Visitor");
        assert_eq!(trust.trust_class, "x-tag-untrusted");
        assert_eq!(trust.trust_sort_num, 1.0);
        assert!(!trust.is_moderator);
    }

    #[test]
    fn veteran_tag_is_highest_base_rank() {
        let trust = compute_trust_level(&tags(&["system_trust_veteran"]), "");
        assert_eq!(trust.trust_level, "Trusted User");
        assert_eq!(trust.trust_class, "x-tag-veteran");
        assert_eq!(trust.trust_sort_num, 5.0);
    }

    #[test]
    fn moderator_and_troll_adjust_sort_num() {
        let moderator = compute_trust_level(&tags(&["system_trust_known"]), "internal");
        assert!(moderator.is_moderator);
        assert!((moderator.trust_sort_num - 3.3).abs() < f64::EPSILON);

        let troll = compute_trust_level(&tags(&["system_trust_basic", "system_troll"]), "");
        assert!(troll.is_troll);
        assert!((troll.trust_sort_num - 2.1).abs() < f64::EPSILON);
    }

    #[test]
    fn probable_troll_only_when_not_already_troll() {
        let trust = compute_trust_level(&tags(&["system_troll", "system_probable_troll"]), "");
        assert!(trust.is_troll);
        assert!(!trust.is_probable_troll);
    }

    #[test]
    fn platform_prefers_live_then_falls_back_to_last() {
        assert_eq!(
            compute_user_platform("standalonewindows", "android"),
            "standalonewindows"
        );
        assert_eq!(compute_user_platform("web", "android"), "android");
        assert_eq!(compute_user_platform("offline", "android"), "android");
        assert_eq!(compute_user_platform("", "android"), "android");
    }

    #[test]
    fn legacy_trusted_and_veteran_labels_are_equivalent() {
        assert!(trust_level_differs("Trusted User", "Veteran User"));
        assert!(!trust_level_changed("Trusted User", "Veteran User"));
        assert!(!trust_level_changed("Veteran User", "Trusted User"));
        assert!(!trust_level_differs("", "Known User"));
        assert!(!trust_level_changed("", "Known User"));
        assert!(trust_level_changed("Known User", "Trusted User"));
    }
}
