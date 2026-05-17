use std::io::{Read, Seek};
use std::path::Path;

use vrcx_0_core::screenshots::{parse_lfs_picture, parse_vrc_image, ScreenshotMetadata};

use crate::png;

pub fn read_text_metadata(path: &str) -> Vec<String> {
    let mut pf = match png::PngFile::open_read(path) {
        Ok(p) => p,
        Err(_) => return Vec::new(),
    };
    let mut result = Vec::new();

    if let Some(xmp) = png::read_text_chunk("XML:com.adobe.xmp", &mut pf, false) {
        result.push(xmp);
    }
    if let Some(desc) = png::read_text_chunk("Description", &mut pf, false) {
        result.push(desc);
    }

    if result.is_empty() && pf.get_chunk(&png::ChunkType::SRGB).is_some() {
        if let Some(lfs) = png::read_text_chunk("Description", &mut pf, true) {
            result.push(lfs);
        }
    }

    result
}

pub fn delete_text_metadata(path: &str, delete_vrchat_metadata: bool) -> bool {
    if path.is_empty() || !Path::new(path).exists() || !is_png_file(path) {
        return false;
    }

    let mut pf = match png::PngFile::open_rw(path) {
        Ok(p) => p,
        Err(_) => return false,
    };
    let deleted_vrchat = if delete_vrchat_metadata {
        png::delete_text_chunk("XML:com.adobe.xmp", &mut pf)
    } else {
        false
    };
    let deleted_vrcx = png::delete_text_chunk("Description", &mut pf);
    deleted_vrchat || deleted_vrcx
}

pub fn write_vrcx_metadata(text: &str, path: &str) -> bool {
    let mut pf = match png::PngFile::open_rw(path) {
        Ok(p) => p,
        Err(_) => return false,
    };
    let chunk = png::generate_text_chunk("Description", text);
    pf.write_chunk(&chunk)
}

pub fn has_vrcx_metadata(path: &str) -> bool {
    let mut pf = match png::PngFile::open_read(path) {
        Ok(p) => p,
        Err(_) => return false,
    };
    pf.get_chunks_of_type(&png::ChunkType::ITXT)
        .into_iter()
        .filter_map(|chunk| chunk.read_itxt())
        .filter(|(keyword, _)| keyword == "Description")
        .map(|(_, text)| text)
        .any(|s| {
            s.starts_with('{')
                && s.ends_with('}')
                && serde_json::from_str::<ScreenshotMetadata>(&s)
                    .ok()
                    .and_then(|metadata| metadata.application)
                    .is_some_and(|application| application == "VRCX" || application == "VRCX-0")
        })
}

pub fn is_png_file(path: &str) -> bool {
    let mut file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(_) => return false,
    };
    let len = file.seek(std::io::SeekFrom::End(0)).unwrap_or(0);
    if len < 33 {
        return false;
    }
    file.seek(std::io::SeekFrom::Start(0)).ok();
    let mut sig = [0u8; 8];
    if file.read_exact(&mut sig).is_err() {
        return false;
    }
    sig == [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]
}

pub fn can_decode_image(path: &Path) -> bool {
    std::fs::read(path)
        .ok()
        .and_then(|data| image::load_from_memory(&data).ok())
        .is_some()
}

pub fn read_png_dimensions(path: &str) -> (Option<i32>, Option<i32>) {
    let Ok(mut png) = png::PngFile::open_read(path) else {
        return (None, None);
    };
    let resolution = png::read_resolution(&mut png);
    let Some((width, height)) = resolution.split_once('x') else {
        return (None, None);
    };
    let width = width.parse::<i32>().ok().filter(|value| *value > 0);
    let height = height.parse::<i32>().ok().filter(|value| *value > 0);
    (width, height)
}

pub fn get_screenshot_metadata(path: &str) -> Option<ScreenshotMetadata> {
    let candidate = Path::new(path);
    let is_png_extension = candidate
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("png"));
    if !candidate.exists() || !is_png_extension {
        return None;
    }

    let metadata_strs = read_text_metadata(path);
    if metadata_strs.is_empty() {
        return Some(ScreenshotMetadata::just_error(
            path,
            "Image has no valid metadata.",
        ));
    }

    let mut result = ScreenshotMetadata::default();
    let mut got_vrchat = false;

    for metadata_string in &metadata_strs {
        if metadata_string.contains("<x:xmpmeta") {
            result = parse_vrc_image(metadata_string);
            result.source_file = Some(path.into());
            got_vrchat = true;
        } else if metadata_string.starts_with('{') && metadata_string.ends_with('}') {
            if let Ok(mut vrcx) = serde_json::from_str::<ScreenshotMetadata>(metadata_string) {
                vrcx.source_file = Some(path.into());
                if got_vrchat {
                    result.players = vrcx.players;
                    result.world.instance_id = vrcx.world.instance_id;
                } else {
                    result = vrcx;
                }
            }
        } else if metadata_string.starts_with("lfs")
            || metadata_string.starts_with("screenshotmanager")
        {
            result = parse_lfs_picture(metadata_string);
            result.source_file = Some(path.into());
        }
    }

    if result.application.is_none() {
        return Some(ScreenshotMetadata::just_error(
            path,
            "Image has no valid metadata.",
        ));
    }

    Some(result)
}
