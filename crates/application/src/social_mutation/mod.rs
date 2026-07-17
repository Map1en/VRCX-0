mod service;
pub mod types;

pub use service::{accept_friend_request, cancel_friend_request, send_friend_request, unfriend};
#[cfg(test)]
pub(crate) use service::{apply_friend_request_accept_locally, apply_unfriend_locally};
pub use types::{
    SocialFriendMutationInput, SocialFriendMutationOutcome, SocialFriendMutationStatus,
    SocialFriendRequestAcceptInput, SocialFriendRequestCancelInput, SocialMutationDeps,
};
