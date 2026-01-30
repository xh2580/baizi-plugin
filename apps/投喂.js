import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer';
import plugin from '../../../lib/plugins/plugin.js';
import cfg from '../../../lib/config/config.js';
import axios from 'axios';

const zanzhuPath = path.join(process.cwd(), 'plugins', 'baizi-plugin', 'config', 'zanzhu.json');
const fontPath = '/root/Yunzai/resources/fonts/NotoSansSC-Regular.ttf';

export class ZanzhuPlugin extends plugin {
  constructor() {
    super({
      name: '赞助管理',
      dsc: '赞助记录管理和榜单生成',
      event: 'message',
      priority: 1,
      rule: [
        {
          reg: '^#?赞助添加\\s*(\\d+):(\\d+(\\.\\d+)?)$',
          fnc: 'addZanzhu'
        },
        {
          reg: '^#?赞助修改\\s*(\\d+):(\\d+(\\.\\d+)?)$',
          fnc: 'updateZanzhu'
        },
        {
          reg: '^#?赞助删除\\s*(\\d+)$',
          fnc: 'deleteZanzhu'
        },
        {
          reg: '^#?(赞助|投喂)榜\\s*$',
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
      const data = JSON.parse(fs.readFileSync(zanzhuPath, 'utf8'));
      return data.map(item => ({
        qqnumber: String(item.qqnumber),
        money: item.money
      })).sort((a, b) => b.money - a.money);
    } catch (e) {
      return [];
    }
  }

  async saveData(data) {
    try {
      const dirPath = path.dirname(zanzhuPath);
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }
      fs.writeFileSync(zanzhuPath, JSON.stringify(data, null, 2));
    } catch (e) {}
  }

  async checkPermission(e) {
    const senderQQ = e.sender.user_id.toString();
    const ownerQQ = '2937655991';
    if (senderQQ !== ownerQQ) {
      await e.reply('您没有权限执行此操作，仅限主人操作。');
      return false;
    }
    return true;
  }

  async addZanzhu(e) {
    if (!(await this.checkPermission(e))) return;

    const match = e.msg.match(/^#?赞助添加\s*(\d+):(\d+(\.\d+)?)$/);
    if (!match) {
      await e.reply('指令格式错误，请使用：#赞助添加 QQ号:金额');
      return;
    }

    const qqnumber = match[1];
    const money = parseFloat(match[2]);
    if (isNaN(money)) {
      await e.reply('金额格式错误，请输入有效的金额。');
      return;
    }

    const data = await this.getData();
    const existingRecord = data.find(item => item.qqnumber === qqnumber);

    if (existingRecord) {
      existingRecord.money += money;
      await this.saveData(data);
      await e.reply(`已更新 QQ:${qqnumber} 的赞助记录，新增金额：¥${money.toFixed(2)}，累计金额：¥${existingRecord.money.toFixed(2)}`);
    } else {
      data.push({ qqnumber, money });
      await this.saveData(data);
      await e.reply(`已添加 QQ:${qqnumber} 的赞助记录，金额：¥${money.toFixed(2)}`);
    }
  }

  async updateZanzhu(e) {
    if (!(await this.checkPermission(e))) return;

    const match = e.msg.match(/^#?赞助修改\s*(\d+):(\d+(\.\d+)?)$/);
    if (!match) {
      await e.reply('指令格式错误，请使用：#赞助修改 QQ号:新金额');
      return;
    }

    const qqnumber = match[1];
    const newMoney = parseFloat(match[2]);
    if (isNaN(newMoney)) {
      await e.reply('金额格式错误，请输入有效的金额。');
      return;
    }

    const data = await this.getData();
    const recordIndex = data.findIndex(item => item.qqnumber === qqnumber);

    if (recordIndex === -1) {
      await e.reply(`未找到 QQ:${qqnumber} 的赞助记录`);
    } else {
      data[recordIndex].money = newMoney;
      await this.saveData(data);
      await e.reply(`已将 QQ:${qqnumber} 的赞助金额修改为 ¥${newMoney.toFixed(2)}`);
    }
  }

  async deleteZanzhu(e) {
    if (!(await this.checkPermission(e))) return;

    const match = e.msg.match(/^#?赞助删除\s*(\d+)$/);
    if (!match) {
      await e.reply('指令格式错误，请使用：#赞助删除 QQ号');
      return;
    }

    const qqnumber = match[1];
    const data = await this.getData();
    const recordIndex = data.findIndex(item => item.qqnumber === qqnumber);

    if (recordIndex === -1) {
      await e.reply(`未找到 QQ:${qqnumber} 的赞助记录`);
    } else {
      data.splice(recordIndex, 1);
      await this.saveData(data);
      await e.reply(`已删除 QQ:${qqnumber} 的赞助记录`);
    }
  }

  hideQQNumber(qqnumber) {
    const qqStr = String(qqnumber);
    if (qqStr.length <= 4) return qqStr;
    const prefix = qqStr.slice(0, 2);
    const suffix = qqStr.slice(-2);
    return `${prefix}****${suffix}`;
  }

  async getQQNickname(qqnumber) {
    try {
      const response = await axios.get(`http://api.ilingku.com/int/v1/qqname?qq=${qqnumber}`, { timeout: 5000 });
      if (response.data.code === 200) {
        return response.data.name || '未知';
      }
      return '匿名';
    } catch (e) {
      return '匿名';
    }
  }

  async generateHTML(data) {
    const totalAmount = data.reduce((sum, item) => sum + item.money, 0);
    const totalSponsors = data.length;

    const items = await Promise.all(data.map(async (item, index) => {
      const nickname = await this.getQQNickname(item.qqnumber);
      let rankClass = '';
      const rankIcon = `${index + 1}`;
      if (index === 0) rankClass = 'sponsor-card-first';
      else if (index === 1) rankClass = 'sponsor-card-second';
      else if (index === 2) rankClass = 'sponsor-card-third';
      const avatarFrame = index < 3 ? `<div class="avatar-frame"></div>` : '';
      return `
        <div class="sponsor-card ${rankClass}">
          <div class="sponsor-rank">${rankIcon}</div>
          <div class="sponsor-avatar-container">
            <img class="sponsor-avatar" src="http://q1.qlogo.cn/g?b=qq&nk=${item.qqnumber}&s=100" alt="头像">
            ${avatarFrame}
          </div>
          <div class="sponsor-info">
            <div class="sponsor-name">昵称: ${nickname}</div>
            <div class="sponsor-id">ID: ${this.hideQQNumber(item.qqnumber)}</div>
            <div class="sponsor-amount">投喂金额: ¥${item.money.toFixed(2)}</div>
          </div>
        </div>
      `;
    }));

    const totalCard = `
      <div class="sponsor-card sponsor-card-total">
        <div class="sponsor-info">
          <div class="sponsor-total">✿  总投喂金额: ¥${totalAmount.toFixed(2)}</div>
          <div class="sponsor-total">✿  总投喂人数: ${totalSponsors}</div>
        </div>
      </div>
    `;

    return `
      <!DOCTYPE html>
      <html lang="zh-CN">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>赞助榜</title>
        <style>
          @font-face {
            font-family: 'Noto Sans SC';
            src: url('file://${fontPath}') format('truetype');
          }
          body { 
            font-family: 'Noto Sans SC', sans-serif; 
            background: #f8f9fa; 
            color: #2B2C34; 
            margin: 0; 
            padding: 20px; 
            display: flex; 
            flex-direction: column; 
            align-items: center; 
          }
          h1 { color: #7F5AF0; font-size: 24px; margin-bottom: 20px; }
          h2 { text-align: center; color: #d2d2d2; font-size: 12px; font-weight: normal; }
          .sponsor-list { width: 100%; max-width: 400px; }
          .sponsor-card { 
            background: white; 
            border-radius: 12px; 
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1); 
            padding: 16px; 
            margin-bottom: 16px; 
            display: flex; 
            align-items: center; 
            position: relative; 
          }
          .sponsor-card-first { border: 2px solid #FFD700; }
          .sponsor-card-second { border: 2px solid #C0C0C0; }
          .sponsor-card-third { border: 2px solid #CD7F32; }
          .sponsor-card-total { background: #7F5AF0; color: white; text-align: center; }
          .sponsor-rank { font-size: 24px; margin-right: 10px; }
          .sponsor-avatar-container { position: relative; width: 60px; height: 60px; margin-right: 16px; }
          .sponsor-avatar { width: 60px; height: 60px; border-radius: 50%; border: 2px solid #7F5AF0; }
          .avatar-frame { 
            position: absolute; 
            top: -10px; 
            left: -10px; 
            width: 150%; 
            height: 150%; 
            background: url('http://8.134.11.131/image/tx.png') no-repeat center center; 
            background-size: cover; 
            pointer-events: none; 
          }
          .sponsor-info { flex: 1; }
          .sponsor-name { font-size: 16px; font-weight: 600; color: #2B2C34; margin-bottom: 4px; }
          .sponsor-id { font-size: 14px; color: #666; margin-bottom: 4px; }
          .sponsor-amount { font-size: 16px; font-weight: 600; color: #2CB67D; }
          .sponsor-total { font-size: 18px; font-weight: 600; margin-bottom: 8px; }
        </style>
      </head>
      <body>
        <h1>🐾 jiuxian の投喂榜 🐾</h1>
        <div class="sponsor-list">${totalCard}${items.join('')}</div>
        <h2>© liusu 2024-2025</h2>
      </body>
      </html>
    `;
  }

  async generateScreenshot(htmlContent) {
    const browser = await this.initBrowserIfNeeded();
    if (!browser) return null;

    const page = await browser.newPage();
    try {
      await page.setViewport({ width: 550, height: 800, deviceScaleFactor: 2 });
      await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
      const screenshotPath = path.join(this.screenshotDir, `zanzhu_${Date.now()}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      return screenshotPath;
    } catch (err) {
      return null;
    } finally {
      await page.close();
    }
  }

  async initBrowserIfNeeded() {
    if (!this.browser) {
      try {
        this.browser = await puppeteer.launch({
          headless: true,
          args: ['--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage', '--disable-setuid-sandbox', '--no-zygote', '--disable-web-security', '--allow-file-access-from-files'],
          executablePath: cfg?.bot?.chromium_path || undefined
        });
      } catch (err) {
        return null;
      }
    }
    return this.browser;
  }

  async showZanzhu(e) {
    try {
      const data = await this.getData();
      if (data.length === 0) {
        return await e.reply('暂无赞助数据');
      }

      await e.reply(`正在整理各位大大的投喂...\n请等一下噢 ⸜(๑'ᵕ'๑)⸝⋆*`);
      const htmlContent = await this.generateHTML(data);
      const imagePath = await this.generateScreenshot(htmlContent);

      if (!imagePath) {
        return await e.reply('生成截图失败，请稍后重试');
      }

      await e.reply([segment.image(`file:///${imagePath}`)]);
    } catch (err) {
      await e.reply('发生错误，请稍后重试');
    }
  }
}