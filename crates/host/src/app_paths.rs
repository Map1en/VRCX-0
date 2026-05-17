use std::path::PathBuf;

use crate::error::Error;

pub struct AppPaths {
    pub app_data: PathBuf,
    pub db_file: PathBuf,
    pub config_file: PathBuf,
    pub image_cache: PathBuf,
    pub screenshot_thumbs: PathBuf,
}

impl AppPaths {
    pub fn resolve() -> Result<Self, Error> {
        let app_data = dirs::config_dir()
            .ok_or_else(|| Error::Custom("cannot resolve AppData".into()))?
            .join("VRCX-0");

        std::fs::create_dir_all(&app_data)?;
        Ok(Self::from_app_data(app_data))
    }

    pub fn from_app_data(app_data: PathBuf) -> Self {
        Self {
            db_file: app_data.join("VRCX-0.sqlite3"),
            config_file: app_data.join("VRCX-0.json"),
            image_cache: app_data.join("ImageCache"),
            screenshot_thumbs: app_data.join("ScreenshotThumbs"),
            app_data,
        }
    }
}
