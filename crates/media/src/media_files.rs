use std::io::Read;
use std::path::{Path, PathBuf};

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use fast_rsync::{Signature, SignatureOptions};
use sha2::{Digest, Sha256};

use crate::error::Error;
use crate::ugc_image_files;

const MAX_IMAGE_SAVE_BYTES: usize = 100 * 1024 * 1024;

pub fn decode_image_file(
    default_name: &str,
    base64_data: &str,
) -> Result<(String, Vec<u8>), Error> {
    let file_name = ugc_image_files::normalize_image_save_file_name(default_name)?;
    let bytes = B64
        .decode(base64_data.trim())
        .map_err(|e| Error::Custom(format!("image base64 decode: {e}")))?;

    if bytes.is_empty() {
        return Err(Error::Custom("image data is empty".into()));
    }

    if bytes.len() > MAX_IMAGE_SAVE_BYTES {
        return Err(Error::Custom("image data is too large".into()));
    }

    Ok((file_name, bytes))
}

pub fn write_image_file(mut path: PathBuf, file_name: &str, bytes: &[u8]) -> Result<String, Error> {
    if path.extension().is_none() {
        path.set_extension(ugc_image_files::default_image_extension(file_name));
    }

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    std::fs::write(&path, bytes)?;
    Ok(path.to_string_lossy().to_string())
}

pub fn decode_file_base64(blob: &str) -> Result<Vec<u8>, Error> {
    B64.decode(blob)
        .map_err(|e| Error::Custom(format!("base64 decode: {e}")))
}

pub fn sign_file(data: &[u8]) -> Vec<u8> {
    Signature::calculate(
        data,
        SignatureOptions {
            block_size: 2048,
            crypto_hash_size: 8,
        },
    )
    .into_serialized()
}

pub fn file_sha256_hex(path: &Path) -> Result<String, Error> {
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hex::encode(hasher.finalize()))
}

pub fn md5_base64(data: &[u8]) -> String {
    B64.encode(md5_digest(data))
}

fn md5_digest(input: &[u8]) -> [u8; 16] {
    const S: [u32; 64] = [
        7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5,
        9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10,
        15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
    ];
    const K: [u32; 64] = [
        0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613,
        0xfd469501, 0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193,
        0xa679438e, 0x49b40821, 0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d,
        0x02441453, 0xd8a1e681, 0xe7d3fbc8, 0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed,
        0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a, 0xfffa3942, 0x8771f681, 0x6d9d6122,
        0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70, 0x289b7ec6, 0xeaa127fa,
        0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665, 0xf4292244,
        0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
        0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb,
        0xeb86d391,
    ];

    let mut a0 = 0x67452301u32;
    let mut b0 = 0xefcdab89u32;
    let mut c0 = 0x98badcfeu32;
    let mut d0 = 0x10325476u32;

    {
        let mut process_chunk = |chunk: &[u8]| {
            let mut words = [0u32; 16];
            for (index, word) in words.iter_mut().enumerate() {
                let offset = index * 4;
                *word = u32::from_le_bytes([
                    chunk[offset],
                    chunk[offset + 1],
                    chunk[offset + 2],
                    chunk[offset + 3],
                ]);
            }

            let mut a = a0;
            let mut b = b0;
            let mut c = c0;
            let mut d = d0;

            for i in 0..64 {
                let (f, g) = if i < 16 {
                    ((b & c) | ((!b) & d), i)
                } else if i < 32 {
                    ((d & b) | ((!d) & c), (5 * i + 1) % 16)
                } else if i < 48 {
                    (b ^ c ^ d, (3 * i + 5) % 16)
                } else {
                    (c ^ (b | (!d)), (7 * i) % 16)
                };

                let next = a
                    .wrapping_add(f)
                    .wrapping_add(K[i])
                    .wrapping_add(words[g])
                    .rotate_left(S[i])
                    .wrapping_add(b);
                a = d;
                d = c;
                c = b;
                b = next;
            }

            a0 = a0.wrapping_add(a);
            b0 = b0.wrapping_add(b);
            c0 = c0.wrapping_add(c);
            d0 = d0.wrapping_add(d);
        };

        let complete_len = input.len() / 64 * 64;
        for chunk in input[..complete_len].as_chunks::<64>().0 {
            process_chunk(chunk);
        }

        let remaining = &input[complete_len..];
        let mut tail = [0u8; 128];
        tail[..remaining.len()].copy_from_slice(remaining);
        tail[remaining.len()] = 0x80;
        let length_offset = if remaining.len() < 56 { 56 } else { 120 };
        let bit_len = (input.len() as u64).wrapping_mul(8);
        tail[length_offset..length_offset + 8].copy_from_slice(&bit_len.to_le_bytes());
        for chunk in tail[..length_offset + 8].as_chunks::<64>().0 {
            process_chunk(chunk);
        }
    }

    let mut output = [0u8; 16];
    output[0..4].copy_from_slice(&a0.to_le_bytes());
    output[4..8].copy_from_slice(&b0.to_le_bytes());
    output[8..12].copy_from_slice(&c0.to_le_bytes());
    output[12..16].copy_from_slice(&d0.to_le_bytes());
    output
}

#[cfg(test)]
mod tests;
