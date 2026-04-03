# 未来美术坊 · 每日美育竞品简报

每日自动生成并发布，覆盖竞品动态、行业政策、腾讯游戏美术力、产品建议。

## 查看简报

访问：[GitHub Pages 首页](https://YOUR_GITHUB_USERNAME.github.io/art-report)

## 目录结构

```
art-report-pages/
├── index.html          # 首页，列出所有历史简报
├── reports/            # 每日简报 HTML 文件存档
│   └── report-YYYY-MM-DD.html
├── reports-index.json  # 简报索引（首页动态加载用）
├── publish.js          # 自动发布脚本
├── publish-config.json # 配置文件（GitHub Pages URL + 企业微信 Webhook）
└── README.md
```

## 本地测试发布

```bash
cd art-report-pages
node publish.js --dry-run
```

## 配置说明

编辑 `publish-config.json`：

```json
{
  "githubPagesUrl": "https://你的用户名.github.io/art-report",
  "wecomWebhookUrl": "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=你的key"
}
```
