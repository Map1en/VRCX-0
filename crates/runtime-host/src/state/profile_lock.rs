use std::fs::{File, OpenOptions};
use std::io::Write as _;
use std::path::Path;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::Duration;

use super::{Result, PROFILE_LOCK_FILE};

pub(super) struct ProfileLock {
    inner: Mutex<Option<ProfileLockGuard>>,
}

pub(super) struct BackendStartGuard<'a> {
    flag: &'a AtomicBool,
}

impl<'a> BackendStartGuard<'a> {
    pub(super) fn try_acquire(flag: &'a AtomicBool) -> Option<Self> {
        flag.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .ok()
            .map(|_| Self { flag })
    }
}

impl Drop for BackendStartGuard<'_> {
    fn drop(&mut self) {
        self.flag.store(false, Ordering::Release);
    }
}

pub(super) struct AtomicFlagGuard {
    flag: Arc<AtomicBool>,
}

impl AtomicFlagGuard {
    pub(super) fn try_acquire(flag: &Arc<AtomicBool>) -> Option<Self> {
        flag.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .ok()
            .map(|_| Self {
                flag: Arc::clone(flag),
            })
    }
}

impl Drop for AtomicFlagGuard {
    fn drop(&mut self) {
        self.flag.store(false, Ordering::Release);
    }
}

struct ProfileLockGuard {
    _file: File,
}

impl ProfileLock {
    pub(super) fn acquire(app_data: &Path) -> Result<Self> {
        std::fs::create_dir_all(app_data)?;
        let path = app_data.join(PROFILE_LOCK_FILE);
        let mut file = open_profile_lock_file(&path)?;
        let _ = file.set_len(0);
        let _ = writeln!(file, "{}", std::process::id());
        Ok(Self {
            inner: Mutex::new(Some(ProfileLockGuard { _file: file })),
        })
    }

    pub(super) fn release(&self) {
        if let Ok(mut guard) = self.inner.lock() {
            guard.take();
        }
    }
}

fn open_profile_lock_file(path: &Path) -> Result<File> {
    open_profile_lock_file_with_retry(path, 15, Duration::from_millis(200))
}

fn open_profile_lock_file_with_retry(
    path: &Path,
    retry_count: usize,
    retry_delay: Duration,
) -> Result<File> {
    for attempt in 0..=retry_count {
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(path)
            .map_err(crate::Error::Io)?;

        match file.try_lock() {
            Ok(()) => return Ok(file),
            Err(std::fs::TryLockError::WouldBlock) if attempt < retry_count => {
                std::thread::sleep(retry_delay);
            }
            Err(std::fs::TryLockError::WouldBlock) => {
                return Err(crate::Error::Custom(format!(
                    "VRCX-0 profile is already in use: {}",
                    path.display()
                )));
            }
            Err(std::fs::TryLockError::Error(error)) => return Err(crate::Error::Io(error)),
        }
    }

    unreachable!()
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn new() -> Self {
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "vrcx-0-profile-lock-{}-{nonce}",
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
    fn waits_for_previous_process_lock_to_release() {
        let dir = TestDir::new();
        let path = dir.path.join(PROFILE_LOCK_FILE);
        let held = open_profile_lock_file_with_retry(&path, 0, Duration::ZERO).unwrap();
        let release = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(30));
            drop(held);
        });

        let acquired =
            open_profile_lock_file_with_retry(&path, 10, Duration::from_millis(10)).unwrap();

        drop(acquired);
        release.join().unwrap();
    }

    #[test]
    fn lock_file_is_a_persistent_sentinel_released_only_by_closing_the_descriptor() {
        let dir = TestDir::new();
        let path = dir.path.join(PROFILE_LOCK_FILE);
        let lock = ProfileLock::acquire(&dir.path).unwrap();
        assert!(path.exists());

        lock.release();
        assert!(path.exists());

        let reacquired = ProfileLock::acquire(&dir.path).unwrap();
        drop(reacquired);
        assert!(path.exists());
    }

    #[test]
    fn stops_waiting_after_retry_budget_is_exhausted() {
        let dir = TestDir::new();
        let path = dir.path.join(PROFILE_LOCK_FILE);
        let _held = open_profile_lock_file_with_retry(&path, 0, Duration::ZERO).unwrap();

        let error =
            open_profile_lock_file_with_retry(&path, 2, Duration::from_millis(1)).unwrap_err();

        assert!(error.to_string().contains("profile is already in use"));
    }
}
