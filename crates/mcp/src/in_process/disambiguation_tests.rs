use std::sync::{Arc, Mutex};

use rmcp::model::{
    CallToolRequestParams, ClientCapabilities, ClientConfig, ElicitRequestParams, ElicitResult,
    ElicitationAction, ElicitationCapability, FormElicitationCapability, Implementation,
    ProtocolVersion,
};
use rmcp::service::{RequestContext, RoleClient};
use rmcp::{serve_client, serve_server, ClientHandler, ErrorData};
use serde_json::{json, Map, Value};
use vrcx_0_core::OwnerId;
use vrcx_0_persistence::game_log::{write_batch, GameLogJoinLeaveEntry, GameLogWriteBatch};

use crate::server::VrcxMcpServer;
use crate::test_support::test_runtime_with_database;

#[derive(Clone)]
struct PickingClient {
    protocol_version: ProtocolVersion,
    pick: Option<&'static str>,
    offered: Arc<Mutex<Vec<Value>>>,
}

impl ClientHandler for PickingClient {
    fn get_info(&self) -> ClientConfig {
        let mut capabilities = ClientCapabilities::default();
        capabilities.elicitation =
            Some(ElicitationCapability::new().with_form(FormElicitationCapability::new()));
        ClientConfig::new(capabilities, Implementation::new("picker", "0"))
            .with_protocol_version(self.protocol_version.clone())
    }

    async fn create_elicitation(
        &self,
        request: ElicitRequestParams,
        _context: RequestContext<RoleClient>,
    ) -> Result<ElicitResult, ErrorData> {
        if let ElicitRequestParams::FormElicitationParams {
            requested_schema, ..
        } = request
        {
            let schema = serde_json::to_value(requested_schema).unwrap();
            self.offered
                .lock()
                .unwrap()
                .push(schema["properties"]["userId"]["oneOf"].clone());
        }
        Ok(match self.pick {
            Some(user_id) => ElicitResult::new(ElicitationAction::Accept)
                .with_content(json!({ "userId": user_id })),
            None => ElicitResult::new(ElicitationAction::Decline),
        })
    }
}

fn joined(created_at: &str, name: &str, user_id: &str) -> GameLogJoinLeaveEntry {
    GameLogJoinLeaveEntry {
        created_at: created_at.into(),
        event_type: "OnPlayerJoined".into(),
        display_name: name.into(),
        location: "wrld_a:1".into(),
        user_id: user_id.into(),
        world_name: "World A".into(),
        time: 0,
    }
}

async fn call_companions_of_ali(
    name: &str,
    protocol_version: ProtocolVersion,
    pick: Option<&'static str>,
) -> (Value, Vec<Value>) {
    let (_dir, runtime, db) = test_runtime_with_database(name, "usr_owner").unwrap();
    write_batch(
        db.as_ref(),
        &OwnerId::new("usr_owner"),
        &GameLogWriteBatch {
            join_leave: vec![
                joined("2026-06-01T20:00:00.000Z", "Alice", "usr_alice"),
                joined("2026-06-02T20:00:00.000Z", "Alicia", "usr_alicia"),
            ],
            ..GameLogWriteBatch::default()
        },
    )
    .unwrap();
    let (server_io, client_io) = tokio::io::duplex(1024 * 1024);
    tokio::spawn(async move {
        let server = serve_server(VrcxMcpServer::new(runtime), server_io)
            .await
            .unwrap();
        let _ = server.waiting().await;
    });
    let offered = Arc::new(Mutex::new(Vec::new()));
    let client = serve_client(
        PickingClient {
            protocol_version,
            pick,
            offered: Arc::clone(&offered),
        },
        client_io,
    )
    .await
    .unwrap();

    let result = client
        .call_tool(
            CallToolRequestParams::new("get_companions_of")
                .with_arguments(Map::from_iter([("user".into(), json!("Ali"))])),
        )
        .await
        .unwrap();
    let offered = offered.lock().unwrap().clone();
    (result.structured_content.unwrap(), offered)
}

fn offered_ids(offered: &[Value]) -> Vec<&str> {
    offered[0]
        .as_array()
        .unwrap()
        .iter()
        .map(|option| option["const"].as_str().unwrap())
        .collect()
}

#[tokio::test]
async fn ambiguous_name_is_resolved_through_a_server_initiated_elicitation() {
    let (structured, offered) = call_companions_of_ali(
        "in-process-elicit-legacy",
        ProtocolVersion::V_2025_11_25,
        Some("usr_alicia"),
    )
    .await;

    assert_eq!(offered.len(), 1);
    assert_eq!(offered_ids(&offered), ["usr_alicia", "usr_alice"]);
    assert!(
        structured.get("needsDisambiguation").is_none(),
        "{structured}"
    );
}

#[tokio::test]
async fn ambiguous_name_is_resolved_through_an_input_required_round() {
    let (structured, offered) = call_companions_of_ali(
        "in-process-elicit-mrtr",
        ProtocolVersion::V_2026_07_28,
        Some("usr_alice"),
    )
    .await;

    assert_eq!(offered.len(), 1);
    assert!(
        structured.get("needsDisambiguation").is_none(),
        "{structured}"
    );
}

#[tokio::test]
async fn declined_choice_keeps_the_candidate_list_for_the_model() {
    let (structured, offered) = call_companions_of_ali(
        "in-process-elicit-decline",
        ProtocolVersion::V_2025_11_25,
        None,
    )
    .await;

    assert_eq!(offered.len(), 1);
    assert_eq!(structured["needsDisambiguation"], true);
    assert_eq!(structured["candidates"].as_array().unwrap().len(), 2);
}
