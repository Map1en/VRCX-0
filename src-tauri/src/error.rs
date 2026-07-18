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

impl specta::Type for AppError {
    fn inline(
        type_map: &mut specta::TypeCollection,
        generics: specta::Generics,
    ) -> specta::DataType {
        String::inline(type_map, generics)
    }
}

impl From<vrcx_0_persistence::Error> for AppError {
    fn from(value: vrcx_0_persistence::Error) -> Self {
        match value {
            vrcx_0_persistence::Error::Database(message) => AppError::Database(message),
            vrcx_0_persistence::Error::Io(error) => AppError::Io(error),
            vrcx_0_persistence::Error::Json(error) => AppError::Json(error),
            vrcx_0_persistence::Error::InvalidData(message) => AppError::Custom(message),
            vrcx_0_persistence::Error::Custom(message) => AppError::Custom(message),
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

impl From<vrcx_0_application_core::Error> for AppError {
    fn from(value: vrcx_0_application_core::Error) -> Self {
        match value {
            vrcx_0_application_core::Error::Database(message) => AppError::Database(message),
            vrcx_0_application_core::Error::Io(error) => AppError::Io(error),
            vrcx_0_application_core::Error::Json(error) => AppError::Json(error),
            vrcx_0_application_core::Error::UpdateArtifactInvalid(message) => {
                AppError::Custom(format!("Update artifact is invalid: {message}"))
            }
            vrcx_0_application_core::Error::Custom(message) => AppError::Custom(message),
        }
    }
}

impl From<vrcx_0_runtime_host::Error> for AppError {
    fn from(value: vrcx_0_runtime_host::Error) -> Self {
        match value {
            vrcx_0_runtime_host::Error::Database(message) => AppError::Database(message),
            vrcx_0_runtime_host::Error::Io(error) => AppError::Io(error),
            vrcx_0_runtime_host::Error::Json(error) => AppError::Json(error),
            vrcx_0_runtime_host::Error::Custom(message) => AppError::Custom(message),
        }
    }
}

impl From<vrcx_0_mcp::McpError> for AppError {
    fn from(value: vrcx_0_mcp::McpError) -> Self {
        match value {
            vrcx_0_mcp::McpError::Io(error) => AppError::Io(error),
            vrcx_0_mcp::McpError::Persistence(error) => AppError::from(error),
            vrcx_0_mcp::McpError::Application(error) => AppError::from(error),
            other => AppError::Custom(other.to_string()),
        }
    }
}

impl From<vrcx_0_harness::HarnessError> for AppError {
    fn from(value: vrcx_0_harness::HarnessError) -> Self {
        match value {
            vrcx_0_harness::HarnessError::Persistence(error) => AppError::from(error),
            vrcx_0_harness::HarnessError::Mcp(error) => AppError::from(error),
            other => AppError::Custom(other.to_string()),
        }
    }
}

impl From<vrcx_0_integrations::external_api::ExternalApiError> for AppError {
    fn from(value: vrcx_0_integrations::external_api::ExternalApiError) -> Self {
        match value {
            vrcx_0_integrations::external_api::ExternalApiError::Custom(message) => {
                AppError::Custom(message)
            }
        }
    }
}

impl From<vrcx_0_vrchat_client::HttpApiError> for AppError {
    fn from(value: vrcx_0_vrchat_client::HttpApiError) -> Self {
        match value {
            vrcx_0_vrchat_client::HttpApiError::Custom(message) => AppError::Custom(message),
        }
    }
}
