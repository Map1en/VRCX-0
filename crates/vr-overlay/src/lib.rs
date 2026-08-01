pub mod model;
#[cfg(feature = "slint-ui")]
pub mod slint_ui;
pub mod surfaces;

pub use model::{
    grab_follow_transform, grab_follow_transform_facing, ray_quad_intersection, recenter_transform,
    Color, DeviceChip, DeviceRole, DeviceStatus, FeedKind, FeedLine, FeedRelation, FeedSeverity,
    OverlayFooter, OverlayQuadSize, OverlaySize, OverlaySurfaceId, OverlayTransform, Ray3,
    RayQuadHit, Rect, RgbaFrame, UvPoint, FRIENDS_PANEL_ID, FRIENDS_PANEL_LASER_LEFT_SURFACE_ID,
    FRIENDS_PANEL_LASER_RIGHT_SURFACE_ID, FRIENDS_PANEL_SURFACE_ID, LEGACY_DUMMY_PANEL_ID,
    MAIN_SURFACE_ID,
};
#[cfg(all(feature = "slint-ui", feature = "friends-panel"))]
pub use slint_ui::{
    default_slint_panel_size, SlintPanelEvent, SlintPanelFrame, SlintPanelHost,
    SlintPanelPointerEvent, SlintPanelRenderStats,
};
#[cfg(feature = "slint-ui")]
pub use slint_ui::{SlintHmdRenderer, SlintWristRenderer};
#[cfg(feature = "friends-panel")]
pub use surfaces::friends_panel::{
    FavoriteFriendsPanelModel, FriendPanelCategory, FriendPanelRow, FriendPanelRowActions,
    FriendPanelRowPrimaryAction, FriendPanelStatusTone, FriendPanelStrings,
};
pub use surfaces::main::{AvatarBitmap, MainSurfaceModel, ToastCard};
pub use surfaces::wrist::WristSurfaceModel;
