use serde::{Deserialize, Serialize};
use vrcx_0_core::friends::UserStatus;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
pub enum ContentFilter {
    #[serde(rename = "content_adult")]
    Adult,
    #[serde(rename = "content_gore")]
    Gore,
    #[serde(rename = "content_horror")]
    Horror,
    #[serde(rename = "content_sex")]
    Sex,
    #[serde(rename = "content_violence")]
    Violence,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ProfileBackgroundType {
    Default,
    Gradient,
    Texture,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ProfileBannerType {
    AvatarBanner,
    CustomImage,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CurrentUserProfileUpdateRequest {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bio: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bio_links: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_icon: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub banner_type: Option<ProfileBannerType>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub banner_custom_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub background_type: Option<ProfileBackgroundType>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub background_gradient_bottom: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub background_gradient_top: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub background_texture_id: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CurrentUserUpdateRequest {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub home_location: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<UserStatus>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status_description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pronouns: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub allow_avatar_copying: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_booping_enabled: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub has_shared_connections_opt_out: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub has_discord_friends_opt_out: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_filters: Option<Vec<ContentFilter>>,
}
