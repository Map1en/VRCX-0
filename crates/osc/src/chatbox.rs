use crate::message::{encode_message, OscArg};

const CHATBOX_INPUT_ADDRESS: &str = "/chatbox/input";
const CHATBOX_TYPING_ADDRESS: &str = "/chatbox/typing";
const CHATBOX_MAX_LINES: usize = 9;
pub const CHATBOX_MAX_CHARS: usize = 144;

pub fn chatbox_input_message(text: &str, notify: bool) -> Vec<u8> {
    encode_message(
        CHATBOX_INPUT_ADDRESS,
        &[OscArg::Str(text), OscArg::Bool(true), OscArg::Bool(notify)],
    )
}

pub fn chatbox_typing_message(typing: bool) -> Vec<u8> {
    encode_message(CHATBOX_TYPING_ADDRESS, &[OscArg::Bool(typing)])
}

pub fn fit_chatbox_text(text: &str) -> String {
    text.replace("\r\n", "\n")
        .replace(['\r', '\0'], "")
        .split('\n')
        .take(CHATBOX_MAX_LINES)
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .chars()
        .take(CHATBOX_MAX_CHARS)
        .collect::<String>()
        .trim_end()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn input_message_sends_immediately_and_carries_the_notification_flag() {
        assert_eq!(&chatbox_input_message("yo", false)[16..20], b",sTF");
        assert_eq!(&chatbox_input_message("yo", true)[16..20], b",sTT");
    }

    #[test]
    fn typing_message_carries_the_typing_flag() {
        let encoded = chatbox_typing_message(true);

        assert_eq!(&encoded[..16], b"/chatbox/typing\0");
        assert_eq!(&encoded[16..], b",T\0\0");
    }

    #[test]
    fn fit_caps_characters_not_bytes() {
        let text = "あ".repeat(CHATBOX_MAX_CHARS + 10);

        let fitted = fit_chatbox_text(&text);

        assert_eq!(fitted.chars().count(), CHATBOX_MAX_CHARS);
    }

    #[test]
    fn fit_drops_lines_past_the_limit_and_normalizes_line_endings() {
        let text = (1..=12)
            .map(|line| line.to_string())
            .collect::<Vec<_>>()
            .join("\r\n");

        let fitted = fit_chatbox_text(&text);

        assert_eq!(fitted, "1\n2\n3\n4\n5\n6\n7\n8\n9");
    }

    #[test]
    fn fit_trims_surrounding_whitespace() {
        assert_eq!(fit_chatbox_text("  hi \n"), "hi");
    }
}
