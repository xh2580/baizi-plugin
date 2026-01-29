import { Restart } from "../../../plugins/other/restart.js"
import plugin from '../../../lib/plugins/plugin.js'

let insing = false
const list = {
  "Atlas":"https://gitee.com/Nwflower/atlas",
  "genshin"  :"https://gitee.com/TimeRainStarSky/Yunzai-genshin",
  "Bili-Plugin":"https://gitee.com/nennen-cn/Bili-Plugin",
  "ws-plugin":"https://gitee.com/xiaoye12123/ws-plugin",
  "TRSS-Plugin"   :"https://gitee.com/qsyhh/TRSS-Plugin",
  "bililivePush-plugin"   :"https://gitee.com/HDTianRu/bililivePush-plugin",
  "Guoba-Plugin"  :"https://gitee.com/guoba-yunzai/guoba-plugin",
  "yenai-plugin"  :"https://gitee.com/yeyang52/yenai-plugin",
  "flower-plugin" :"https://gitee.com/Nwflower/flower-plugin",
  "FanSky_Qs" :"https://gitee.com/FanSky_Qs/FanSky_Qs",
  "earth-k-plugin":"https://gitee.com/SmallK111407/earth-k-plugin",
  "liangshi-calc":"https://gitee.com/liangshi233/liangshi-calc",
  "mora-plugin"   :"https://gitee.com/Rrrrrrray/mora-plugin",
  "xiaoyao-cvs-plugin":"https://gitea.com/Ctrlcvs/xiaoyao-cvs-plugin",
  "rconsole-plugin"   :"https://gitee.com/kyrzy0416/rconsole-plugin",
  "waves-plugin"   :"https://gh.xiaohuanya.top/https://github.com/erzaozi/waves-plugin",
  "xiaofei-plugin"   :"https://gitee.com/xfdown/xiaofei-plugin",
  "Yunzai-QQBot-plugin":"https://gitee.com/xiaoye12123/Yunzai-QQBot-Plugin",
  "ZZZ-Plugin"  :"https://gh.xiaohuanya.top/https://github.com/ZZZure/ZZZ-Plugin",
  "ICQQ-Plugin"   :"https://gitee.com/TimeRainStarSky/Yunzai-ICQQ-Plugin",
}
const map = {}
for (const i in list)
  map[i.replace(/-[Pp]lugin$/, "")] = i

export class install extends plugin {
  constructor() {
    super({
      name: "安装插件",
      dsc: "#安装插件 #安装TRSS-Plugin",
      event: "message",
      priority: -Infinity,
      rule: [
        {
          reg: `^#baizi安装(插件|${Object.keys(map).join("|")})(-[Pp]lugin)?$`,
          fnc: "install",
          permission: "master"
        }
      ]
    })
  }

  async install() {
    if (insing) {
      await this.reply("正在安装，请稍候再试")
      return false
    }

    let name = this.e.msg.replace(/^#baizi安装(.+?)(-[Pp]lugin)?$/, "$1")
    if (map[name]) name = map[name]

    if (name == "插件") {
      let msg = "\n"
      for (const i in list)
        if (!await Bot.fsStat(`plugins/${i}`))
          msg += `${i}\n`

      if (msg == "\n")
        msg = "暂无可安装插件"
      else
        msg = `可安装插件列表：${msg}发送 #baizi安装+插件名 进行安装`

      await this.reply(msg)
      return true
    }

    const path = `plugins/${name}`
    if (await Bot.fsStat(path)) {
      await this.reply(`${name} 插件已安装`)
      return false
    }
    return this.runInstall(name, list[name], path)
  }

  async runInstall(name, url, path) {
    logger.mark(`${this.e.logFnc} 开始安装 ${name} 插件`)
    await this.reply(`开始安装 ${name} 插件`)

    insing = true
    const ret = await Bot.exec(`git clone --depth 1 --single-branch "${url}" "${path}"`)
    if (await Bot.fsStat(`${path}/package.json`))
      await Bot.exec("pnpm install")
    insing = false

    if (ret.error) {
      logger.mark(`${this.e.logFnc} ${name} 插件安装错误`)
      this.gitErr(name, ret.error.message, ret.stdout)
      return false
    }
    return this.restart()
  }

  gitErrUrl(error) {
    return error.replace(/(Cloning into|正克隆到)\s*'.+?'/g, "").match(/'(.+?)'/g)[0].replace(/'(.+?)'/, "$1")
  }

  async gitErr(name, error, stdout) {
    if (/unable to access|无法访问/.test(error))
      await this.reply(`远程仓库连接错误：${this.gitErrUrl(error)}`)
    else if (/not found|未找到|does not (exist|appear)|不存在|Authentication failed|鉴权失败/.test(error))
      await this.reply(`远程仓库地址错误：${this.gitErrUrl(error)}`)
    else await this.reply(`${name} 插件安装错误\n${error}\n${stdout}`)
  }

  restart() {
    return new Restart(this.e).restart()
  }
}