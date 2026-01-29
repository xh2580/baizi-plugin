import yaml from 'yaml';
import fs from 'fs';
import fetch from 'node-fetch';
import https from 'https';
import axios from 'axios';
import moment from 'moment';

const _path = process.cwd();
const CONFIG_PATH = `${_path}/data/ymconfig/config.yaml`;
const agent = new https.Agent({
    rejectUnauthorized: false
});

/**
 * 解析yaml文件
 * @returns {Object}
 * @example
 * const config = yamlParse();
 * console.log(config);
 */

export function 解析亦米插件yaml() {
    const file = fs.readFileSync(CONFIG_PATH, 'utf8');
    return yaml.parse(file);
 }

/**
 * 保存yaml文件
 * @param {string} path 文件路径
 * @param {Object} configObject 配置对象
 * @example
 * const config = yamlParse();
 * config.xxx = 'xxx';
 * 保存yaml(CONFIG_PATH, config);
 * 
 */

export async function 保存yaml(path, configObject) {
    try {
        const yamlContent = yaml.stringify(configObject);
        fs.writeFileSync(path, yamlContent, 'utf8');
    } catch (error) {
        console.error(`保存配置时出错: ${error.message}`);
    }
}

/**
 * 解析网页text
 * @param {string} url 网页链接
 * @returns {string}
 * @example
 * const text = await 解析网页text('https://www.baidu.com');
 * console.log(text);
 * 
 */
export async function 解析网页text(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`网络响应错误，状态码: ${response.status}`);
        }
        return await response.text();
    } catch (error) {
        throw new Error(`请求失败: ${error.message}`);
    }
}

/**
 * 解析网页json
 * @param {string} url 网页链接
 * @returns {Object}
 * @example
 * const json = await 解析网页json('https://www.baidu.com');
 * console.log(json);
 * 
 */
export async function 解析网页json(url) {
    try {
        const response = await axios.get(url, {
            httpsAgent: agent,
            timeout: 5000
        });
        return response.data;
    } catch (error) {
        console.error('请求详细错误:', error);
        throw new Error(`请求失败: ${error.message}`);
    }
}

/**
 * 转发消息
 * @param {Object} e 事件对象
 * @param {Array} ys 消息对象数组
 * @param {string} tl 标题
 * @param {Array} cl 标题内容数组
 */
export async function makemsg(e, ys, tl, cl) {
    if (!Array.isArray(ys)) {
      if (ys) {
        ys = [ys];
      } else {
        logger.warn('makemsg: ys 参数为空或未定义');
        return;
      }
    }
  
    try {
      let summary;
      try {
        const res = await fetch('https://v1.hitokoto.cn')
          .then(response => response.status !== 403 ? response.json() : null)
          .catch(err => logger.error(err));
        summary = res ? res.hitokoto.replace(/。/g, '+') : moment().format('HH:mm:ss.SSS.');
      } catch (error) {
        summary = moment().format('HH:mm:ss.SSS.');
      }
      let rawObj = null;
      if (e.group) {
        rawObj = e.group.raw || e.group;
      } else if (e.friend) {
        rawObj = e.friend.raw || e.friend;
      } else if (e.raw) {
        rawObj = e.raw;
      }
      if (!rawObj) {
        if (e.isGroup && e.group_id) {
          const bot = Bot || global.Bot;
          if (bot) {
            rawObj = bot.pickGroup(e.group_id);
          }
        } else if (!e.isGroup && e.user_id) {
          const bot = Bot || global.Bot;
          if (bot) {
            rawObj = bot.pickFriend(e.user_id);
          }
        }
      }
      if (!rawObj || typeof rawObj.makeForwardMsg !== 'function') {
        throw new Error('无法使用高级转发方式，将使用普通转发');
      }
      const ngm = await rawObj.makeForwardMsg(ys);
      
      if (ngm && typeof ngm.data === 'object') {
        if (ngm.data.meta && ngm.data.meta.detail) {
          Object.assign(ngm.data.meta.detail, { news: [{ text: `${cl}` }], source: tl, summary });
        } else if (ngm.data.meta) {
          ngm.data.meta.detail = { news: [{ text: `${cl}` }], source: tl, summary };
        } else {
          ngm.data.meta = { detail: { news: [{ text: `${cl}` }], source: tl, summary } };
        }
        
        ngm.data.prompt = `${tl}`;
      }
      await e.reply(ngm);
      logger.mark(`『${tl}』`);
    } catch (error) {
      logger.warn(`高级转发消息生成失败，使用兼容模式: ${error.message}`);
      
      try {
        const nickname = Bot.nickname;
        const user_id = Bot.uin;
  
        const forwardMessages = ys.map((msg, idx) => ({
          message: msg,
          nickname,
          user_id,
          time: Math.floor(Date.now() / 1000) + idx
        }));
  
        let forwardMsg;
        if (e.isGroup && typeof e.group?.makeForwardMsg === 'function') {
          forwardMsg = await e.group.makeForwardMsg(forwardMessages);
        } else if (!e.isGroup && typeof e.friend?.makeForwardMsg === 'function') {
          forwardMsg = await e.friend.makeForwardMsg(forwardMessages);
        } else if (typeof e.makeForwardMsg === 'function') {
          forwardMsg = await e.makeForwardMsg(forwardMessages);
        } else {
          for (let msg of ys) {
            await e.reply(msg);
          }
          logger.mark(`『${tl}』(单条发送)`);
          return;
        }
  
        await e.reply(forwardMsg);
        logger.mark(`『${tl}』(兼容模式)`);
      } catch (fallbackError) {
        logger.error(`兼容模式转发失败: ${fallbackError.message}`);
        for (let msg of ys) {
          await e.reply(msg);
        }
        logger.mark(`『${tl}』(单条发送)`);
      }
    }
  }
  
  /**
   * 转发消息包装函数
   * @param {Object} e 事件对象
   * @param {Array} messages 消息数组
   * @param {string} title 标题
   * @param {Array} entitle 标题内容数组
   */
  export async function 发聊天记录(e, messages, title, entitle) {
    const formatMessages = [];
    const nickname = Bot.nickname;
    const user_id = Bot.uin;
    
    messages.forEach((msg, idx) => {
      formatMessages.push({
        message: msg,
        nickname,
        user_id,
        time: Math.floor(Date.now() / 1000) + idx + 1,
      });
    });
    
    await makemsg(e, formatMessages, title, entitle);
  }