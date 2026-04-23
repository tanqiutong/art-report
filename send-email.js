/**
 * 未来美术坊简报邮件发送脚本
 * 用法：
 *   node art-report-pages/send-email.js --to "a@tencent.com,b@tencent.com"
 *   node art-report-pages/send-email.js --to "a@tencent.com" --date "2026-04-22"
 *
 * 依赖：nodemailer（首次运行会提示安装）
 */

const path   = require('path');
const fs     = require('fs');

// ── 参数解析 ──────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf('--' + name);
  return idx !== -1 ? args[idx + 1] : null;
}

const toArg   = getArg('to');
const dateArg = getArg('date');  // 可选，默认取最新一期

if (!toArg) {
  console.error('[错误] 请指定收件人：--to "a@tencent.com,b@tencent.com"');
  process.exit(1);
}

const recipients = toArg.split(',').map(s => s.trim()).filter(Boolean);

// ── 读取配置 ──────────────────────────────────────────
const configPath = path.join(__dirname, 'email-config.json');
if (!fs.existsSync(configPath)) {
  console.error('[错误] 未找到 email-config.json，请先配置发件人信息');
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

// ── 确定要发的简报文件 ────────────────────────────────
const indexPath = path.join(__dirname, 'reports-index.json');
if (!fs.existsSync(indexPath)) {
  console.error('[错误] 未找到 reports-index.json');
  process.exit(1);
}
const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
if (!index.length) {
  console.error('[错误] 暂无简报记录');
  process.exit(1);
}

let target;
if (dateArg) {
  target = index.find(r => r.date === dateArg);
  if (!target) { console.error('[错误] 未找到日期为', dateArg, '的简报'); process.exit(1); }
} else {
  target = index[0];
}

const reportFile = path.join(__dirname, 'reports', target.file);
if (!fs.existsSync(reportFile)) {
  console.error('[错误] 简报文件不存在：', reportFile);
  process.exit(1);
}

const reportHtml = fs.readFileSync(reportFile, 'utf8');
const reportDate = target.date;
const period     = index.length - index.indexOf(target);
const pagesUrl   = config.githubPagesUrl || 'https://tanqiutong.github.io/art-report';
const onlineUrl  = pagesUrl + '/reports/' + target.file;

// ── 解析简报内容 ──────────────────────────────────────
/**
 * 简单正则提取，不引入 DOM 解析器。
 * 提取格式：news-item → { title, date, source, impact, url, summary, isNew }
 */
function extractNewsItems(html) {
  const items = [];
  // 匹配每个 <li class="news-item...">...</li>
  const liReg = /<li class="news-item([^"]*)">([\s\S]*?)<\/li>/g;
  let m;
  while ((m = liReg.exec(html)) !== null) {
    const cls     = m[1];
    const block   = m[2];
    const isNew   = cls.includes('new-item');

    // 标题
    const titleM  = block.match(/<div class="news-title">([\s\S]*?)<\/div>/);
    let title = titleM ? titleM[1].replace(/<[^>]+>/g, '').trim() : '';

    // 来源
    const srcM    = block.match(/class="news-source"[^>]*>([\s\S]*?)<\/span>/);
    const source  = srcM ? srcM[1].replace(/<[^>]+>/g, '').trim() : '';

    // 日期
    const dateM   = block.match(/class="news-date"[^>]*>([\s\S]*?)<\/span>/);
    const date    = dateM ? dateM[1].replace(/<[^>]+>/g, '').trim() : '';

    // 影响标签
    const impM    = block.match(/class="news-impact[^"]*"[^>]*><span[^>]*><\/span>([\s\S]*?)<\/span>/);
    const impact  = impM ? impM[1].replace(/<[^>]+>/g, '').trim() : '';

    // 摘要里的第一个链接作为「原文链接」
    const linkM   = block.match(/class="highlight"[^>]*href="([^"]+)"/);
    const url     = linkM ? linkM[1] : '';

    // 摘要纯文本
    const sumM    = block.match(/class="news-summary"[^>]*>([\s\S]*?)<\/div>/);
    const summary = sumM ? sumM[1].replace(/<[^>]+>/g, '').trim().slice(0, 120) + '…' : '';

    items.push({ title, date, source, impact, url, summary, isNew });
  }
  return items;
}

/**
 * 提取一句话模块（行动/腾讯/风险）
 */
function extractOneLiner(html, sectionId) {
  const secReg = new RegExp('id="' + sectionId + '"[^>]*>([\\s\\S]*?)</div>\\s*</div>', '');
  const secM   = html.match(new RegExp('id="' + sectionId + '"[\\s\\S]*?(?=id="|<div class="footer")'));
  if (!secM) return [];
  const block  = secM[0];

  // 行动建议
  if (sectionId === 'actions-section') {
    const cards = [];
    const cardReg = /<div class="action-card[^"]*">([\s\S]*?)<\/div>\s*<\/div>/g;
    let cm;
    while ((cm = cardReg.exec(block)) !== null) {
      const priM = cm[1].match(/class="action-priority"[^>]*>([\s\S]*?)<\/div>/);
      const lineM = cm[1].match(/class="action-oneliner"[^>]*>([\s\S]*?)<\/div>/);
      if (priM && lineM) {
        cards.push({
          priority: priM[1].replace(/<[^>]+>/g, '').trim(),
          text:     lineM[1].replace(/<[^>]+>/g, '').trim()
        });
      }
    }
    return cards;
  }

  // 风险
  if (sectionId === 'risks-section') {
    const risks = [];
    const riskReg = /<div class="risk-item">([\s\S]*?)<\/div>\s*<\/div>/g;
    let rm;
    while ((rm = riskReg.exec(block)) !== null) {
      const iconM = rm[1].match(/class="risk-icon ([^"]+)"/);
      const lineM = rm[1].match(/class="risk-oneliner"[^>]*>([\s\S]*?)<\/div>/);
      if (lineM) {
        risks.push({
          level: iconM ? iconM[1] : 'amber',
          text:  lineM[1].replace(/<[^>]+>/g, '').trim()
        });
      }
    }
    return risks;
  }

  return [];
}

const newsItems    = extractNewsItems(reportHtml);
const newItems     = newsItems.filter(n => n.isNew);
const oldItems     = newsItems.filter(n => !n.isNew);
const actions      = extractOneLiner(reportHtml, 'actions-section');
const risks        = extractOneLiner(reportHtml, 'risks-section');

// ── 生成邮件 HTML ─────────────────────────────────────
function impactColor(impact) {
  if (!impact) return '#6b7280';
  if (impact.includes('极高') || impact.includes('竞争')) return '#5b21b6';
  if (impact.includes('政策')) return '#9d174d';
  if (impact.includes('预警') || impact.includes('加剧')) return '#991b1b';
  if (impact.includes('中等')) return '#92400e';
  if (impact.includes('技术')) return '#155e75';
  return '#3730a3';
}
function impactBg(impact) {
  if (!impact) return '#f3f4f6';
  if (impact.includes('极高') || impact.includes('竞争')) return '#ede9fe';
  if (impact.includes('政策')) return '#fce7f3';
  if (impact.includes('预警') || impact.includes('加剧')) return '#fee2e2';
  if (impact.includes('中等')) return '#fef3c7';
  if (impact.includes('技术')) return '#cffafe';
  return '#e0e7ff';
}
function riskDot(level) {
  if (level === 'red')   return '🔴';
  if (level === 'amber') return '🟡';
  return '🟢';
}
function pColor(priority) {
  if (priority && priority.startsWith('P0')) return '#e53e3e';
  if (priority && priority.startsWith('P1')) return '#5b4fcf';
  return '#7c6fe8';
}

function renderNewsRow(item, showNew) {
  const badge = (showNew && item.isNew)
    ? '<span style="display:inline-block;background:#ede9fe;color:#6d28d9;font-size:10px;font-weight:700;padding:1px 6px;border-radius:8px;margin-left:6px;">新</span>'
    : '';
  const impBg  = impactBg(item.impact);
  const impClr = impactColor(item.impact);
  const titleEl = item.url
    ? `<a href="${item.url}" target="_blank" style="color:#3730a3;font-weight:700;font-size:14px;text-decoration:none;">${item.title}</a>`
    : `<span style="font-weight:700;font-size:14px;color:#1e1b4b;">${item.title}</span>`;

  return `
  <tr>
    <td style="padding:14px 0;border-bottom:1px solid #ede9fe;vertical-align:top;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="vertical-align:top;padding-right:10px;width:auto;">
          ${titleEl}${badge}
          <div style="margin-top:5px;font-size:12px;color:#9691c4;">
            ${item.date ? item.date + ' &nbsp;·&nbsp; ' : ''}
            <span style="color:#5b4fcf;font-weight:500;">${item.source}</span>
            ${item.impact ? `&nbsp;<span style="background:${impBg};color:${impClr};font-size:10px;font-weight:700;padding:1px 7px;border-radius:10px;">${item.impact}</span>` : ''}
          </div>
          <div style="margin-top:6px;font-size:13px;color:#4c4878;line-height:1.65;">${item.summary}</div>
        </td>
      </tr></table>
    </td>
  </tr>`;
}

function buildEmail() {
  const todayLabel = `${reportDate} · 第${period}期`;

  const newRows = newItems.map(i => renderNewsRow(i, true)).join('');
  const oldRows = oldItems.map(i => renderNewsRow(i, false)).join('');

  const actionRows = actions.map(a => `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #f3f0ff;">
        <span style="display:inline-block;font-size:10px;font-weight:700;color:${pColor(a.priority)};background:#f3f0ff;padding:2px 8px;border-radius:10px;margin-bottom:4px;">${a.priority}</span>
        <div style="font-size:13px;color:#1e1b4b;line-height:1.6;">${a.text}</div>
      </td>
    </tr>`).join('');

  const riskRows = risks.map(r => `
    <tr>
      <td style="padding:7px 0;border-bottom:1px solid #f7f6fc;font-size:13px;color:#4c4878;line-height:1.6;">
        ${riskDot(r.level)}&nbsp;&nbsp;${r.text}
      </td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>未来美术坊简报 ${reportDate}</title></head>
<body style="margin:0;padding:0;background:#f7f6fc;font-family:'PingFang SC','Microsoft YaHei',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f7f6fc;">
<tr><td align="center" style="padding:24px 16px;">

  <!-- 主容器 -->
  <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">

    <!-- ── Banner ── -->
    <tr><td style="background:linear-gradient(125deg,#3d35a8,#6b5ce7,#a78bfa);border-radius:12px 12px 0 0;padding:28px 28px 22px;position:relative;">
      <div style="display:inline-block;background:rgba(255,255,255,0.18);border:1px solid rgba(255,255,255,0.3);color:rgba(255,255,255,0.9);font-size:10px;font-weight:600;padding:2px 10px;border-radius:20px;letter-spacing:.06em;margin-bottom:10px;">竞品简报</div>
      <div style="font-size:26px;font-weight:700;color:#fff;letter-spacing:.02em;line-height:1.2;margin-bottom:4px;">未来美术坊</div>
      <div style="font-size:11px;color:rgba(255,255,255,0.5);letter-spacing:.08em;margin-bottom:14px;">ART EDUCATION · COMPETITIVE INTELLIGENCE REPORT</div>
      <div style="font-size:12px;color:rgba(255,255,255,0.75);">${todayLabel}</div>
    </td></tr>

    <!-- ── 在线查看 ── -->
    <tr><td style="background:#fff;padding:12px 28px;border-left:1px solid #ede9fe;border-right:1px solid #ede9fe;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="font-size:12px;color:#9691c4;">本期共 ${newsItems.length} 条动态，其中 ${newItems.length} 条今日新增</td>
        <td align="right"><a href="${onlineUrl}" target="_blank" style="font-size:12px;font-weight:600;color:#5b4fcf;text-decoration:none;border:1px solid #c4b5fd;padding:4px 12px;border-radius:6px;">网页版查看 ↗</a></td>
      </tr></table>
    </td></tr>

    <!-- ── 今日新增动态 ── -->
    ${newItems.length > 0 ? `
    <tr><td style="background:#fff;padding:20px 28px 0;border-left:1px solid #ede9fe;border-right:1px solid #ede9fe;">
      <div style="font-size:11px;font-weight:700;letter-spacing:.1em;color:#5b4fcf;margin-bottom:2px;display:flex;align-items:center;gap:6px;">
        <span style="display:inline-block;width:4px;height:14px;background:linear-gradient(180deg,#5b4fcf,#a78bfa);border-radius:2px;vertical-align:middle;margin-right:6px;"></span>今日新增动态
      </div>
    </td></tr>
    <tr><td style="background:#fff;padding:0 28px;border-left:1px solid #ede9fe;border-right:1px solid #ede9fe;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0">${newRows}</table>
    </td></tr>` : ''}

    <!-- ── 持续监控动态 ── -->
    ${oldItems.length > 0 ? `
    <tr><td style="background:#fff;padding:20px 28px 0;border-left:1px solid #ede9fe;border-right:1px solid #ede9fe;">
      <div style="font-size:11px;font-weight:700;letter-spacing:.1em;color:#5b4fcf;margin-bottom:2px;">
        <span style="display:inline-block;width:4px;height:14px;background:linear-gradient(180deg,#5b4fcf,#a78bfa);border-radius:2px;vertical-align:middle;margin-right:6px;"></span>持续监控动态
      </div>
    </td></tr>
    <tr><td style="background:#fff;padding:0 28px;border-left:1px solid #ede9fe;border-right:1px solid #ede9fe;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0">${oldRows}</table>
    </td></tr>` : ''}

    <!-- ── 产品动作建议 ── -->
    ${actionRows ? `
    <tr><td style="background:#fff;padding:20px 28px 0;border-left:1px solid #ede9fe;border-right:1px solid #ede9fe;">
      <div style="font-size:11px;font-weight:700;letter-spacing:.1em;color:#5b4fcf;margin-bottom:2px;">
        <span style="display:inline-block;width:4px;height:14px;background:linear-gradient(180deg,#5b4fcf,#a78bfa);border-radius:2px;vertical-align:middle;margin-right:6px;"></span>产品动作建议
      </div>
    </td></tr>
    <tr><td style="background:#fff;padding:0 28px;border-left:1px solid #ede9fe;border-right:1px solid #ede9fe;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0">${actionRows}</table>
    </td></tr>` : ''}

    <!-- ── 风险观察 ── -->
    ${riskRows ? `
    <tr><td style="background:#fff;padding:20px 28px 0;border-left:1px solid #ede9fe;border-right:1px solid #ede9fe;">
      <div style="font-size:11px;font-weight:700;letter-spacing:.1em;color:#5b4fcf;margin-bottom:2px;">
        <span style="display:inline-block;width:4px;height:14px;background:linear-gradient(180deg,#5b4fcf,#a78bfa);border-radius:2px;vertical-align:middle;margin-right:6px;"></span>风险观察
      </div>
    </td></tr>
    <tr><td style="background:#fff;padding:0 28px 14px;border-left:1px solid #ede9fe;border-right:1px solid #ede9fe;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0">${riskRows}</table>
    </td></tr>` : ''}

    <!-- ── Footer ── -->
    <tr><td style="background:#3d35a8;border-radius:0 0 12px 12px;padding:16px 28px;text-align:center;">
      <div style="font-size:11px;color:rgba(255,255,255,0.55);line-height:1.8;">
        未来美术坊内部竞品简报 · 每日自动生成 · 由布丁驱动<br>
        <a href="${pagesUrl}" target="_blank" style="color:rgba(255,255,255,0.65);text-decoration:none;">${pagesUrl}</a>
      </div>
    </td></tr>

  </table>
</td></tr>
</table>
</body></html>`;
}

// ── 发送邮件 ──────────────────────────────────────────
async function main() {
  let nodemailer;
  try {
    nodemailer = require('nodemailer');
  } catch (e) {
    console.log('[提示] 正在安装 nodemailer...');
    require('child_process').execSync('npm install nodemailer --save', { stdio: 'inherit', cwd: __dirname });
    nodemailer = require('nodemailer');
  }

  const emailHtml = buildEmail();

  // 同时保存一份邮件 HTML 到本地（方便调试）
  const debugFile = path.join(__dirname, '..', `email_preview_${reportDate}.html`);
  fs.writeFileSync(debugFile, emailHtml, 'utf8');
  console.log('[✓] 邮件预览已保存：', debugFile);

  const createFn = nodemailer.createTransport || nodemailer.createTransporter;
  const transporter = createFn({
    host:   config.smtp.host,
    port:   config.smtp.port,
    secure: config.smtp.port === 465,
    auth: {
      user: config.smtp.user,
      pass: config.smtp.pass
    }
  });

  const subject = `【未来美术坊】${reportDate} 竞品简报 · 第${period}期（共${newsItems.length}条，新增${newItems.length}条）`;

  await transporter.sendMail({
    from:    `"未来美术坊简报" <${config.smtp.user}>`,
    to:      recipients.join(', '),
    subject: subject,
    html:    emailHtml
  });

  console.log(`[✓] 邮件已发送至：${recipients.join(', ')}`);
}

main().catch(err => {
  console.error('[✗] 发送失败：', err.message);
  process.exit(1);
});
