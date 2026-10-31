use vrcx_0_application_core::Error as ApplicationError;

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error(transparent)]
    Application(#[from] ApplicationError),

    #[error("{0}")]
    AuthInteractionRequired(String),

    #[error("{reason}")]
    AuthSessionInvalidated {
        reason: String,
        status_code: Option<i32>,
    },
}

impl From<std::io::Error> for Error {
    fn from(value: std::io::Error) -> Self {
        Self::Application(value.into())
    }
}

impl From<serde_json::Error> for Error {
    fn from(value: serde_json::Error) -> Self {
        Self::Application(value.into())
    }
}

impl From<vrcx_0_persistence::Error> for Error {
    fn from(value: vrcx_0_persistence::Error) -> Self {
        Self::Application(value.into())
    }
}

impl From<vrcx_0_media::Error> for Error {
    fn from(value: vrcx_0_media::Error) -> Self {
        Self::Application(match value {
            vrcx_0_media::Error::Io(error) => ApplicationError::Io(error),
            vrcx_0_media::Error::Custom(message) => ApplicationError::Custom(message),
        })
    }
}

impl From<vrcx_0_platform::Error> for Error {
    fn from(value: vrcx_0_platform::Error) -> Self {
        Self::Application(match value {
            vrcx_0_platform::Error::Io(error) => ApplicationError::Io(error),
            vrcx_0_platform::Error::Json(error) => ApplicationError::Json(error),
            vrcx_0_platform::Error::RegistryPolicyInvalid(message) => {
                ApplicationError::RegistryPolicyInvalid(message)
            }
            vrcx_0_platform::Error::Custom(message) => ApplicationError::Custom(message),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_platform_registry_policy_category() {
        assert!(matches!(
            Error::from(vrcx_0_platform::Error::RegistryPolicyInvalid(
                "invalid registry".into()
            )),
            Error::Application(ApplicationError::RegistryPolicyInvalid(message))
                if message == "invalid registry"
        ));
    }
}
