import fs from 'fs';
import path from 'path';
import plugin from '../../../lib/plugins/plugin.js';

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
      rule: [{reg: '#投喂添加', fnc: 'addZanzhu'}, {reg: '#赞助添加', fnc: 'addZanzhu'}, {reg: '#投喂修改', fnc: 'updateZanzhu'}, {reg: '#赞助修改', fnc: 'updateZanzhu'}, {reg: '#投喂删除', fnc: 'deleteZanzhu'}, {reg: '#赞助删除', fnc: 'deleteZanzhu'}]
    });
  }

  async getData() {
    try {
      let d=JSON.parse(fs.readFileSync(zanzhuPath, 'utf8')),f=[],i=0;
      for(i=0;i<d.length;i++){f.push({qqnumber:String(d[i].qqnumber),money:d[i].money});}
      return f;
    } catch (e) {
      return [];
    }
  }

  async saveData(d) {
    try{fs.writeFileSync(zanzhuPath, JSON.stringify(d, null, 2));}catch(e){}
  }

  async checkPerm(e) {
    let q=String(e.sender.user_id);
    if(q!=='2209176666'){await e.reply('仅限主人操作');return false;}
    return true;
  }

  async addZanzhu(e) {
    if(!(await this.checkPerm(e)))return;
    let m=e.msg.replace('#投喂添加','').replace('#赞助添加','').trim().split(':'),q='',mo=0,d=[],i=0,f=false;
    if(m.length!==2){return await e.reply('格式：#投喂添加 QQ号:金额');}
    q=m[0].trim();mo=parseFloat(m[1].trim());
    if(isNaN(mo)){return await e.reply('金额必须是数字');}
    d=await this.getData();
    for(i=0;i<d.length;i++){
      if(d[i].qqnumber===q){d[i].money+=mo;f=true;break;}
    }
    if(!f){d.push({qqnumber:q,money:mo});}
    await this.saveData(d);
    await e.reply('操作成功');
  }

  async updateZanzhu(e) {
    if(!(await this.checkPerm(e)))return;
    let m=e.msg.replace('#投喂修改','').replace('#赞助修改','').trim().split(':'),q='',mo=0,d=[],i=0,f=false;
    if(m.length!==2){return await e.reply('格式：#投喂修改 QQ号:新金额');}
    q=m[0].trim();mo=parseFloat(m[1].trim());
    if(isNaN(mo)){return await e.reply('金额必须是数字');}
    d=await this.getData();
    for(i=0;i<d.length;i++){
      if(d[i].qqnumber===q){d[i].money=mo;f=true;break;}
    }
    if(!f){return await e.reply('未找到该记录');}
    await this.saveData(d);
    await e.reply('修改成功');
  }

  async deleteZanzhu(e) {
    if(!(await this.checkPerm(e)))return;
    let q=e.msg.replace('#投喂删除','').replace('#赞助删除','').trim(),d=[],nd=[],i=0,f=false;
    d=await this.getData();
    for(i=0;i<d.length;i++){
      if(d[i].qqnumber===q){f=true;}else{nd.push(d[i]);}
    }
    if(!f){return await e.reply('未找到该记录');}
    await this.saveData(nd);
    await e.reply('删除成功');
  }
}