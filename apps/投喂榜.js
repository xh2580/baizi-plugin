import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer';
import plugin from '../../../lib/plugins/plugin.js';
import cfg from '../../../lib/config/config.js';
import axios from 'axios';
import segment from '../../../lib/segment.js';

// 配置文件路径+自动生成
const zanzhuPath = path.join(process.cwd(), 'plugins', 'baizi-plugin', 'config', 'zanzhu.json');
if (!fs.existsSync(path.dirname(zanzhuPath))) {
  fs.mkdirSync(path.dirname(zanzhuPath), { recursive: true });
}
if (!fs.existsSync(zanzhuPath)) {
  fs.writeFileSync(zanzhuPath, JSON.stringify([], null, 2), 'utf8');
}

export class ZanzhuPlugin extends plugin {
  constructor() {
    super({
      name: '投喂榜',
      dsc: '生成投喂榜单截图',
      event: 'message',
      priority: -1,
      rule: [
        {
          reg: '#投喂榜',
          fnc: 'showZanzhu'
        },
        {
          reg: '#赞助榜',
          fnc: 'showZanzhu'
        }
      ]
    });
    this.browser = null;
    this.screenshotDir = path.join(process.cwd(), 'data', 'temp');
    if (!fs.existsSync(this.screenshotDir)) {
      fs.mkdirSync(this.screenshotDir, { recursive: true });
    }
  }

  async getData() {
    try {
      let data = JSON.parse(fs.readFileSync(zanzhuPath, 'utf8'));
      return data.sort(function(a, b) {
        return b.money - a.money;
      });
    } catch (e) {
      return [];
    }
  }

  hideQQNumber(qq) {
    let qqStr = String(qq);
    if (qqStr.length <= 4) return qqStr;
    return qqStr.slice(0,2) + '****' + qqStr.slice(-2);
  }

  async getQQNickname(qq) {
    try {
      let res = await axios.get('http://api.ilingku.com/int/v1/qqname?qq=' + qq, {
        timeout: 5000
      });
      if (res.data.code === 200) {
        return res.data.name || '未知';
      }
      return '匿名';
    } catch (e) {
      return '匿名';
    }
  }

  async generateHTML(data) {
    let totalAmount = 0;
    for (let i = 0; i < data.length; i++) {
      totalAmount += data[i].money;
    }
    let htmlItems = '';
    for (let i = 0; i < data.length; i++) {
      let item = data[i];
      let nickname = await this.getQQNickname(item.qqnumber);
      let rankClass = '';
      if (i === 0) rankClass = 'rank1';
      else if (i === 1) rankClass = 'rank2';
      else if (i === 2) rankClass = 'rank3';
      let frame = i < 3 ? '<div class="avatar-frame"></div>' : '';
      htmlItems += '<div class="card ' + rankClass + '">';
      htmlItems += '<div class="rank">' + (i+1) + '</div>';
      htmlItems += '<div class="avatar-box">';
      htmlItems += '<img src="http://q1.qlogo.cn/g?b=qq&nk=' + item.qqnumber + '&s=100" class="avatar">';
      htmlItems += frame;
      htmlItems += '</div>';
      htmlItems += '<div class="info">';
      htmlItems += '<div class="nick">昵称：' + nickname + '</div>';
      htmlItems += '<div class="id">ID：' + this.hideQQNumber(item.qqnumber) + '</div>';
      htmlItems += '<div class="money">投喂：¥' + item.money.toFixed(2) + '</div>';
      htmlItems += '</div></div>';
    }
    let totalCard = '<div class="card total-card">';
    totalCard += '<div class="total-info">';
    totalCard += '<div>✿ 总投喂金额：¥' + totalAmount.toFixed(2) + '</div>';
    totalCard += '<div>✿ 总投喂人数：' + data.length + '</div>';
    totalCard += '</div></div>';
    let html = '<!DOCTYPE html><html lang="zh-CN"><head>';
    html += '<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">';
    html += '<style>';
    html += 'body{font-family:微软雅黑,宋体,Arial,sans-serif;background:#f8f9fa;padding:20px;margin:0;display:flex;flex-direction:column;align-items:center;}';
    html += 'h1{color:#7F5AF0;font-size:24px;margin-bottom:20px;}';
    html += '.card{background:#fff;border-radius:12px;padding:16px;margin-bottom:16px;display:flex;align-items:center;box-shadow:0 4px 12px rgba(0,0,0,0.1);width:100%;max-width:400px;}';
    html += '.rank1{border:2px solid #FFD700;} .rank2{border:2px solid #C0C0C0;} .rank3{border:2px solid #CD7F32;}';
    html += '.total-card{background:#7F5AF0;color:#fff;justify-content:center;text-align:center;}';
    html += '.rank{font-size:24px;margin-right:10px;}';
    html += '.avatar-box{position:relative;width:60px;height:60px;margin-right:16px;}';
    html += '.avatar{width:100%;height:100%;border-radius:50%;border:2px solid #7F5AF0;}';
    html += '.avatar-frame{position:absolute;top:-10px;left:-10px;width:150%;height:150%;background:url(http://8.134.11.131/image/tx.png) no-repeat center/cover;pointer-events:none;}';
    html += '.info{flex:1;} .nick{font-size:16px;font-weight:600;color:#2B2C34;margin-bottom:4px;}';
    html += '.id{font-size:14px;color:#666;margin-bottom:4px;} .money{font-size:16px;font-weight:600;color:#2CB67D;}';
    html += '.total-info{font-size:18px;font-weight:600;} h2{color:#d2d2d2;font-size:12px;margin-top:20px;}';
    html += '</style></head><body>';
    html += '<h1>🐾 baizi の投喂榜 🐾</h1>';
    html += '<div class="card-list">' + totalCard + htmlItems + '</div>';
    html += '<h2>© liusu 2024-2025</h2></body></html>';
    return html;
  }

  async initBrowser() {
    if (!this.browser) {
      try {
        this.browser = await puppeteer.launch({
          headless: true,
          args: ['--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage'],
          executablePath: cfg?.bot?.chromium_path
        });
      } catch (e) {
        return null;
      }
    }
    return this.browser;
  }

  async generateScreenshot(html) {
    let browser = await this.initBrowser();
    if (!browser) return null;
    let page = await browser.newPage();
    try {
      await page.setViewport({width:550, height:800, deviceScaleFactor:2});
      await page.setContent(html, {waitUntil: 'networkidle0'});
      let imgPath = path.join(this.screenshotDir, 'zanzhu_' + Date.now() + '.png');
      await page.screenshot({path: imgPath, fullPage: true});
      return imgPath;
    } catch (e) {
      return null;
    } finally {
      await page.close();
    }
  }

  async showZanzhu(e) {
    try {
      let data = await this.getData();
      if (data.length === 0) {
        return await e.reply('暂无投喂数据');
      }
      await e.reply('正在整理投喂数据，请稍等～');
      let html = await this.generateHTML(data);
      let img = await this.generateScreenshot(html);
      if (!img) {
        return await e.reply('截图生成失败，请稍后重试');
      }
      await e.reply([segment.image('file:///' + img)]);
    } catch (e) {
      await e.reply('投喂榜加载失败，请稍后重试');
    }
  }
}