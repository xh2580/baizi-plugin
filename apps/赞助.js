import plugin from '../../../lib/plugins/plugin.js';

export class SponsorPlugin extends plugin {
    constructor() {
        super({
            name: '赞助',
            event: 'message',
            priority: -Infinity,
            rule: [
                {
                    reg: '^#?(赞助|我要赞助|投喂|插入baizi)$',
                    fnc: 'sendSponsorMessage'
                }
            ]
        });
    }

    async sendSponsorMessage(e) {
        const imageUrl = `http://p.qlogo.cn/homework/0/hw_h_38569im5g1kwggk67d5f139660c6/0/25632286`;
        const msg = [segment.image(imageUrl), `感谢👍 `];
        return this.reply(msg, true);
    }
}