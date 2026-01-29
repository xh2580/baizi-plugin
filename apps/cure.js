import plugin from '../../../lib/plugins/plugin.js'
import cfg from '../../../lib/config/config.js'
import fs from "fs";
import path from "path";
const __dirname = path.resolve();

export class example extends plugin {
      constructor () {
      super({
      name: '随机治愈文案',
      dsc: '随机文案',
      event: 'message', 
      priority: -10,
     rule: [
    {
     reg: '^#?随机治愈文案',
     fnc: 'cure'
    }
   ]
 });
}

    async cure(e) {
    let buttons = [
      [
        {
          text: '再来一个',
          callback: '/随机治愈文案',
          send: true,
        },
        ],
        [
        {
          text: '返回菜单',
          callback: '/帮助',
          send: true,
        },
        {
          text: 'emo文案',
          callback: '/随机emo文案',
          send: true,
        },
      ],
    ];
   const filePath = path.join(__dirname, 'plugins/baizi-plugin/resources/Text/cure.txt');
   const fileContent = await fs.promises.readFile(filePath, { encoding: 'utf-8' });
   //异步读取文件内容
   const lines = fileContent.trim().split('\n'); // 将内容按行分割，并去除末尾空白行

   // 随机选择一行文本并发送
   const randomIndex = Math.floor(Math.random() * lines.length); // 生成随机数作为数组下标
   const msg = lines[randomIndex]; // 获取随机行文本内容
   const formattedMsg = msg.replace(/\n/g, "");
   e.reply([
      msg,
      segment.button(...buttons),
    ]); // 发送文本消息

  return; // 返回 true 表示已处理事件 也就是阻挡消息不再往下
 }
}