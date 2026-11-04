use std::io::Cursor;

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use fast_image_resize::{FilterType, ResizeAlg, ResizeOptions, Resizer};
use image::{imageops, DynamicImage, RgbImage, RgbaImage};

use crate::error::Error;

pub const PRINT_WIDTH: u32 = 2048;
pub const PRINT_HEIGHT: u32 = 1440;
pub const PRINT_PHOTO_X: u32 = 64;
pub const PRINT_PHOTO_Y: u32 = 69;
pub const PRINT_PHOTO_WIDTH: u32 = 1920;
pub const PRINT_PHOTO_HEIGHT: u32 = 1080;
pub const PRINT_CAPTION_Y: u32 = PRINT_PHOTO_Y + PRINT_PHOTO_HEIGHT;
pub const PRINT_CAPTION_HEIGHT: u32 = PRINT_HEIGHT - PRINT_CAPTION_Y;

const PAPER: image::Rgb<u8> = image::Rgb([255, 255, 255]);

pub fn compose_screenshot_print(source: &[u8], caption_png_base64: &str) -> Result<Vec<u8>, Error> {
    let photo = image::load_from_memory(source)
        .map_err(|error| Error::Custom(format!("decode screenshot: {error}")))?;
    let caption_bytes = B64
        .decode(caption_png_base64)
        .map_err(|error| Error::Custom(format!("decode print caption: {error}")))?;
    let caption = image::load_from_memory(&caption_bytes)
        .map_err(|error| Error::Custom(format!("decode print caption: {error}")))?
        .to_rgba8();
    if caption.dimensions() != (PRINT_WIDTH, PRINT_CAPTION_HEIGHT) {
        return Err(Error::Custom("Print caption has the wrong size.".into()));
    }

    let mut print = RgbImage::from_pixel(PRINT_WIDTH, PRINT_HEIGHT, PAPER);
    let fitted = fit_photo(&photo)?;
    let x = PRINT_PHOTO_X + (PRINT_PHOTO_WIDTH - fitted.width()) / 2;
    let y = PRINT_PHOTO_Y + (PRINT_PHOTO_HEIGHT - fitted.height()) / 2;
    imageops::overlay(
        &mut print,
        &flatten_on_paper(&fitted),
        i64::from(x),
        i64::from(y),
    );
    imageops::overlay(
        &mut print,
        &flatten_on_paper(&caption),
        0,
        i64::from(PRINT_CAPTION_Y),
    );

    let mut out = Cursor::new(Vec::new());
    print
        .write_to(&mut out, image::ImageFormat::Png)
        .map_err(|error| Error::Custom(format!("encode print: {error}")))?;
    Ok(out.into_inner())
}

fn fit_photo(photo: &DynamicImage) -> Result<RgbaImage, Error> {
    let source = photo.to_rgba8();
    let scale = (f64::from(PRINT_PHOTO_WIDTH) / f64::from(source.width()))
        .min(f64::from(PRINT_PHOTO_HEIGHT) / f64::from(source.height()));
    let width = ((f64::from(source.width()) * scale).round() as u32).clamp(1, PRINT_PHOTO_WIDTH);
    let height = ((f64::from(source.height()) * scale).round() as u32).clamp(1, PRINT_PHOTO_HEIGHT);
    if (width, height) == source.dimensions() {
        return Ok(source);
    }
    let mut resized = RgbaImage::new(width, height);
    Resizer::new()
        .resize(
            &source,
            &mut resized,
            Some(&ResizeOptions::new().resize_alg(ResizeAlg::Convolution(FilterType::Lanczos3))),
        )
        .map_err(|error| Error::Custom(format!("resize screenshot: {error}")))?;
    Ok(resized)
}

fn flatten_on_paper(image: &RgbaImage) -> RgbImage {
    RgbImage::from_fn(image.width(), image.height(), |x, y| {
        let [r, g, b, a] = image.get_pixel(x, y).0;
        let blend = |channel: u8, paper: u8| {
            ((u16::from(channel) * u16::from(a) + u16::from(paper) * (255 - u16::from(a)) + 127)
                / 255) as u8
        };
        image::Rgb([blend(r, PAPER[0]), blend(g, PAPER[1]), blend(b, PAPER[2])])
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png(image: DynamicImage) -> Vec<u8> {
        let mut out = Cursor::new(Vec::new());
        image.write_to(&mut out, image::ImageFormat::Png).unwrap();
        out.into_inner()
    }

    fn caption() -> String {
        let mut strip = RgbaImage::new(PRINT_WIDTH, PRINT_CAPTION_HEIGHT);
        strip.put_pixel(100, 270, image::Rgba([0, 0, 0, 255]));
        B64.encode(png(DynamicImage::ImageRgba8(strip)))
    }

    fn compose(width: u32, height: u32) -> RgbImage {
        let photo = DynamicImage::ImageRgb8(RgbImage::from_pixel(
            width,
            height,
            image::Rgb([200, 10, 10]),
        ));
        let print = compose_screenshot_print(&png(photo), &caption()).unwrap();
        image::load_from_memory(&print).unwrap().to_rgb8()
    }

    #[test]
    fn places_a_16_9_photo_in_the_official_photo_area() {
        let print = compose(3840, 2160);
        assert_eq!(print.dimensions(), (PRINT_WIDTH, PRINT_HEIGHT));
        assert_eq!(
            print.get_pixel(PRINT_PHOTO_X - 1, PRINT_PHOTO_Y).0,
            [255, 255, 255]
        );
        assert_eq!(
            print.get_pixel(PRINT_PHOTO_X, PRINT_PHOTO_Y - 1).0,
            [255, 255, 255]
        );
        assert_eq!(
            print.get_pixel(PRINT_PHOTO_X, PRINT_PHOTO_Y).0,
            [200, 10, 10]
        );
        assert_eq!(
            print
                .get_pixel(PRINT_PHOTO_X + PRINT_PHOTO_WIDTH - 1, PRINT_CAPTION_Y - 1)
                .0,
            [200, 10, 10]
        );
        assert_eq!(
            print.get_pixel(PRINT_PHOTO_X, PRINT_CAPTION_Y).0,
            [255, 255, 255]
        );
        assert_eq!(print.get_pixel(100, PRINT_CAPTION_Y + 270).0, [0, 0, 0]);
    }

    #[test]
    fn fits_portrait_photos_inside_the_photo_area_without_cropping() {
        let print = compose(1080, 1920);
        let center_x = PRINT_PHOTO_X + PRINT_PHOTO_WIDTH / 2;
        assert_eq!(
            print.get_pixel(PRINT_PHOTO_X, PRINT_PHOTO_Y + 500).0,
            [255, 255, 255]
        );
        assert_eq!(print.get_pixel(center_x, PRINT_PHOTO_Y).0, [200, 10, 10]);
        assert_eq!(
            print.get_pixel(center_x, PRINT_CAPTION_Y - 1).0,
            [200, 10, 10]
        );
    }

    #[test]
    fn rejects_a_caption_of_the_wrong_size() {
        let photo = png(DynamicImage::ImageRgb8(RgbImage::new(16, 9)));
        let caption = B64.encode(png(DynamicImage::ImageRgba8(RgbaImage::new(10, 10))));
        assert!(compose_screenshot_print(&photo, &caption).is_err());
    }
}
