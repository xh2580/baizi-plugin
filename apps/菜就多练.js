import plugin from '../../../lib/plugins/plugin.js'

export class PracticeMore extends plugin {
  constructor() {
    super({
      name: '菜就多练',
      dsc: '菜就多练',
      event: 'message',
      priority: -10,
      rule: [
        {
          reg: '^#?菜就多练$',
          fnc: 'practiceMore'
        }
      ]
    })
  }

  async practiceMore(e) {
    logger.info('[baizi-plugin]')
    let voiceFilePath = process.cwd() + "/plugins/baizi-plugin/resources/voice/菜就多练.mp3"
    await this.e.reply(segment.record(voiceFilePath))
    let msg = "输不起就别玩"
    await this.e.reply(msg, true, { at: true })
    return true
  }
}
