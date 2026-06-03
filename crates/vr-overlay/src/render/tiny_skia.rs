use cosmic_text::{Attrs, Buffer, Color as TextColor, FontSystem, Metrics, Shaping, SwashCache};
use tiny_skia::{FillRule, Paint, PathBuilder, Pixmap, Rect as SkiaRect, Stroke, Transform};

use crate::{
    model::{Color, RgbaFrame},
    scene::{DrawCommand, OverlayScene, TextStyle},
    OverlayRenderer,
};

use super::OverlayRenderError;

pub struct TinySkiaRenderer {
    font_system: FontSystem,
    cache: SwashCache,
}

impl TinySkiaRenderer {
    pub fn new() -> Self {
        let mut font_system = FontSystem::new();
        if let Some(family) = preferred_cjk_family(&font_system) {
            font_system.db_mut().set_sans_serif_family(family);
        }
        Self {
            font_system,
            cache: SwashCache::new(),
        }
    }
}

impl Default for TinySkiaRenderer {
    fn default() -> Self {
        Self::new()
    }
}

impl OverlayRenderer for TinySkiaRenderer {
    fn render(&mut self, scene: &OverlayScene) -> Result<RgbaFrame, OverlayRenderError> {
        if scene.size.width == 0 || scene.size.height == 0 {
            return Err(OverlayRenderError::InvalidSize {
                width: scene.size.width,
                height: scene.size.height,
            });
        }
        let Some(mut pixmap) = Pixmap::new(scene.size.width, scene.size.height) else {
            return Err(OverlayRenderError::InvalidSize {
                width: scene.size.width,
                height: scene.size.height,
            });
        };
        pixmap.fill(to_skia_color(Color::rgba(0, 0, 0, 0)));

        for command in &scene.commands {
            match command {
                DrawCommand::FillRect { rect, color } => {
                    if let Some(rect) = SkiaRect::from_xywh(rect.x, rect.y, rect.width, rect.height)
                    {
                        let mut paint = Paint::default();
                        paint.set_color(to_skia_color(*color));
                        pixmap.fill_rect(rect, &paint, Transform::identity(), None);
                    }
                }
                DrawCommand::StrokeRect { rect, color, width } => {
                    let Some(rect) = SkiaRect::from_xywh(rect.x, rect.y, rect.width, rect.height)
                    else {
                        continue;
                    };
                    let mut builder = PathBuilder::new();
                    builder.push_rect(rect);
                    let Some(path) = builder.finish() else {
                        continue;
                    };
                    let mut paint = Paint::default();
                    paint.set_color(to_skia_color(*color));
                    let stroke = Stroke {
                        width: *width,
                        ..Stroke::default()
                    };
                    pixmap.stroke_path(&path, &paint, &stroke, Transform::identity(), None);
                }
                DrawCommand::Circle {
                    center_x,
                    center_y,
                    radius,
                    color,
                } => {
                    let mut builder = PathBuilder::new();
                    builder.push_circle(*center_x, *center_y, *radius);
                    let Some(path) = builder.finish() else {
                        continue;
                    };
                    let mut paint = Paint::default();
                    paint.set_color(to_skia_color(*color));
                    pixmap.fill_path(
                        &path,
                        &paint,
                        FillRule::Winding,
                        Transform::identity(),
                        None,
                    );
                }
                DrawCommand::Text {
                    origin_x,
                    origin_y,
                    max_width,
                    text,
                    style,
                } => {
                    self.draw_text(&mut pixmap, *origin_x, *origin_y, *max_width, text, style);
                }
            }
        }

        Ok(RgbaFrame::new(scene.size, pixmap.data().to_vec()))
    }
}

impl TinySkiaRenderer {
    fn draw_text(
        &mut self,
        pixmap: &mut Pixmap,
        origin_x: f32,
        origin_y: f32,
        max_width: f32,
        text: &str,
        style: &TextStyle,
    ) {
        if text.is_empty() || max_width <= 0.0 {
            return;
        }
        let metrics = Metrics::new(style.size, style.line_height);
        let mut buffer = Buffer::new(&mut self.font_system, metrics);
        buffer.set_size(Some(max_width), Some(style.line_height));
        buffer.set_text(text, &Attrs::new(), Shaping::Advanced, None);
        let width = pixmap.width();
        let height = pixmap.height();
        let origin_x = origin_x.round() as i32;
        let origin_y = origin_y.round() as i32;
        let data = pixmap.data_mut();
        buffer.draw(
            &mut self.font_system,
            &mut self.cache,
            TextColor::rgba(style.color.r, style.color.g, style.color.b, style.color.a),
            |x, y, w, h, color| {
                blend_rect(
                    data,
                    (width, height),
                    PixelRect {
                        x: origin_x + x,
                        y: origin_y + y,
                        width: w,
                        height: h,
                    },
                    color.as_rgba(),
                );
            },
        );
    }
}

struct PixelRect {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

fn blend_rect(data: &mut [u8], surface_size: (u32, u32), rect: PixelRect, color: [u8; 4]) {
    let [r, g, b, a] = color;
    if a == 0 {
        return;
    }
    let (surface_width, surface_height) = surface_size;
    let x_start = rect.x.max(0) as u32;
    let y_start = rect.y.max(0) as u32;
    let x_end = (rect.x + rect.width as i32).clamp(0, surface_width as i32) as u32;
    let y_end = (rect.y + rect.height as i32).clamp(0, surface_height as i32) as u32;
    for py in y_start..y_end {
        for px in x_start..x_end {
            let index = ((py * surface_width + px) * 4) as usize;
            let dst_a = data[index + 3] as u16;
            let src_a = a as u16;
            let out_a = src_a + dst_a.saturating_mul(255 - src_a) / 255;
            data[index] = alpha_over(r, data[index], src_a);
            data[index + 1] = alpha_over(g, data[index + 1], src_a);
            data[index + 2] = alpha_over(b, data[index + 2], src_a);
            data[index + 3] = out_a.min(255) as u8;
        }
    }
}

fn alpha_over(src: u8, dst: u8, src_a: u16) -> u8 {
    let dst = dst as u16;
    ((src as u16 * src_a + dst * (255 - src_a)) / 255) as u8
}

fn to_skia_color(color: Color) -> tiny_skia::Color {
    tiny_skia::Color::from_rgba8(color.r, color.g, color.b, color.a)
}

fn preferred_cjk_family(font_system: &FontSystem) -> Option<String> {
    const FAMILIES: &[&str] = &[
        "Microsoft YaHei UI",
        "Microsoft YaHei",
        "Microsoft JhengHei UI",
        "Microsoft JhengHei",
        "Yu Gothic UI",
        "Noto Sans CJK SC",
        "Noto Sans CJK JP",
        "Noto Sans CJK TC",
        "Source Han Sans SC",
        "Source Han Sans JP",
        "Source Han Sans TC",
        "WenQuanYi Micro Hei",
    ];
    FAMILIES
        .iter()
        .find(|family| {
            font_system.db().faces().any(|face| {
                face.families
                    .iter()
                    .any(|(name, _)| name.eq_ignore_ascii_case(family))
            })
        })
        .map(|family| (*family).to_string())
}
