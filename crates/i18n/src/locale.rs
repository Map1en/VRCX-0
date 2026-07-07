use serde_json::Value;

pub fn resolve_locale<I, S>(language: &str, available_locales: I, fallback_locale: &str) -> String
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let available = available_locales
        .into_iter()
        .map(|locale| locale.as_ref().to_string())
        .collect::<Vec<_>>();
    let fallback = if fallback_locale.trim().is_empty() {
        "en"
    } else {
        fallback_locale
    };
    let candidate = language.trim().replace('_', "-");
    if candidate.is_empty() {
        return fallback.to_string();
    }
    if let Some(exact) = available.iter().find(|locale| locale.as_str() == candidate) {
        return exact.clone();
    }

    let parts = candidate
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    let base_language = parts
        .first()
        .map(|part| part.to_ascii_lowercase())
        .unwrap_or_default();
    if base_language.is_empty() {
        return fallback.to_string();
    }

    if base_language == "zh" {
        let traditional = parts
            .iter()
            .skip(1)
            .map(|part| part.to_ascii_lowercase())
            .any(|part| matches!(part.as_str(), "hant" | "tw" | "hk" | "mo"));
        let target = if traditional { "zh-TW" } else { "zh-CN" };
        return available
            .iter()
            .find(|locale| locale.as_str() == target)
            .cloned()
            .unwrap_or_else(|| fallback.to_string());
    }

    available
        .iter()
        .find(|locale| locale.to_ascii_lowercase() == base_language)
        .cloned()
        .unwrap_or_else(|| fallback.to_string())
}

pub fn interpolate(template: &str, params: &Value) -> String {
    let Some(params) = params.as_object() else {
        return template.to_string();
    };
    let chars = template.chars().collect::<Vec<_>>();
    let mut output = String::with_capacity(template.len());
    let mut index = 0;

    while index < chars.len() {
        if chars[index] != '{' {
            output.push(chars[index]);
            index += 1;
            continue;
        }

        let mut end = index + 1;
        while end < chars.len() && chars[end] != '}' {
            end += 1;
        }

        if end >= chars.len() {
            output.push(chars[index]);
            index += 1;
            continue;
        }

        let key = chars[index + 1..end].iter().collect::<String>();
        output.push_str(&param_value(params.get(key.trim())));
        index = end + 1;
    }

    output
}

pub fn collapse_whitespace(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn param_value(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(value)) => value.trim().to_string(),
        Some(Value::Bool(value)) => value.to_string(),
        Some(Value::Number(value)) => value.to_string(),
        _ => String::new(),
    }
}
