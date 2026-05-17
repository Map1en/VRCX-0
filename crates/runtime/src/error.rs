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

impl From<vrcx_0_host::Error> for Error {
    fn from(value: vrcx_0_host::Error) -> Self {
        match value {
            vrcx_0_host::Error::Io(error) => Self::Io(error),
            vrcx_0_host::Error::Json(error) => Self::Json(error),
            vrcx_0_host::Error::Custom(message) => Self::Custom(message),
        }
    }
}

impl From<vrcx_0_vrchat::WebClientError> for Error {
    fn from(value: vrcx_0_vrchat::WebClientError) -> Self {
        match value {
            vrcx_0_vrchat::WebClientError::Custom(message) => Self::Custom(message),
            vrcx_0_vrchat::WebClientError::Io(error) => Self::Io(error),
            vrcx_0_vrchat::WebClientError::Media(error) => error.into(),
        }
    }
}

impl From<vrcx_0_vrchat::ImageFetchError> for Error {
    fn from(value: vrcx_0_vrchat::ImageFetchError) -> Self {
        match value {
            vrcx_0_vrchat::ImageFetchError::Custom(message) => Self::Custom(message),
        }
    }
}
