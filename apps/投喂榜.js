import fs from 'fs';
import path from 'path';
import plugin from '../../../lib/plugins/plugin.js';

// 配置文件路径+自动生成
const zanzhuPath = path.join(process.cwd(), 'plugins', 'baizi-plugin', 'config', 'zanzhu.json');
if (!fs.existsSync(path.dirname(zanzhuPath))) {
  fs.mkdirSync(path.dirname(zanzhuPath), { recursive: true });
}
if (!fs.existsSync(zanzhuPath)) {
  fs.writeFileSync(zanzhuPath, JSON.stringify([], null, 2), 'utf8');
}

export class AddZanzhuPlugin extends plugin {
  constructor() {
    super({
      name: '投喂配置',
      dsc: '增删改投喂记录',
      event: 'message',
      priority: 1,
      rule: [
        {reg: '#投喂添加', fnc: 'addZanzhu'},
        {reg: '#赞助添加', fnc: 'addZanzhu'},
        {reg: '#投喂修改', fnc: 'updateZanzhu'},
        {reg: '#赞助修改', fnc: 'updateZanzhu'},
        {reg: '#投喂删除', fnc: 'deleteZanzhu'},
        {reg: '#赞助删除', fnc: 'deleteZanzhu'}
      ]
    });
  }

  async getData() {
    try {
      let data = JSON.parse(fs.readFileSync(zanzhuPath, 'utf8'));
      let formatData = [];
      for (let i = 0; i < data.length; i++) {
        formatData.push({
          qqnumber: String(data[i].qqnumber),
          money: data[i].money
        });
      }
      return formatData;
    } catch (e) {
      return [];
    }
  }

  async saveData(data) {
    try {
      fs.writeFileSync(zanzhuPath, JSON.stringify(data, null, 2));
    } catch (e) {}
  }

  async checkPerm(e) {
    let senderQQ = String(e.sender.user_id);
    let ownerQQ = '2209176666';
    if (senderQQ !== ownerQQ) {
      await e.reply('仅限主人操作，无权限！');
      return false;
    }
    return true;
  }

  async addZanzhu(e) {
    if (!(await this.checkPerm(e))) return;
    let msg = e.msg.replace('#投喂添加', '').replace('#赞助添加', '').trim();
    let arr = msg.split(':');
    if (arr.length !== 2) {
      return await e.reply('格式：#投喂添加 QQ号:金额');
    }
    let qq = arr[0].trim();
    let money = parseFloat(arr[1].trim());
    if (isNaN(money)) {
      return await e.reply('金额必须是数字！');
    }
    let data = await this.getData();
    let isExist = false;
    for (let i = 0; i < data.length; i++) {
      if (data[i].qqnumber === qq) {
        data[i].money += money;
        isExist = true;
        break;
      }
    }
    if (!isExist) {
      data.push({qqnumber: qq, money: money});
    }
    await this.saveData(data);
    await e.reply('操作成功！');
  }

  async updateZanzhu(e) {
    if (!(await this.checkPerm(e))) return;
    let msg = e.msg.replace('#投喂修改', '').replace('#赞助修改', '').trim();
    let arr = msg.split(':');
    if (arr.length !== 2) {
      return await e.reply('格式：#投喂修改 QQ号:新金额');
    }
    let qq = arr[0].trim();
    let money = parseFloat(arr[1].trim());
    if (isNaN(money)) {
      return await e.reply('金额必须是数字！');
    }
    let data = await this.getData();
    let isFind = false;
    for (let i = 0; i < data.length; i++) {
      if (data[i].qqnumber === qq) {
        data[i].money = money;
        isFind = true;
        break;
      }
    }
    if (!isFind) {
      return await e.reply('未找到该QQ的投喂记录！');
    }
    await this.saveData(data);
    await e.reply('修改成功！');
  }

  async deleteZanzhu(e) {
    if (!(await this.checkPerm(e))) return;
    let qq = e.msg.replace('#投喂删除', '').replace('#赞助删除', '').trim();
    let data = await this.getData();
    let newData = [];
    let isFind = false;
    for (let i = 0; i < data.length; i++) {
      if (data[i].qqnumber !== qq) {
        newData.push(data[i]);
      } else {
        isFind = true;
      }
    }
    if (!isFind) {
      return await e.reply('未找到该QQ的投喂记录！');
    }
    await this.saveData(newData);
    await e.reply('删除成功！');
  }
}