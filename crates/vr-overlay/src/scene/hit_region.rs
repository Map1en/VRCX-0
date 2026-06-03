use crate::model::Rect;

#[derive(Clone, Debug, PartialEq)]
pub struct HitRegion {
    pub id: String,
    pub rect: Rect,
}
