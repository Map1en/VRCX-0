use std::sync::Arc;

use crate::model::{Color, FeedRelation, FeedSeverity, OverlaySize};

#[derive(Clone, Debug, PartialEq)]
pub struct AvatarBitmap {
    pub width: u32,
    pub height: u32,
    pub rgba: Arc<[u8]>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ToastCard {
    pub actor_name: String,
    pub relation: FeedRelation,
    pub action: String,
    pub severity: FeedSeverity,
    pub avatar: Option<AvatarBitmap>,
    pub show_avatar: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct MainSurfaceModel {
    pub size: OverlaySize,
    pub dark_background: bool,
    pub accent: Color,
    pub toasts: Vec<ToastCard>,
}
