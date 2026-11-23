use std::io::{Read, Seek, SeekFrom, Write};

const PNG_SIGNATURE: [u8; 8] = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
const MAX_CHUNKS_TO_READ: usize = 16;
const CHUNK_FIELD_SIZE: usize = 4;
const CHUNK_NONDATA_SIZE: usize = 12;

fn make_crc_table() -> [u32; 256] {
    let mut table = [0u32; 256];
    for n in 0..256u32 {
        let mut c = n;
        for _ in 0..8 {
            if c & 1 == 1 {
                c = 0xEDB8_8320 ^ ((c >> 1) & 0x7FFF_FFFF);
            } else {
                c = (c >> 1) & 0x7FFF_FFFF;
            }
        }
        table[n as usize] = c;
    }
    table
}

fn crc32(data: &[u8], init: u32) -> u32 {
    static CRC_TABLE: std::sync::OnceLock<[u32; 256]> = std::sync::OnceLock::new();
    let table = CRC_TABLE.get_or_init(make_crc_table);
    let mut c = init ^ 0xFFFF_FFFF;
    for &b in data {
        c = table[((c ^ b as u32) & 0xFF) as usize] ^ ((c >> 8) & 0x00FF_FFFF);
    }
    c ^ 0xFFFF_FFFF
}

#[derive(Clone, Debug)]
#[allow(clippy::upper_case_acronyms)]
pub enum ChunkType {
    IHDR,
    SRGB,
    ITXT,
    IDAT,
    IEND,
    Unknown,
}

impl ChunkType {
    fn from_str(s: &str) -> Self {
        match s {
            "IHDR" => Self::IHDR,
            "sRGB" => Self::SRGB,
            "iTXt" => Self::ITXT,
            "IDAT" => Self::IDAT,
            "IEND" => Self::IEND,
            _ => Self::Unknown,
        }
    }
}

#[derive(Clone, Debug)]
pub struct PngChunk {
    pub index: usize,
    pub chunk_type: ChunkType,
    pub chunk_type_str: String,
    pub data: Vec<u8>,
}

impl PngChunk {
    pub fn read_itxt(&self) -> Option<(String, String)> {
        if !matches!(self.chunk_type, ChunkType::ITXT) {
            return None;
        }
        let d = &self.data;
        let kw_end = d.iter().position(|&b| b == 0)?;
        if kw_end == 0 || kw_end > 79 {
            return None;
        }
        let keyword = String::from_utf8_lossy(&d[..kw_end]).into_owned();
        let text_offset = kw_end + 5;
        if text_offset > d.len() {
            return Some((keyword, String::new()));
        }
        let text = String::from_utf8_lossy(&d[text_offset..]).into_owned();
        Some((keyword, text))
    }

    pub fn read_ihdr_resolution(&self) -> Option<(u32, u32)> {
        if !matches!(self.chunk_type, ChunkType::IHDR) || self.data.len() < 8 {
            return None;
        }
        let w = u32::from_be_bytes([self.data[0], self.data[1], self.data[2], self.data[3]]);
        let h = u32::from_be_bytes([self.data[4], self.data[5], self.data[6], self.data[7]]);
        Some((w, h))
    }

    fn calculate_crc(&self) -> u32 {
        let type_bytes = self.chunk_type_str.as_bytes();
        crc32(&self.data, crc32(type_bytes, 0))
    }

    fn exists_in_file<F: Read + Seek>(&self, f: &mut F) -> bool {
        f.seek(SeekFrom::Start(self.index as u64)).ok();
        let mut buf = [0u8; 4];
        if f.read_exact(&mut buf).is_err() {
            return false;
        }
        let len = u32::from_be_bytes(buf) as usize;
        if len != self.data.len() {
            return false;
        }
        if f.seek(SeekFrom::Current((4 + len) as i64)).is_err() {
            return false;
        }
        if f.read_exact(&mut buf).is_err() {
            return false;
        }
        let file_crc = u32::from_be_bytes(buf);
        file_crc == self.calculate_crc()
    }

    pub fn to_bytes(&self) -> Vec<u8> {
        let type_bytes = self.chunk_type_str.as_bytes();
        let data_len = self.data.len() as u32;
        let crc = self.calculate_crc();
        let total = self.data.len() + CHUNK_NONDATA_SIZE;
        let mut out = Vec::with_capacity(total);
        out.extend_from_slice(&data_len.to_be_bytes());
        out.extend_from_slice(type_bytes);
        out.extend_from_slice(&self.data);
        out.extend_from_slice(&crc.to_be_bytes());
        out
    }
}

pub fn generate_text_chunk(keyword: &str, text: &str) -> PngChunk {
    let mut data = Vec::new();
    data.extend_from_slice(keyword.as_bytes());
    data.push(0);
    data.push(0);
    data.push(0);
    data.push(0);
    data.push(0);
    data.extend_from_slice(text.as_bytes());

    PngChunk {
        index: 0,
        chunk_type: ChunkType::ITXT,
        chunk_type_str: "iTXt".into(),
        data,
    }
}

pub struct PngFile {
    file: std::fs::File,
    cache: Vec<PngChunk>,
}

impl PngFile {
    pub fn open_read(path: &str) -> Result<Self, String> {
        let file = std::fs::OpenOptions::new()
            .read(true)
            .open(path)
            .map_err(|e| format!("open: {e}"))?;
        Ok(Self {
            file,
            cache: Vec::new(),
        })
    }

    pub fn open_rw(path: &str) -> Result<Self, String> {
        let file = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(path)
            .map_err(|e| format!("open rw: {e}"))?;
        Ok(Self {
            file,
            cache: Vec::new(),
        })
    }

    pub fn is_valid(&mut self) -> bool {
        let len = self.file.seek(SeekFrom::End(0)).unwrap_or(0);
        if len < 57 {
            return false;
        }
        self.file.seek(SeekFrom::Start(0)).ok();
        let mut sig = [0u8; 8];
        if self.file.read_exact(&mut sig).is_err() {
            return false;
        }
        sig == PNG_SIGNATURE
    }

    fn ensure_cache(&mut self) {
        if !self.cache.is_empty() {
            return;
        }
        if !self.is_valid() {
            return;
        }
        let mut pos = PNG_SIGNATURE.len();
        let mut buf4 = [0u8; 4];
        let file_len = self.file.seek(SeekFrom::End(0)).unwrap_or(0) as usize;

        for _ in 0..MAX_CHUNKS_TO_READ {
            let remaining = file_len.saturating_sub(pos);
            if remaining < CHUNK_NONDATA_SIZE {
                break;
            }
            self.file.seek(SeekFrom::Start(pos as u64)).ok();
            if self.file.read_exact(&mut buf4).is_err() {
                break;
            }
            let chunk_len = u32::from_be_bytes(buf4) as usize;
            if chunk_len > remaining - CHUNK_NONDATA_SIZE {
                break;
            }
            if self.file.read_exact(&mut buf4).is_err() {
                break;
            }
            let type_str = String::from_utf8_lossy(&buf4).into_owned();
            if type_str == "IDAT" || type_str == "IEND" {
                break;
            }
            let mut data = vec![0u8; chunk_len];
            if chunk_len > 0 && self.file.read_exact(&mut data).is_err() {
                break;
            }
            self.cache.push(PngChunk {
                index: pos,
                chunk_type: ChunkType::from_str(&type_str),
                chunk_type_str: type_str,
                data,
            });
            pos += CHUNK_NONDATA_SIZE + chunk_len;
        }
    }

    pub fn get_chunk(&mut self, ct: &ChunkType) -> Option<&PngChunk> {
        self.ensure_cache();
        self.cache
            .iter()
            .find(|c| std::mem::discriminant(&c.chunk_type) == std::mem::discriminant(ct))
    }

    pub fn get_chunks_of_type(&mut self, ct: &ChunkType) -> Vec<PngChunk> {
        self.ensure_cache();
        self.cache
            .iter()
            .filter(|c| std::mem::discriminant(&c.chunk_type) == std::mem::discriminant(ct))
            .cloned()
            .collect()
    }

    pub fn get_chunk_reverse(&mut self, ct: &ChunkType) -> Option<PngChunk> {
        let file_len = self.file.seek(SeekFrom::End(0)).unwrap_or(0);
        if file_len < 8300 {
            return None;
        }
        let search_bytes = match ct {
            ChunkType::ITXT => b"iTXt",
            ChunkType::IHDR => b"IHDR",
            ChunkType::SRGB => b"sRGB",
            _ => return None,
        };
        let start = file_len - 8192 - CHUNK_NONDATA_SIZE as u64;
        self.file.seek(SeekFrom::Start(start)).ok()?;
        let mut buf = vec![0u8; 8192];
        self.file.read_exact(&mut buf).ok()?;

        for i in 0..buf.len().saturating_sub(4) {
            if &buf[i..i + 4] == search_bytes {
                let chunk_start = start as i64 + i as i64 - CHUNK_FIELD_SIZE as i64;
                if chunk_start < 0 {
                    continue;
                }
                self.file.seek(SeekFrom::Start(chunk_start as u64)).ok()?;
                let mut len_buf = [0u8; 4];
                self.file.read_exact(&mut len_buf).ok()?;
                let chunk_len = u32::from_be_bytes(len_buf) as usize;
                if chunk_len > file_len as usize {
                    return None;
                }
                let mut type_buf = [0u8; 4];
                self.file.read_exact(&mut type_buf).ok()?;
                let type_str = String::from_utf8_lossy(&type_buf).into_owned();
                let mut data = vec![0u8; chunk_len];
                if chunk_len > 0 {
                    self.file.read_exact(&mut data).ok()?;
                }
                return Some(PngChunk {
                    index: chunk_start as usize,
                    chunk_type: ChunkType::from_str(&type_str),
                    chunk_type_str: type_str,
                    data,
                });
            }
        }
        None
    }

    pub fn write_chunk(&mut self, chunk: &PngChunk) -> std::io::Result<bool> {
        self.ensure_cache();
        let last = match self.cache.last() {
            Some(c) => c,
            None => return Ok(false),
        };
        let insert_pos = last.index + CHUNK_NONDATA_SIZE + last.data.len();
        let file_len = self.file.seek(SeekFrom::End(0))? as usize;

        self.file.seek(SeekFrom::Start(insert_pos as u64))?;
        let mut tail = vec![0u8; file_len - insert_pos];
        self.file.read_exact(&mut tail)?;

        self.file.seek(SeekFrom::Start(insert_pos as u64))?;
        self.file.write_all(&chunk.to_bytes())?;
        self.file.write_all(&tail)?;
        Ok(true)
    }

    pub fn delete_chunk(&mut self, chunk: &PngChunk) -> std::io::Result<bool> {
        if !chunk.exists_in_file(&mut self.file) {
            return Ok(false);
        }
        let delete_start = chunk.index;
        let delete_len = chunk.data.len() + CHUNK_NONDATA_SIZE;
        let file_len = self.file.seek(SeekFrom::End(0))? as usize;

        let src_pos = delete_start + delete_len;
        let buf_size = 128 * 1024;
        let mut buffer = vec![0u8; buf_size];
        let mut read_pos = src_pos;
        let mut write_pos = delete_start;

        while read_pos < file_len {
            self.file.seek(SeekFrom::Start(read_pos as u64))?;
            let to_read = buf_size.min(file_len - read_pos);
            let n = self.file.read(&mut buffer[..to_read])?;
            if n == 0 {
                break;
            }
            self.file.seek(SeekFrom::Start(write_pos as u64))?;
            self.file.write_all(&buffer[..n])?;
            read_pos += n;
            write_pos += n;
        }
        self.file.set_len((file_len - delete_len) as u64)?;

        self.cache.retain(|c| c.index != chunk.index);
        for c in &mut self.cache {
            if c.index > delete_start {
                c.index -= delete_len;
            }
        }
        Ok(true)
    }

    pub fn restore(&mut self, original: &[u8]) -> std::io::Result<()> {
        self.cache.clear();
        self.file.seek(SeekFrom::Start(0))?;
        self.file.write_all(original)?;
        self.file.set_len(original.len() as u64)
    }
}

pub fn read_resolution(png: &mut PngFile) -> String {
    if let Some(ihdr) = png.get_chunk(&ChunkType::IHDR) {
        if let Some((w, h)) = ihdr.read_ihdr_resolution() {
            return format!("{w}x{h}");
        }
    }
    "0x0".into()
}

pub fn read_text_chunk(keyword: &str, png: &mut PngFile, legacy_search: bool) -> Option<String> {
    if legacy_search {
        let chunk = png.get_chunk_reverse(&ChunkType::ITXT)?;
        let (kw, text) = chunk.read_itxt()?;
        if kw == keyword {
            return Some(text);
        }
        return None;
    }
    let chunks = png.get_chunks_of_type(&ChunkType::ITXT);
    for c in &chunks {
        if let Some((kw, text)) = c.read_itxt() {
            if kw == keyword {
                return Some(text);
            }
        }
    }
    None
}

pub fn delete_text_chunk(keyword: &str, png: &mut PngFile) -> std::io::Result<bool> {
    let chunks = png.get_chunks_of_type(&ChunkType::ITXT);
    for c in &chunks {
        if let Some((kw, _)) = c.read_itxt() {
            if kw == keyword {
                return png.delete_chunk(c);
            }
        }
    }
    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestFile {
        path: std::path::PathBuf,
    }

    impl TestFile {
        fn write(name: &str, bytes: &[u8]) -> Self {
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "vrcx-0-png-{name}-{}-{nonce}.png",
                std::process::id()
            ));
            std::fs::write(&path, bytes).unwrap();
            Self { path }
        }
    }

    impl Drop for TestFile {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.path);
        }
    }

    #[test]
    fn crc32_matches_standard_vector_and_chained_png_chunk_crc() {
        assert_eq!(crc32(b"123456789", 0), 0xCBF4_3926);

        let chunk = generate_text_chunk("Description", "hello");
        let expected = crc32(&chunk.data, crc32(b"iTXt", 0));
        let bytes = chunk.to_bytes();
        let crc_bytes = &bytes[bytes.len() - 4..];
        assert_eq!(u32::from_be_bytes(crc_bytes.try_into().unwrap()), expected);
    }

    #[test]
    fn generated_itxt_chunk_round_trips_keyword_and_text() {
        let chunk = generate_text_chunk("Description", "VRChat metadata");

        assert_eq!(
            chunk.read_itxt(),
            Some(("Description".into(), "VRChat metadata".into()))
        );
        assert_eq!(&chunk.data[..12], b"Description\0");
        assert_eq!(&chunk.data[12..16], &[0, 0, 0, 0]);
    }

    #[test]
    fn read_itxt_rejects_non_itxt_and_empty_or_oversized_keywords() {
        let non_text = PngChunk {
            index: 0,
            chunk_type: ChunkType::IHDR,
            chunk_type_str: "IHDR".into(),
            data: vec![0; 13],
        };
        assert_eq!(non_text.read_itxt(), None);

        let empty_keyword = PngChunk {
            index: 0,
            chunk_type: ChunkType::ITXT,
            chunk_type_str: "iTXt".into(),
            data: vec![0, 0, 0, 0, 0],
        };
        assert_eq!(empty_keyword.read_itxt(), None);

        let mut oversized_keyword = vec![b'a'; 80];
        oversized_keyword.push(0);
        oversized_keyword.extend_from_slice(&[0, 0, 0, 0]);
        oversized_keyword.extend_from_slice(b"text");
        let oversized = PngChunk {
            index: 0,
            chunk_type: ChunkType::ITXT,
            chunk_type_str: "iTXt".into(),
            data: oversized_keyword,
        };
        assert_eq!(oversized.read_itxt(), None);
    }

    #[test]
    fn truncated_chunk_tail_does_not_underflow_or_panic() {
        let chunk = PngChunk {
            index: 0,
            chunk_type: ChunkType::Unknown,
            chunk_type_str: "tEXt".into(),
            data: vec![0; 8],
        };
        let mut bytes = PNG_SIGNATURE.to_vec();
        bytes.extend_from_slice(&chunk.to_bytes());
        bytes.extend_from_slice(&chunk.to_bytes());
        bytes.extend_from_slice(&[0; 9]);
        assert_eq!(bytes.len(), 57);
        let file = TestFile::write("truncated-tail", &bytes);
        let mut png = PngFile::open_read(file.path.to_str().unwrap()).unwrap();

        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            png.get_chunks_of_type(&ChunkType::ITXT)
        }));

        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
    }
}
