use futures_util::future::BoxFuture;

use std::sync::Arc;

use vrcx_0_application_core::Result;
use vrcx_0_contracts::vrchat_api::VrchatResponse;

pub type VrchatConfigFuture<'a> = BoxFuture<'a, Result<VrchatResponse>>;

pub trait VrchatConfigPort: Send + Sync {
    fn cached(&self, endpoint: &str) -> Option<VrchatResponse>;
    fn clear(&self);
    fn fetch(&self, endpoint: String) -> VrchatConfigFuture<'_>;
}

#[derive(Clone)]
pub struct VrchatConfigRuntime {
    endpoint: String,
    port: Arc<dyn VrchatConfigPort>,
}

impl VrchatConfigRuntime {
    pub fn new(endpoint: String, port: Arc<dyn VrchatConfigPort>) -> Self {
        Self { endpoint, port }
    }

    pub async fn get(&self) -> Result<VrchatResponse> {
        if let Some(response) = self.port.cached(&self.endpoint) {
            return Ok(response);
        }
        self.refresh().await
    }

    pub async fn refresh(&self) -> Result<VrchatResponse> {
        self.port.clear();
        self.port.fetch(self.endpoint.clone()).await
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use vrcx_0_contracts::vrchat_api::VrchatResponse;

    use super::{VrchatConfigFuture, VrchatConfigPort, VrchatConfigRuntime};

    struct RecordingPort {
        cached: Option<VrchatResponse>,
        events: Mutex<Vec<String>>,
    }

    impl RecordingPort {
        fn new(cached: Option<VrchatResponse>) -> Self {
            Self {
                cached,
                events: Mutex::new(Vec::new()),
            }
        }
    }

    impl VrchatConfigPort for RecordingPort {
        fn cached(&self, endpoint: &str) -> Option<VrchatResponse> {
            self.events
                .lock()
                .unwrap()
                .push(format!("cached:{endpoint}"));
            self.cached.clone()
        }

        fn clear(&self) {
            self.events.lock().unwrap().push("clear".into());
        }

        fn fetch(&self, endpoint: String) -> VrchatConfigFuture<'_> {
            self.events
                .lock()
                .unwrap()
                .push(format!("fetch:{endpoint}"));
            Box::pin(async {
                Ok(VrchatResponse {
                    status: 200,
                    data: "fresh".into(),
                })
            })
        }
    }

    #[tokio::test]
    async fn get_returns_the_cached_response_without_clearing_or_fetching() {
        let port = Arc::new(RecordingPort::new(Some(VrchatResponse {
            status: 200,
            data: "cached".into(),
        })));
        let runtime = VrchatConfigRuntime::new("https://api.example/api/1".into(), port.clone());

        let response = runtime.get().await.unwrap();

        assert_eq!(response.data, "cached");
        assert_eq!(
            *port.events.lock().unwrap(),
            ["cached:https://api.example/api/1"]
        );
    }

    #[tokio::test]
    async fn a_cache_miss_uses_the_same_clear_then_fetch_path_as_refresh() {
        for refresh in [false, true] {
            let port = Arc::new(RecordingPort::new(None));
            let runtime =
                VrchatConfigRuntime::new("https://api.example/api/1".into(), port.clone());

            let response = if refresh {
                runtime.refresh().await.unwrap()
            } else {
                runtime.get().await.unwrap()
            };

            assert_eq!(response.data, "fresh");
            let expected = if refresh {
                vec!["clear", "fetch:https://api.example/api/1"]
            } else {
                vec![
                    "cached:https://api.example/api/1",
                    "clear",
                    "fetch:https://api.example/api/1",
                ]
            };
            assert_eq!(*port.events.lock().unwrap(), expected);
        }
    }
}
