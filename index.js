import fs from 'node:fs'

if (!global.segment) {
  global.segment = (await import("oicq")).segment
}


logger.info('\x1b[插件载入成功！！！！！！\x1b[0m')
logger.info('\x1b[作者：baizi\x1b[0m')
logger.info('\x1b[交流群：863644536\x1b[0m')
logger.info('\x1b[34m---------哼哼啊啊啊---------\x1b[0m')


async function loadPlugins() {
  const files = fs
    .readdirSync('./plugins/baizi-plugin/apps')
    .filter(file => file.endsWith('.js'))

  let ret = files.map(file => import(`./apps/${file}`));
  ret = await Promise.allSettled(ret);

  let apps = {}
  for (let i in files) {
    const name = files[i].replace('.js', '')
    if (ret[i].status !== 'fulfilled') {
      logger.error(`\x1b[baizi-plugins载入插件错误：${name}\x1b[0m`)
      logger.error(ret[i].reason)
      continue
    }
    apps[name] = ret[i].value[Object.keys(ret[i].value)[0]]
  }
  return apps
}

export const apps = await loadPlugins()
