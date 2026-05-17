use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Database error: {0}")]
    Database(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("{0}")]
    Custom(String),
}

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

impl From<vrcx_0_store::Error> for AppError {
    fn from(value: vrcx_0_store::Error) -> Self {
        match value {
            vrcx_0_store::Error::Database(message) => AppError::Database(message),
            vrcx_0_store::Error::Io(error) => AppError::Io(error),
            vrcx_0_store::Error::Json(error) => AppError::Json(error),
            vrcx_0_store::Error::Custom(message) => AppError::Custom(message),
        }
    }
}

impl From<vrcx_0_media::Error> for AppError {
    fn from(value: vrcx_0_media::Error) -> Self {
        match value {
            vrcx_0_media::Error::Io(error) => AppError::Io(error),
            vrcx_0_media::Error::Custom(message) => AppError::Custom(message),
        }
    }
}

impl From<vrcx_0_host::Error> for AppError {
    fn from(value: vrcx_0_host::Error) -> Self {
        match value {
            vrcx_0_host::Error::Io(error) => AppError::Io(error),
            vrcx_0_host::Error::Json(error) => AppError::Json(error),
            vrcx_0_host::Error::Custom(message) => AppError::Custom(message),
        }
    }
}

impl From<vrcx_0_runtime::Error> for AppError {
    fn from(value: vrcx_0_runtime::Error) -> Self {
        match value {
            vrcx_0_runtime::Error::Database(message) => AppError::Database(message),
            vrcx_0_runtime::Error::Io(error) => AppError::Io(error),
            vrcx_0_runtime::Error::Json(error) => AppError::Json(error),
            vrcx_0_runtime::Error::Custom(message) => AppError::Custom(message),
        }
    }
}
