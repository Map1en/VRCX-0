#![allow(non_snake_case)]

use serde::{Deserialize, Serialize};

use crate::error::AppError;

#[derive(Debug, Deserialize, specta::Type)]
pub struct ProxySettingsTestInput {
    #[serde(default)]
    proxy: String,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ProxySettingsTestResult {
    normalized_proxy: Option<String>,
    status: i32,
}

#[tauri::command]
#[specta::specta]
pub async fn app__proxy_settings_test(
    input: ProxySettingsTestInput,
) -> Result<ProxySettingsTestResult, AppError> {
    let result =
        vrcx_0_application_core::test_proxy_connectivity(&input.proxy, env!("CARGO_PKG_VERSION"))
            .await?;
    Ok(ProxySettingsTestResult {
        normalized_proxy: result.normalized_proxy,
        status: result.status,
    })
}
