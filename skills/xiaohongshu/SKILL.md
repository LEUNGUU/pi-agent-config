---
name: xiaohongshu
description: Search and browse Xiaohongshu (小红书/Little Red Book) - Chinese social media platform. Use for searching posts, getting post details with comments, user profiles, publishing content. Requires xiaohongshu-mcp server running on port 18060.
---

# Xiaohongshu

Search and browse Xiaohongshu (小红书) posts via MCP server.

## Prerequisites

The xiaohongshu-mcp server must be running:
```bash
systemctl status xiaohongshu-mcp
```

## Search Posts

```bash
{baseDir}/search.sh "keyword"
```

Returns feeds with `id`, `xsecToken`, title, user info, interaction stats.

## Get Post Details

```bash
{baseDir}/detail.sh <feed_id> <xsec_token>
```

Returns post content, images, comments. Both params from search results.

## Get User Profile

```bash
{baseDir}/profile.sh <user_id> <xsec_token>
```

## Generic Tool Call

```bash
{baseDir}/call-tool.sh <tool_name> '<json_args>'
```

## Available Tools

| Tool | Description | Required Params |
|------|-------------|-----------------|
| `search_feeds` | Search posts | `keyword` |
| `get_feed_detail` | Post + comments | `feed_id`, `xsec_token` |
| `user_profile` | User info | `user_id`, `xsec_token` |
| `list_feeds` | Homepage feeds | none |
| `like_feed` | Like post | `feed_id`, `xsec_token` |
| `favorite_feed` | Favorite post | `feed_id`, `xsec_token` |
| `post_comment_to_feed` | Comment | `feed_id`, `xsec_token`, `content` |
| `publish_content` | Publish image post | `title`, `content`, `images` |
| `publish_with_video` | Publish video | `title`, `content`, `video` |
| `check_login_status` | Check auth | none |
| `get_login_qrcode` | Login QR | none |

## Notes

- `xsec_token` is required for most operations - get it from search/list results
- Search supports filters: `sort_by`, `publish_time`, `note_type`, `location`
