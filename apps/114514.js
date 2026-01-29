import plugin from '../../../lib/plugins/plugin.js'

export class example extends plugin {
    constructor () {
      super({
        name: 'baizi',
        dsc: '太臭了',
        event: 'message',
        priority: -10,
        rule: [
          {
            reg: '^#?114514$',
            fnc: '114514'
          }
        ]
      })
    }
    async 114514 (e) {
      logger.info('[baizi.js插件]')
      let url = encodeURI(`https://img.kookapp.cn/attachments/2024-01/14/65a3b36237503.mp3`)
      await this.e.reply(segment.record(url))
      return;
    }
  }