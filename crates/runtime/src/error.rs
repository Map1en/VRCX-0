#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("Database error: {0}")]
    Database(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("{0}")]
    Custom(String),
}

impl From<vrcx_0_store::Error> for Error {
    fn from(value: vrcx_0_store::Error) -> Self {
        match value {
            vrcx_0_store::Error::Database(message) => Self::Database(message),
            vrcx_0_store::Error::Io(error) => Self::Io(error),
            vrcx_0_store::Error::Json(error) => Self::Json(error),
            vrcx_0_store::Error::Custom(message) => Self::Custom(message),
        }
    }
}

impl From<vrcx_0_media::Error> for Error {
    fn from(value: vrcx_0_media::Error) -> Self {
        match value {
            vrcx_0_media::Error::Io(error) => Self::Io(error),
            vrcx_0_media::Error::Custom(message) => Self::Custom(message),
        }
    }
}
