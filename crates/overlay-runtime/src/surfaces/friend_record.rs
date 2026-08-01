use vrcx_0_core::friends::FriendRecord;
use vrcx_0_runtime_host::notification::{user_image_url_128, UserImageSources};

pub(crate) fn friend_record_avatar_url(
    record: &FriendRecord,
    allow_user_icon: bool,
    endpoint: &str,
) -> String {
    user_image_url_128(
        UserImageSources {
            user_icon: extra_str(record, "userIcon"),
            profile_pic_override_thumbnail: extra_str(record, "profilePicOverrideThumbnail"),
            profile_pic_override: extra_str(record, "profilePicOverride"),
            thumbnail_url: extra_str(record, "thumbnailUrl"),
            current_avatar_thumbnail_image_url: record.current_avatar_thumbnail_image_url.as_str(),
            current_avatar_image_url: record.current_avatar_image_url.as_str(),
        },
        allow_user_icon,
        endpoint,
    )
    .unwrap_or_default()
}

pub(crate) fn extra_str<'a>(record: &'a FriendRecord, key: &str) -> &'a str {
    record
        .extra
        .get(key)
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default()
}
