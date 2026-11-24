use crate::message::{encode_message, OscArg};

const AVATAR_PARAMETER_PREFIX: &str = "/avatar/parameters/";

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum AvatarParameterValue {
    Bool(bool),
    Int(i32),
    Float(f32),
}

pub fn avatar_parameter_message(name: &str, value: AvatarParameterValue) -> Vec<u8> {
    let arg = match value {
        AvatarParameterValue::Bool(value) => OscArg::Bool(value),
        AvatarParameterValue::Int(value) => OscArg::Int(value),
        AvatarParameterValue::Float(value) => OscArg::Float(value),
    };
    encode_message(&format!("{AVATAR_PARAMETER_PREFIX}{name}"), &[arg])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parameter_name_is_appended_to_the_avatar_parameters_address() {
        let encoded = avatar_parameter_message("Beat", AvatarParameterValue::Bool(true));

        assert_eq!(&encoded[..24], b"/avatar/parameters/Beat\0");
        assert_eq!(&encoded[24..], b",T\0\0");
    }
}
