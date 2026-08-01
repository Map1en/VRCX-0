use vrcx_0_i18n::OverlayMessageKey;

pub(crate) use vrcx_0_runtime_host::notification::{OverlayLocale, OverlayLocalizer};

pub(crate) trait OverlayPanelLocalizer {
    #[cfg(feature = "friends-panel")]
    fn panel_display_location(&self, location: &str, world_name: &str, group_name: &str) -> String;
    #[cfg(feature = "friends-panel")]
    fn friends_panel_strings(&self) -> vrcx_0_vr_overlay::FriendPanelStrings;
    #[cfg(feature = "friends-panel")]
    fn friends_panel_traveling_label(&self) -> String;
    #[cfg(feature = "friends-panel")]
    fn friends_panel_favorites_online_label(&self) -> String;
    #[cfg(feature = "friends-panel")]
    fn friends_panel_same_instance_label(&self) -> String;
    #[cfg(feature = "friends-panel")]
    fn friends_panel_local_favorites_label(&self) -> String;
    #[cfg(feature = "friends-panel")]
    fn friends_panel_private_label(&self) -> String;
    #[cfg(feature = "friends-panel")]
    fn friends_panel_offline_label(&self) -> String;
    fn generic_instance_location(&self) -> String;
}

impl OverlayPanelLocalizer for OverlayLocalizer {
    #[cfg(feature = "friends-panel")]
    fn panel_display_location(&self, location: &str, world_name: &str, group_name: &str) -> String {
        self.display_location_without_instance(location, world_name, group_name)
    }

    #[cfg(feature = "friends-panel")]
    fn friends_panel_strings(&self) -> vrcx_0_vr_overlay::FriendPanelStrings {
        vrcx_0_vr_overlay::FriendPanelStrings {
            title: self.label(OverlayMessageKey::OverlayFriendsPanelTitle),
            all_label: self.label(OverlayMessageKey::OverlayFriendsPanelAll),
            empty_label: self.label(OverlayMessageKey::OverlayFriendsPanelEmpty),
            note_label: self.label(OverlayMessageKey::OverlayFriendsPanelNote),
            memo_label: self.label(OverlayMessageKey::OverlayFriendsPanelMemo),
            open_label: self.label(OverlayMessageKey::OverlayFriendsPanelOpen),
            request_label: self.label(OverlayMessageKey::OverlayFriendsPanelRequest),
            invite_label: self.label(OverlayMessageKey::OverlayFriendsPanelInvite),
        }
    }

    #[cfg(feature = "friends-panel")]
    fn friends_panel_traveling_label(&self) -> String {
        self.label(OverlayMessageKey::OverlayFriendsPanelTraveling)
    }

    #[cfg(feature = "friends-panel")]
    fn friends_panel_favorites_online_label(&self) -> String {
        self.label(OverlayMessageKey::OverlayFriendsPanelFavoritesOnline)
    }

    #[cfg(feature = "friends-panel")]
    fn friends_panel_same_instance_label(&self) -> String {
        self.label(OverlayMessageKey::OverlayFriendsPanelSameInstance)
    }

    #[cfg(feature = "friends-panel")]
    fn friends_panel_local_favorites_label(&self) -> String {
        self.label(OverlayMessageKey::OverlayFriendsPanelLocalFavorites)
    }

    #[cfg(feature = "friends-panel")]
    fn friends_panel_private_label(&self) -> String {
        self.label(OverlayMessageKey::OverlayFriendsPanelPrivate)
    }

    #[cfg(feature = "friends-panel")]
    fn friends_panel_offline_label(&self) -> String {
        self.label(OverlayMessageKey::OverlayFriendsPanelOffline)
    }

    fn generic_instance_location(&self) -> String {
        self.label(OverlayMessageKey::OverlayGenericInstanceLocation)
    }
}

#[cfg(all(test, feature = "friends-panel"))]
mod tests {
    use super::*;

    #[test]
    fn panel_display_location_never_appends_instance_id() {
        let localizer = OverlayLocalizer::with_instance_id(OverlayLocale::En, true);

        let display =
            localizer.panel_display_location("wrld_a:12345~region(use)", "Public World", "");

        assert!(!display.contains("#12345"));
    }
}
