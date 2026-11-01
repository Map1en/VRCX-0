use base64::{engine::general_purpose::STANDARD as B64, Engine};
use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use serde_json::json;
use vrcx_0_local_server::{generate_token, is_allowed_authority, tokens_match};

use crate::error::McpError;
use crate::types::{ClientConfigSnippets, McpInstallClient};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct McpAuthPolicy {
    pub port: u16,
    pub token: String,
    pub allow_lan_connections: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, thiserror::Error)]
pub enum McpAuthError {
    #[error("MCP requests used an invalid host header")]
    InvalidHost,
    #[error("MCP requests used an invalid origin")]
    InvalidOrigin,
    #[error("MCP requests require an Authorization bearer token")]
    MissingBearerToken,
    #[error("MCP bearer token did not match")]
    InvalidBearerToken,
}

pub fn generate_mcp_token() -> Result<String, McpError> {
    generate_token().map_err(McpError::from)
}

pub fn authorize_mcp_request(
    policy: &McpAuthPolicy,
    authorization: Option<&str>,
    host: Option<&str>,
    origin: Option<&str>,
) -> Result<(), McpAuthError> {
    if !is_allowed_authority(host, policy.port, policy.allow_lan_connections) {
        return Err(McpAuthError::InvalidHost);
    }

    if let Some(origin) = origin {
        if !is_allowed_loopback_origin(origin, policy.port) {
            return Err(McpAuthError::InvalidOrigin);
        }
    }

    let bearer = authorization
        .and_then(|value| value.strip_prefix("Bearer "))
        .ok_or(McpAuthError::MissingBearerToken)?;

    if tokens_match(bearer, &policy.token) {
        Ok(())
    } else {
        Err(McpAuthError::InvalidBearerToken)
    }
}

pub fn client_config_snippets(
    port: u16,
    token: &str,
    allow_lan_connections: bool,
) -> ClientConfigSnippets {
    let host = if allow_lan_connections {
        "YOUR-LAN-IP"
    } else {
        "127.0.0.1"
    };
    let url = format!("http://{host}:{port}/mcp");
    let auth_header = format!("Authorization: Bearer {token}");
    // On Windows `npx` is the `npx.cmd` shim; launching it as `command: "npx"` makes the
    // client wrap it in `cmd /C <resolved npx.cmd path>`, whose quote-stripping mangles a
    // Node install path containing spaces (e.g. `C:\Program Files\nodejs`). Spawning `cmd`
    // with the bare `npx` lets cmd resolve it via PATHEXT, so no spaced path is embedded.
    let mcp_remote_command = if cfg!(windows) {
        format!(
            "\"command\": \"cmd\",\n      \"args\": [\"/c\", \"npx\", \"-y\", \"mcp-remote\", \"{url}\", \"--header\", \"{auth_header}\"]"
        )
    } else {
        format!(
            "\"command\": \"npx\",\n      \"args\": [\"-y\", \"mcp-remote\", \"{url}\", \"--header\", \"{auth_header}\"]"
        )
    };
    ClientConfigSnippets {
        claude_code_command: format!(
            "claude mcp add --transport http vrcx-0 {url} --header \"{auth_header}\""
        ),
        mcp_remote_json: format!(
            "{{\n  \"mcpServers\": {{\n    \"vrcx-0\": {{\n      {mcp_remote_command}\n    }}\n  }}\n}}"
        ),
        generic_json: format!(
            "{{\n  \"mcpServers\": {{\n    \"vrcx-0\": {{\n      \"url\": \"{url}\",\n      \"headers\": {{\n        \"Authorization\": \"Bearer {token}\"\n      }}\n    }}\n  }}\n}}"
        ),
        codex_toml: format!(
            "[mcp_servers.vrcx-0]\nurl = \"{url}\"\nhttp_headers = {{ \"Authorization\" = \"Bearer {token}\" }}"
        ),
        opencode_json: format!(
            "{{\n  \"$schema\": \"https://opencode.ai/config.json\",\n  \"mcp\": {{\n    \"vrcx-0\": {{\n      \"type\": \"remote\",\n      \"url\": \"{url}\",\n      \"headers\": {{\n        \"Authorization\": \"Bearer {token}\"\n      }},\n      \"enabled\": true\n    }}\n  }}\n}}"
        ),
    }
}

pub fn client_install_url(client: McpInstallClient, port: u16, token: &str) -> String {
    let url = format!("http://127.0.0.1:{port}/mcp");
    let headers = json!({ "Authorization": format!("Bearer {token}") });
    let remote_config = || base64_query_value(&json!({ "url": url, "headers": headers }));
    match client {
        McpInstallClient::CherryStudio => format!(
            "cherrystudio://mcp/install?servers={}",
            base64_query_value(&json!({
                "mcpServers": {
                    "vrcx-0": { "type": "streamableHttp", "baseUrl": url, "headers": headers }
                }
            }))
        ),
        McpInstallClient::Cursor => format!(
            "cursor://anysphere.cursor-deeplink/mcp/install?name=vrcx-0&config={}",
            remote_config()
        ),
        McpInstallClient::LmStudio => {
            format!("lmstudio://add_mcp?name=vrcx-0&config={}", remote_config())
        }
        McpInstallClient::VsCode => format!(
            "vscode:mcp/install?{}",
            utf8_percent_encode(
                &json!({ "name": "vrcx-0", "type": "http", "url": url, "headers": headers })
                    .to_string(),
                NON_ALPHANUMERIC
            )
        ),
    }
}

fn base64_query_value(config: &serde_json::Value) -> String {
    utf8_percent_encode(&B64.encode(config.to_string()), NON_ALPHANUMERIC).to_string()
}

fn is_allowed_loopback_origin(origin: &str, port: u16) -> bool {
    let origin = origin.to_ascii_lowercase();
    origin == format!("http://127.0.0.1:{port}") || origin == format!("http://localhost:{port}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_auth_requires_bearer_token_and_loopback_host() {
        let policy = McpAuthPolicy {
            port: 8798,
            token: "secret-token".into(),
            allow_lan_connections: false,
        };

        assert_eq!(
            authorize_mcp_request(
                &policy,
                Some("Bearer secret-token"),
                Some("127.0.0.1:8798"),
                None,
            ),
            Ok(())
        );
        assert_eq!(
            authorize_mcp_request(
                &policy,
                Some("Bearer secret-token"),
                Some("localhost:8798"),
                None,
            ),
            Ok(())
        );
        assert!(authorize_mcp_request(
            &policy,
            Some("Bearer secret-token"),
            Some("evil.test:8798"),
            None,
        )
        .is_err());
        assert!(
            authorize_mcp_request(&policy, Some("Bearer wrong"), Some("127.0.0.1:8798"), None,)
                .is_err()
        );
        assert!(authorize_mcp_request(&policy, None, Some("127.0.0.1:8798"), None).is_err());
    }

    #[test]
    fn request_auth_allows_lan_authority_only_when_enabled() {
        let mut policy = McpAuthPolicy {
            port: 8798,
            token: "secret-token".into(),
            allow_lan_connections: false,
        };

        assert_eq!(
            authorize_mcp_request(
                &policy,
                Some("Bearer secret-token"),
                Some("192.168.1.20:8798"),
                None,
            ),
            Err(McpAuthError::InvalidHost)
        );

        policy.allow_lan_connections = true;
        assert_eq!(
            authorize_mcp_request(
                &policy,
                Some("Bearer secret-token"),
                Some("192.168.1.20:8798"),
                None,
            ),
            Ok(())
        );
        assert_eq!(
            authorize_mcp_request(
                &policy,
                Some("Bearer secret-token"),
                Some("desktop.local:8798"),
                Some("http://evil.test"),
            ),
            Err(McpAuthError::InvalidOrigin)
        );
        assert_eq!(
            authorize_mcp_request(
                &policy,
                Some("Bearer secret-token"),
                Some("192.168.1.20:9876"),
                None,
            ),
            Err(McpAuthError::InvalidHost)
        );
    }

    #[test]
    fn client_help_snippets_include_real_url_and_token_warning() {
        let snippets = client_config_snippets(7654, "tok_secret", false);

        assert!(snippets
            .claude_code_command
            .contains("http://127.0.0.1:7654/mcp"));
        assert!(snippets
            .claude_code_command
            .contains("Authorization: Bearer tok_secret"));
        assert!(snippets.generic_json.contains("\"mcpServers\""));
        assert!(snippets.generic_json.contains("http://127.0.0.1:7654/mcp"));
        assert!(snippets.mcp_remote_json.contains("mcp-remote"));
        assert!(snippets
            .mcp_remote_json
            .contains("http://127.0.0.1:7654/mcp"));

        if cfg!(windows) {
            assert!(snippets.mcp_remote_json.contains("\"command\": \"cmd\""));
            assert!(snippets.mcp_remote_json.contains("\"/c\""));
            assert!(snippets.mcp_remote_json.contains("\"npx\""));
        } else {
            assert!(snippets.mcp_remote_json.contains("\"command\": \"npx\""));
        }
    }

    #[test]
    fn codex_and_opencode_snippets_use_native_remote_config() {
        let snippets = client_config_snippets(7654, "tok_secret", false);

        assert_eq!(
            snippets.codex_toml,
            "[mcp_servers.vrcx-0]\nurl = \"http://127.0.0.1:7654/mcp\"\nhttp_headers = { \"Authorization\" = \"Bearer tok_secret\" }"
        );
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&snippets.opencode_json)
                .expect("opencode json"),
            json!({
                "$schema": "https://opencode.ai/config.json",
                "mcp": {
                    "vrcx-0": {
                        "type": "remote",
                        "url": "http://127.0.0.1:7654/mcp",
                        "headers": { "Authorization": "Bearer tok_secret" },
                        "enabled": true,
                    }
                }
            })
        );
    }

    #[test]
    fn client_help_snippets_use_lan_placeholder_when_lan_connections_are_enabled() {
        let snippets = client_config_snippets(7654, "tok_secret", true);

        assert!(snippets
            .claude_code_command
            .contains("http://YOUR-LAN-IP:7654/mcp"));
        assert!(snippets
            .generic_json
            .contains("http://YOUR-LAN-IP:7654/mcp"));
        assert!(snippets
            .mcp_remote_json
            .contains("http://YOUR-LAN-IP:7654/mcp"));
        assert!(!snippets.claude_code_command.contains("127.0.0.1"));
        assert!(!snippets.generic_json.contains("127.0.0.1"));
        assert!(!snippets.mcp_remote_json.contains("127.0.0.1"));
        assert!(snippets.codex_toml.contains("http://YOUR-LAN-IP:7654/mcp"));
        assert!(snippets
            .opencode_json
            .contains("http://YOUR-LAN-IP:7654/mcp"));
    }

    fn decoded_query_config(link: &str, prefix: &str) -> serde_json::Value {
        let encoded = link.strip_prefix(prefix).expect("install link prefix");
        let base64 = percent_encoding::percent_decode_str(encoded)
            .decode_utf8()
            .expect("utf8 config");
        serde_json::from_slice(&B64.decode(base64.as_bytes()).expect("base64 config"))
            .expect("json config")
    }

    #[test]
    fn cursor_and_lm_studio_links_carry_base64_remote_config() {
        let expected = json!({
            "url": "http://127.0.0.1:7654/mcp",
            "headers": { "Authorization": "Bearer tok_secret" },
        });

        let cursor = client_install_url(McpInstallClient::Cursor, 7654, "tok_secret");
        assert_eq!(
            decoded_query_config(
                &cursor,
                "cursor://anysphere.cursor-deeplink/mcp/install?name=vrcx-0&config="
            ),
            expected
        );

        let lm_studio = client_install_url(McpInstallClient::LmStudio, 7654, "tok_secret");
        assert_eq!(
            decoded_query_config(&lm_studio, "lmstudio://add_mcp?name=vrcx-0&config="),
            expected
        );
    }

    #[test]
    fn cherry_studio_link_carries_base64_streamable_http_server_map() {
        let link = client_install_url(McpInstallClient::CherryStudio, 7654, "tok_secret");

        assert!(!link.contains('+'));
        assert_eq!(
            decoded_query_config(&link, "cherrystudio://mcp/install?servers="),
            json!({
                "mcpServers": {
                    "vrcx-0": {
                        "type": "streamableHttp",
                        "baseUrl": "http://127.0.0.1:7654/mcp",
                        "headers": { "Authorization": "Bearer tok_secret" },
                    }
                }
            })
        );
    }

    #[test]
    fn vscode_link_carries_url_encoded_named_http_config() {
        let link = client_install_url(McpInstallClient::VsCode, 7654, "tok_secret");
        let encoded = link
            .strip_prefix("vscode:mcp/install?")
            .expect("install link prefix");
        let config: serde_json::Value = serde_json::from_str(
            &percent_encoding::percent_decode_str(encoded)
                .decode_utf8()
                .expect("utf8 config"),
        )
        .expect("json config");

        assert_eq!(
            config,
            json!({
                "name": "vrcx-0",
                "type": "http",
                "url": "http://127.0.0.1:7654/mcp",
                "headers": { "Authorization": "Bearer tok_secret" },
            })
        );
    }
}
