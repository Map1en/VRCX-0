use vrcx_0_application::social::NoteExportRemoteRequests;
use vrcx_0_application_core::Result;
use vrcx_0_contracts::vrchat_api::VrchatRequest;
use vrcx_0_core::vrchat_endpoints::normalize_vrchat_api_endpoint;
use vrcx_0_vrchat_client::tools::user_note_save_input;

pub struct VrchatNoteExportRemoteRequests;

impl NoteExportRemoteRequests for VrchatNoteExportRemoteRequests {
    fn save_note(&self, endpoint: String, user_id: String, note: String) -> Result<VrchatRequest> {
        Ok(user_note_save_input(
            normalize_vrchat_api_endpoint(Some(&endpoint)),
            user_id,
            note,
        )?
        .1)
    }
}
