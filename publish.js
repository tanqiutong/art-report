#!/usr/bin/env node
/**
 * publish.js
 * 未来美术坊 · 每日简报自动发布脚本
 *
 * 功能：
 *   1. 从 WorkBuddy 工作区读取当天生成的简报 HTML
 *   2. 复制到 art-report-pages/reports/ 目录
 *   3. 更新 reports-index.json（首页简报列表）
 *   4. Git commit + push 到 GitHub（触发 GitHub Pages 自动部署）
 *   5. 通过企业微信机器人 Webhook 发消息到群
 *
 * 使用方式：
 *   node publish.js
 *   node publish.js --dry-run   （只生成文件，不推送不发消息，测试用）
 *
 * 环境变量（在 .env 文件或系统环境变量中配置）：
 *   WECOM_WEBHOOK_URL  企业微信机器人 Webhook 地址
 *   GITHUB_PAGES_URL   你的 GitHub Pages 域名，如 https://yourname.github.io/art-report
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const https = require('https');
const http = require('http');

// ── 路径配置 ──────────────────────────────────────────────
const WORKSPACE = path.resolve(__dirname, '..');
const PAGES_DIR = __dirname;
const REPORTS_DIR = path.join(PAGES_DIR, 'reports');
const INDEX_FILE = path.join(PAGES_DIR, 'reports-index.json');
const CONFIG_FILE = path.join(PAGES_DIR, 'publish-config.json');

// ── 读取配置 ──────────────────────────────────────────────
function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    console.error('[错误] 找不到配置文件 publish-config.json');
    console.error('       请先运行 setup 或手动创建配置文件');
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
}

// ── 工具函数 ──────────────────────────────────────────────
function today() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function log(msg) {
  console.log(`[${new Date().toLocaleTimeString('zh-CN')}] ${msg}`);
}

// ── 1. 找到今天的简报 HTML ─────────────────────────────────
function findTodayReport(dateStr) {
  const candidates = [
    path.join(WORKSPACE, `daily_art_report_${dateStr}.html`),
    path.join(WORKSPACE, `art_report_${dateStr}.html`),
  ];
  for (const f of candidates) {
    if (fs.existsSync(f)) return f;
  }
  return null;
}

// ── 2. 复制到 pages/reports/ ──────────────────────────────
function copyReport(srcPath, dateStr) {
  if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const destName = `report-${dateStr}.html`;
  const destPath = path.join(REPORTS_DIR, destName);
  fs.copyFileSync(srcPath, destPath);
  log(`已复制简报 → reports/${destName}`);
  return destName;
}

// ── 3. 更新 reports-index.json ────────────────────────────
function updateIndex(dateStr, fileName) {
  let index = [];
  if (fs.existsSync(INDEX_FILE)) {
    try { index = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8')); } catch (e) { index = []; }
  }
  // 去重：同一天只保留一条
  index = index.filter(item => item.date !== dateStr);
  // 最新的放最前面
  index.unshift({ date: dateStr, file: fileName, publishedAt: new Date().toISOString() });
  // 只保留最近 90 天
  index = index.slice(0, 90);
  fs.writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2), 'utf8');
  log('已更新 reports-index.json');
}

// ── 4. Git push ───────────────────────────────────────────
function gitPush(dateStr) {
  try {
    execSync('git add -A', { cwd: PAGES_DIR, stdio: 'pipe' });
    execSync(`git commit -m "daily report ${dateStr}"`, { cwd: PAGES_DIR, stdio: 'pipe' });
    execSync('git push', { cwd: PAGES_DIR, stdio: 'pipe' });
    log('已推送到 GitHub，GitHub Pages 部署中（约1分钟生效）');
  } catch (e) {
    const msg = e.message || '';
    if (msg.includes('nothing to commit')) {
      log('Git: 无新变更，跳过推送');
    } else {
      console.error('[Git 错误]', msg);
      throw e;
    }
  }
}

// ── 5. 企业微信机器人通知 ─────────────────────────────────
function sendWeComMessage(webhookUrl, pagesBaseUrl, dateStr, reportFile) {
  return new Promise((resolve, reject) => {
    const reportUrl = `${pagesBaseUrl.replace(/\/$/, '')}/reports/${reportFile}`;
    const indexUrl = pagesBaseUrl.replace(/\/$/, '');

    const payload = JSON.stringify({
      msgtype: 'markdown',
      markdown: {
        content: [
          `## 🎨 未来美术坊 · ${dateStr} 每日美育竞品简报`,
          ``,
          `> 今日简报已更新，点击下方链接查看完整内容`,
          ``,
          `**📋 [点击查看今日简报](${reportUrl})**`,
          ``,
          `覆盖内容：竞品动态 · 行业政策 · 腾讯美术力 · 产品建议 · 风险观察`,
          ``,
          `[历史简报存档](${indexUrl}) | 未来美术坊内部使用`,
        ].join('\n')
      }
    });

    const urlObj = new URL(webhookUrl);
    const lib = urlObj.protocol === 'https:' ? https : http;
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    };

    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (result.errcode === 0) {
            log('企业微信消息已发送 ✓');
            resolve(result);
          } else {
            console.error('[企业微信] 发送失败:', result);
            reject(new Error(`errcode: ${result.errcode}, errmsg: ${result.errmsg}`));
          }
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ── 主流程 ────────────────────────────────────────────────
async function main() {
  const isDryRun = process.argv.includes('--dry-run');
  if (isDryRun) log('=== DRY RUN 模式，不会推送到 GitHub 也不会发企业微信消息 ===');

  const config = loadConfig();
  const dateStr = today();

  log(`开始发布 ${dateStr} 简报...`);

  // 1. 找到今天的简报
  const srcPath = findTodayReport(dateStr);
  if (!srcPath) {
    console.error(`[错误] 找不到今天的简报文件：daily_art_report_${dateStr}.html`);
    console.error('       请先运行简报生成任务，或检查文件是否在工作区根目录');
    process.exit(1);
  }
  log(`找到简报文件：${path.basename(srcPath)}`);

  // 2. 复制到 pages
  const reportFile = copyReport(srcPath, dateStr);

  // 3. 更新索引
  updateIndex(dateStr, reportFile);

  if (isDryRun) {
    log('[DRY RUN] 跳过 Git push 和微信通知');
    log(`[DRY RUN] 简报文件已就绪：${path.join(REPORTS_DIR, reportFile)}`);
    return;
  }

  // 4. Git push
  gitPush(dateStr);

  // 5. 企业微信通知（等30秒让GitHub Pages生效）
  if (config.wecomWebhookUrl && config.githubPagesUrl) {
    log('等待30秒让 GitHub Pages 部署完成...');
    await new Promise(r => setTimeout(r, 30000));
    try {
      await sendWeComMessage(config.wecomWebhookUrl, config.githubPagesUrl, dateStr, reportFile);
    } catch (e) {
      console.error('[企业微信通知失败]', e.message);
      console.error('简报已发布到 GitHub Pages，请手动分享链接');
    }
  } else {
    log('[跳过企业微信通知] 未配置 wecomWebhookUrl 或 githubPagesUrl');
    log(`简报已发布，访问地址：${config.githubPagesUrl || '请配置 githubPagesUrl'}`);
  }

  log(`✓ 发布完成！${dateStr} 简报已推送`);
}

main().catch(e => {
  console.error('[发布失败]', e);
  process.exit(1);
});
