use std::time::Duration;

use serde_json::Value;
use vrcx_0_core::json::JsonExt;

pub const PROFILE_BIO_SCAN_INTERVAL: Duration = Duration::from_secs(3);
pub const PROFILE_BIO_SCAN_PAUSE: Duration = Duration::from_secs(5 * 60);
pub const PROFILE_BIO_SCAN_MIN_AGE: Duration = Duration::from_secs(12 * 60 * 60);

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ProfileBioRecord {
    pub bio: String,
    pub bio_links: Vec<String>,
    pub checked_at: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProfileBioObservation {
    pub user_id: String,
    pub display_name: String,
    pub bio: String,
    pub bio_links: Vec<String>,
}

impl ProfileBioObservation {
    pub fn from_profile(profile: &Value) -> Option<Self> {
        let user_id = profile.trimmed_text("id");
        if !user_id.starts_with("usr_") {
            return None;
        }
        Some(Self {
            user_id,
            display_name: profile.trimmed_text("displayName"),
            bio: profile.get("bio")?.as_str()?.trim().to_string(),
            bio_links: profile
                .get("bioLinks")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|link| !link.is_empty())
                .map(str::to_string)
                .collect(),
        })
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RecordedProfileBio {
    pub observation: ProfileBioObservation,
    pub observed_at: String,
}
