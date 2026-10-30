use serde::{Deserialize, Serialize};
pub use vrcx_0_contracts::vrchat_requests::{GroupGalleryMutation, GroupRoleMutation};

use crate::http_api::{require_text, HttpApiError};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
pub enum GroupPostVisibility {
    #[serde(rename = "group")]
    Group,
    #[serde(rename = "public")]
    Public,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GroupPostMutation {
    pub title: String,
    pub text: String,
    pub send_notification: bool,
    pub visibility: GroupPostVisibility,
    #[serde(default)]
    pub role_ids: Vec<String>,
    pub image_id: Option<String>,
}

impl GroupPostMutation {
    pub(super) fn validated(mut self) -> Result<Self, HttpApiError> {
        self.title = require_text(self.title, "VrchatGroupPost requires title.")?;
        self.text = require_text(self.text, "VrchatGroupPost requires text.")?;
        if self.visibility == GroupPostVisibility::Public && !self.role_ids.is_empty() {
            return Err(HttpApiError::Custom(
                "VrchatGroupPost roleIds require group visibility.".into(),
            ));
        }
        for role_id in &mut self.role_ids {
            *role_id = require_text(
                role_id.as_str(),
                "VrchatGroupPost roleIds cannot contain blank values.",
            )?;
            if !role_id.starts_with("grol_") {
                return Err(HttpApiError::Custom(
                    "VrchatGroupPost roleIds must begin with grol_.".into(),
                ));
            }
        }
        Ok(self)
    }
}

pub(super) fn validated_role(
    mut role: GroupRoleMutation,
    require_name: bool,
) -> Result<GroupRoleMutation, HttpApiError> {
    if require_name || role.name.is_some() {
        role.name = Some(require_text(
            role.name.unwrap_or_default(),
            "VrchatGroupRole requires name.",
        )?);
    }
    Ok(role)
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
pub enum GroupProfileJoinState {
    #[serde(rename = "closed")]
    Closed,
    #[serde(rename = "invite")]
    Invite,
    #[serde(rename = "open")]
    Open,
    #[serde(rename = "request")]
    Request,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GroupProfileUpdate {
    pub name: String,
    pub short_code: String,
    pub description: String,
    pub join_state: GroupProfileJoinState,
    pub languages: Vec<String>,
    pub rules: String,
    pub links: Vec<String>,
    pub icon_id: Option<String>,
    pub banner_id: Option<String>,
    pub allow_group_join_prompt: bool,
}

const GROUP_PROFILE_LIST_LIMIT: usize = 3;

impl GroupProfileUpdate {
    pub(super) fn validated(mut self) -> Result<Self, HttpApiError> {
        self.name = require_text(self.name, "VrchatGroupUpdate requires name.")?;
        if self.name.chars().count() < 3 {
            return Err(HttpApiError::Custom(
                "VrchatGroupUpdate name must be at least 3 characters.".into(),
            ));
        }
        let short_code_len = self.short_code.chars().count();
        if !(3..=6).contains(&short_code_len)
            || !self
                .short_code
                .chars()
                .all(|ch| ch.is_ascii_uppercase() || ch.is_ascii_digit())
        {
            return Err(HttpApiError::Custom(
                "VrchatGroupUpdate shortCode must be 3-6 uppercase letters or digits.".into(),
            ));
        }
        if self.languages.len() > GROUP_PROFILE_LIST_LIMIT
            || self.links.len() > GROUP_PROFILE_LIST_LIMIT
        {
            return Err(HttpApiError::Custom(
                "VrchatGroupUpdate allows at most 3 languages and 3 links.".into(),
            ));
        }
        for value in self.languages.iter_mut().chain(self.links.iter_mut()) {
            *value = require_text(
                value.as_str(),
                "VrchatGroupUpdate languages and links cannot contain blank values.",
            )?;
        }
        for file_id in [&self.icon_id, &self.banner_id].into_iter().flatten() {
            if !file_id.starts_with("file_") {
                return Err(HttpApiError::Custom(
                    "VrchatGroupUpdate iconId and bannerId must begin with file_.".into(),
                ));
            }
        }
        Ok(self)
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
pub enum GroupMemberVisibility {
    #[serde(rename = "friends")]
    Friends,
    #[serde(rename = "hidden")]
    Hidden,
    #[serde(rename = "visible")]
    Visible,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GroupMemberPatch {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_subscribed_to_announcements: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_subscribed_to_event_announcements: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub manager_notes: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visibility: Option<GroupMemberVisibility>,
}
