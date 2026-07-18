use crate::Result;

pub trait GameLogHostActions: Send + Sync {
    fn quit_game(&self) -> i64;
    fn copy_image_to_clipboard(&self, path: &str) -> Result<()>;
    fn ugc_photo_location(&self, configured_path: Option<String>) -> String;
}

#[derive(Default)]
pub struct NoopGameLogHostActions;

impl GameLogHostActions for NoopGameLogHostActions {
    fn quit_game(&self) -> i64 {
        0
    }

    fn copy_image_to_clipboard(&self, _path: &str) -> Result<()> {
        Ok(())
    }

    fn ugc_photo_location(&self, configured_path: Option<String>) -> String {
        configured_path.unwrap_or_default()
    }
}
