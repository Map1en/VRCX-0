pub type Result<T> = std::result::Result<T, Error>;

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

impl From<vrcx_0_persistence::Error> for Error {
    fn from(value: vrcx_0_persistence::Error) -> Self {
        match value {
            vrcx_0_persistence::Error::Database(message) => Error::Database(message),
            vrcx_0_persistence::Error::Io(error) => Error::Io(error),
            vrcx_0_persistence::Error::Json(error) => Error::Json(error),
            vrcx_0_persistence::Error::InvalidData(message) => Error::Custom(message),
            vrcx_0_persistence::Error::Custom(message) => Error::Custom(message),
        }
    }
}

impl From<vrcx_0_media::Error> for Error {
    fn from(value: vrcx_0_media::Error) -> Self {
        match value {
            vrcx_0_media::Error::Io(error) => Error::Io(error),
            vrcx_0_media::Error::Custom(message) => Error::Custom(message),
        }
    }
}

impl From<vrcx_0_host::Error> for Error {
    fn from(value: vrcx_0_host::Error) -> Self {
        match value {
            vrcx_0_host::Error::Io(error) => Error::Io(error),
            vrcx_0_host::Error::Json(error) => Error::Json(error),
            vrcx_0_host::Error::Custom(message) => Error::Custom(message),
        }
    }
}

impl From<vrcx_0_application_core::Error> for Error {
    fn from(value: vrcx_0_application_core::Error) -> Self {
        match value {
            vrcx_0_application_core::Error::Database(message) => Error::Database(message),
            vrcx_0_application_core::Error::Io(error) => Error::Io(error),
            vrcx_0_application_core::Error::Json(error) => Error::Json(error),
            vrcx_0_application_core::Error::UpdateArtifactInvalid(message) => {
                Error::Custom(format!("Update artifact is invalid: {message}"))
            }
            vrcx_0_application_core::Error::Custom(message) => Error::Custom(message),
        }
    }
}
