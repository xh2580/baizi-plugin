import fs from 'fs';
import path from 'path';
import plugin from '../../../lib/plugins/plugin.js';
import axios from 'axios';

const zanzhuPath = path.join(process.cwd(), 'plugins', 'baizi-plugin', 'config', 'zanzhu.json');

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
          reg: '^#?赞助修改\\s*(\\d+):(\\d+(\\.\d+)?)$',
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
  }

  async getData() {
    try {
      if (!fs.existsSync(zanzhuPath)) {
        return [];
      }
      const data = JSON.parse(fs.readFileSync(zanzhuPath, 'utf8'));
      return data.map(item => ({
        qqnumber: String(item.qqnumber),
        money: item.money
      })).sort((a, b) => b.money - a.money);
    } catch (e) {
      console.error('读取数据失败:', e.message);
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
    } catch (e) {
      console.error('保存数据失败:', e.message);
    }
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
      const response = await axios.get(`http://baizihaoxiao.xin/API/qqapi.php?qq=${qqnumber}`, { timeout: 5000 });
      if (response.data.code === 1) {
        return response.data.data.name || '未知';
      }
      return '匿名';
    } catch (e) {
      console.error('获取QQ昵称失败:', e.message);
      return '匿名';
    }
  }

  formatMoney(money) {
    return `¥${money.toFixed(2)}`;
  }

  getRankEmoji(index) {
    const emojis = ['🥇', '🥈', '🥉', '🏅', '🏅'];
    return index < emojis.length ? emojis[index] : '🎖️';
  }

  generateSeparator(length) {
    return '─'.repeat(length);
  }

  async generateTextSponsorBoard(data) {
    const totalAmount = data.reduce((sum, item) => sum + item.money, 0);
    const totalSponsors = data.length;
    
    // 获取所有昵称
    const itemsWithNicknames = await Promise.all(data.map(async (item, index) => {
      const nickname = await this.getQQNickname(item.qqnumber);
      return { ...item, nickname, index };
    }));
    
    let message = `╔═══════════════════════════════╗\n`;
    message += `║     🐾 白子 の投喂榜 🐾      ║\n`;
    message += `╚═══════════════════════════════╝\n\n`;
    
    // 添加前三名特别标注
    const topThree = itemsWithNicknames.slice(0, 3);
    if (topThree.length > 0) {
      message += `🏆 【 荣誉殿堂 】🏆\n`;
      message += `${this.generateSeparator(20)}\n`;
      
      for (const item of topThree) {
        const rankEmoji = this.getRankEmoji(item.index);
        message += `${rankEmoji} ${item.nickname}\n`;
        message += `   ID: ${this.hideQQNumber(item.qqnumber)}\n`;
        message += `   金额: ${this.formatMoney(item.money)}\n`;
        
        if (item.index < 2) message += `${this.generateSeparator(20)}\n`;
      }
      message += `\n`;
    }
    
    // 添加其他赞助者
    const others = itemsWithNicknames.slice(3);
    if (others.length > 0) {
      message += `🎖️ 【 感谢名单 】🎖️\n`;
      message += `${this.generateSeparator(30)}\n`;
      
      for (const item of others) {
        const rankNumber = (item.index + 1).toString().padStart(2, ' ');
        message += `  ${rankNumber}. ${item.nickname} (${this.hideQQNumber(item.qqnumber)}) - ${this.formatMoney(item.money)}\n`;
      }
      message += `\n`;
    }
    
    // 添加统计信息
    message += `📊 【 统计数据 】📊\n`;
    message += `${this.generateSeparator(25)}\n`;
    message += `🌸 总投喂金额: ${this.formatMoney(totalAmount)}\n`;
    message += `🌸 总投喂人数: ${totalSponsors}人\n`;
    
    // 添加人均和最高最低
    if (totalSponsors > 0) {
      const avgAmount = totalAmount / totalSponsors;
      const maxAmount = Math.max(...data.map(item => item.money));
      const minAmount = Math.min(...data.map(item => item.money));
      
      message += `🌸 人均投喂: ${this.formatMoney(avgAmount)}\n`;
      message += `🌸 最高投喂: ${this.formatMoney(maxAmount)}\n`;
      message += `🌸 最低投喂: ${this.formatMoney(minAmount)}\n`;
    }
    
    message += `\n${this.generateSeparator(35)}\n`;
    message += `✨ 感谢各位大大的支持！✨\n`;
    message += `© liusu 2024-2026`;
    
    return message;
  }

  async generateSimpleSponsorBoard(data) {
    const totalAmount = data.reduce((sum, item) => sum + item.money, 0);
    const totalSponsors = data.length;
    
    let message = `┏━━━━━━━━━━━━━━━━━━━━━━━━━┓\n`;
    message += `┃      🐾 白子 の投喂榜 🐾      ┃\n`;
    message += `┗━━━━━━━━━━━━━━━━━━━━━━━━━┛\n\n`;
    
    // 使用更简单的格式，不需要异步获取昵称
    for (let i = 0; i < data.length; i++) {
      const item = data[i];
      const rank = i + 1;
      let rankPrefix = `${rank}.`;
      
      if (i === 0) rankPrefix = '🥇';
      else if (i === 1) rankPrefix = '🥈';
      else if (i === 2) rankPrefix = '🥉';
      else if (i < 9) rankPrefix = `${rank}.`;
      else rankPrefix = `${rank}.`;
      
      message += `${rankPrefix} ${this.hideQQNumber(item.qqnumber)} - ${this.formatMoney(item.money)}\n`;
    }
    
    message += `\n${'═'.repeat(28)}\n`;
    message += `总投喂金额: ${this.formatMoney(totalAmount)}\n`;
    message += `总投喂人数: ${totalSponsors}人\n`;
    message += `${'═'.repeat(28)}\n`;
    message += `© liusu 2024-2026`;
    
    return message;
  }

  async showZanzhu(e) {
    try {
      await e.reply(`正在整理各位大大的投喂...\n请等一下噢 ⸜(๑'ᵕ'๑)⸝⋆*`);
      
      const data = await this.getData();
      if (data.length === 0) {
        return await e.reply('暂无赞助数据');
      }

      // 根据数据量选择不同的格式
      let message;
      if (data.length <= 10) {
        message = await this.generateTextSponsorBoard(data);
      } else {
        // 数据太多时使用简化版
        message = await this.generateSimpleSponsorBoard(data);
      }
      
      await e.reply(message);
      
    } catch (err) {
      console.error('showZanzhu 执行失败:', err);
      console.error('错误详情:', err.stack);
      await e.reply('发生错误，请稍后重试');
    }
  }
}