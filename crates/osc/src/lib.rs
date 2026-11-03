mod chatbox;
mod message;

pub use chatbox::{
    chatbox_input_message, chatbox_typing_message, fit_chatbox_text, CHATBOX_MAX_CHARS,
};
