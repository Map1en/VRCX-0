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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expected_byte_len_returns_rgba_byte_count_for_normal_sizes() {
        assert_eq!(
            RgbaFrame::expected_byte_len(OverlaySize::new(16, 8)),
            Some(16 * 8 * 4)
        );
    }

    #[test]
    fn expected_byte_len_allows_zero_sized_frames() {
        assert_eq!(
            RgbaFrame::expected_byte_len(OverlaySize::new(0, 0)),
            Some(0)
        );
    }

    #[test]
    fn expected_byte_len_returns_none_when_dimensions_overflow_usize() {
        assert_eq!(
            RgbaFrame::expected_byte_len(OverlaySize::new(u32::MAX, u32::MAX)),
            None
        );
    }

    #[test]
    fn is_valid_len_checks_exact_rgba_buffer_size() {
        let size = OverlaySize::new(2, 3);
        assert!(RgbaFrame::new(size, vec![0; 2 * 3 * 4]).is_valid_len());
        assert!(!RgbaFrame::new(size, vec![0; 2 * 3 * 4 - 1]).is_valid_len());
        assert!(!RgbaFrame::new(OverlaySize::new(u32::MAX, u32::MAX), Vec::new()).is_valid_len());
    }
}
