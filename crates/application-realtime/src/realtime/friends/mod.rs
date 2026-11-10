mod presence;
mod runtime;

pub(crate) use presence::baseline_friend_view;
pub use runtime::RealtimeFriendsRuntime;
pub(crate) use runtime::{
    apply_friend_number, display_name_feed_entry, trust_level_feed_entry, FriendBaselineEffects,
    RosterDelta, SyntheticFriendEvent,
};
