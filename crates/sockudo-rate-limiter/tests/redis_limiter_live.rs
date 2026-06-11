#![cfg(feature = "redis")]

use redis::AsyncCommands;
use sockudo_rate_limiter::RateLimiter;
use sockudo_rate_limiter::redis_limiter::RedisRateLimiter;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

fn redis_url() -> String {
    std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379/".to_string())
}

fn unique_prefix(test_name: &str) -> String {
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_secs(0))
        .as_millis();

    format!("sockudo-rate-limiter-live:{test_name}:{now_ms}")
}

#[tokio::test]
#[ignore = "requires a live Redis-compatible server, such as Valkey, on REDIS_URL or localhost:6379"]
async fn redis_limiter_counts_each_request_in_same_second() {
    let client = redis::Client::open(redis_url()).expect("valid Redis URL");
    let prefix = unique_prefix("burst");
    let redis_key = format!("{prefix}:rl:ip-1");
    let limiter = RedisRateLimiter::new(client.clone(), prefix, 3, 60)
        .await
        .expect("Redis limiter should connect");

    let mut conn = client
        .get_multiplexed_async_connection()
        .await
        .expect("direct Redis connection should connect");
    let _: usize = conn.del(&redis_key).await.expect("test key cleanup");

    let first = limiter.increment("ip-1").await.expect("first increment");
    let second = limiter.increment("ip-1").await.expect("second increment");
    let third = limiter.increment("ip-1").await.expect("third increment");
    let fourth = limiter.increment("ip-1").await.expect("fourth increment");

    let count: usize = conn
        .zcard(&redis_key)
        .await
        .expect("read limiter zset size");
    let _: usize = conn.del(&redis_key).await.expect("test key cleanup");

    assert!(first.allowed);
    assert!(second.allowed);
    assert!(third.allowed);
    assert!(!fourth.allowed);
    assert_eq!(third.remaining, 0);
    assert_eq!(fourth.remaining, 0);
    assert_eq!(count, 3);
}

#[tokio::test]
#[ignore = "requires a live Redis-compatible server, such as Valkey, on REDIS_URL or localhost:6379"]
async fn redis_limiter_removes_expired_window_entries() {
    let client = redis::Client::open(redis_url()).expect("valid Redis URL");
    let prefix = unique_prefix("cleanup");
    let redis_key = format!("{prefix}:rl:ip-1");
    let limiter = RedisRateLimiter::new(client.clone(), prefix, 5, 1)
        .await
        .expect("Redis limiter should connect");

    let mut conn = client
        .get_multiplexed_async_connection()
        .await
        .expect("direct Redis connection should connect");
    let _: usize = conn.del(&redis_key).await.expect("test key cleanup");
    let _: usize = conn
        .zadd(&redis_key, "expired-member", 0_u64)
        .await
        .expect("insert expired limiter member");

    let before: usize = conn.zcard(&redis_key).await.expect("read seeded zset size");
    let result = limiter.check("ip-1").await.expect("check cleans window");
    let after: usize = conn
        .zcard(&redis_key)
        .await
        .expect("read cleaned zset size");
    let _: usize = conn.del(&redis_key).await.expect("test key cleanup");

    assert_eq!(before, 1);
    assert!(result.allowed);
    assert_eq!(result.remaining, 5);
    assert_eq!(after, 0);
}
