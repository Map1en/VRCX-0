mod batch;
mod service;
mod types;

pub use batch::{
    unfriend_batch, unfriend_selection, SocialUnfriendBatchInput, SocialUnfriendBatchItemResult,
    SocialUnfriendBatchItemState, SocialUnfriendBatchResult, SocialUnfriendBatchTarget,
    SOCIAL_UNFRIEND_BATCH_MAX_ITEMS,
};
pub use service::{
    accept_friend_request, accept_friend_request_notification, cancel_friend_request,
    send_friend_request, unfriend,
};
#[cfg(test)]
pub(in crate::social) use service::{apply_friend_request_accept_locally, apply_unfriend_locally};
pub use types::{
    SocialFriendMutationInput, SocialFriendMutationOutcome, SocialFriendMutationStatus,
    SocialFriendRequestAcceptInput, SocialFriendRequestCancelInput,
    SocialFriendRequestNotificationAcceptOutput, SocialFriendRequestNotificationAcceptStatus,
    SocialMutationDeps,
};
