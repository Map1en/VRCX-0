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

    edit_png_in_place(path, |pf| {
        let deleted_vrchat = if delete_vrchat_metadata {
            png::delete_text_chunk("XML:com.adobe.xmp", pf)?
        } else {
            false
        };
        let deleted_vrcx = png::delete_text_chunk("Description", pf)?;
        Ok(deleted_vrchat || deleted_vrcx)
    })
}

pub fn write_vrcx_metadata(text: &str, path: &str) -> bool {
    let chunk = png::generate_text_chunk("Description", text);
    edit_png_in_place(path, |pf| pf.write_chunk(&chunk))
}

fn edit_png_in_place(
    path: &str,
    edit: impl FnOnce(&mut png::PngFile) -> std::io::Result<bool>,
) -> bool {
    let Ok(original) = std::fs::read(path) else {
        return false;
    };
    let mut pf = match png::PngFile::open_rw(path) {
        Ok(p) => p,
        Err(_) => return false,
    };
    match edit(&mut pf) {
        Ok(changed) => changed,
        Err(_) => {
            let _ = pf.restore(&original);
            false
        }
    }
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

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct PngDimensions {
    pub width: Option<i32>,
    pub height: Option<i32>,
}

pub fn read_png_dimensions(path: &str) -> PngDimensions {
    let Ok(mut png) = png::PngFile::open_read(path) else {
        return PngDimensions::default();
    };
    let resolution = png::read_resolution(&mut png);
    let Some((width, height)) = resolution.split_once('x') else {
        return PngDimensions::default();
    };
    PngDimensions {
        width: width.parse::<i32>().ok().filter(|value| *value > 0),
        height: height.parse::<i32>().ok().filter(|value| *value > 0),
    }
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

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    use super::*;
    use crate::png::{generate_text_chunk, ChunkType, PngChunk};

    static NEXT_TEMP_ID: AtomicU64 = AtomicU64::new(0);

    fn chunk(chunk_type_str: &str, data: Vec<u8>) -> Vec<u8> {
        let chunk_type = match chunk_type_str {
            "IHDR" => ChunkType::IHDR,
            "sRGB" => ChunkType::SRGB,
            "IDAT" => ChunkType::IDAT,
            "IEND" => ChunkType::IEND,
            _ => ChunkType::Unknown,
        };
        PngChunk {
            index: 0,
            chunk_type,
            chunk_type_str: chunk_type_str.into(),
            data,
        }
        .to_bytes()
    }

    fn ihdr() -> Vec<u8> {
        chunk("IHDR", vec![0, 0, 0, 2, 0, 0, 0, 3, 8, 6, 0, 0, 0])
    }

    fn temp_png_path(name: &str) -> PathBuf {
        let id = NEXT_TEMP_ID.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir().join(format!("vrcx-0-{name}-{}-{id}.png", std::process::id()))
    }

    fn write_png(name: &str, bytes: &[u8]) -> PathBuf {
        let path = temp_png_path(name);
        fs::write(&path, bytes).unwrap();
        path
    }

    fn png_with_pre_idat_text_chunks(chunks: &[PngChunk]) -> Vec<u8> {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
        bytes.extend_from_slice(&ihdr());
        for chunk in chunks {
            bytes.extend_from_slice(&chunk.to_bytes());
        }
        bytes.extend_from_slice(&chunk("IDAT", Vec::new()));
        bytes.extend_from_slice(&chunk("IEND", Vec::new()));
        bytes
    }

    #[test]
    fn get_screenshot_metadata_merges_vrcx_players_and_instance_over_vrchat_xmp() {
        let xmp = r#"<x:xmpmeta><rdf:Description><CreatorTool>VRChat</CreatorTool><Author>Maple</Author><AuthorID>usr_author</AuthorID><DateTime>2026-06-21T22:00:00Z</DateTime><WorldID>wrld_xmp</WorldID><WorldDisplayName>XMP World</WorldDisplayName><rdf:li>Original note</rdf:li></rdf:Description></x:xmpmeta>"#;
        let vrcx = serde_json::json!({
            "application": "VRCX-0",
            "version": 1,
            "author": { "id": "usr_vrcx", "displayName": "VRCX Author" },
            "world": {
                "id": "wrld_vrcx",
                "name": "VRCX World",
                "instanceId": "wrld_vrcx:456"
            },
            "players": [
                { "id": "usr_friend", "displayName": "Friend" }
            ]
        })
        .to_string();
        let bytes = png_with_pre_idat_text_chunks(&[
            generate_text_chunk("XML:com.adobe.xmp", xmp),
            generate_text_chunk("Description", &vrcx),
        ]);
        let path = write_png("merged-metadata", &bytes);
        let path_str = path.to_str().unwrap().to_string();

        let metadata = get_screenshot_metadata(&path_str).unwrap();
        fs::remove_file(path).ok();

        assert_eq!(metadata.application.as_deref(), Some("VRChat"));
        assert_eq!(metadata.author.id, "usr_author");
        assert_eq!(metadata.world.id, "wrld_xmp");
        assert_eq!(metadata.world.name.as_deref(), Some("XMP World"));
        assert_eq!(metadata.world.instance_id, "wrld_vrcx:456");
        assert_eq!(metadata.players.len(), 1);
        assert_eq!(metadata.players[0].id, "usr_friend");
        assert_eq!(metadata.source_file.as_deref(), Some(path_str.as_str()));
    }

    #[test]
    fn read_text_metadata_falls_back_to_legacy_lfs_itxt_after_idat_when_srgb_exists() {
        let lfs =
            "lfs|2|author:usr_author,Maple|world:wrld_lfs,123,LFS World|players:usr_friend,1,2,3,Friend";
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
        bytes.extend_from_slice(&ihdr());
        bytes.extend_from_slice(&chunk("sRGB", vec![0]));
        bytes.extend_from_slice(&chunk("IDAT", vec![0; 8200]));
        bytes.extend_from_slice(&generate_text_chunk("Description", lfs).to_bytes());
        bytes.extend_from_slice(&chunk("IEND", Vec::new()));
        let path = write_png("legacy-lfs", &bytes);

        let metadata_strings = read_text_metadata(path.to_str().unwrap());
        let metadata = get_screenshot_metadata(path.to_str().unwrap()).unwrap();
        fs::remove_file(path).ok();

        assert_eq!(metadata_strings, vec![lfs.to_string()]);
        assert_eq!(metadata.application.as_deref(), Some("lfs"));
        assert_eq!(metadata.world.id, "wrld_lfs");
        assert_eq!(metadata.world.instance_id, "wrld_lfs:123");
        assert_eq!(metadata.world.name.as_deref(), Some("LFS World"));
        assert_eq!(metadata.players[0].display_name, "Friend");
    }

    #[test]
    fn writing_metadata_through_a_read_only_handle_reports_failure() {
        let bytes = png_with_pre_idat_text_chunks(&[]);
        let path = write_png("read-only-handle", &bytes);
        let mut pf = png::PngFile::open_read(path.to_str().unwrap()).unwrap();

        let written = pf.write_chunk(&generate_text_chunk("Description", "{}"));
        drop(pf);
        let after = fs::read(&path).unwrap();
        fs::remove_file(path).ok();

        assert!(written.is_err());
        assert_eq!(after, bytes);
    }

    #[test]
    fn a_failed_edit_restores_the_original_screenshot_bytes() {
        let bytes = png_with_pre_idat_text_chunks(&[generate_text_chunk(
            "XML:com.adobe.xmp",
            "<x:xmpmeta/>",
        )]);
        let path = write_png("failed-edit", &bytes);

        let edited = edit_png_in_place(path.to_str().unwrap(), |pf| {
            pf.write_chunk(&generate_text_chunk(
                "Description",
                "{\"application\":\"VRCX-0\"}",
            ))?;
            png::delete_text_chunk("XML:com.adobe.xmp", pf)?;
            Err(std::io::Error::other("injected failure"))
        });
        let after = fs::read(&path).unwrap();
        fs::remove_file(path).ok();

        assert!(!edited);
        assert_eq!(after, bytes);
    }

    #[test]
    fn writing_and_deleting_metadata_round_trips_the_description_chunk() {
        let bytes = png_with_pre_idat_text_chunks(&[]);
        let path = write_png("round-trip", &bytes);
        let path_str = path.to_str().unwrap().to_string();
        let vrcx = r#"{"application":"VRCX-0","version":1}"#;

        assert!(write_vrcx_metadata(vrcx, &path_str));
        assert_eq!(read_text_metadata(&path_str), vec![vrcx.to_string()]);
        assert!(delete_text_metadata(&path_str, false));
        let after = fs::read(&path).unwrap();
        fs::remove_file(path).ok();

        assert_eq!(after, bytes);
    }

    #[test]
    fn writing_metadata_keeps_the_screenshot_creation_time() {
        let path = write_png("creation-time", &png_with_pre_idat_text_chunks(&[]));
        let Ok(created_before) = fs::metadata(&path).and_then(|meta| meta.created()) else {
            fs::remove_file(path).ok();
            return;
        };
        std::thread::sleep(std::time::Duration::from_millis(20));

        assert!(write_vrcx_metadata("{}", path.to_str().unwrap()));
        let created_after = fs::metadata(&path).and_then(|meta| meta.created()).unwrap();
        fs::remove_file(path).ok();

        assert_eq!(created_after, created_before);
    }
}
