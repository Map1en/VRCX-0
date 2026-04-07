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
#[allow(dead_code)]
#[allow(clippy::upper_case_acronyms)]
pub enum ChunkType {
    IHDR,
    SRGB,
    ITXT,
    IDAT,
    IEND,
    Unknown(String),
}

#[allow(dead_code)]
impl ChunkType {
    fn from_str(s: &str) -> Self {
        match s {
            "IHDR" => Self::IHDR,
            "sRGB" => Self::SRGB,
            "iTXt" => Self::ITXT,
            "IDAT" => Self::IDAT,
            "IEND" => Self::IEND,
            _ => Self::Unknown(s.to_string()),
        }
    }

    fn as_bytes(&self) -> &[u8] {
        match self {
            Self::IHDR => b"IHDR",
            Self::SRGB => b"sRGB",
            Self::ITXT => b"iTXt",
            Self::IDAT => b"IDAT",
            Self::IEND => b"IEND",
            Self::Unknown(s) => s.as_bytes(),
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
            if pos >= file_len {
                break;
            }
            self.file.seek(SeekFrom::Start(pos as u64)).ok();
            if self.file.read_exact(&mut buf4).is_err() {
                break;
            }
            let chunk_len = u32::from_be_bytes(buf4) as usize;
            if chunk_len > file_len - pos - CHUNK_NONDATA_SIZE {
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

    pub fn write_chunk(&mut self, chunk: &PngChunk) -> bool {
        self.ensure_cache();
        let last = match self.cache.last() {
            Some(c) => c,
            None => return false,
        };
        let insert_pos = last.index + CHUNK_NONDATA_SIZE + last.data.len();
        let file_len = self.file.seek(SeekFrom::End(0)).unwrap_or(0) as usize;

        self.file.seek(SeekFrom::Start(insert_pos as u64)).ok();
        let tail_len = file_len - insert_pos;
        let mut tail = vec![0u8; tail_len];
        if tail_len > 0 {
            let _ = self.file.read_exact(&mut tail);
        }

        let chunk_bytes = chunk.to_bytes();
        let new_len = file_len + chunk_bytes.len();
        self.file.set_len(new_len as u64).ok();
        self.file.seek(SeekFrom::Start(insert_pos as u64)).ok();
        let _ = self.file.write_all(&chunk_bytes);
        let _ = self.file.write_all(&tail);
        true
    }

    pub fn delete_chunk(&mut self, chunk: &PngChunk) -> bool {
        if !chunk.exists_in_file(&mut self.file) {
            return false;
        }
        let delete_start = chunk.index;
        let delete_len = chunk.data.len() + CHUNK_NONDATA_SIZE;
        let file_len = self.file.seek(SeekFrom::End(0)).unwrap_or(0) as usize;

        let src_pos = delete_start + delete_len;
        let buf_size = 128 * 1024;
        let mut buffer = vec![0u8; buf_size];
        let mut read_pos = src_pos;
        let mut write_pos = delete_start;

        while read_pos < file_len {
            self.file.seek(SeekFrom::Start(read_pos as u64)).ok();
            let to_read = buf_size.min(file_len - read_pos);
            let n = self.file.read(&mut buffer[..to_read]).unwrap_or(0);
            if n == 0 {
                break;
            }
            self.file.seek(SeekFrom::Start(write_pos as u64)).ok();
            let _ = self.file.write_all(&buffer[..n]);
            read_pos += n;
            write_pos += n;
        }
        self.file.set_len((file_len - delete_len) as u64).ok();

        self.cache.retain(|c| c.index != chunk.index);
        for c in &mut self.cache {
            if c.index > delete_start {
                c.index -= delete_len;
            }
        }
        true
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

pub fn delete_text_chunk(keyword: &str, png: &mut PngFile) -> bool {
    let chunks = png.get_chunks_of_type(&ChunkType::ITXT);
    for c in &chunks {
        if let Some((kw, _)) = c.read_itxt() {
            if kw == keyword {
                return png.delete_chunk(c);
            }
        }
    }
    false
}
