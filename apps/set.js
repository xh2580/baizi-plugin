import plugin from '../../../lib/plugins/plugin.js'
import lodash from 'lodash'
import { Config, Common } from '../components/index.js'
import loader from '../../../lib/plugins/loader.js'
import moment from 'moment'
const cfgMap = {
	'戳一戳类型': 'sz.cyclx',
	'戳一戳': 'sz.cyc',
	'禁言嘲讽': 'sz.jycf',
};

const CfgReg = `^#?(baizi|白子)(插件)?设置\\s*(${lodash.keys(cfgMap).join('|')})?\\s*(.*)$`;

export class setting extends plugin {
	constructor() {
		super({
			name: 'baizi插件设置',
			dsc: '插件设置',
			event: 'message',
			priority: -10,
			rule: [
				{
					reg: CfgReg,
					fnc: 'message',
					permission: 'master'
				}
			]
		});
	}

	async message() {
		return await set(this.e);
	}
}


async function set(e) {
	let reg = new RegExp(CfgReg).exec(e.msg);

	if (reg && reg[2]) {
		let val = reg[3] || '';
		let cfgKey = cfgMap[reg[2]];
		if (cfgKey == 'sz.cyclx') {
			let cyclx = ['白圣女','随机少女文本'];
			if (!cyclx.includes(val)) {
				e.reply('不支持的戳一戳类型', true);
				return true;
			}
		} else if (val.includes('开启') || val.includes('关闭')) {
			val = !/关闭/.test(val);
		} else {
			cfgKey = '';
		}

		if (cfgKey) {
			setCfg(cfgKey, val);
		}
	}


	let cfg = {};
	for (let name in cfgMap) {
		let key = cfgMap[name].split('.')[1];
		cfg[key] = getStatus(cfgMap[name]);
	}

	// 渲染图像
	return await Common.render('admin/index', {
		...cfg
	}, { e, scale: 1 });

}

function setCfg(rote, value, def = false) {
	let arr = rote?.split('.') || [];
	if (arr.length > 0) {
		let type = arr[0], name = arr[1];
		let data = Config.getYaml('set', type, def ? 'defSet' : 'config') || {};
		data[name] = value;
		Config.save('set', type, def ? 'defSet' : 'config', data);
	}
}

const getStatus = function (rote, def = false) {
	let _class = 'cfg-status';
	let value = '';
	let arr = rote?.split('.') || [];
	if (arr.length > 0) {
		let type = arr[0], name = arr[1];
		let data = Config.getYaml('set', type, def ? 'defSet' : 'config') || {};
		if (data[name] == true || data[name] == false) {
			_class = data[name] == false ? `${_class}  status-off` : _class;
			value = data[name] == true ? '已开启' : '已关闭';
		} else {
			value = data[name];
		}
	}
	if (!value) {
		if (rote == 'sz.cyclx') {
			value = '白圣女';
		} else {
			_class = `${_class}  status-off`;
			value = '已关闭';
		}
	}

	return `<div class="${_class}">${value}</div>`;
}