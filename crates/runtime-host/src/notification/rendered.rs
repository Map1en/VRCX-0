#[derive(Clone, Debug)]
pub(crate) struct RenderedNotification {
    pub(crate) title: String,
    pub(crate) body: String,
    pub(crate) text: String,
    pub(crate) display_location: String,
    pub(crate) image_url: String,
}
