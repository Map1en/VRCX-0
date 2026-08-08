use serde::Serialize;

#[derive(Clone, Copy, Debug, Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
enum AppErrorCode {
    Database,
    Io,
    Json,
    Custom,
}

#[derive(Clone, Copy, Debug, Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
enum SqliteErrorCategory {
    Malformed,
    DiskFull,
    Locked,
    IoError,
}

#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
struct AppErrorPayload {
    code: AppErrorCode,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    sqlite_category: Option<SqliteErrorCategory>,
}

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
        AppErrorPayload {
            code: self.code(),
            message: self.to_string(),
            sqlite_category: self.sqlite_category(),
        }
        .serialize(serializer)
    }
}

impl specta::Type for AppError {
    fn inline(
        type_map: &mut specta::TypeCollection,
        generics: specta::Generics,
    ) -> specta::DataType {
        AppErrorPayload::inline(type_map, generics)
    }

    fn reference(
        type_map: &mut specta::TypeCollection,
        generics: &[specta::DataType],
    ) -> specta::datatype::reference::Reference {
        AppErrorPayload::reference(type_map, generics)
    }
}

impl AppError {
    fn code(&self) -> AppErrorCode {
        match self {
            Self::Database(_) => AppErrorCode::Database,
            Self::Io(_) => AppErrorCode::Io,
            Self::Json(_) => AppErrorCode::Json,
            Self::Custom(_) => AppErrorCode::Custom,
        }
    }

    fn sqlite_category(&self) -> Option<SqliteErrorCategory> {
        let Self::Database(message) = self else {
            return None;
        };
        let message = message.to_ascii_lowercase();
        if message.contains("database disk image is malformed")
            || message.contains("not a database")
        {
            Some(SqliteErrorCategory::Malformed)
        } else if message.contains("database or disk is full") {
            Some(SqliteErrorCategory::DiskFull)
        } else if message.contains("database is locked")
            || message.contains("attempt to write a readonly database")
        {
            Some(SqliteErrorCategory::Locked)
        } else if message.contains("disk i/o error") {
            Some(SqliteErrorCategory::IoError)
        } else {
            None
        }
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

impl From<vrcx_0_assistant::AssistantError> for AppError {
    fn from(value: vrcx_0_assistant::AssistantError) -> Self {
        match value {
            vrcx_0_assistant::AssistantError::Persistence(error) => AppError::from(error),
            vrcx_0_assistant::AssistantError::Mcp(error) => AppError::from(error),
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_structured_database_error_with_sqlite_category() {
        let payload =
            serde_json::to_value(AppError::Database("database or disk is full".to_string()))
                .unwrap();

        assert_eq!(
            payload,
            serde_json::json!({
                "code": "database",
                "message": "Database error: database or disk is full",
                "sqliteCategory": "disk_full"
            })
        );
    }

    #[test]
    fn omits_sqlite_category_for_unrelated_errors() {
        let payload =
            serde_json::to_value(AppError::Custom("database or disk is full".to_string())).unwrap();

        assert_eq!(
            payload,
            serde_json::json!({
                "code": "custom",
                "message": "database or disk is full"
            })
        );
    }
}
