use std::path::{Component, Path, PathBuf};

use crate::error::Error;

fn sanitize_ugc_component(value: &str, label: &str) -> Result<String, Error> {
    let mut sanitized = String::with_capacity(value.len());
    for ch in value.trim().chars() {
        if ch.is_control() || matches!(ch, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') {
            sanitized.push('_');
        } else {
            sanitized.push(ch);
        }
    }

    while sanitized.ends_with(' ') || sanitized.ends_with('.') {
        sanitized.pop();
    }

    if sanitized.is_empty() || sanitized == "." || sanitized == ".." {
        sanitized = "_".into();
    }

    if is_windows_reserved_name(&sanitized) {
        sanitized.insert(0, '_');
    }

    if !is_single_path_component(&sanitized) {
        return Err(Error::Custom(format!("invalid {label} path component")));
    }

    Ok(sanitized)
}

fn is_single_path_component(value: &str) -> bool {
    let mut components = Path::new(value).components();
    match (components.next(), components.next()) {
        (Some(Component::Normal(component)), None) => component == std::ffi::OsStr::new(value),
        _ => false,
    }
}

fn is_windows_reserved_name(value: &str) -> bool {
    let upper = value
        .split('.')
        .next()
        .unwrap_or_default()
        .to_ascii_uppercase();
    matches!(
        upper.as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    )
}

pub fn normalize_image_save_file_name(default_name: &str) -> Result<String, Error> {
    let candidate = if default_name.trim().is_empty() {
        "image.png"
    } else {
        default_name.trim()
    };
    let mut file_name = sanitize_ugc_component(candidate, "file_name")?;
    if Path::new(&file_name).extension().is_none() {
        file_name.push_str(".png");
    }
    Ok(file_name)
}

pub fn default_image_extension(file_name: &str) -> &str {
    match Path::new(file_name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "jpg" => "jpg",
        "jpeg" => "jpeg",
        "gif" => "gif",
        "webp" => "webp",
        "bmp" => "bmp",
        _ => "png",
    }
}

pub fn build_ugc_image_path(
    ugc_folder_path: &str,
    month_folder: &str,
    file_name: &str,
) -> Result<PathBuf, Error> {
    if ugc_folder_path.trim().is_empty() {
        return Err(Error::Custom("UGC folder path is empty".into()));
    }

    let month_folder = sanitize_ugc_component(month_folder, "month_folder")?;
    let file_name = sanitize_ugc_component(file_name, "file_name")?;
    Ok(PathBuf::from(ugc_folder_path)
        .join(month_folder)
        .join(file_name))
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use crate::error::Error;

    #[test]
    fn normalizes_image_file_names() -> Result<(), Error> {
        assert_eq!(super::normalize_image_save_file_name("")?, "image.png");
        assert_eq!(
            super::normalize_image_save_file_name("avatar")?,
            "avatar.png"
        );
        assert_eq!(
            super::normalize_image_save_file_name("photo.webp")?,
            "photo.webp"
        );
        assert_eq!(super::normalize_image_save_file_name("CON")?, "_CON.png");
        assert_eq!(
            super::normalize_image_save_file_name(" CON <bad>:name?. ")?.as_str(),
            "CON _bad__name_.png"
        );
        Ok(())
    }

    #[test]
    fn builds_ugc_image_paths_from_single_components() -> Result<(), Error> {
        let path = super::build_ugc_image_path(r"C:\VRCX\UGC", "2026/04", r"..\avatar:name?.png")?;

        assert_eq!(
            path,
            PathBuf::from(r"C:\VRCX\UGC")
                .join("2026_04")
                .join(".._avatar_name_.png")
        );
        Ok(())
    }
}
