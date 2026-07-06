mod font;
pub mod layout;
pub mod model;
pub mod render;
pub mod scene;
pub mod surfaces;

pub use font::{new_shared_overlay_font_system, SharedOverlayFontSystem};
pub use layout::TextMeasurer;
pub use model::{
    grab_follow_transform, ray_quad_intersection, recenter_transform, Color, DeviceChip,
    DeviceRole, DeviceStatus, FeedKind, FeedLine, FeedRelation, FeedSeverity, OverlayFooter,
    OverlayQuadSize, OverlaySize, OverlaySurfaceId, OverlayTransform, Ray3, RayQuadHit, Rect,
    RgbaFrame, UvPoint, MAIN_SURFACE_ID,
};
pub use render::{OverlayRenderError, OverlayRenderer, TinySkiaRenderer};
pub use scene::{DrawCommand, HitRegion, OverlayScene, TextStyle};
pub use surfaces::dummy_panel::{
    build_dummy_panel_scene, DummyPanelAction, DummyPanelModel, INTERACTIVE_DUMMY_SURFACE_ID,
};
pub use surfaces::friends_panel::{
    build_friends_panel_scene, FavoriteFriendsPanelModel, FriendPanelAction, FriendPanelCategory,
    FriendPanelRow, FriendPanelStatusTone, FriendPanelStrings, FRIENDS_PANEL_ID,
    FRIENDS_PANEL_LASER_LEFT_SURFACE_ID, FRIENDS_PANEL_LASER_RIGHT_SURFACE_ID,
    FRIENDS_PANEL_SURFACE_ID, LEGACY_DUMMY_PANEL_ID,
};
pub use surfaces::main::{build_main_scene, AvatarBitmap, MainSurfaceModel, ToastCard};
pub use surfaces::wrist::{build_wrist_scene, WristSurfaceModel};
