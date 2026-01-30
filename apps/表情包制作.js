import plugin from '../../../lib/plugins/plugin.js';
import { segment } from "oicq";

const API_CONFIG = {
  TRANSPARENT_AVATAR: qq => `https://api.lolimi.cn/API/preview/t.php?type=1&qq=${qq}`,
  ADVANCED_TEXT_IMAGE: text => `https://api.yuafeng.cn/API/ly/ttf/gjtwhc.php?text=${encodeURIComponent(text)}&imagecolor=false&image=https://api.yuafeng.cn/API/ly/bizhi.php`,
  TEXT_IMAGE: text => `https://api.yuafeng.cn/API/ly/ttf/wztw.php?text=${encodeURIComponent(text)}`,
  PAIR_GENERATOR: (text1, text2) => `https://api.yuafeng.cn/API/ly/ttf/qrj.php?msg1=${encodeURIComponent(text1)}&msg2=${encodeURIComponent(text2)}`,
  HANDHOLD: (qq1, qq2) => `https://api.yuafeng.cn/API/zt/ztg.php?qq1=${qq1}&qq2=${qq2}`,
  QQ_CARD: (qq, qid, name) => `https://api.zxz.ee/api/qqgxmp/?qq=${qq}&qid=${qid}&name=${encodeURIComponent(name)}&type=`,
  SPECIAL_EFFECTS: {
    SHE: qq => `https://api.bi71t5.cn/api/yaoshel.php?QQ=${qq}`,
    KAIDAO: qq => `https://api.bi71t5.cn/api/dfj.php?QQ=${qq}`,
    STRANGE_DRAGON: (a, b) => `https://api.yuafeng.cn/API/lt/api.php?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}&t=2`
  }
};

const VALIDATION = {
  QQ_REGEX: /^\d{5,12}$/,
  TEXT_REGEX: /^[\s\S]{1,50}$/
};

export class zaizaiimagegen extends plugin {
  constructor() {
    super({
      name: 'zaizai:表情包生成',
      event: 'message',
      priority: -Infinity,
      rule: [
        { reg: /^#?透明头像\s*(\d+)$/i, fnc: 'tmtx' },
        { reg: /^#?高级文转图\s+(.+)$/i, fnc: 'gjwzt' },
        { reg: /^#?文转图\s+(.+)$/i, fnc: 'wzt' },
        { reg: /^#?天生一对\s+(\S+)\s+(\S+)$/i, fnc: 'tsyd' },
        { reg: /^#?奇怪龙\s+(\S+)\s+(\S+)$/i, fnc: 'lt' },
        { reg: /^#?牵\s*@(\d+)/i, fnc: 'qian' },
        { reg: /^#?QQ个性名片\s+(\d+)\s+(\d+)\s+([\s\S]+?)$/i, fnc: 'qqCard' }
      ]
    });
  }

  async sendGeneratedImage(e, imageUrl) {
    try {
      const response = await fetch(imageUrl);
      if (!response.ok) throw new Error(`API响应异常 [${response.status}]`);
      return e.reply(segment.image(imageUrl));
    } catch (error) {
      console.error('[图片生成失败]', error);
      return e.reply(`图片生成失败，请检查格式或稍后重试 (${error.message})`);
    }
  }

  async tmtx(e) {
    const qq = e.msg.match(/(\d+)/)[1];
    if (!VALIDATION.QQ_REGEX.test(qq)) return e.reply('请输入5-12位纯数字QQ号');
    return this.sendGeneratedImage(e, API_CONFIG.TRANSPARENT_AVATAR(qq));
  }

  async gjwzt(e) {
    const text = e.msg.replace(/^#?高级文转图\s*/i, '').trim();
    if (!VALIDATION.TEXT_REGEX.test(text)) return e.reply('文本长度需在1-50字符之间');
    return this.sendGeneratedImage(e, API_CONFIG.ADVANCED_TEXT_IMAGE(text));
  }

  async wzt(e) {
    const text = e.msg.replace(/^#?文转图\s*/i, '').trim();
    if (!VALIDATION.TEXT_REGEX.test(text)) return e.reply('文本长度需在1-50字符之间');
    return this.sendGeneratedImage(e, API_CONFIG.TEXT_IMAGE(text));
  }

  async tsyd(e) {
    const [, text1, text2] = e.msg.match(/^#?天生一对\s+(\S+)\s+(\S+)$/i);
    return this.sendGeneratedImage(e, API_CONFIG.PAIR_GENERATOR(text1, text2));
  }

  async qian(e) {
    const targetQQ = e.message.find(msg => msg.type === 'at')?.qq;
    if (!targetQQ) return e.reply('请@需要牵的人');
    return this.sendGeneratedImage(e, API_CONFIG.HANDHOLD(e.user_id, targetQQ));
  }

  async lt(e) {
    const [, text1, text2] = e.msg.match(/^#?奇怪龙\s+(\S+)\s+(\S+)$/i);
    return this.sendGeneratedImage(e, API_CONFIG.SPECIAL_EFFECTS.STRANGE_DRAGON(text1, text2));
  }

  async handleSpecialEffect(e, effectType) {
    const targetQQ = e.message.find(msg => msg.type === 'at')?.qq;
    if (!targetQQ) return e.reply('请@一个人');
    return this.sendGeneratedImage(e, API_CONFIG.SPECIAL_EFFECTS[effectType](targetQQ));
  }
  
  async qqCard(e) {
  const params = e.msg.match(/^#?QQ个性名片\s+(\d+)\s+(\d+)\s+([\s\S]+?)$/i);
  
  if (!params || params.length < 4) {
    return e.reply('格式错误，正确格式：#QQ个性名片 QQ号 qid 名字');
  }
  if (!VALIDATION.QQ_REGEX.test(params[1])) {
    return e.reply('QQ号需5-12位纯数字');
  }
  if (params[3].length > 20) {
    return e.reply('名字长度不超过20字符');
  }

  const apiUrl = API_CONFIG.QQ_CARD(params[1], params[2], params[3]);
  return this.sendGeneratedImage(e, apiUrl);
}
