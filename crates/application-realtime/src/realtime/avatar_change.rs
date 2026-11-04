use vrcx_0_application_core::FileCache;
use vrcx_0_contracts::feed_live::FeedLiveEntry;
use vrcx_0_contracts::FileMetadataOutput;
use vrcx_0_core::files::extract_file_id;

use crate::realtime::FriendIconChange;

pub(crate) async fn resolve_avatar_feed_entry(
    file_cache: &FileCache,
    endpoint: &str,
    change: &FriendIconChange,
) -> Option<FeedLiveEntry> {
    let next = resolve_avatar_image_file(file_cache, endpoint, &change.next_icon_url).await?;
    let previous = resolve_avatar_image_file(file_cache, endpoint, &change.previous_icon_url).await;
    Some(FeedLiveEntry::Avatar {
        created_at: change.created_at.clone(),
        user_id: change.user_id.clone(),
        display_name: change.display_name.clone(),
        owner_id: next.owner_id,
        previous_owner_id: previous
            .as_ref()
            .map(|file| file.owner_id.clone())
            .unwrap_or_default(),
        avatar_name: next.avatar_name.unwrap_or_default(),
        previous_avatar_name: previous
            .as_ref()
            .and_then(|file| file.avatar_name.clone())
            .unwrap_or_default(),
        current_avatar_image_url: change.next_icon_url.clone(),
        previous_current_avatar_image_url: previous
            .map(|_| change.previous_icon_url.clone())
            .unwrap_or_default(),
        owner_user_id: String::new(),
    })
}

async fn resolve_avatar_image_file(
    file_cache: &FileCache,
    endpoint: &str,
    icon_url: &str,
) -> Option<FileMetadataOutput> {
    let file_id = extract_file_id(icon_url)?;
    file_cache
        .resolve(endpoint, &file_id)
        .await
        .filter(|file| file.avatar_name.is_some())
}
