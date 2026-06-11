use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

static MEMBER_SEQUENCE: AtomicU64 = AtomicU64::new(0);

pub(crate) fn current_time_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_secs(0))
        .as_millis() as u64
}

pub(crate) fn window_start_ms(now_ms: u64, window_secs: u64) -> u64 {
    now_ms.saturating_sub(window_secs.saturating_mul(1_000))
}

pub(crate) fn entry_member(now_ms: u64) -> String {
    let sequence = MEMBER_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    format!("{}:{}:{}", now_ms, rand::random::<u64>(), sequence)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn window_start_uses_milliseconds() {
        assert_eq!(window_start_ms(10_000, 3), 7_000);
    }

    #[test]
    fn window_start_saturates() {
        assert_eq!(window_start_ms(500, 3), 0);
    }

    #[test]
    fn entry_members_are_unique_for_same_timestamp() {
        let now_ms = 42;

        let first = entry_member(now_ms);
        let second = entry_member(now_ms);

        assert_ne!(first, second);
        assert!(first.starts_with("42:"));
        assert!(second.starts_with("42:"));
    }
}
