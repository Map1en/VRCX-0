use std::collections::VecDeque;
use std::sync::Mutex;

pub struct BackendIngestQueue<T> {
    items: Mutex<VecDeque<T>>,
    limit: Option<usize>,
}

impl<T> BackendIngestQueue<T> {
    pub fn unbounded() -> Self {
        Self {
            items: Mutex::new(VecDeque::new()),
            limit: None,
        }
    }

    #[allow(dead_code)]
    pub fn bounded(limit: usize) -> Self {
        Self {
            items: Mutex::new(VecDeque::with_capacity(limit.min(1024))),
            limit: Some(limit),
        }
    }

    pub fn push_batch(&self, batch: impl IntoIterator<Item = T>) {
        let mut items = self.items.lock().unwrap();
        for item in batch {
            items.push_back(item);
            if let Some(limit) = self.limit {
                while items.len() > limit {
                    items.pop_front();
                }
            }
        }
    }

    pub fn flush(&self) -> Vec<T> {
        let mut items = self.items.lock().unwrap();
        items.drain(..).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::BackendIngestQueue;

    #[test]
    fn keeps_only_the_newest_items_when_bounded() {
        let queue = BackendIngestQueue::bounded(3);
        queue.push_batch([1, 2, 3, 4, 5]);
        assert_eq!(queue.flush(), vec![3, 4, 5]);
        assert!(queue.flush().is_empty());
    }

    #[test]
    fn unbounded_queue_keeps_catch_up_batches_intact() {
        let queue = BackendIngestQueue::unbounded();
        queue.push_batch(0..10);
        assert_eq!(queue.flush(), (0..10).collect::<Vec<_>>());
    }
}
