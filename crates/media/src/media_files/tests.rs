use super::*;

struct TestDir {
    path: PathBuf,
}

impl TestDir {
    fn new(name: &str) -> Self {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "vrcx-0-media-files-{name}-{}-{nonce}",
            std::process::id()
        ));
        std::fs::create_dir_all(&path).unwrap();
        Self { path }
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

#[test]
fn md5_matches_rfc_1321_test_vectors() {
    let vectors = [
        ("", "d41d8cd98f00b204e9800998ecf8427e"),
        ("a", "0cc175b9c0f1b6a831c399e269772661"),
        ("abc", "900150983cd24fb0d6963f7d28e17f72"),
        ("message digest", "f96b697d7cb7938d525a2f31aaf161d0"),
        (
            "abcdefghijklmnopqrstuvwxyz",
            "c3fcd3d76192e4007dfb496cca67e13b",
        ),
        (
            "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
            "d174ab98d277d9f5a5611c2c9f419d9f",
        ),
        (
            "12345678901234567890123456789012345678901234567890123456789012345678901234567890",
            "57edf4a22be3c955ac49da2e2107b67a",
        ),
    ];

    for (input, expected) in vectors {
        assert_eq!(hex::encode(md5_digest(input.as_bytes())), expected);
    }
}

#[test]
fn md5_handles_56_and_64_byte_padding_boundaries() {
    assert_eq!(
        hex::encode(md5_digest(&[b'a'; 56])),
        "3b0c8ac703f828b04c6c197006d17218"
    );
    assert_eq!(
        hex::encode(md5_digest(&[b'a'; 64])),
        "014842d480b571495a4a0363793f7367"
    );
}

#[test]
fn rsync_signature_matches_golden_and_is_parseable() {
    let blob = B64.encode(b"hello");
    let encoded_signature = sign_file_base64(&blob).unwrap();

    assert_eq!(encoded_signature, "cnMBNgAACAAAAAAIB/gCr4ZkN8t6eUvO");

    let bytes = B64.decode(encoded_signature).unwrap();
    let signature = Signature::deserialize(bytes.clone()).unwrap();
    assert_eq!(signature.serialized(), bytes);
}

#[test]
fn base64_helpers_accept_valid_and_empty_data_and_reject_invalid_data() {
    assert_eq!(base64_byte_len("aGVsbG8=").unwrap(), 5);
    assert_eq!(base64_byte_len("").unwrap(), 0);
    assert!(base64_byte_len("not base64").is_err());

    let (file_name, bytes) = decode_image_file("avatar.webp", "  aGVsbG8=\n").unwrap();
    assert_eq!(file_name, "avatar.webp");
    assert_eq!(bytes, b"hello");
    assert!(decode_image_file("avatar.png", "not base64").is_err());
    assert!(decode_image_file("avatar.png", "").is_err());
}

#[test]
fn write_image_file_adds_extension_and_preserves_content() {
    let dir = TestDir::new("write");
    let path = dir.path.join("nested").join("avatar");
    let bytes = b"image bytes";

    let written = write_image_file(path, "avatar.webp", bytes).unwrap();
    let written = PathBuf::from(written);

    assert_eq!(
        written.extension().and_then(|value| value.to_str()),
        Some("webp")
    );
    assert_eq!(std::fs::read(written).unwrap(), bytes);
}
