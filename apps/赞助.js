import fs from 'fs';
import path from 'path';
import plugin from '../../../lib/plugins/plugin.js';
import axios from 'axios';
import https from 'https';
import { fileURLToPath } from 'url';

// 获取当前文件路径
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
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
    
    // 使用绝对路径
    this.tempDir = path.join(__dirname, '../data/temp');
    this.ensureDirExists(this.tempDir);
  }

  ensureDirExists(dirPath) {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  async getData() {
    try {
      if (!fs.existsSync(zanzhuPath)) {
        return [];
      }
      const data = JSON.parse(fs.readFileSync(zanzhuPath, 'utf8'));
      return data.map(item => ({
        qqnumber: String(item.qqnumber),
        money: parseFloat(item.money)
      })).sort((a, b) => b.money - a.money);
    } catch (e) {
      console.error('读取数据失败:', e.message);
      return [];
    }
  }

  async saveData(data) {
    try {
      const dirPath = path.dirname(zanzhuPath);
      this.ensureDirExists(dirPath);
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
      // 使用多个API源，增加成功率
      const apiUrls = [
        `http://baizihaoxiao.xin/API/qqapi.php?qq=${qqnumber}`,
        `http://ovoa.cc/api/qqinfo.api.php?qq=${qqnumber}`,
        `https://api.usuuu.com/qq/${qqnumber}`
      ];

      let response;
      for (const url of apiUrls) {
        try {
          response = await axios.get(url, { 
            timeout: 3000,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
          });
          
          if (response.data) {
            // 解析不同API返回格式
            let name = '';
            let imgurl = '';
            
            if (response.data.name || response.data.nickname) {
              name = response.data.name || response.data.nickname;
            } else if (response.data.data?.name) {
              name = response.data.data.name;
            }
            
            if (response.data.imgurl || response.data.avatar) {
              imgurl = response.data.imgurl || response.data.avatar;
            } else if (response.data.data?.imgurl) {
              imgurl = response.data.data.imgurl;
            }
            
            return {
              success: true,
              nickname: name || `用户${this.hideQQNumber(qqnumber)}`,
              avatar: imgurl || `https://q1.qlogo.cn/g?b=qq&nk=${qqnumber}&s=640`,
              uin: qqnumber
            };
          }
        } catch (apiError) {
          continue; // 尝试下一个API
        }
      }
      
      // 所有API都失败，使用默认
      return {
        success: false,
        nickname: `用户${this.hideQQNumber(qqnumber)}`,
        avatar: `https://q1.qlogo.cn/g?b=qq&nk=${qqnumber}&s=640`,
        uin: qqnumber
      };
    } catch (e) {
      console.error(`获取QQ信息失败 (${qqnumber}):`, e.message);
      return {
        success: false,
        nickname: `用户${this.hideQQNumber(qqnumber)}`,
        avatar: `https://q1.qlogo.cn/g?b=qq&nk=${qqnumber}&s=640`,
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

  async downloadImage(url) {
    return new Promise((resolve, reject) => {
      const filename = `avatar_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.jpg`;
      const filePath = path.join(this.tempDir, filename);
      
      const file = fs.createWriteStream(filePath);
      const protocol = url.startsWith('https') ? https : http;
      
      const request = protocol.get(url, (response) => {
        if (response.statusCode !== 200) {
          file.close();
          fs.unlinkSync(filePath);
          reject(new Error(`下载失败: ${response.statusCode}`));
          return;
        }
        
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          // 返回相对路径或base64格式
          const relativePath = path.relative(process.cwd(), filePath);
          resolve(`file:///${relativePath.replace(/\\/g, '/')}`);
        });
      }).on('error', (err) => {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        reject(err);
      });
      
      request.setTimeout(5000, () => {
        request.destroy();
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        reject(new Error('下载超时'));
      });
    });
  }

  async createZanzhuImage(sponsors, stats) {
    try {
      // 这里是图片生成的代码，如果你没有图片生成库，可以先用文字版
      // 这里我先返回一个文字版的图片base64占位符
      
      // 如果你有图片生成需求，可以使用：
      // 1. jimp（轻量级图片处理）
      // 2. canvas
      // 3. sharp
      
      // 暂时返回null，使用文字消息
      return null;
    } catch (error) {
      console.error('生成图片失败:', error);
      return null;
    }
  }

  async showZanzhu(e) {
    try {
      await e.reply('正在整理各位大大的投喂...\n请等一下噢 ⸜(๑\'ᵕ\'๑)⸝⋆*');
      
      const data = await this.getData();
      if (data.length === 0) {
        return await e.reply('暂无赞助数据，快来成为第一个投喂者吧！(๑•̀ㅂ•́)و✧');
      }

      // 获取所有QQ信息
      const qqInfoPromises = data.map(item => this.getQQInfo(item.qqnumber));
      const qqInfoResults = await Promise.allSettled(qqInfoPromises);
      
      const sponsors = [];
      for (let i = 0; i < data.length; i++) {
        const item = data[i];
        const infoResult = qqInfoResults[i];
        let qqInfo;
        
        if (infoResult.status === 'fulfilled') {
          qqInfo = infoResult.value;
        } else {
          qqInfo = {
            success: false,
            nickname: `用户${this.hideQQNumber(item.qqnumber)}`,
            avatar: `https://q1.qlogo.cn/g?b=qq&nk=${item.qqnumber}&s=640`,
            uin: item.qqnumber
          };
        }
        
        sponsors.push({
          ...item,
          qqInfo,
          rank: this.getRankEmoji(i),
          moneyStr: this.formatMoney(item.money),
          hiddenQQ: this.hideQQNumber(item.qqnumber)
        });
      }

      // 创建合并的消息内容
      let message = '';

      // 顶部标题
      message += '┏━━━━━━━━━━━━━━━━━━━━━━━━┓\n';
      message += '┃      🐾 白子の投喂榜 🐾      ┃\n';
      message += '┗━━━━━━━━━━━━━━━━━━━━━━━━┛\n\n';

      // 前10名赞助者
      const displayLimit = Math.min(sponsors.length, 10);
      for (let i = 0; i < displayLimit; i++) {
        const sponsor = sponsors[i];
        
        // 生成等级图标
        let rankIcon = '';
        if (i === 0) rankIcon = '👑 ';
        else if (i === 1) rankIcon = '💎 ';
        else if (i === 2) rankIcon = '✨ ';
        else if (i < 10) rankIcon = '⭐ ';
        
        // 格式化金额颜色
        const money = sponsor.money;
        let moneyColor = '';
        if (money >= 1000) moneyColor = '💰💰💰';
        else if (money >= 500) moneyColor = '💰💰';
        else if (money >= 100) moneyColor = '💰';
        
        message += `${rankIcon}${sponsor.rank} ${sponsor.qqInfo.nickname}\n`;
        message += `  ↳ ID: ${sponsor.hiddenQQ} | ${moneyColor}${sponsor.moneyStr}\n`;
        
        if (i < displayLimit - 1) {
          message += '─'.repeat(24) + '\n';
        }
      }

      // 如果还有更多赞助者
      if (sponsors.length > displayLimit) {
        message += '\n💫 其他赞助者 💫\n';
        for (let i = displayLimit; i < Math.min(sponsors.length, displayLimit + 10); i++) {
          const sponsor = sponsors[i];
          message += `${sponsor.rank} ${sponsor.qqInfo.nickname} - ${sponsor.moneyStr}\n`;
        }
        if (sponsors.length > displayLimit + 10) {
          message += `...等 ${sponsors.length - displayLimit - 10} 位赞助者\n`;
        }
      }

      // 统计信息
      const totalAmount = sponsors.reduce((sum, item) => sum + item.money, 0);
      const totalSponsors = sponsors.length;
      const avgAmount = totalSponsors > 0 ? totalAmount / totalSponsors : 0;
      const maxAmount = sponsors.length > 0 ? Math.max(...sponsors.map(item => item.money)) : 0;

      message += '\n════════════════════════\n';
      message += '📊 投喂统计 📊\n';
      message += '════════════════════════\n';
      message += `✨ 累计金额: ${this.formatMoney(totalAmount)}\n`;
      message += `👥 投喂人数: ${totalSponsors}人\n`;
      message += `📈 人均投喂: ${this.formatMoney(avgAmount)}\n`;
      message += `🏆 最高投喂: ${this.formatMoney(maxAmount)}\n`;
      message += '════════════════════════\n';
      message += '💕 感谢各位大大的支持！ 💕\n';
      message += '© liusu 2024-2026\n';

      // 尝试生成图片版，如果失败则发送文字版
      const imageData = await this.createZanzhuImage(sponsors, {
        totalAmount,
        totalSponsors,
        avgAmount,
        maxAmount
      });

      if (imageData) {
        // 如果有图片数据，发送图片
        await e.reply([segment.image(`base64://${imageData}`)]);
      } else {
        // 发送合并的文字消息
        await e.reply(message);
      }

      // 清理临时文件
      this.cleanOldAvatarFiles();
      
    } catch (err) {
      console.error('showZanzhu 执行失败:', err);
      await e.reply('生成榜单时发生错误，请稍后重试');
    }
  }

  cleanOldAvatarFiles() {
    try {
      if (!fs.existsSync(this.tempDir)) return;
      
      const files = fs.readdirSync(this.tempDir);
      const now = Date.now();
      
      files.forEach(file => {
        if (file.startsWith('avatar_')) {
          const filePath = path.join(this.tempDir, file);
          try {
            const stats = fs.statSync(filePath);
            // 删除1小时前的文件
            if (now - stats.mtimeMs > 3600000) {
              fs.unlinkSync(filePath);
            }
          } catch (e) {
            // 忽略错误
          }
        }
      });
    } catch (err) {
      // 忽略清理错误
    }
  }
}