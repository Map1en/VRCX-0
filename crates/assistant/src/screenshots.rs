use serde::{Deserialize, Serialize};
use serde_json::Value;
use specta::Type;
use vrcx_0_core::screenshots::ScreenshotFilter;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Type)]
#[serde(rename_all = "camelCase")]
pub struct AssistantScreenshots {
    pub total: i64,
    pub ids: Vec<String>,
    pub filter: ScreenshotFilter,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchOutput {
    total: i64,
    screenshots: Vec<SearchRow>,
    filter: ScreenshotFilter,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchRow {
    screenshot_id: String,
}

pub fn tool_screenshots(tool: &str, structured: &Value) -> Option<AssistantScreenshots> {
    if tool != "search_screenshots" {
        return None;
    }
    let output = serde_json::from_value::<SearchOutput>(structured.clone()).ok()?;
    (!output.screenshots.is_empty()).then(|| AssistantScreenshots {
        total: output.total,
        ids: output
            .screenshots
            .into_iter()
            .map(|row| row.screenshot_id)
            .collect(),
        filter: output.filter,
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn search_results_become_a_screenshot_strip_with_its_filter() {
        let strip = tool_screenshots(
            "search_screenshots",
            &json!({
                "total": 12,
                "screenshots": [{ "screenshotId": "VRChat_a.png", "people": ["Alice"] }],
                "filter": { "people": ["usr_alice"], "peopleMatch": "all" }
            }),
        )
        .expect("strip");
        assert_eq!(strip.total, 12);
        assert_eq!(strip.ids, ["VRChat_a.png"]);
        assert_eq!(strip.filter.people, ["usr_alice"]);
        assert!(tool_screenshots(
            "search_screenshots",
            &json!({ "total": 0, "screenshots": [], "filter": {} })
        )
        .is_none());
        assert!(tool_screenshots("get_friend_profile", &json!({})).is_none());
    }
}
