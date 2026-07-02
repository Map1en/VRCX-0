pub(crate) fn extract_file_id(value: &str) -> Option<String> {
    let start = value.find("file_")?;
    let id = value[start..]
        .chars()
        .take_while(|ch| ch.is_ascii_alphanumeric() || *ch == '-' || *ch == '_')
        .collect::<String>();
    (!id.is_empty()).then_some(id)
}
