#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum OscArg<'a> {
    Str(&'a str),
    Bool(bool),
    Int(i32),
    Float(f32),
}

pub(crate) fn encode_message(address: &str, args: &[OscArg<'_>]) -> Vec<u8> {
    let mut buffer = Vec::with_capacity(address.len() + 8);
    push_padded_str(&mut buffer, address);
    let mut type_tags = String::with_capacity(args.len() + 1);
    type_tags.push(',');
    for arg in args {
        type_tags.push(match arg {
            OscArg::Str(_) => 's',
            OscArg::Bool(true) => 'T',
            OscArg::Bool(false) => 'F',
            OscArg::Int(_) => 'i',
            OscArg::Float(_) => 'f',
        });
    }
    push_padded_str(&mut buffer, &type_tags);
    for arg in args {
        match arg {
            OscArg::Str(value) => push_padded_str(&mut buffer, value),
            OscArg::Int(value) => buffer.extend(value.to_be_bytes()),
            OscArg::Float(value) => buffer.extend(value.to_be_bytes()),
            OscArg::Bool(_) => {}
        }
    }
    buffer
}

fn push_padded_str(buffer: &mut Vec<u8>, value: &str) {
    buffer.extend(value.bytes().filter(|byte| *byte != 0));
    buffer.push(0);
    while !buffer.len().is_multiple_of(4) {
        buffer.push(0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pads_address_type_tags_and_strings_to_four_bytes() {
        let encoded = encode_message("/chatbox/input", &[OscArg::Str("hi"), OscArg::Bool(true)]);

        assert_eq!(&encoded[..16], b"/chatbox/input\0\0");
        assert_eq!(&encoded[16..20], b",sT\0");
        assert_eq!(&encoded[20..], b"hi\0\0");
    }

    #[test]
    fn strips_interior_nul_bytes_so_the_string_is_not_cut_short() {
        let encoded = encode_message("/a", &[OscArg::Str("a\0b")]);

        assert_eq!(&encoded[8..], b"ab\0\0");
    }

    #[test]
    fn string_already_aligned_still_gets_a_terminator_block() {
        let encoded = encode_message("/abc", &[]);

        assert_eq!(&encoded[..8], b"/abc\0\0\0\0");
        assert_eq!(&encoded[8..], b",\0\0\0");
    }

    #[test]
    fn numbers_are_big_endian_four_byte_arguments() {
        let encoded = encode_message("/n", &[OscArg::Int(72), OscArg::Float(0.5)]);

        assert_eq!(&encoded[4..8], b",if\0");
        assert_eq!(&encoded[8..12], &72_i32.to_be_bytes());
        assert_eq!(&encoded[12..], &0.5_f32.to_be_bytes());
    }
}
