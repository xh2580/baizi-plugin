import fs from 'fs';
import path from 'path';
import plugin from '../../../lib/plugins/plugin.js';

// 赞助数据文件路径
const zanzhuPath = path.join(process.cwd(), 'plugins', 'baizi-plugins', 'config', 'zanzhu.json');

export class AddZanzhuPlugin extends plugin {
  constructor() {
    super({
      name: '赞助管理',
      dsc: '添加、修改或删除赞助记录',
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
        }
      ]
    });

    console.log('AddZanzhuPlugin 已加载');
    console.log('赞助数据文件路径:', zanzhuPath);
    console.log('文件是否存在:', fs.existsSync(zanzhuPath));
  }

  /** 读取赞助数据，并将 qqnumber 转换为字符串 */
  async getData() {
    try {
      const data = JSON.parse(fs.readFileSync(zanzhuPath, 'utf8'));
      // 将 qqnumber 转换为字符串
      const formattedData = data.map(item => ({
        qqnumber: String(item.qqnumber),
        money: item.money
      }));
      console.log('读取到的赞助数据:', formattedData);
      return formattedData;
    } catch (e) {
      console.error('读取赞助数据失败:', e.message);
      return [];
    }
  }

  /** 保存赞助数据 */
  async saveData(data) {
    try {
      fs.writeFileSync(zanzhuPath, JSON.stringify(data, null, 2));
      console.log('数据保存成功:', data);
    } catch (e) {
      console.error('保存赞助数据失败:', e.message);
    }
  }

  /** 检查权限 */
  async checkPermission(e) {
    const senderQQ = e.sender.user_id.toString();
    const ownerQQ = '2209176666';
    if (senderQQ !== ownerQQ) {
      console.log('权限不足，发送者QQ:', senderQQ);
      await e.reply('您没有权限执行此操作，仅限主人操作。');
      return false;
    }
    console.log('权限通过，发送者QQ:', senderQQ);
    return true;
  }

  /** 添加或更新赞助记录 */
  async addZanzhu(e) {
    console.log('进入 addZanzhu 方法，收到消息:', e.msg);
    if (!(await this.checkPermission(e))) return;

    const match = e.msg.match(/^#?赞助添加\s*(\d+):(\d+(\.\d+)?)$/);
    console.log('匹配结果:', match);
    if (!match) {
      await e.reply('指令格式错误，请使用：#赞助添加 QQ号:金额');
      return;
    }

    const qqnumber = match[1];
    const money = parseFloat(match[2]);
    console.log('解析结果 - qqnumber:', qqnumber, 'money:', money);

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

  /** 修改赞助记录 */
  async updateZanzhu(e) {
    console.log('进入 updateZanzhu 方法，收到消息:', e.msg);
    if (!(await this.checkPermission(e))) return;

    const match = e.msg.match(/^#?赞助修改\s*(\d+):(\d+(\.\d+)?)$/);
    console.log('匹配结果:', match);
    if (!match) {
      await e.reply('指令格式错误，请使用：#赞助修改 QQ号:新金额');
      return;
    }

    const qqnumber = match[1];
    const newMoney = parseFloat(match[2]);
    console.log('解析结果 - qqnumber:', qqnumber, 'newMoney:', newMoney);

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

  /** 删除赞助记录 */
  async deleteZanzhu(e) {
    console.log('进入 deleteZanzhu 方法，收到消息:', e.msg);
    if (!(await this.checkPermission(e))) return;

    const match = e.msg.match(/^#?赞助删除\s*(\d+)$/);
    console.log('匹配结果:', match);
    if (!match) {
      await e.reply('指令格式错误，请使用：#赞助删除 QQ号');
      return;
    }

    const qqnumber = match[1];
    console.log('解析结果 - qqnumber:', qqnumber);

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
}
