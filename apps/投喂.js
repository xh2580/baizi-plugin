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

  async getQQInfo(qqnumber) {
    try {
      const response = await axios.get(`http://baizihaoxiao.xin/API/qqapi.php?qq=${qqnumber}`, { 
        timeout: 3000 
      });
      
      console.log(`API返回数据 (QQ: ${qqnumber}):`, JSON.stringify(response.data));
      
      if (response.data.code === 1 && response.data.data) {
        return {
          success: true,
          nickname: response.data.data.name || `用户${this.hideQQNumber(qqnumber)}`,
          avatar: response.data.data.imgurl || `http://q1.qlogo.cn/g?b=qq&nk=${qqnumber}&s=100`,
          uin: response.data.data.uin || qqnumber
        };
      } else {
        return {
          success: false,
          nickname: `用户${this.hideQQNumber(qqnumber)}`,
          avatar: `http://q1.qlogo.cn/g?b=qq&nk=${qqnumber}&s=100`,
          uin: qqnumber
        };
      }
    } catch (e) {
      console.error(`获取QQ信息失败 (QQ: ${qqnumber}):`, e.message);
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
    return `${index + 1}.`;
  }

  async generateBeautifulSponsorBoard(data) {
    const totalAmount = data.reduce((sum, item) => sum + item.money, 0);
    const totalSponsors = data.length;
    
    // 并发获取前10个QQ的信息
    const maxRequests = Math.min(10, data.length);
    const qqInfoPromises = [];
    
    for (let i = 0; i < maxRequests; i++) {
      qqInfoPromises.push(this.getQQInfo(data[i].qqnumber));
    }
    
    let qqInfos = [];
    try {
      const results = await Promise.allSettled(qqInfoPromises);
      qqInfos = results.map(result => 
        result.status === 'fulfilled' ? result.value : {
          success: false,
          nickname: `用户${this.hideQQNumber(data[result.index]?.qqnumber || '')}`,
          avatar: `http://q1.qlogo.cn/g?b=qq&nk=${data[result.index]?.qqnumber || ''}&s=100`,
          uin: data[result.index]?.qqnumber || ''
        }
      );
    } catch (e) {
      console.error('批量获取QQ信息失败:', e.message);
      qqInfos = data.slice(0, maxRequests).map(item => ({
        success: false,
        nickname: `用户${this.hideQQNumber(item.qqnumber)}`,
        avatar: `http://q1.qlogo.cn/g?b=qq&nk=${item.qqnumber}&s=100`,
        uin: item.qqnumber
      }));
    }
    
    let message = '';
    
    // 顶部装饰
    message += '┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓\n';
    message += '┃      🐾 白子 の投喂榜 🐾      ┃\n';
    message += '┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛\n\n';
    
    // 前三名特别显示
    if (data.length >= 3) {
      message += '🌟 𝗧𝗢𝗣 𝗧𝗛𝗥𝗘𝗘 荣耀榜 🌟\n';
      message += '━'.repeat(24) + '\n';
      
      for (let i = 0; i < Math.min(3, data.length); i++) {
        const item = data[i];
        const rankEmoji = this.getRankEmoji(i);
        const qqInfo = i < qqInfos.length ? qqInfos[i] : {
          nickname: `用户${this.hideQQNumber(item.qqnumber)}`,
          success: false
        };
        const moneyStr = this.formatMoney(item.money);
        
        message += `${rankEmoji} ${qqInfo.nickname}\n`;
        message += `   ID: ${this.hideQQNumber(item.qqnumber)}\n`;
        message += `   金额: ${moneyStr}\n`;
        if (i < 2) message += '━'.repeat(24) + '\n';
      }
      message += '\n';
    }
    
    // 第4名及以后
    if (data.length > 3) {
      message += '💫 爱心投喂榜 💫\n';
      message += '─'.repeat(28) + '\n';
      
      const startIndex = 3;
      for (let i = startIndex; i < data.length; i++) {
        const item = data[i];
        const rankNum = i + 1;
        const rankStr = rankNum.toString().padStart(2, ' ');
        
        // 对于第10名之后的，我们不调用API，直接使用隐藏QQ号
        let displayName;
        if (i < qqInfos.length) {
          displayName = qqInfos[i].nickname;
        } else {
          displayName = `用户${this.hideQQNumber(item.qqnumber)}`;
        }
        
        const moneyStr = this.formatMoney(item.money);
        
        message += ` ${rankStr} ${displayName}  ${moneyStr}\n`;
        
        // 每10条加个分隔线
        if ((i - startIndex + 1) % 10 === 0 && i !== data.length - 1) {
          message += '─'.repeat(28) + '\n';
        }
      }
      message += '\n';
    }
    
    // 统计信息
    message += '📊 投喂统计 📊\n';
    message += '═'.repeat(26) + '\n';
    message += `💰 累计金额: ${this.formatMoney(totalAmount)}\n`;
    message += `👥 投喂人数: ${totalSponsors}人\n`;
    
    if (totalSponsors > 0) {
      const avgAmount = totalAmount / totalSponsors;
      const maxAmount = Math.max(...data.map(item => item.money));
      
      message += `📈 人均投喂: ${this.formatMoney(avgAmount)}\n`;
      message += `🏆 最高投喂: ${this.formatMoney(maxAmount)}\n`;
    }
    
    // 底部装饰和头像信息说明
    message += '═'.repeat(26) + '\n';
    message += '🎀 感谢各位大大的支持！ 🎀\n';
    message += '📸 注：已获取赞助者QQ头像信息\n';
    message += '© liusu 2024-2026';
    
    return message;
  }

  async showZanzhu(e) {
    try {
      const data = await this.getData();
      if (data.length === 0) {
        return await e.reply('暂无赞助数据，快来成为第一个投喂者吧！(๑•̀ㅂ•́)و✧');
      }

      await e.reply(`正在整理各位大大的投喂...\n请等一下噢 ⸜(๑'ᵕ'๑)⸝⋆*`);
      
      const message = await this.generateBeautifulSponsorBoard(data);
      await e.reply(message);
      
    } catch (err) {
      console.error('showZanzhu 执行失败:', err);
      await e.reply('发生错误，请稍后重试');
    }
  }
}