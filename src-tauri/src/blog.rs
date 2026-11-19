use dom_query::{Document, Selection};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::time::Duration;

const MAX_HTML_BYTES: usize = 2 * 1024 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(12);
const JS_MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;

fn normalized_text(selection: Selection<'_>) -> String {
    selection.text().split_whitespace().collect::<Vec<_>>().join(" ")
}

fn post_id_from_card(card: &Selection<'_>) -> Option<i64> {
    if let Some(raw) = card.attr("data-track-item-id") {
        if let Ok(id) = raw.trim().parse::<i64>() {
            if id > 0 && id <= JS_MAX_SAFE_INTEGER {
                return Some(id);
            }
        }
    }
    let href = card.attr("href")?;
    let trimmed = href.trim().trim_end_matches('/');
    let id_str = trimmed.rsplit('/').next()?;
    if !trimmed.contains("/archives/") || id_str.is_empty() || !id_str.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let id = id_str.parse::<i64>().ok()?;
    (id > 0 && id <= JS_MAX_SAFE_INTEGER).then_some(id)
}

fn parse_leading_number(text: &str) -> Option<u64> {
    let digits: String = text.chars().take_while(|c| c.is_ascii_digit()).collect();
    if digits.is_empty() {
        None
    } else {
        digits.parse::<u64>().ok()
    }
}

fn parse_page(html: &str, page: u32) -> Result<(Vec<Value>, u32), String> {
    let document = Document::from(html);
    let mut seen = HashSet::new();
    let mut items = Vec::new();

    for card_node in document.select("a.hg-cate-feed__card").iter() {
        let card = Selection::from(card_node);
        let Some(id) = post_id_from_card(&card) else {
            continue;
        };
        if !seen.insert(id) {
            continue;
        }

        let title = normalized_text(card.select(".hg-cate-feed__title"));
        if title.is_empty() {
            continue;
        }
        let desc = normalized_text(card.select(".hg-cate-feed__intro"));
        let author_name = normalized_text(card.select(".hg-cate-feed__author"));
        let date = normalized_text(card.select(".hg-cate-feed__date"));
        let category = normalized_text(card.select(".hg-cate-feed__category"));

        let img = card.select(".hg-cate-feed__cover img");
        let cover = img
            .attr("data-src")
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .or_else(|| {
                img.attr("src")
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty() && !s.contains("cover-placeholder"))
            })
            .unwrap_or_default();

        let mut hot: u64 = 0;
        for stat in card.select(".hg-cate-feed__stats span").iter() {
            let txt = normalized_text(Selection::from(stat));
            if txt.contains("阅读") {
                if let Some(n) = parse_leading_number(&txt) {
                    hot = n;
                }
            }
        }

        let tags: Vec<String> = if category.is_empty() {
            Vec::new()
        } else {
            vec![category]
        };

        items.push(json!({
            "id": id,
            "title": title,
            "desc": desc,
            "cover": cover,
            "tags": tags,
            "publish_time": date,
            "created_at": date,
            "hot": hot,
            "author": if author_name.is_empty() { Value::Null } else { json!({ "name": author_name }) },
        }));
    }

    let mut max_page = page.max(1);
    for pager in document.select(".hg-pager__page").iter() {
        let txt = normalized_text(Selection::from(pager));
        if let Ok(n) = txt.parse::<u32>() {
            if n > max_page {
                max_page = n;
            }
        }
    }

    if items.is_empty() && page <= 1 {
        return Err("官网博客页没有找到可用文章".into());
    }

    Ok((items, max_page))
}

fn blog_path(cate: &str, page: u32) -> Result<String, String> {
    let page = page.max(1);
    match cate.trim() {
        "" => Ok(if page <= 1 {
            "/blog/".to_string()
        } else {
            format!("/blog/page/{page}/")
        }),
        "gossip" => Ok(if page <= 1 {
            "/blog/gossip/".to_string()
        } else {
            format!("/blog/gossip/{page}/")
        }),
        "reviews" => Ok(if page <= 1 {
            "/blog/reviews/".to_string()
        } else {
            format!("/blog/reviews/{page}/")
        }),
        other => Err(format!("未知博客分类：{other}")),
    }
}

async fn fetch_html(path: &str) -> Result<String, String> {
    let base = crate::net::base();
    tokio::time::timeout(REQUEST_TIMEOUT, async {
        let referer = format!("{base}/blog/");
        let url = format!("{base}{path}");
        let mut response = crate::net::get(
            &url,
            REQUEST_TIMEOUT,
            Some("text/html,application/xhtml+xml"),
            Some(&referer),
        )
        .await?;

        if !response.status().is_success() {
            return Err(format!("官网博客页请求失败（HTTP {}）", response.status()));
        }
        if response
            .content_length()
            .is_some_and(|length| length > MAX_HTML_BYTES as u64)
        {
            return Err("官网博客页超过 2 MiB 限制".into());
        }

        let mut html = Vec::with_capacity(response.content_length().unwrap_or(0) as usize);
        while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
            if html.len().saturating_add(chunk.len()) > MAX_HTML_BYTES {
                return Err("官网博客页超过 2 MiB 限制".into());
            }
            html.extend_from_slice(&chunk);
        }
        String::from_utf8(html).map_err(|_| "官网博客页不是有效的 UTF-8 HTML".into())
    })
    .await
    .map_err(|_| "获取官网博客超时（12 秒）".to_string())?
}

pub async fn fetch(cate: Option<String>, page: u32) -> Result<Value, String> {
    let path = blog_path(cate.as_deref().unwrap_or(""), page)?;
    let html = fetch_html(&path).await?;
    let (items, pages) = parse_page(&html, page.max(1))?;
    let size = items.len();
    Ok(json!({
        "items": items,
        "pagination": {
            "page": page.max(1),
            "pages": pages,
            "size": size,
        }
    }))
}

#[cfg(test)]
mod tests {
    use super::{blog_path, parse_page};

    #[test]
    fn builds_expected_blog_paths() {
        assert_eq!(blog_path("", 1).unwrap(), "/blog/");
        assert_eq!(blog_path("", 2).unwrap(), "/blog/page/2/");
        assert_eq!(blog_path("gossip", 1).unwrap(), "/blog/gossip/");
        assert_eq!(blog_path("gossip", 3).unwrap(), "/blog/gossip/3/");
        assert_eq!(blog_path("reviews", 1).unwrap(), "/blog/reviews/");
        assert_eq!(blog_path("reviews", 4).unwrap(), "/blog/reviews/4/");
    }

    #[test]
    fn parses_blog_cards_and_pager() {
        let html = r#"
        <div class="hg-cate-feed">
          <a class="hg-cate-feed__card" href="/archives/1130/" data-track-item-id="1130">
            <div class="hg-cate-feed__cover">
              <img src="/static/web/images/cover-placeholder.png" data-src="https://img.example.com/1130.jpg">
            </div>
            <div class="hg-cate-feed__body">
              <p class="hg-cate-feed__meta">
                <span class="hg-cate-feed__author">黄果扫地僧</span>
                <span class="hg-cate-feed__date">2026-11-19</span>
                <span class="hg-cate-feed__category">短剧剧评</span>
              </p>
              <h3 class="hg-cate-feed__title">测试剧评标题</h3>
              <p class="hg-cate-feed__intro">测试简介</p>
              <p class="hg-cate-feed__stats"><span>273阅读</span><span>5评论</span></p>
            </div>
          </a>
        </div>
        <div class="hg-pager">
          <span class="hg-pager__page is-active">1</span>
          <a class="hg-pager__page" href="/blog/reviews/30/">30</a>
        </div>
        "#;

        let (items, pages) = parse_page(html, 1).unwrap();
        assert_eq!(pages, 30);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0]["id"], 1130);
        assert_eq!(items[0]["title"], "测试剧评标题");
        assert_eq!(items[0]["cover"], "https://img.example.com/1130.jpg");
        assert_eq!(items[0]["author"]["name"], "黄果扫地僧");
        assert_eq!(items[0]["tags"][0], "短剧剧评");
        assert_eq!(items[0]["hot"], 273);
    }
}
