import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer';
import plugin from '../../../lib/plugins/plugin.js';
import cfg from '../../../lib/config/config.js';
import axios from 'axios';
import segment from '../../../lib/segment.js';

const zanzhuPath = path.join(process.cwd(), 'plugins', 'baizi-plugin', 'config', 'zanzhu.json');
if (!fs.existsSync(path.dirname(zanzhuPath))) fs.mkdirSync(path.dirname(zanzhuPath), { recursive: true });
if (!fs.existsSync(zanzhuPath)) fs.writeFileSync(zanzhuPath, JSON.stringify([], null, 2), 'utf8');

export class ZanzhuPlugin extends plugin {
  constructor() {
    super({
      name: '投喂榜',
      dsc: '生成投喂榜单截图发送',
      event: 'message',
      priority: -1,
      rule: [
        {reg: '#投喂榜', fnc: 'showZanzhu'},
        {reg: '#赞助榜', fnc: 'showZanzhu'}
      ]
    });
    this.browser = null;
    this.screenshotDir = path.join(process.cwd(), 'data', 'temp');
    if (!fs.existsSync(this.screenshotDir)) fs.mkdirSync(this.screenshotDir, { recursive: true });
  }

  async getData() {
    try {
      let data = JSON.parse(fs.readFileSync(zanzhuPath, 'utf8'));
      return data.sort(function(a,b){return b.money - a.money;});
    } catch (e) {
      return [];
    }
  }

  hideQQNumber(qq) {
    let s = String(qq);
    return s.length<=4?s:s.slice(0,2)+'****'+s.slice(-2);
  }

  async getQQNickname(qq) {
    try {
      let r = await axios.get('http://api.ilingku.com/int/v1/qqname?qq='+qq, {timeout:5000});
      return r.data.code===200?(r.data.name||'未知'):'匿名';
    } catch (e) {
      return '匿名';
    }
  }

  async initBrowser() {
    if(!this.browser){
      try{
        this.browser=await puppeteer.launch({
          headless: true,
          args:['--disable-gpu','--no-sandbox','--disable-dev-shm-usage'],
          executablePath: cfg?.bot?.chromium_path
        });
      }catch(e){return null;}
    }
    return this.browser;
  }

  async generateScreenshot(html) {
    let b=await this.initBrowser();
    if(!b)return null;
    let p=await b.newPage();
    try{
      await p.setViewport({width:550,height:800,deviceScaleFactor:2});
      await p.setContent(html,{waitUntil:'networkidle0'});
      let img=path.join(this.screenshotDir,'zanzhu_'+Date.now()+'.png');
      await p.screenshot({path:img,fullPage:true});
      return img;
    }catch(e){return null;}finally{await p.close();}
  }

  async showZanzhu(e) {
    try{
      let d=await this.getData();
      if(d.length===0)return await e.reply('暂无投喂/赞助数据');
      await e.reply('正在整理投喂数据，请稍等～');
      let total=0,i=0,html='',item='',n='',c='',f='';
      for(i=0;i<d.length;i++){total+=d[i].money;}
      html='<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><style>body{font-family:微软雅黑,宋体,Arial,sans-serif;background:#f8f9fa;padding:20px;margin:0;display:flex;flex-direction:column;align-items:center;}h1{color:#7F5AF0;font-size:24px;margin-bottom:20px;}.card{background:#fff;border-radius:12px;padding:16px;margin-bottom:16px;display:flex;align-items:center;box-shadow:0 4px 12px rgba(0,0,0,0.1);width:100%;max-width:400px;}.rank1{border:2px solid #FFD700;}.rank2{border:2px solid #C0C0C0;}.rank3{border:2px solid #CD7F32;}.total-card{background:#7F5AF0;color:#fff;justify-content:center;text-align:center;}.rank{font-size:24px;margin-right:10px;}.avatar-box{position:relative;width:60px;height:60px;margin-right:16px;}.avatar{width:100%;height:100%;border-radius:50%;border:2px solid #7F5AF0;}.avatar-frame{position:absolute;top:-10px;left:-10px;width:150%;height:150%;background:url(http://8.134.11.131/image/tx.png) no-repeat center/cover;pointer-events:none;}.info{flex:1;}.nick{font-size:16px;font-weight:600;color:#2B2C34;margin-bottom:4px;}.id{font-size:14px;color:#666;margin-bottom:4px;}.money{font-size:16px;font-weight:600;color:#2CB67D;}.total-info{font-size:18px;font-weight:600;}h2{color:#d2d2d2;font-size:12px;margin-top:20px;}</style></head><body><h1>🐾 baizi の投喂榜 🐾</h1><div class="card total-card"><div class="total-info"><div>✿ 总投喂金额：¥'+total.toFixed(2)+'</div><div>✿ 总投喂人数：'+d.length+'</div></div></div>';
      for(i=0;i<d.length;i++){
        item=d[i];n=await this.getQQNickname(item.qqnumber);
        c=i===0?'rank1':i===1?'rank2':i===2?'rank3':'';
        f=i<3?'<div class="avatar-frame"></div>':'';
        html+='<div class="card '+c+'"><div class="rank">'+(i+1)+'</div><div class="avatar-box"><img src="http://q1.qlogo.cn/g?b=qq&nk='+item.qqnumber+'&s=100" class="avatar">'+f+'</div><div class="info"><div class="nick">昵称：'+n+'</div><div class="id">ID：'+this.hideQQNumber(item.qqnumber)+'</div><div class="money">投喂：¥'+item.money.toFixed(2)+'</div></div></div>';
      }
      html+='<h2>© liusu 2024-2025</h2></body></html>';
      let img=await this.generateScreenshot(html);
      if(!img)return await e.reply('截图生成失败，请稍后重试');
      await e.reply([segment.image('file:///'+img)]);
    }catch(e){
      await e.reply('投喂榜加载失败，请稍后重试');
    }
  }
}

export class AddZanzhuPlugin extends plugin {
  constructor() {
    super({
      name: '投喂配置',
      dsc: '增删改投喂/赞助记录',
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
      let d=JSON.parse(fs.readFileSync(zanzhuPath, 'utf8')),f=[],i=0;
      for(i=0;i<d.length;i++){
        f.push({qqnumber:String(d[i].qqnumber),money:d[i].money});
      }
      return f;
    } catch (e) {
      return [];
    }
  }

  async saveData(d) {
    try{
      fs.writeFileSync(zanzhuPath, JSON.stringify(d, null, 2));
    }catch(e){}
  }

  async checkPerm(e) {
    let q=String(e.sender.user_id);
    if(q!=='2209176666'){
      await e.reply('您没有权限执行此操作，仅限主人操作。');
      return false;
    }
    return true;
  }

  async addZanzhu(e) {
    if(!(await this.checkPerm(e)))return;
    let m=e.msg.replace('#投喂添加','').replace('#赞助添加','').trim().split(':'),q='',mo=0,d=[],i=0,f=false;
    if(m.length!==2){return await e.reply('指令格式错误：#投喂添加 QQ号:金额');}
    q=m[0].trim();mo=parseFloat(m[1].trim());
    if(isNaN(mo)){return await e.reply('金额格式错误，请输入有效数字');}
    d=await this.getData();
    for(i=0;i<d.length;i++){
      if(d[i].qqnumber===q){d[i].money+=mo;f=true;break;}
    }
    if(!f){d.push({qqnumber:q,money:mo});}
    await this.saveData(d);
    await e.reply(`操作成功！QQ:${q} 累计投喂金额：¥${f?d.find(item=>item.qqnumber===q).money.toFixed(2):mo.toFixed(2)}`);
  }

  async updateZanzhu(e) {
    if(!(await this.checkPerm(e)))return;
    let m=e.msg.replace('#投喂修改','').replace('#赞助修改','').trim().split(':'),q='',mo=0,d=[],i=0,f=false;
    if(m.length!==2){return await e.reply('指令格式错误：#投喂修改 QQ号:新金额');}
    q=m[0].trim();mo=parseFloat(m[1].trim());
    if(isNaN(mo)){return await e.reply('金额格式错误，请输入有效数字');}
    d=await this.getData();
    for(i=0;i<d.length;i++){
      if(d[i].qqnumber===q){d[i].money=mo;f=true;break;}
    }
    if(!f){return await e.reply(`未找到QQ:${q} 的投喂/赞助记录`);}
    await this.saveData(d);
    await e.reply(`修改成功！QQ:${q} 投喂金额已更新为：¥${mo.toFixed(2)}`);
  }

  async deleteZanzhu(e) {
    if(!(await this.checkPerm(e)))return;
    let q=e.msg.replace('#投喂删除','').replace('#赞助删除','').trim(),d=[],nd=[],i=0,f=false;
    d=await this.getData();
    for(i=0;i<d.length;i++){
      if(d[i].qqnumber===q){f=true;}else{nd.push(d[i]);}
    }
    if(!f){return await e.reply(`未找到QQ:${q} 的投喂/赞助记录`);}
    await this.saveData(nd);
    await e.reply(`删除成功！已移除QQ:${q} 的所有投喂/赞助记录`);
  }
}