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

impl From<vrcx_0_core::vrchat_registry_policy::RegistryPolicyError> for Error {
    fn from(value: vrcx_0_core::vrchat_registry_policy::RegistryPolicyError) -> Self {
        use vrcx_0_core::vrchat_registry_policy::RegistryPolicyError;
        match value {
            RegistryPolicyError::Json(error) => Self::Json(error),
            RegistryPolicyError::Invalid(message) => Self::Custom(message),
        }
    }
}

impl From<vrcx_0_persistence::Error> for Error {
    fn from(value: vrcx_0_persistence::Error) -> Self {
        match value {
            vrcx_0_persistence::Error::Database(message) => Self::Database(message),
            vrcx_0_persistence::Error::Io(error) => Self::Io(error),
            vrcx_0_persistence::Error::Json(error) => Self::Json(error),
            vrcx_0_persistence::Error::InvalidData(message) => Self::Custom(message),
            vrcx_0_persistence::Error::Custom(message) => Self::Custom(message),
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

impl From<vrcx_0_vrchat_client::WebClientError> for Error {
    fn from(value: vrcx_0_vrchat_client::WebClientError) -> Self {
        match value {
            vrcx_0_vrchat_client::WebClientError::Custom(message) => Self::Custom(message),
            vrcx_0_vrchat_client::WebClientError::Io(error) => Self::Io(error),
        }
    }
}

impl From<vrcx_0_vrchat_client::ImageFetchError> for Error {
    fn from(value: vrcx_0_vrchat_client::ImageFetchError) -> Self {
        match value {
            vrcx_0_vrchat_client::ImageFetchError::Custom(message) => Self::Custom(message),
        }
    }
}

impl From<vrcx_0_vrchat_client::HttpApiError> for Error {
    fn from(value: vrcx_0_vrchat_client::HttpApiError) -> Self {
        match value {
            vrcx_0_vrchat_client::HttpApiError::Custom(message) => Self::Custom(message),
        }
    }
}
