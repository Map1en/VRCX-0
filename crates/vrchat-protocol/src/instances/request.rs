use crate::http_api::{require_text, HttpApiError};
pub use vrcx_0_contracts::vrchat_requests::{
    InstanceCreateGroupAccessType, InstanceCreateMinimumAvatarPerformance, InstanceCreateRegion,
    InstanceCreateRequest, InstanceCreateType,
};

pub(super) fn validated_instance_create_request(
    mut request: InstanceCreateRequest,
) -> Result<InstanceCreateRequest, HttpApiError> {
    request.world_id = require_text(request.world_id, "VrchatInstanceCreate requires worldId.")?;
    if !request.world_id.starts_with("wrld_") {
        return Err(HttpApiError::Custom(
            "VrchatInstanceCreate requires a worldId beginning with wrld_.".into(),
        ));
    }

    request.owner_id = request
        .owner_id
        .map(crate::http_api::normalize_text)
        .filter(|owner_id| !owner_id.is_empty());

    match request.r#type {
        InstanceCreateType::Public => {
            if request.owner_id.is_some() {
                return Err(HttpApiError::Custom(
                    "VrchatInstanceCreate public instances cannot have an ownerId.".into(),
                ));
            }
        }
        InstanceCreateType::Group => {
            if !request
                .owner_id
                .as_deref()
                .is_some_and(|owner_id| owner_id.starts_with("grp_"))
            {
                return Err(HttpApiError::Custom(
                    "VrchatInstanceCreate group instances require a group ownerId.".into(),
                ));
            }
        }
        InstanceCreateType::Friends | InstanceCreateType::Hidden | InstanceCreateType::Private => {
            if !request
                .owner_id
                .as_deref()
                .is_some_and(|owner_id| owner_id.starts_with("usr_"))
            {
                return Err(HttpApiError::Custom(
                    "VrchatInstanceCreate private instances require a user ownerId.".into(),
                ));
            }
        }
    }

    if request.can_request_invite && request.r#type != InstanceCreateType::Private {
        return Err(HttpApiError::Custom(
            "VrchatInstanceCreate canRequestInvite only applies to private instances.".into(),
        ));
    }

    if request.r#type == InstanceCreateType::Group {
        let group_access_type = request.group_access_type.ok_or_else(|| {
            HttpApiError::Custom(
                "VrchatInstanceCreate group instances require groupAccessType.".into(),
            )
        })?;
        if request.role_ids.is_some() && group_access_type != InstanceCreateGroupAccessType::Members
        {
            return Err(HttpApiError::Custom(
                "VrchatInstanceCreate roleIds require members group access.".into(),
            ));
        }
        if let Some(role_ids) = &mut request.role_ids {
            for role_id in role_ids {
                *role_id = require_text(
                    role_id.as_str(),
                    "VrchatInstanceCreate roleIds cannot contain blank values.",
                )?;
                if !role_id.starts_with("grol_") {
                    return Err(HttpApiError::Custom(
                        "VrchatInstanceCreate roleIds must begin with grol_.".into(),
                    ));
                }
            }
        }
    } else if request.group_access_type.is_some()
        || request.queue_enabled.is_some()
        || request.role_ids.is_some()
        || request.age_gate.is_some()
        || request.minimum_avatar_performance.is_some()
    {
        return Err(HttpApiError::Custom(
            "VrchatInstanceCreate group options require a group instance.".into(),
        ));
    }

    request.display_name = non_blank_text(request.display_name);
    request.description = non_blank_text(request.description);
    request.category_id = non_blank_text(request.category_id);
    if request
        .category_id
        .as_deref()
        .is_some_and(|category_id| !category_id.starts_with("icat_"))
    {
        return Err(HttpApiError::Custom(
            "VrchatInstanceCreate categoryId must begin with icat_.".into(),
        ));
    }
    request.vibe_ids = non_empty_list(request.vibe_ids, "vibeIds")?;
    if let Some(vibe_ids) = &request.vibe_ids {
        if vibe_ids.iter().any(|vibe_id| !vibe_id.starts_with("ivib_")) {
            return Err(HttpApiError::Custom(
                "VrchatInstanceCreate vibeIds must begin with ivib_.".into(),
            ));
        }
    }
    request.languages = non_empty_list(request.languages, "languages")?;

    Ok(request)
}

const MAX_DISCOVERY_LIST_LEN: usize = 3;

fn non_blank_text(value: Option<String>) -> Option<String> {
    value
        .map(crate::http_api::normalize_text)
        .filter(|value| !value.is_empty())
}

fn non_empty_list(
    values: Option<Vec<String>>,
    field: &str,
) -> Result<Option<Vec<String>>, HttpApiError> {
    let Some(values) = values.filter(|values| !values.is_empty()) else {
        return Ok(None);
    };
    if values.len() > MAX_DISCOVERY_LIST_LEN {
        return Err(HttpApiError::Custom(format!(
            "VrchatInstanceCreate {field} accepts at most {MAX_DISCOVERY_LIST_LEN} values."
        )));
    }
    values
        .into_iter()
        .map(|value| {
            require_text(
                value,
                &format!("VrchatInstanceCreate {field} cannot contain blank values."),
            )
        })
        .collect::<Result<Vec<_>, _>>()
        .map(Some)
}
