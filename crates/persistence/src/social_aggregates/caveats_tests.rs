use serde_json::json;

use super::*;

#[test]
fn tool_outputs_include_global_data_caveat_resource_text() {
    let value = data_caveats_resource();
    assert!(value.contains("observer-centered"));
    assert!(value.contains("not a global VRChat record"));
    assert_eq!(
        json!(global_caveats()).as_array().unwrap().len(),
        global_caveats().len()
    );
}
