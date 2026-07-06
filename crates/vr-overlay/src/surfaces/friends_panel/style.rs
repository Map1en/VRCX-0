use crate::model::Color;

pub const BACKGROUND: Color = Color::rgba(8, 13, 20, 240);
pub const PANEL: Color = Color::rgba(16, 24, 34, 248);
pub const PANEL_ALT: Color = Color::rgba(24, 35, 48, 248);
pub const PANEL_HOVER: Color = Color::rgba(38, 53, 72, 248);
pub const PANEL_PRESSED: Color = Color::rgba(18, 122, 150, 255);
pub const TEXT: Color = Color::rgba(248, 250, 252, 255);
pub const MUTED: Color = Color::rgba(148, 163, 184, 255);
pub const SUBTLE: Color = Color::rgba(100, 116, 139, 255);
pub const DIVIDER: Color = Color::rgba(51, 65, 85, 255);
pub const ACCENT: Color = Color::rgba(45, 212, 191, 255);
pub const FAVORITE: Color = Color::rgba(250, 204, 21, 255);
pub const ONLINE: Color = Color::rgba(34, 197, 94, 255);
pub const ACTIVE: Color = Color::rgba(45, 212, 191, 255);
pub const BUSY: Color = Color::rgba(248, 113, 113, 255);
pub const ASK_ME: Color = Color::rgba(251, 191, 36, 255);
pub const OFFLINE: Color = Color::rgba(100, 116, 139, 255);

pub const MARGIN: f32 = 32.0;
pub const HEADER_Y: f32 = 30.0;
pub const LIST_Y: f32 = 154.0;
pub const ROW_HEIGHT: f32 = 106.0;
pub const CATEGORY_WIDTH: f32 = 230.0;
pub const CATEGORY_GAP: f32 = 18.0;
pub const CATEGORY_HEIGHT: f32 = 58.0;
pub const AVATAR_SIZE: f32 = 72.0;
pub const VISIBLE_ROWS: usize = 5;
pub const VISIBLE_CATEGORIES: usize = 7;
