use crate::model::{Color, Rect};

#[derive(Clone, Debug, PartialEq)]
pub enum DrawCommand {
    FillRect {
        rect: Rect,
        color: Color,
    },
    StrokeRect {
        rect: Rect,
        color: Color,
        width: f32,
    },
    Circle {
        center_x: f32,
        center_y: f32,
        radius: f32,
        color: Color,
    },
    Text {
        origin_x: f32,
        origin_y: f32,
        max_width: f32,
        text: String,
        style: TextStyle,
    },
}

#[derive(Clone, Debug, PartialEq)]
pub struct TextStyle {
    pub size: f32,
    pub line_height: f32,
    pub color: Color,
}

impl TextStyle {
    pub const fn new(size: f32, line_height: f32, color: Color) -> Self {
        Self {
            size,
            line_height,
            color,
        }
    }
}
