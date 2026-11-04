use crate::FriendPlace;
use vrcx_0_core::friends::{FriendBaselineEntry, FriendRecord};
use vrcx_0_core::presence::{Place, PresenceEntry, PresencePlace, PresenceView};

use super::evidence::Evidence;
use super::model::Phase;

pub(crate) fn baseline_friend_view(entry: &FriendBaselineEntry) -> (FriendRecord, PresenceEntry) {
    let evidence = Evidence::from_baseline(&entry.presence);
    let view = presence_view(&Phase::initial(&evidence.claim, 0, false));
    (entry.record.clone(), PresenceEntry { rev: 0, view })
}

pub(crate) fn dwell_place(phase: &Phase) -> FriendPlace {
    let Some(state) = phase.online_state() else {
        return FriendPlace::Elsewhere {
            location: "offline".to_string(),
        };
    };
    match &state.place {
        Place::Instance(tag) => FriendPlace::Present {
            location: tag.clone(),
            since_ms: state.since_ms,
        },
        Place::Traveling { to } => FriendPlace::Traveling {
            destination: to.clone().unwrap_or_default(),
            since_ms: state.since_ms,
        },
        place => FriendPlace::Elsewhere {
            location: place.tag().to_string(),
        },
    }
}

pub(crate) fn presence_view(phase: &Phase) -> PresenceView {
    match phase {
        Phase::Offline { .. } => PresenceView::Offline,
        Phase::Active { platform, .. } => PresenceView::Active {
            platform: platform.clone(),
        },
        Phase::Online(state) => PresenceView::Online {
            place: PresencePlace::new(&state.place),
            platform: state.platform.clone(),
            online_since_ms: state.online_since_ms,
        },
        Phase::PendingOffline {
            held,
            target,
            deadline_ms,
        } => PresenceView::PendingOffline {
            place: PresencePlace::new(&held.place),
            platform: held.platform.clone(),
            online_since_ms: held.online_since_ms,
            target: *target,
            deadline_ms: *deadline_ms,
        },
    }
}
