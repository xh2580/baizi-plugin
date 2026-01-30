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
          reg: '^#?(赞助|投喂)榜$',
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

  async getQQInfo(qqnumber) {
    try {
      const response = await axios.get(`http://baizihaoxiao.xin/API/qqapi.php?qq=${qqnumber}`, { 
        timeout: 5000 
      });
      
      console.log(`获取QQ信息 (${qqnumber}):`, response.data);
      
      if (response.data.code === 1 && response.data.data) {
        const data = response.data.data;
        return {
          success: true,
          nickname: data.name || `用户${this.hideQQNumber(qqnumber)}`,
          avatar: data.imgurl || `http://q1.qlogo.cn/g?b=qq&nk=${qqnumber}&s=100`,
          uin: data.uin || qqnumber
        };
      }
      return {
        success: false,
        nickname: `用户${this.hideQQNumber(qqnumber)}`,
        avatar: `http://q1.qlogo.cn/g?b=qq&nk=${qqnumber}&s=100`,
        uin: qqnumber
      };
    } catch (e) {
      console.error(`获取QQ信息失败 (${qqnumber}):`, e.message);
      return {
        success: false,
        nickname: `用户${this.hideQQNumber(qqnumber)}`,
        avatar: `http://q1.qlogo.cn/g?b=qq&nk=${qqnumber}&s=100`,
        uin: qqnumber
      };
    }
  }

  formatMoney(money) {
    return `¥${money.toFixed(2)}`;
  }

  getRankEmoji(index) {
    if (index === 0) return '🥇';
    if (index === 1) return '🥈';
    if (index === 2) return '🥉';
    return `${index + 1}`;
  }

  async generateSponsorBoard(data) {
    const totalAmount = data.reduce((sum, item) => sum + item.money, 0);
    const totalSponsors = data.length;
    
    // 并发获取所有赞助者的QQ信息
    const qqInfoPromises = data.map(item => this.getQQInfo(item.qqnumber));
    const qqInfos = await Promise.allSettled(qqInfoPromises);
    
    // 处理QQ信息结果
    const processedInfos = qqInfos.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        const qqnumber = data[index]?.qqnumber || '';
        return {
          success: false,
          nickname: `用户${this.hideQQNumber(qqnumber)}`,
          avatar: `http://q1.qlogo.cn/g?b=qq&nk=${qqnumber}&s=100`,
          uin: qqnumber
        };
      }
    });
    
    let message = '';
    
    // 顶部标题
    message += '┏━━━━━━━━━━━━━━━━━━━━━━━━┓\n';
    message += '┃      🐾 白子の投喂榜 🐾      ┃\n';
    message += '┗━━━━━━━━━━━━━━━━━━━━━━━━┛\n\n';
    
    // 显示所有赞助者信息
    message += '🌟 投喂英雄榜 🌟\n';
    message += '━'.repeat(24) + '\n\n';
    
    for (let i = 0; i < data.length; i++) {
      const item = data[i];
      const qqInfo = processedInfos[i];
      const rankEmoji = this.getRankEmoji(i);
      const moneyStr = this.formatMoney(item.money);
      const hiddenQQ = this.hideQQNumber(item.qqnumber);
      
      // 显示头像占位符和赞助者信息
      message += `[${qqInfo.success ? '✓' : '○'}] 头像 - ${qqInfo.nickname}\n`;
      message += `${rankEmoji} 赞助者: ${qqInfo.nickname}\n`;
      message += `   QQ: ${hiddenQQ}\n`;
      message += `   金额: ${moneyStr}\n\n`;
      
      // 添加分隔线（每5个赞助者加一个分隔线）
      if ((i + 1) % 5 === 0 && i !== data.length - 1) {
        message += '─'.repeat(24) + '\n\n';
      }
    }
    
    // 统计信息
    message += '📊 投喂统计 📊\n';
    message += '═'.repeat(24) + '\n';
    message += `✨ 累计金额: ${this.formatMoney(totalAmount)}\n`;
    message += `👥 投喂人数: ${totalSponsors}人\n`;
    
    if (totalSponsors > 0) {
      const avgAmount = totalAmount / totalSponsors;
      const maxAmount = Math.max(...data.map(item => item.money));
      
      message += `📈 人均投喂: ${this.formatMoney(avgAmount)}\n`;
      message += `🏆 最高投喂: ${this.formatMoney(maxAmount)}\n`;
    }
    
    // 底部信息
    message += '═'.repeat(24) + '\n';
    message += '💕 感谢各位大大的支持！ 💕\n';
    message += `注: [✓]表示已成功获取头像信息\n`;
    message += `    [○]表示使用默认头像\n`;
    message += '© liusu 2024-2026';
    
    return message;
  }

  async showZanzhu(e) {
    try {
      // 先回复等待消息
      await e.reply('正在整理各位大大的投喂...\n请等一下噢 ⸜(๑\'ᵕ\'๑)⸝⋆*');
      
      const data = await this.getData();
      if (data.length === 0) {
        return await e.reply('暂无赞助数据，快来成为第一个投喂者吧！(๑•̀ㅂ•́)و✧');
      }

      const message = await this.generateSponsorBoard(data);
      await e.reply(message);
      
    } catch (err) {
      console.error('showZanzhu 执行失败:', err);
      console.error('错误详情:', err.stack);
      await e.reply('发生错误，请稍后重试');
    }
  }
}