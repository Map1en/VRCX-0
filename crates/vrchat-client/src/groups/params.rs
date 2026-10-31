pub use vrcx_0_contracts::vrchat_requests::GroupMemberSort;

pub(super) const fn member_sort_param(sort: GroupMemberSort) -> &'static str {
    match sort {
        GroupMemberSort::JoinedAtAsc => "joinedAt:asc",
        GroupMemberSort::JoinedAtDesc => "joinedAt:desc",
    }
}
