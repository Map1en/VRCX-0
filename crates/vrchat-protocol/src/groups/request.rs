pub use vrcx_0_contracts::vrchat_requests::{
    GroupGalleryMutation, GroupMemberPatch, GroupMemberVisibility, GroupPostMutation,
    GroupPostVisibility, GroupProfileJoinState, GroupProfileUpdate, GroupRoleMutation,
};

use crate::http_api::{require_text, HttpApiError};

pub(super) fn validated_post(
    mut post: GroupPostMutation,
) -> Result<GroupPostMutation, HttpApiError> {
    post.title = require_text(post.title, "VrchatGroupPost requires title.")?;
    post.text = require_text(post.text, "VrchatGroupPost requires text.")?;
    if post.visibility == GroupPostVisibility::Public && !post.role_ids.is_empty() {
        return Err(HttpApiError::Custom(
            "VrchatGroupPost roleIds require group visibility.".into(),
        ));
    }
    for role_id in &mut post.role_ids {
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
    Ok(post)
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

const GROUP_PROFILE_LIST_LIMIT: usize = 3;

pub(super) fn validated_profile_update(
    mut profile: GroupProfileUpdate,
) -> Result<GroupProfileUpdate, HttpApiError> {
    profile.name = require_text(profile.name, "VrchatGroupUpdate requires name.")?;
    if profile.name.chars().count() < 3 {
        return Err(HttpApiError::Custom(
            "VrchatGroupUpdate name must be at least 3 characters.".into(),
        ));
    }
    let short_code_len = profile.short_code.chars().count();
    if !(3..=6).contains(&short_code_len)
        || !profile
            .short_code
            .chars()
            .all(|ch| ch.is_ascii_uppercase() || ch.is_ascii_digit())
    {
        return Err(HttpApiError::Custom(
            "VrchatGroupUpdate shortCode must be 3-6 uppercase letters or digits.".into(),
        ));
    }
    if profile.languages.len() > GROUP_PROFILE_LIST_LIMIT
        || profile.links.len() > GROUP_PROFILE_LIST_LIMIT
    {
        return Err(HttpApiError::Custom(
            "VrchatGroupUpdate allows at most 3 languages and 3 links.".into(),
        ));
    }
    for value in profile.languages.iter_mut().chain(profile.links.iter_mut()) {
        *value = require_text(
            value.as_str(),
            "VrchatGroupUpdate languages and links cannot contain blank values.",
        )?;
    }
    for file_id in [&profile.icon_id, &profile.banner_id].into_iter().flatten() {
        if !file_id.starts_with("file_") {
            return Err(HttpApiError::Custom(
                "VrchatGroupUpdate iconId and bannerId must begin with file_.".into(),
            ));
        }
    }
    Ok(profile)
}
