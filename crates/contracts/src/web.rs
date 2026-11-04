#[derive(Clone, Debug, Default)]
pub enum WebUploadMode {
    #[default]
    None,
    FilePut {
        file_data: Vec<u8>,
        file_mime: String,
        file_md5: Option<String>,
    },
    LegacyImage {
        image_data: String,
        post_data: Option<String>,
    },
    Image {
        image_data: String,
        post_data: Option<String>,
    },
    PrintImage {
        image_data: String,
        post_data: Option<String>,
    },
    Multipart {
        parts: Vec<WebMultipartPart>,
    },
}

#[derive(Clone, Debug)]
pub struct WebMultipartPart {
    pub name: String,
    pub file_name: Option<String>,
    pub mime: String,
    pub data: Vec<u8>,
}

#[derive(Clone, Debug)]
pub struct WebExecuteRequest {
    pub url: String,
    pub method: String,
    pub headers: Vec<(String, String)>,
    pub body: Option<String>,
    pub upload: WebUploadMode,
    pub response_body_limit: Option<usize>,
}

impl WebExecuteRequest {
    pub fn new(url: String, method: String) -> Self {
        Self {
            url,
            method,
            headers: Vec::new(),
            body: None,
            upload: WebUploadMode::None,
            response_body_limit: None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RealtimeConnectionOptions {
    pub origin: String,
    pub proxy_url: Option<String>,
}

#[derive(Clone, Debug)]
pub struct RealtimeAuthTokenFetch {
    pub response: crate::VrchatResponse,
    pub rejected_pooled_status: Option<i32>,
}
