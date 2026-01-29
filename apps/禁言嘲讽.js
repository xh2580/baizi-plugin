import { segment } from 'oicq';
import plugin from '../../../lib/plugins/plugin.js';
import { Config} from '../components/index.js'

export class example extends plugin {
    constructor() {
        super({
            name: 'ban',
            dsc: 'ban',
            event: 'notice.group.ban',
            priority: -10,
            rule: [
                {
                    reg: '',
                    fnc: 'ban'
                }
            ]
        });
    }

    async ban(e) {
    if(!Config.getConfig('set','sz')['jycf']){return false}
    if (e.duration === 0){return false}
        let msg = `\n你怎么不说话了 是因为不喜欢吗？`
        msg = e.user_id? `\n你怎么不说话了 是因为不喜欢吗？` : `\n你们怎么不说话了 是因为不喜欢吗？`
            if (e.sub_type === 'ban') {
            logger.info('[让我看看谁被禁言了]');
            e.reply([
                segment.at(e.user_id),
                msg
            ]);
            return false
        }
        return false
    }
}