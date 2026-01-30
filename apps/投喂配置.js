import fs from 'fs';
import path from 'path';
import plugin from '../../../lib/plugins/plugin.js';

const zanzhuPath = path.join(process.cwd(), 'plugins', 'baizi-plugin', 'config', 'zanzhu.json');
if (!fs.existsSync(path.dirname(zanzhuPath))) fs.mkdirSync(path.dirname(zanzhuPath), { recursive: true });
if (!fs.existsSync(zanzhuPath)) fs.writeFileSync(zanzhuPath, JSON.stringify([], null, 2), 'utf8');

export class AddZanzhuPlugin extends plugin {
  constructor() {
    super({
      name: '投喂管理',
      dsc: '增删改投喂记录',
      event: 'message',
      priority: 1,
      rule: [
        { reg: '^#?(赞助|投喂)添加(\\d+):([0-9.]+)$', fnc: 'addZanzhu' },
        { reg: '^#?(赞助|投喂)修改(\\d+):([0-9.]+)$', fnc: 'updateZanzhu' },
        { reg: '^#?(赞助|投喂)删除(\\d+)$', fnc: 'deleteZanzhu' }
      ]
    });
  }

  async getData() {
    try {
      return JSON.parse(fs.readFileSync(zanzhuPath, 'utf8')).map(i => ({
        qqnumber: String(i.qqnumber),
        money: i.money
      }));
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
    const qq = String(e.sender.user_id);
    if (qq !== '2209176666') {
      await e.reply('您没有权限执行此操作，仅限主人操作。');
      return false;
    }
    return true;
  }

  async addZanzhu(e) {
    if (!(await this.checkPerm(e))) return;
    const m = e.msg.match(/^#?(赞助|投喂)添加(\\d+):([0-9.]+)$/);
    if (!m) return await e.reply('格式错误：#投喂添加QQ号:金额');
    const qq = m[2], money = parseFloat(m[3]);
    if (isNaN(money)) return await e.reply('金额格式错误');
    const data = await this.getData();
    const idx = data.findIndex(i => i.qqnumber === qq);
    if (idx > -1) {
      data[idx].money += money;
      await this.saveData(data);
      return await e.reply(`已更新QQ:${qq} 投喂金额，累计：¥${data[idx].money.toFixed(2)}`);
    } else {
      data.push({ qqnumber: qq, money: money });
      await this.saveData(data);
      return await e.reply(`已添加QQ:${qq} 投喂金额：¥${money.toFixed(2)}`);
    }
  }

  async updateZanzhu(e) {
    if (!(await this.checkPerm(e))) return;
    const m = e.msg.match(/^#?(赞助|投喂)修改(\\d+):([0-9.]+)$/);
    if (!m) return await e.reply('格式错误：#投喂修改QQ号:新金额');
    const qq = m[2], money = parseFloat(m[3]);
    if (isNaN(money)) return await e.reply('金额格式错误');
    const data = await this.getData();
    const idx = data.findIndex(i => i.qqnumber === qq);
    if (idx === -1) return await e.reply('未找到该QQ的投喂记录');
    data[idx].money = money;
    await this.saveData(data);
    await e.reply(`已修改QQ:${qq} 投喂金额为：¥${money.toFixed(2)}`);
  }

  async deleteZanzhu(e) {
    if (!(await this.checkPerm(e))) return;
    const m = e.msg.match(/^#?(赞助|投喂)删除(\\d+)$/);
    if (!m) return await e.reply('格式错误：#投喂删除QQ号');
    const qq = m[2];
    const data = await this.getData();
    const idx = data.findIndex(i => i.qqnumber === qq);
    if (idx === -1) return await e.reply('未找到该QQ的投喂记录');
    data.splice(idx, 1);
    await this.saveData(data);
    await e.reply(`已删除QQ:${qq} 的投喂记录`);
  }
}