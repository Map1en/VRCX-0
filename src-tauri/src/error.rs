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

impl From<vrcx_0_persistence::Error> for AppError {
    fn from(value: vrcx_0_persistence::Error) -> Self {
        match value {
            vrcx_0_persistence::Error::Database(message) => AppError::Database(message),
            vrcx_0_persistence::Error::Io(error) => AppError::Io(error),
            vrcx_0_persistence::Error::Json(error) => AppError::Json(error),
            vrcx_0_persistence::Error::Custom(message) => AppError::Custom(message),
        }
    }
}
