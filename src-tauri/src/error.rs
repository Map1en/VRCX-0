use serde::Serialize;
use vrcx_0_runtime_host_desktop::feed_logger::{FeedLoggerError, FeedLoggerErrorCode};
use vrcx_0_runtime_host_desktop::ProfileBackupSettingsError;

#[derive(Clone, Copy, Debug, Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
enum AppErrorCode {
    Database,
    Io,
    Json,
    PersistenceInvalidData,
    RegistryPolicyInvalid,
    WebClient,
    UpdateArtifactInvalid,
    VrchatApi,
    AuthInteractionRequired,
    AuthSessionInvalidated,
    IntegrationApiPortInUse,
    IntegrationApiBind,
    FeedLogger,
    Custom,
}

#[derive(Clone, Copy, Debug, Serialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub(crate) enum SqliteErrorCategory {
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
    #[serde(skip_serializing_if = "Option::is_none")]
    status_code: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    port: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    feed_logger_code: Option<FeedLoggerErrorCode>,
}

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Database error: {message}")]
    Database {
        message: String,
        sqlite_category: Option<SqliteErrorCategory>,
    },

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("JSON error: {0}")]
    JsonMessage(String),

    #[error("{0}")]
    PersistenceInvalidData(String),

    #[error("{0}")]
    RegistryPolicyInvalid(String),

    #[error("{0}")]
    WebClient(String),

    #[error("Update artifact is invalid: {0}")]
    UpdateArtifactInvalid(String),

    #[error("{message}")]
    VrchatApi { status_code: i32, message: String },

    #[error("{0}")]
    AuthInteractionRequired(String),

    #[error("{reason}")]
    AuthSessionInvalidated {
        reason: String,
        status_code: Option<i32>,
    },

    #[error("Integration API port {port} is already in use")]
    IntegrationApiPortInUse { port: u16 },

    #[error("Integration API failed to bind port {port}: {message}")]
    IntegrationApiBind { port: u16, message: String },

    #[error("{message}")]
    FeedLogger {
        code: FeedLoggerErrorCode,
        message: String,
    },

    #[error("{0}")]
    Custom(String),
}

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        AppErrorPayload {
            code: self.code(),
            message: self.to_string(),
            sqlite_category: self.sqlite_category(),
            status_code: self.status_code(),
            port: self.port(),
            feed_logger_code: match self {
                Self::FeedLogger { code, .. } => Some(*code),
                _ => None,
            },
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
    fn database(
        message: String,
        sqlite_category: Option<vrcx_0_contracts::SqliteErrorCategory>,
    ) -> Self {
        Self::Database {
            message,
            sqlite_category: sqlite_category.map(SqliteErrorCategory::from),
        }
    }

    fn code(&self) -> AppErrorCode {
        match self {
            Self::Database { .. } => AppErrorCode::Database,
            Self::Io(_) => AppErrorCode::Io,
            Self::Json(_) | Self::JsonMessage(_) => AppErrorCode::Json,
            Self::PersistenceInvalidData(_) => AppErrorCode::PersistenceInvalidData,
            Self::RegistryPolicyInvalid(_) => AppErrorCode::RegistryPolicyInvalid,
            Self::WebClient(_) => AppErrorCode::WebClient,
            Self::UpdateArtifactInvalid(_) => AppErrorCode::UpdateArtifactInvalid,
            Self::VrchatApi { .. } => AppErrorCode::VrchatApi,
            Self::AuthInteractionRequired(_) => AppErrorCode::AuthInteractionRequired,
            Self::AuthSessionInvalidated { .. } => AppErrorCode::AuthSessionInvalidated,
            Self::IntegrationApiPortInUse { .. } => AppErrorCode::IntegrationApiPortInUse,
            Self::IntegrationApiBind { .. } => AppErrorCode::IntegrationApiBind,
            Self::FeedLogger { .. } => AppErrorCode::FeedLogger,
            Self::Custom(_) => AppErrorCode::Custom,
        }
    }

    fn sqlite_category(&self) -> Option<SqliteErrorCategory> {
        match self {
            Self::Database {
                sqlite_category, ..
            } => *sqlite_category,
            _ => None,
        }
    }

    fn status_code(&self) -> Option<i32> {
        match self {
            Self::VrchatApi { status_code, .. } => Some(*status_code),
            Self::AuthSessionInvalidated { status_code, .. } => *status_code,
            _ => None,
        }
    }

    fn port(&self) -> Option<u16> {
        match self {
            Self::IntegrationApiPortInUse { port } | Self::IntegrationApiBind { port, .. } => {
                Some(*port)
            }
            _ => None,
        }
    }
}

impl From<vrcx_0_contracts::SqliteErrorCategory> for SqliteErrorCategory {
    fn from(value: vrcx_0_contracts::SqliteErrorCategory) -> Self {
        match value {
            vrcx_0_contracts::SqliteErrorCategory::Malformed => Self::Malformed,
            vrcx_0_contracts::SqliteErrorCategory::DiskFull => Self::DiskFull,
            vrcx_0_contracts::SqliteErrorCategory::Locked => Self::Locked,
            vrcx_0_contracts::SqliteErrorCategory::IoError => Self::IoError,
        }
    }
}

impl From<vrcx_0_platform::Error> for AppError {
    fn from(value: vrcx_0_platform::Error) -> Self {
        match value {
            vrcx_0_platform::Error::Io(error) => AppError::Io(error),
            vrcx_0_platform::Error::Json(error) => AppError::Json(error),
            vrcx_0_platform::Error::RegistryPolicyInvalid(message) => {
                AppError::RegistryPolicyInvalid(message)
            }
            vrcx_0_platform::Error::Custom(message) => AppError::Custom(message),
        }
    }
}

impl From<vrcx_0_application_core::Error> for AppError {
    fn from(value: vrcx_0_application_core::Error) -> Self {
        match value {
            vrcx_0_application_core::Error::Database(message) => AppError::database(message, None),
            vrcx_0_application_core::Error::Sqlite { message, category } => {
                AppError::database(message, category)
            }
            vrcx_0_application_core::Error::Io(error) => AppError::Io(error),
            vrcx_0_application_core::Error::Json(error) => AppError::Json(error),
            vrcx_0_application_core::Error::PersistenceInvalidData(message) => {
                AppError::PersistenceInvalidData(message)
            }
            vrcx_0_application_core::Error::RegistryPolicyInvalid(message) => {
                AppError::RegistryPolicyInvalid(message)
            }
            vrcx_0_application_core::Error::WebClient(message) => AppError::WebClient(message),
            vrcx_0_application_core::Error::UpdateArtifactInvalid(message) => {
                AppError::UpdateArtifactInvalid(message)
            }
            vrcx_0_application_core::Error::VrchatApi {
                status_code,
                message,
            } => AppError::VrchatApi {
                status_code,
                message,
            },
            vrcx_0_application_core::Error::Custom(message) => AppError::Custom(message),
        }
    }
}

impl From<vrcx_0_composition::Error> for AppError {
    fn from(value: vrcx_0_composition::Error) -> Self {
        match value {
            vrcx_0_composition::Error::Application(error) => error.into(),
            vrcx_0_composition::Error::AuthInteractionRequired(reason) => {
                AppError::AuthInteractionRequired(reason)
            }
            vrcx_0_composition::Error::AuthSessionInvalidated {
                reason,
                status_code,
            } => AppError::AuthSessionInvalidated {
                reason,
                status_code,
            },
        }
    }
}

impl From<FeedLoggerError> for AppError {
    fn from(value: FeedLoggerError) -> Self {
        Self::FeedLogger {
            code: value.code(),
            message: value.to_string(),
        }
    }
}

impl From<ProfileBackupSettingsError> for AppError {
    fn from(value: ProfileBackupSettingsError) -> Self {
        match value {
            ProfileBackupSettingsError::RecorderNeedsBackups(error) => Self::from(error),
            ProfileBackupSettingsError::Backup(error) => Self::from(error),
        }
    }
}

impl From<vrcx_0_mcp::McpError> for AppError {
    fn from(value: vrcx_0_mcp::McpError) -> Self {
        match value {
            vrcx_0_mcp::McpError::Io(error) => AppError::Io(error),
            vrcx_0_mcp::McpError::Application(error) => AppError::from(error),
            other => AppError::Custom(other.to_string()),
        }
    }
}

impl From<vrcx_0_integration_api::IntegrationApiError> for AppError {
    fn from(value: vrcx_0_integration_api::IntegrationApiError) -> Self {
        match value {
            vrcx_0_integration_api::IntegrationApiError::PortInUse { port } => {
                Self::IntegrationApiPortInUse { port }
            }
            vrcx_0_integration_api::IntegrationApiError::Bind { port, source } => {
                Self::IntegrationApiBind {
                    port,
                    message: source.to_string(),
                }
            }
            vrcx_0_integration_api::IntegrationApiError::Io(error) => Self::Io(error),
            other => Self::Custom(other.to_string()),
        }
    }
}

impl From<vrcx_0_assistant::AssistantError> for AppError {
    fn from(value: vrcx_0_assistant::AssistantError) -> Self {
        match value {
            vrcx_0_assistant::AssistantError::Persistence(error) => match error {
                vrcx_0_assistant::AssistantPortError::Database {
                    message,
                    sqlite_category,
                } => AppError::Database {
                    message,
                    sqlite_category: sqlite_category.map(|category| match category {
                        vrcx_0_assistant::AssistantSqliteErrorCategory::Malformed => {
                            SqliteErrorCategory::Malformed
                        }
                        vrcx_0_assistant::AssistantSqliteErrorCategory::DiskFull => {
                            SqliteErrorCategory::DiskFull
                        }
                        vrcx_0_assistant::AssistantSqliteErrorCategory::Locked => {
                            SqliteErrorCategory::Locked
                        }
                        vrcx_0_assistant::AssistantSqliteErrorCategory::IoError => {
                            SqliteErrorCategory::IoError
                        }
                    }),
                },
                vrcx_0_assistant::AssistantPortError::Io(message) => {
                    AppError::Io(std::io::Error::other(message))
                }
                vrcx_0_assistant::AssistantPortError::Json(message) => {
                    AppError::JsonMessage(message)
                }
                vrcx_0_assistant::AssistantPortError::InvalidData(message) => {
                    AppError::PersistenceInvalidData(message)
                }
                vrcx_0_assistant::AssistantPortError::Custom(message) => AppError::Custom(message),
            },
            vrcx_0_assistant::AssistantError::Mcp(error) => AppError::from(error),
            other => AppError::Custom(other.to_string()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_structured_database_error_with_sqlite_category() {
        let payload = serde_json::to_value(AppError::database(
            "opaque storage failure".into(),
            Some(vrcx_0_contracts::SqliteErrorCategory::DiskFull),
        ))
        .unwrap();

        assert_eq!(
            payload,
            serde_json::json!({
                "code": "database",
                "message": "Database error: opaque storage failure",
                "sqliteCategory": "disk_full"
            })
        );
    }

    #[test]
    fn does_not_classify_database_errors_from_display_text() {
        let payload =
            serde_json::to_value(AppError::database("database or disk is full".into(), None))
                .unwrap();

        assert_eq!(
            payload,
            serde_json::json!({
                "code": "database",
                "message": "Database error: database or disk is full"
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

    #[test]
    fn preserves_vrchat_api_status_in_ipc_payload() {
        let payload =
            serde_json::to_value(AppError::from(vrcx_0_application_core::Error::VrchatApi {
                status_code: 404,
                message: "Not found".into(),
            }))
            .unwrap();

        assert_eq!(
            payload,
            serde_json::json!({
                "code": "vrchat_api",
                "message": "Not found",
                "statusCode": 404
            })
        );
    }

    #[test]
    fn serializes_stable_diagnostic_codes_across_error_boundaries() {
        let cases = [
            (
                AppError::from(vrcx_0_application_core::Error::PersistenceInvalidData(
                    "invalid snapshot".into(),
                )),
                "persistence_invalid_data",
                "invalid snapshot",
            ),
            (
                AppError::from(vrcx_0_application_core::Error::RegistryPolicyInvalid(
                    "invalid registry".into(),
                )),
                "registry_policy_invalid",
                "invalid registry",
            ),
            (
                AppError::from(vrcx_0_application_core::Error::WebClient(
                    "request setup failed".into(),
                )),
                "web_client",
                "request setup failed",
            ),
            (
                AppError::from(vrcx_0_application_core::Error::UpdateArtifactInvalid(
                    "signature mismatch".into(),
                )),
                "update_artifact_invalid",
                "Update artifact is invalid: signature mismatch",
            ),
        ];

        for (error, code, message) in cases {
            let payload = serde_json::to_value(error).unwrap();
            assert_eq!(payload["code"], code);
            assert_eq!(payload["message"], message);
        }
    }

    #[test]
    fn feed_logger_errors_carry_a_code_the_interface_can_translate() {
        let payload = serde_json::to_value(AppError::from(FeedLoggerError::NotPresent)).unwrap();

        assert_eq!(payload["code"], "feed_logger");
        assert_eq!(payload["feedLoggerCode"], "notPresent");
    }

    #[test]
    fn preserves_auth_session_diagnostics_in_ipc_payload() {
        let interaction_required = serde_json::to_value(AppError::from(
            vrcx_0_composition::Error::AuthInteractionRequired("2FA required".into()),
        ))
        .unwrap();
        assert_eq!(
            interaction_required,
            serde_json::json!({
                "code": "auth_interaction_required",
                "message": "2FA required"
            })
        );

        let invalidated = serde_json::to_value(AppError::from(
            vrcx_0_composition::Error::AuthSessionInvalidated {
                reason: "session expired".into(),
                status_code: Some(401),
            },
        ))
        .unwrap();
        assert_eq!(
            invalidated,
            serde_json::json!({
                "code": "auth_session_invalidated",
                "message": "session expired",
                "statusCode": 401
            })
        );
    }
}
