#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum IpcEventDisposition {
    Forward,
    Handled,
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct IpcPacket {
    #[serde(rename = "Type")]
    pub type_field: String,
    #[serde(rename = "Data", skip_serializing_if = "Option::is_none")]
    pub data: Option<String>,
    #[serde(rename = "MsgType", skip_serializing_if = "Option::is_none")]
    pub msg_type: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::IpcPacket;

    #[test]
    fn serializes_ipc_packet_with_legacy_field_names() {
        let packet = IpcPacket {
            type_field: "Launch".to_string(),
            data: Some("payload".to_string()),
            msg_type: Some("Request".to_string()),
        };

        let value = serde_json::to_value(packet).unwrap();

        assert_eq!(value["Type"], "Launch");
        assert_eq!(value["Data"], "payload");
        assert_eq!(value["MsgType"], "Request");
        assert!(value.get("type_field").is_none());
        assert!(value.get("data").is_none());
        assert!(value.get("msg_type").is_none());
    }
}
