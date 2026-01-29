let voiceFilePath = process.cwd() + "/plugins/baizi-plugin/resources/voice/小心心传奇.mp3";

export class VoiceMessageSender extends plugin {
    constructor() {
        super({
            name: '小心心传奇',
            dsc: '非常的厉害',
            event: 'message',
            priority: -10,
            rule: [
                {
                    reg: '^小心心传奇$',
                    fnc: 'sendVoiceMessage'
                }
            ]
        })
    }

    async sendVoiceMessage(e) {
        logger.info('[小心心传奇.js插件]');
        await this.e.reply(segment.record(voiceFilePath));
    }
}
