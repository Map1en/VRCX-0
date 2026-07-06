use crate::model::{OverlaySize, Rect, UvPoint};

#[derive(Clone, Debug, PartialEq)]
pub struct HitRegion {
    pub id: String,
    pub rect: Rect,
}

impl HitRegion {
    pub fn contains_uv(&self, size: OverlaySize, uv: UvPoint) -> bool {
        if !(0.0..=1.0).contains(&uv.x) || !(0.0..=1.0).contains(&uv.y) {
            return false;
        }
        let x = uv.x * size.width.max(1) as f32;
        let y = uv.y * size.height.max(1) as f32;
        self.rect.contains_point(x, y)
    }
}
