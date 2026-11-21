//! 会话持久化：token + 用户资料存到应用数据目录。

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
pub struct Session {
    // 旧版本没有 origin：不能推断其 token 属于哪个镜像，升级后必须重新登录。
    #[serde(default)]
    pub origin: String,
    #[serde(default)]
    pub token: String,
    #[serde(default)]
    pub user: serde_json::Value,
    /// Process-local identity epoch, so even logout/login with a reused token invalidates old work.
    #[serde(skip)]
    pub revision: u64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn credentials_are_bound_to_origin() {
        let store = SessionStore::new();
        store.set(
            "https://huangguoai.com",
            "secret-token".into(),
            json!({"id": 1}),
        );
        assert_eq!(
            store.token("https://huangguoai.com").as_deref(),
            Some("secret-token")
        );
        assert_eq!(store.token("https://huangguoai.ai"), None);
        assert_eq!(store.token("https://evil.example"), None);
        assert!(store.user("https://evil.example").is_null());
        store.clear();
        assert_eq!(store.token("https://huangguoai.com"), None);
    }

    #[test]
    fn legacy_sessions_are_not_assigned_to_current_line() {
        let store = SessionStore::new();
        *store.current.lock().unwrap() =
            serde_json::from_str(r#"{"token":"legacy","user":{"id":1}}"#).unwrap();
        assert_eq!(store.token("https://huangguoai.com"), None);
        assert!(store.user("https://huangguoai.com").is_null());
    }

    #[test]
    fn late_profile_and_logout_cannot_replace_a_new_session() {
        let store = SessionStore::new();
        let origin = "https://example.com";
        store.set(origin, "first".into(), json!({"id": 1}));
        let first = store.snapshot(origin).unwrap();
        store.set(origin, "second".into(), json!({"id": 2}));
        assert!(!store.update_user_if_current(&first, json!({"id": 1, "nickname": "late"})));
        assert!(!store.clear_if_current(&first));
        assert_eq!(store.user(origin)["id"], 2);
        let second = store.snapshot(origin).unwrap();
        assert!(!store.update_user_if_current(&second, json!({"id": 1})));
        assert!(store.update_user_if_current(&second, json!({"id": 2, "nickname": "fresh"})));
    }

    #[test]
    fn relogin_with_same_token_still_invalidates_old_requests() {
        let store = SessionStore::new();
        let origin = "https://example.com";
        store.set(origin, "same".into(), json!({"id": 1}));
        let old = store.snapshot(origin).unwrap();
        store.clear();
        store.set(origin, "same".into(), json!({"id": 1}));
        assert!(!store.is_current(&old));
        assert!(!store.clear_if_current(&old));
        assert!(serde_json::to_value(store.snapshot(origin).unwrap()).unwrap().get("revision").is_none());
    }

    #[test]
    fn late_login_cannot_replace_a_newer_account() {
        let store = SessionStore::new();
        let origin = "https://example.com";
        let revision = store.revision();
        assert!(store.set_if_revision(revision, origin, "new".into(), json!({"id": 2})));
        assert!(!store.set_if_revision(revision, origin, "late".into(), json!({"id": 1})));
        assert_eq!(store.user(origin)["id"], 2);
    }

    // 上游把可信判定注入进来（真实调用方传 `is_fixed || is_trusted_mirror`），
    // 测试用固定的一组 origin，不依赖进程全局的镜像集合。
    fn trusted_pair(origin: &str) -> bool {
        matches!(origin, "https://huangguoai.com" | "https://mirror-a.example")
    }

    #[test]
    fn trusted_rebase_moves_session_and_bumps_revision() {
        let store = SessionStore::new();
        let old_origin = "https://huangguoai.com";
        let new_origin = "https://mirror-a.example";
        store.set(old_origin, "secret-token".into(), json!({"id": 1}));
        let before = store.snapshot(old_origin).unwrap();
        assert!(store.rebase_if_trusted(new_origin, trusted_pair));
        assert_eq!(store.token(new_origin).as_deref(), Some("secret-token"));
        assert_eq!(store.user(new_origin)["id"], 1);
        // 旧 origin 不再解析出凭据。
        assert_eq!(store.token(old_origin), None);
        assert!(store.user(old_origin).is_null());
        // 与 set_if_revision 同样的语义：切换前的快照全部作废。
        assert_eq!(store.revision(), before.revision.wrapping_add(1));
        assert!(!store.is_current(&before));
        assert!(!store.update_user_if_current(&before, json!({"id": 1, "nickname": "late"})));
        assert!(!store.clear_if_current(&before));
        assert_eq!(store.stored_origin().as_deref(), Some(new_origin));
    }

    #[test]
    fn trusted_rebase_persists_the_new_origin() {
        let dir = std::env::temp_dir().join(format!(
            "hguox-session-rebase-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let store = SessionStore::new();
        store.bind(dir.clone());
        store.set("https://huangguoai.com", "secret-token".into(), json!({"id": 1}));
        assert!(store.rebase_if_trusted("https://mirror-a.example", trusted_pair));
        let on_disk: Session =
            serde_json::from_str(&std::fs::read_to_string(dir.join("session.json")).unwrap())
                .unwrap();
        assert_eq!(on_disk.origin, "https://mirror-a.example");
        assert_eq!(on_disk.token, "secret-token");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn rebase_refuses_untrusted_endpoints_in_both_directions() {
        for (old_origin, new_origin) in [
            // 可信 -> 自定义：不能把 token 交出去。
            ("https://huangguoai.com", "https://custom.example"),
            // 自定义 -> 可信：也不能把自己的登录塞进来。
            ("https://custom.example", "https://huangguoai.com"),
            // 未确认的镜像 -> 可信镜像。
            ("https://unpublished.example", "https://mirror-a.example"),
        ] {
            let store = SessionStore::new();
            store.set(old_origin, "secret-token".into(), json!({"id": 1}));
            let before = store.snapshot(old_origin).unwrap();
            assert!(
                !store.rebase_if_trusted(new_origin, trusted_pair),
                "{old_origin} -> {new_origin}"
            );
            // 会话原封不动：origin、token、revision 都不变。
            assert_eq!(store.token(old_origin).as_deref(), Some("secret-token"));
            assert_eq!(store.token(new_origin), None);
            assert!(store.is_current(&before));
            assert_eq!(store.revision(), before.revision);
        }
    }

    #[test]
    fn rebase_on_empty_session_is_a_noop() {
        let store = SessionStore::new();
        assert_eq!(store.stored_origin(), None);
        let revision = store.revision();
        assert!(!store.rebase_if_trusted("https://mirror-a.example", trusted_pair));
        assert_eq!(store.revision(), revision);
        // 旧版本会话没有 origin：保持「未归属」，不允许被搬家。
        *store.current.lock().unwrap() =
            serde_json::from_str(r#"{"token":"legacy","user":{"id":1}}"#).unwrap();
        assert_eq!(store.stored_origin(), None);
        assert!(!store.rebase_if_trusted("https://huangguoai.com", trusted_pair));
        assert_eq!(store.token("https://huangguoai.com"), None);
    }

    #[tokio::test]
    async fn boot_reconcile_verifies_stored_mirror_even_when_current_line_is_fixed() {
        let store = SessionStore::new();
        store.set("https://mirror-a.example", "secret-token".into(), json!({"id": 1}));
        let verified = std::sync::Mutex::new(Vec::<String>::new());
        store
            .reconcile_with(
                "https://huangguoai.com",
                || "https://huangguoai.com".to_string(),
                |origin| {
                    origin == "https://huangguoai.com"
                        || verified.lock().unwrap().iter().any(|item| item == origin)
                },
                |origin| {
                    if origin != "https://huangguoai.com" {
                        verified.lock().unwrap().push(origin);
                    }
                    std::future::ready(())
                },
            )
            .await;
        assert_eq!(
            store.token("https://huangguoai.com").as_deref(),
            Some("secret-token")
        );
        assert_eq!(store.token("https://mirror-a.example"), None);
    }

    #[tokio::test]
    async fn boot_reconcile_keeps_the_session_when_the_line_moved_mid_refresh() {
        let store = SessionStore::new();
        store.set("https://mirror-a.example", "secret-token".into(), json!({"id": 1}));
        store
            .reconcile_with(
                "https://huangguoai.com",
                || "https://other.example".to_string(),
                |_| true,
                |_| std::future::ready(()),
            )
            .await;
        // 线路在验发布页期间被改走：不动会话，等下一次 boot 再对账。
        assert_eq!(store.token("https://mirror-a.example").as_deref(), Some("secret-token"));
        assert_eq!(store.token("https://huangguoai.com"), None);
    }

    #[test]
    fn same_origin_untrusted_is_not_reported_as_usable() {
        let store = SessionStore::new();
        let origin = "https://custom.example";
        store.set(origin, "secret-token".into(), json!({"id": 1}));
        assert!(!store.rebase_if_trusted(origin, trusted_pair));
        assert_eq!(store.token(origin).as_deref(), Some("secret-token"));
    }

    #[test]
    fn rebase_to_the_same_origin_keeps_the_revision() {
        let store = SessionStore::new();
        let origin = "https://huangguoai.com";
        store.set(origin, "secret-token".into(), json!({"id": 1}));
        let before = store.snapshot(origin).unwrap();
        assert!(store.rebase_if_trusted(origin, trusted_pair));
        assert!(store.is_current(&before));
        assert_eq!(store.revision(), before.revision);
    }
}

/// 参与会话搬家的「可信线路」：固定入口，或本进程内被发布页确认过的镜像。
/// 自定义线路刻意不算——用户自己填的站点可能有自己的登录，token 绝不跟着走。
pub fn rebase_trust(origin: &str) -> bool {
    crate::lines::is_fixed(origin) || crate::lines::is_trusted_mirror(origin)
}

pub struct SessionStore {
    pub file: Mutex<Option<PathBuf>>,
    pub current: Mutex<Session>,
}

impl SessionStore {
    pub fn new() -> Self {
        Self {
            file: Mutex::new(None),
            current: Mutex::new(Session::default()),
        }
    }

    pub fn bind(&self, dir: PathBuf) {
        let mut path = dir;
        path.push("session.json");
        if let Ok(text) = std::fs::read_to_string(&path) {
            if let Ok(sess) = serde_json::from_str::<Session>(&text) {
                *self.current.lock().unwrap() = sess;
            }
        }
        *self.file.lock().unwrap() = Some(path);
    }

    pub fn token(&self, origin: &str) -> Option<String> {
        let cur = self.current.lock().unwrap();
        (cur.origin == origin && !cur.token.is_empty()).then(|| cur.token.clone())
    }

    pub fn user(&self, origin: &str) -> serde_json::Value {
        let cur = self.current.lock().unwrap();
        if cur.origin == origin && !cur.token.is_empty() {
            cur.user.clone()
        } else {
            serde_json::Value::Null
        }
    }

    pub fn snapshot(&self, origin: &str) -> Option<Session> {
        let cur = self.current.lock().unwrap();
        (cur.origin == origin && !cur.token.is_empty()).then(|| cur.clone())
    }

    /// 已存会话属于哪个 origin（不看当前线路），没有就 None。
    ///
    /// 冷启动用它判断「要不要尝试把登录态搬到当前线路」；它永远不暴露 token 本身。
    pub fn stored_origin(&self) -> Option<String> {
        let cur = self.current.lock().unwrap();
        (!cur.token.is_empty() && !cur.origin.is_empty()).then(|| cur.origin.clone())
    }

    /// 可信线路之间切换：上游各线路共用一套账号体系，所以当**新旧两端都可信**
    /// （固定主站，或本进程内被发布页确认过的镜像）时，会话跟着 origin 搬家，
    /// 用户不用重新登录。判定函数由调用方注入，本模块不依赖 `crate::lines`。
    ///
    /// 返回 true 表示 `new_origin` 上已有可用会话（搬家成功或本来就绑在那里）；
    /// 返回 false 表示没搬——手动切换的调用方要退回 `clear()`，绝不把 token 带给
    /// 一个不可信的站点。搬家会像 `set_if_revision` 一样推进 revision，旧的在途
    /// 请求因此无法回写，同时把新 origin 落盘。
    pub fn rebase_if_trusted(&self, new_origin: &str, trusted: impl Fn(&str) -> bool) -> bool {
        {
            let mut cur = self.current.lock().unwrap();
            if cur.token.is_empty() || cur.origin.is_empty() {
                return false;
            }
            /* 上游 5ecfaee：可信判定要放在「同一个 origin」之前。否则一个停在不可信
               自定义线路上的会话会被报成"可用"，调用方就不会 clear，token 继续挂在那个站点上。 */
            if !trusted(&cur.origin) || !trusted(new_origin) {
                return false;
            }
            if cur.origin == new_origin {
                return true;
            }
            cur.origin = new_origin.to_string();
            cur.revision = cur.revision.wrapping_add(1);
        }
        self.persist();
        true
    }

    /// 冷启动对账：会话可能还停在上一轮的线路（例如 App 没开时自动选线换了地址）。
    ///
    /// 上游 5ecfaee 修的就是这里：以前只在「已存 origin 不是可信镜像」时验一次发布页，
    /// 于是「当前是固定主站、已存的是上一轮的镜像」这种最常见的组合只验了一半，
    /// rebase 直接失败 → 老登录态被丢掉。现在两端都验，并且在验的过程中线路/会话变了就不动手。
    pub async fn reconcile_on_boot(&self, origin: &str) {
        self.reconcile_with(
            origin,
            crate::net::base,
            rebase_trust,
            |target| async move {
                let _ = crate::lines::verify_published_origin(&target).await;
            },
        )
        .await;
    }

    async fn reconcile_with<Cur, Trust, Verify, Fut>(
        &self,
        origin: &str,
        current_base: Cur,
        trusted: Trust,
        mut verify: Verify,
    ) where
        Cur: Fn() -> String,
        Trust: Fn(&str) -> bool,
        Verify: FnMut(String) -> Fut,
        Fut: std::future::Future<Output = ()>,
    {
        let rev = self.revision();
        let stored = self.stored_origin();
        if self.token(origin).is_none() {
            if let Some(old) = stored.as_deref().filter(|old| *old != origin) {
                verify(old.to_owned()).await;
                verify(origin.to_owned()).await;
                // 验发布页要花几百毫秒：期间线路被别人改掉、或会话已经换了身份，就别再搬。
                if current_base() == origin && self.revision() == rev {
                    let _ = self.rebase_if_trusted(origin, trusted);
                }
            }
        } else if !crate::net::trusted_auth_origin(origin) {
            // 会话已经落在当前 origin 上，但这个 origin 还没有信任记录（自定义/新镜像）：
            // 补一次发布页确认，让它有机会升级成可信，而不是直接把人踢下线。
            verify(origin.to_owned()).await;
        }
    }

    pub fn revision(&self) -> u64 {
        self.current.lock().unwrap().revision
    }

    pub fn set_if_revision(&self, expected_revision: u64, origin: &str, token: String, user: serde_json::Value) -> bool {
        {
            let mut cur = self.current.lock().unwrap();
            if cur.revision != expected_revision { return false; }
            cur.origin = origin.to_string();
            cur.token = token;
            cur.user = user;
            cur.revision = cur.revision.wrapping_add(1);
        }
        self.persist();
        true
    }

    fn same_identity(current: &Session, expected: &Session) -> bool {
        current.revision == expected.revision
            && current.origin == expected.origin
            && current.token == expected.token
            && current.user.get("id") == expected.user.get("id")
    }

    pub fn is_current(&self, expected: &Session) -> bool {
        Self::same_identity(&self.current.lock().unwrap(), expected)
    }

    pub fn update_user_if_current(&self, expected: &Session, user: serde_json::Value) -> bool {
        {
            let mut cur = self.current.lock().unwrap();
            if !Self::same_identity(&cur, expected) || user.get("id") != expected.user.get("id") {
                return false;
            }
            cur.user = user;
        }
        self.persist();
        true
    }

    pub fn clear_if_current(&self, expected: &Session) -> bool {
        {
            let mut cur = self.current.lock().unwrap();
            if !Self::same_identity(&cur, expected) { return false; }
            cur.token.clear();
            cur.origin.clear();
            cur.user = serde_json::Value::Null;
            cur.revision = cur.revision.wrapping_add(1);
        }
        self.persist();
        true
    }

    pub fn set(&self, origin: &str, token: String, user: serde_json::Value) {
        {
            let mut cur = self.current.lock().unwrap();
            cur.origin = origin.to_string();
            cur.token = token;
            cur.user = user;
            cur.revision = cur.revision.wrapping_add(1);
        }
        self.persist();
    }

    pub fn clear(&self) {
        {
            let mut cur = self.current.lock().unwrap();
            cur.token.clear();
            cur.origin.clear();
            cur.user = serde_json::Value::Null;
            cur.revision = cur.revision.wrapping_add(1);
        }
        self.persist();
    }

    fn persist(&self) {
        // Keep state locked through the write so a slower earlier writer cannot persist over a new login.
        let snapshot = self.current.lock().unwrap();
        if let Some(path) = self.file.lock().unwrap().as_ref() {
            if let Ok(text) = serde_json::to_string_pretty(&*snapshot) {
                /* 上游 5ecfaee：先写临时文件再 rename，避免写到一半被杀进程留下半个 JSON
                   （下次 bind() 反序列化失败 = 静默登出）。unix 上顺便把权限钉成 0600：
                   这个文件里是 token。Windows 的 rename 带 MOVEFILE_REPLACE_EXISTING，
                   失败时退回直接写，绝不让"原子"变成"丢登录态"。 */
                let temp = path.with_extension("json.tmp");
                let mut options = std::fs::OpenOptions::new();
                options.write(true).create(true).truncate(true);
                #[cfg(unix)]
                {
                    use std::os::unix::fs::OpenOptionsExt;
                    options.mode(0o600);
                }
                let written = options.open(&temp).ok().is_some_and(|mut file| {
                    use std::io::Write;
                    file.write_all(text.as_bytes()).is_ok() && file.sync_all().is_ok()
                });
                if !written || std::fs::rename(&temp, path).is_err() {
                    let _ = std::fs::remove_file(&temp);
                    let _ = std::fs::write(path, text);
                }
            }
        }
    }
}
