use serde::{Deserialize, Serialize};

use super::geometry::OverlaySize;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RgbaFrame {
    pub size: OverlaySize,
    pub data: Vec<u8>,
}

impl RgbaFrame {
    pub fn new(size: OverlaySize, data: Vec<u8>) -> Self {
        Self { size, data }
    }

    pub fn expected_byte_len(size: OverlaySize) -> Option<usize> {
        let width = usize::try_from(size.width).ok()?;
        let height = usize::try_from(size.height).ok()?;
        width.checked_mul(height)?.checked_mul(4)
    }

    pub fn is_valid_len(&self) -> bool {
        Self::expected_byte_len(self.size).is_some_and(|expected| expected == self.data.len())
    }
}
