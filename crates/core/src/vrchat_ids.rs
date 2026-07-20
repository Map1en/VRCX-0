pub fn is_world_id(value: &str) -> bool {
    is_prefixed_uuid(value, "wrld_")
}

pub fn is_avatar_id(value: &str) -> bool {
    is_prefixed_uuid(value, "avtr_")
}

fn is_prefixed_uuid(value: &str, prefix: &str) -> bool {
    let Some(uuid) = value.strip_prefix(prefix) else {
        return false;
    };
    is_uuid(uuid)
}

fn is_uuid(value: &str) -> bool {
    value.len() == 36
        && value.bytes().enumerate().all(|(index, byte)| {
            if matches!(index, 8 | 13 | 18 | 23) {
                byte == b'-'
            } else {
                byte.is_ascii_hexdigit()
            }
        })
}

#[cfg(test)]
mod tests {
    use super::{is_avatar_id, is_world_id};

    #[test]
    fn accepts_canonical_world_ids() {
        assert!(is_world_id("wrld_12345678-1234-1234-1234-1234567890ab"));
    }

    #[test]
    fn rejects_noncanonical_world_ids() {
        for value in [
            "",
            "legacy-world-id",
            "wrld_not-a-vrchat-id",
            "usr_12345678-1234-1234-1234-1234567890ab",
        ] {
            assert!(!is_world_id(value), "{value}");
        }
    }

    #[test]
    fn validates_canonical_avatar_ids() {
        assert!(is_avatar_id("avtr_12345678-1234-1234-1234-1234567890ab"));
        for value in [
            "",
            "avtr_not-a-vrchat-id",
            "wrld_12345678-1234-1234-1234-1234567890ab",
        ] {
            assert!(!is_avatar_id(value), "{value}");
        }
    }
}
