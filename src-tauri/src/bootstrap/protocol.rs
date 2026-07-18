use std::borrow::Cow;

use tauri::http::{header::CONTENT_TYPE, Request, Response, StatusCode};

use crate::state::AppState;

pub fn screenshot_protocol_response(
    request: Request<Vec<u8>>,
    paths: &vrcx_0_host::app_paths::AppPaths,
) -> Response<Cow<'static, [u8]>> {
    let path = match percent_encoding::percent_decode_str(&request.uri().path()[1..]).decode_utf8()
    {
        Ok(path) => path.into_owned(),
        Err(_) => {
            return Response::builder()
                .status(StatusCode::BAD_REQUEST)
                .body(Vec::new().into())
                .unwrap();
        }
    };

    let path_buf = std::path::PathBuf::from(&path);
    let is_png = path_buf
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("png"));

    if !is_png || !path_buf.is_file() {
        return Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Vec::new().into())
            .unwrap();
    }

    if !crate::adapters::host_file_access::is_known_root_path(&path_buf, paths) {
        return Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Vec::new().into())
            .unwrap();
    }

    match std::fs::read(&path_buf) {
        Ok(bytes) => Response::builder()
            .header(CONTENT_TYPE, "image/png")
            .body(bytes.into())
            .unwrap(),
        Err(_) => Response::builder()
            .status(StatusCode::INTERNAL_SERVER_ERROR)
            .body(Vec::new().into())
            .unwrap(),
    }
}

pub fn screenshot_thumbnail_protocol_response(
    request: Request<Vec<u8>>,
    paths: &vrcx_0_host::app_paths::AppPaths,
) -> Response<Cow<'static, [u8]>> {
    let path = match percent_encoding::percent_decode_str(&request.uri().path()[1..]).decode_utf8()
    {
        Ok(path) => path.into_owned(),
        Err(_) => {
            return Response::builder()
                .status(StatusCode::BAD_REQUEST)
                .body(Vec::new().into())
                .unwrap();
        }
    };

    let path_buf = std::path::PathBuf::from(&path);
    let is_webp = path_buf
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("webp"));

    if !is_webp
        || !path_buf.is_file()
        || !vrcx_0_host::path_utils::is_path_inside_directory(&path_buf, &paths.screenshot_thumbs)
    {
        return Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Vec::new().into())
            .unwrap();
    }

    match std::fs::read(&path_buf) {
        Ok(bytes) => Response::builder()
            .header(CONTENT_TYPE, "image/webp")
            .body(bytes.into())
            .unwrap(),
        Err(_) => Response::builder()
            .status(StatusCode::INTERNAL_SERVER_ERROR)
            .body(Vec::new().into())
            .unwrap(),
    }
}

fn background_image_content_type(path: &std::path::Path) -> Option<&'static str> {
    let extension = path.extension().and_then(|ext| ext.to_str())?;
    if extension.eq_ignore_ascii_case("jpg") || extension.eq_ignore_ascii_case("jpeg") {
        return Some("image/jpeg");
    }
    if extension.eq_ignore_ascii_case("png") {
        return Some("image/png");
    }
    if extension.eq_ignore_ascii_case("webp") {
        return Some("image/webp");
    }
    None
}

pub fn background_image_protocol_response(
    request: Request<Vec<u8>>,
    state: &AppState,
) -> Response<Cow<'static, [u8]>> {
    let raw_path = request.uri().path().trim_start_matches('/');
    if raw_path.is_empty() {
        return Response::builder()
            .status(StatusCode::BAD_REQUEST)
            .body(Vec::new().into())
            .unwrap();
    }

    let path = match percent_encoding::percent_decode_str(raw_path).decode_utf8() {
        Ok(path) => path.into_owned(),
        Err(_) => {
            return Response::builder()
                .status(StatusCode::BAD_REQUEST)
                .body(Vec::new().into())
                .unwrap();
        }
    };

    let path_buf = std::path::PathBuf::from(&path);
    let Some(content_type) = background_image_content_type(&path_buf) else {
        return Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Vec::new().into())
            .unwrap();
    };

    if !path_buf.is_file()
        || state
            .desktop
            .host_file_access
            .ensure_read_allowed(&path_buf, &state.paths)
            .is_err()
    {
        return Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Vec::new().into())
            .unwrap();
    }

    match std::fs::read(&path_buf) {
        Ok(bytes) => Response::builder()
            .header(CONTENT_TYPE, content_type)
            .body(bytes.into())
            .unwrap(),
        Err(_) => Response::builder()
            .status(StatusCode::INTERNAL_SERVER_ERROR)
            .body(Vec::new().into())
            .unwrap(),
    }
}
