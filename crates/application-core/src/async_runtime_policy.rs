#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct TokioThreadCounts {
    worker_threads: usize,
    max_blocking_threads: usize,
}

pub fn recommended_tokio_worker_threads_for(logical_cpus: usize) -> usize {
    recommended_tokio_thread_counts_for(logical_cpus).worker_threads
}

pub fn recommended_tokio_worker_threads() -> usize {
    recommended_tokio_worker_threads_for(available_logical_cpus())
}

pub fn recommended_tokio_max_blocking_threads_for(logical_cpus: usize) -> usize {
    recommended_tokio_thread_counts_for(logical_cpus).max_blocking_threads
}

pub fn recommended_tokio_max_blocking_threads() -> usize {
    recommended_tokio_max_blocking_threads_for(available_logical_cpus())
}

fn recommended_tokio_thread_counts_for(logical_cpus: usize) -> TokioThreadCounts {
    match logical_cpus {
        0..=2 => TokioThreadCounts {
            worker_threads: 1,
            max_blocking_threads: 4,
        },
        3..=4 => TokioThreadCounts {
            worker_threads: 2,
            max_blocking_threads: 8,
        },
        _ => TokioThreadCounts {
            worker_threads: 4,
            max_blocking_threads: 16,
        },
    }
}

fn available_logical_cpus() -> usize {
    std::thread::available_parallelism()
        .map(std::num::NonZeroUsize::get)
        .unwrap_or(1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn thread_counts_follow_logical_cpu_tiers() {
        let cases = [
            (
                0,
                TokioThreadCounts {
                    worker_threads: 1,
                    max_blocking_threads: 4,
                },
            ),
            (
                1,
                TokioThreadCounts {
                    worker_threads: 1,
                    max_blocking_threads: 4,
                },
            ),
            (
                2,
                TokioThreadCounts {
                    worker_threads: 1,
                    max_blocking_threads: 4,
                },
            ),
            (
                3,
                TokioThreadCounts {
                    worker_threads: 2,
                    max_blocking_threads: 8,
                },
            ),
            (
                4,
                TokioThreadCounts {
                    worker_threads: 2,
                    max_blocking_threads: 8,
                },
            ),
            (
                5,
                TokioThreadCounts {
                    worker_threads: 4,
                    max_blocking_threads: 16,
                },
            ),
            (
                8,
                TokioThreadCounts {
                    worker_threads: 4,
                    max_blocking_threads: 16,
                },
            ),
        ];

        for (logical_cpus, expected) in cases {
            assert_eq!(
                recommended_tokio_worker_threads_for(logical_cpus),
                expected.worker_threads
            );
            assert_eq!(
                recommended_tokio_max_blocking_threads_for(logical_cpus),
                expected.max_blocking_threads
            );
        }
    }
}
