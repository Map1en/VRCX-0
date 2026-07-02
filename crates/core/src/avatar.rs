pub fn avatar_name_from_file_name(file_name: &str) -> Option<String> {
    let lower = file_name.to_ascii_lowercase();
    let start = lower.find("avatar - ")? + "avatar - ".len();
    let end = lower.rfind(" - image -")?;
    if end < start {
        return None;
    }
    let name = file_name[start..end].trim();
    (!name.is_empty()).then(|| name.to_string())
}

#[cfg(test)]
mod tests {
    use super::avatar_name_from_file_name;

    #[test]
    fn avatar_name_from_file_name_extracts_name() {
        let raw = "Avatar - Name - Image - 2022․3․22f1_1_standalonewindows_Release";

        assert_eq!(avatar_name_from_file_name(raw).as_deref(), Some("Name"));
        assert_eq!(avatar_name_from_file_name("just a name"), None);
    }
}
