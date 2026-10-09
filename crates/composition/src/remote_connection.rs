use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::{Error, Result};

const CONNECTION_FILE: &str = "remote-server.json";

/// The desktop's only persistent database configuration. History lives on the server.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteDatabaseConnection {
    pub server_url: String,
    pub token: String,
}

impl RemoteDatabaseConnection {
    pub fn load(app_data: &Path) -> Result<Option<Self>> {
        let path = app_data.join(CONNECTION_FILE);
        match std::fs::read(&path) {
            Ok(bytes) => {
                let connection: Self = serde_json::from_slice(&bytes)?;
                connection.validate()?;
                Ok(Some(connection))
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error.into()),
        }
    }

    pub fn validate(&self) -> Result<()> {
        if !(self.server_url.trim().starts_with("http://")
            || self.server_url.trim().starts_with("https://"))
            || self.token.trim().is_empty()
        {
            return Err(Error::Custom(
                "Enter an HTTP or HTTPS server address and its access token.".into(),
            ));
        }
        Ok(())
    }

    pub fn save(&self, app_data: &Path) -> Result<()> {
        self.validate()?;
        std::fs::create_dir_all(app_data)?;
        let normalized = Self {
            server_url: self.server_url.trim().trim_end_matches('/').to_owned(),
            token: self.token.trim().to_owned(),
        };
        let path = app_data.join(CONNECTION_FILE);
        std::fs::write(&path, serde_json::to_vec_pretty(&normalized)?)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
        }
        Ok(())
    }

    pub fn choose_local(app_data: &Path) -> Result<()> {
        std::fs::create_dir_all(app_data)?;
        match std::fs::remove_file(app_data.join(CONNECTION_FILE)) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
        std::fs::write(app_data.join("storage-mode.json"), b"\"local\"")?;
        Ok(())
    }

    pub fn is_local_configured(app_data: &Path) -> bool {
        !app_data.join(CONNECTION_FILE).exists()
            && (app_data.join("storage-mode.json").exists()
                || app_data.join("VRCX-0.sqlite3").exists())
    }
}
