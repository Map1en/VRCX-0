use crate::model::{OverlaySize, UvPoint};

use crate::surfaces::main::AvatarBitmap;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FriendPanelStatusTone {
    Online,
    Active,
    Busy,
    AskMe,
    Offline,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FriendPanelCategory {
    pub key: String,
    pub label: String,
    pub count: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FriendPanelRowPrimaryAction {
    Open,
    Request,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct FriendPanelRowActions {
    pub primary: Option<FriendPanelRowPrimaryAction>,
    pub invite: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct FriendPanelRow {
    pub section_label: Option<String>,
    pub user_id: String,
    pub display_name: String,
    pub status: FriendPanelStatusTone,
    pub location_text: String,
    pub is_traveling: bool,
    pub traveling_text: Option<String>,
    pub note: Option<String>,
    pub memo: Option<String>,
    pub avatar: Option<AvatarBitmap>,
    pub actions: FriendPanelRowActions,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FriendPanelStrings {
    pub title: String,
    pub all_label: String,
    pub empty_label: String,
    pub note_label: String,
    pub memo_label: String,
    pub open_label: String,
    pub request_label: String,
    pub invite_label: String,
}

impl Default for FriendPanelStrings {
    fn default() -> Self {
        Self {
            title: "Favorite Friends".to_string(),
            all_label: "All".to_string(),
            empty_label: "No favorite friends online".to_string(),
            note_label: "Note".to_string(),
            memo_label: "Local Note".to_string(),
            open_label: "Open".to_string(),
            request_label: "Request".to_string(),
            invite_label: "Invite".to_string(),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct FavoriteFriendsPanelModel {
    pub size: OverlaySize,
    pub categories: Vec<FriendPanelCategory>,
    pub selected_category_key: String,
    pub rows: Vec<FriendPanelRow>,
    pub armed_action_region_id: Option<String>,
    pub pointer_uv: Option<UvPoint>,
    pub status_message: Option<String>,
    pub strings: FriendPanelStrings,
}

impl Default for FavoriteFriendsPanelModel {
    fn default() -> Self {
        let strings = FriendPanelStrings::default();
        Self {
            size: OverlaySize::new(1080, 720),
            categories: vec![FriendPanelCategory {
                key: "all".to_string(),
                label: strings.all_label.clone(),
                count: 0,
            }],
            selected_category_key: "all".to_string(),
            rows: Vec::new(),
            armed_action_region_id: None,
            pointer_uv: None,
            status_message: None,
            strings,
        }
    }
}

impl FavoriteFriendsPanelModel {
    pub fn disarm_action(&mut self) {
        self.armed_action_region_id = None;
    }
}
