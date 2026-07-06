mod activity;
mod best_time;
mod caveats;
mod changes;
mod companions;
mod copresence;
mod fading;
mod friend_log;
mod graph;
mod helpers;
mod invites;
mod recall;
mod resolve;
mod types;
mod worlds;

pub use activity::get_friend_activity_pattern;
pub use best_time::get_best_time_to_play;
pub use caveats::{data_caveats_resource, global_caveats};
pub use changes::get_friend_changes;
pub use companions::get_companions_of;
pub use copresence::get_copresence_summary;
pub use fading::get_fading_friends;
pub use friend_log::{get_friend_log, get_friend_log_first_created_at};
pub use graph::{get_friend_circles, get_social_graph};
pub use helpers::normalize_access_bucket;
pub use invites::get_invite_history;
pub use recall::recall_encounter;
pub use resolve::resolve_user_by_name;
pub use types::{
    ActivityBucket, BestTimeBucketRow, BestTimeFriend, BestTimeToPlayInput, BestTimeToPlayOutput,
    CompanionOfRow, CompanionWorldRow, CompanionsOfInput, CompanionsOfOutput, CopresenceGroupBy,
    CopresenceSummaryInput, CopresenceSummaryOutput, CopresenceSummaryRow, FadingFriendRow,
    FadingFriendsInput, FadingFriendsOutput, FavoriteLocalInput, FavoriteOutput,
    FriendActivityPatternInput, FriendActivityPatternOutput, FriendActivityPatternRow,
    FriendChangeEvent, FriendChangeKind, FriendChangeRow, FriendChangesInput, FriendChangesOutput,
    FriendCirclePair, FriendCircleRow, FriendCirclesInput, FriendCirclesOutput, FriendLogInput,
    FriendLogOutput, FriendLogRow, InviteDirection, InviteHistoryInput, InviteHistoryOutput,
    InviteHistoryRow, RecallEncounterInput, RecallEncounterOutput, RecallEncounterRow,
    ResolveUserInput, ResolveUserOutput, ResolvedUserRow, SearchWorldsVisitedInput,
    SearchWorldsVisitedOutput, SocialGraphEdge, SocialGraphInput, SocialGraphNode,
    SocialGraphOutput, TimeWindow, VisitedWorldRow,
};
pub use worlds::{favorite_local, search_worlds_visited};

#[cfg(test)]
#[path = "../../tests/social_aggregates/activity_tests.rs"]
mod activity_tests;
#[cfg(test)]
#[path = "../../tests/social_aggregates/caveats_tests.rs"]
mod caveats_tests;
#[cfg(test)]
#[path = "../../tests/social_aggregates/changes_tests.rs"]
mod changes_tests;
#[cfg(test)]
#[path = "../../tests/social_aggregates/companions_tests.rs"]
mod companions_tests;
#[cfg(test)]
#[path = "../../tests/social_aggregates/copresence_tests.rs"]
mod copresence_tests;
#[cfg(test)]
#[path = "../../tests/social_aggregates/friend_log_tests.rs"]
mod friend_log_tests;
#[cfg(test)]
#[path = "../../tests/social_aggregates/graph_tests.rs"]
mod graph_tests;
#[cfg(test)]
#[path = "../../tests/social_aggregates/invites_tests.rs"]
mod invites_tests;
#[cfg(test)]
#[path = "../../tests/social_aggregates/recall_tests.rs"]
mod recall_tests;
#[cfg(test)]
#[path = "../../tests/social_aggregates/support.rs"]
mod test_support;
#[cfg(test)]
#[path = "../../tests/social_aggregates/worlds_tests.rs"]
mod worlds_tests;
