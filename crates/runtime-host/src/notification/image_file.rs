pub(crate) fn extract_file_id(value: &str) -> Option<String> {
    let start = value.find("file_")?;
    let id = value[start..]
        .chars()
        .take_while(|ch| ch.is_ascii_alphanumeric() || *ch == '-' || *ch == '_')
        .collect::<String>();
    (!id.is_empty()).then_some(id)
}

pub(crate) fn extract_file_version(value: &str, file_id: &str) -> Option<String> {
    let marker = format!("/{file_id}/");
    let start = value.find(&marker)? + marker.len();
    let version = value[start..]
        .chars()
        .take_while(|ch| ch.is_ascii_digit())
        .collect::<String>();
    (!version.is_empty()).then_some(version)
}

pub(crate) fn fallback_file_version(value: &str) -> String {
    value
        .split('/')
        .next_back()
        .unwrap_or_default()
        .split('?')
        .next()
        .unwrap_or_default()
        .to_string()
}
