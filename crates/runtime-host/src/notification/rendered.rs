#[derive(Clone, Debug)]
pub struct RenderedNotification {
    pub title: String,
    pub body: String,
    pub text: String,
    pub display_location: String,
    pub image_url: String,
}
