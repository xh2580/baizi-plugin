import plugin from '../../../lib/plugins/plugin.js'
import { spawn } from 'child_process'
import util from 'util'
import os from 'os'
import fs from 'fs'
import path from 'path'
import http from 'http'
import crypto from 'crypto'
import SystemUtils from '../conponents/system-utils.js'
import { makemsg } from '../conponents/utils.js'
import { takeScreenshot } from '../conponents/shot.js';

let server = null
const PORT = 35798
const activeSessions = new Map()
setInterval(() => {
  const now = Date.now()
  for (const [key, expiry] of activeSessions.entries()) {
    if (now > expiry) {
      activeSessions.delete(key)
    }
  }
}, 60000)

export class SystemMonitor extends plugin {
  constructor() {
    super({
      name: '系统监控',
      dsc: '查看系统的运行状态',
      event: 'message',
      priority: 5000,
      rule: [
        {
          reg: '^#?(baizi|baizi)面板$',
          fnc: 'openStatusPanel',
          permission: 'master'
        },
        {
          reg: '^#baizi状态$',
          fnc: 'sendSimpleStatus',
          permission: 'master'
        },
        {
          reg: '^#baizi状态pro$',
          fnc: 'sendDetailedStatus',
          permission: 'master'
        }
      ]
    })

    this.webRoot = path.join(process.cwd(), 'plugins', 'baizi-plugin', 'resources', 'zhuangtai')
    this.outputDir = path.join(process.cwd(), 'plugins', 'baizi-plugin', 'resources', 'zhuangtai', 'status-output')

    // 创建输出目录
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  // 生成安全令牌
  generateSecureToken() {
    return crypto.randomBytes(6).toString('hex')
  }

  // 获取访问URL
  async getAccessUrl() {
    const ipServices = [
      'http://ifconfig.me/ip'
    ]

    const token = this.generateSecureToken()
    activeSessions.set(token, Date.now() + 600000)

    const tryGetIP = async (url) => {
      try {
        return await new Promise((resolve, reject) => {
          const req = http.get(url, { timeout: 5000 }, (res) => {
            if (res.statusCode !== 200) {
              reject(new Error(`HTTP ${res.statusCode}`))
              return
            }
            
            let data = ''
            res.on('data', chunk => data += chunk)
            res.on('end', () => resolve(data.trim()))
          })
          
          req.on('error', reject)
          req.on('timeout', () => {
            req.destroy()
            reject(new Error('请求超时'))
          })
        })
      } catch (error) {
        throw error
      }
    }

    for (const service of ipServices) {
      try {
        const publicIP = await tryGetIP(service)
        if (/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(publicIP)) {
          const parts = publicIP.split('.').map(Number)
          const isPrivate = 
            parts[0] === 10 || 
            (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
            (parts[0] === 192 && parts[1] === 168)
              
          if (!isPrivate) {
            console.log(`成功从 ${service} 获取公网IP`)
            return `http://${publicIP}:${PORT}/${token}`
          }
        }
      } catch (error) {
        console.log(`从 ${service} 获取IP失败:`, error.message)
        continue
      }
    }
  
    // 尝试获取本地网络IP
    console.log('获取公网IP失败，回退到本地IP')
    try {
      const networkInterfaces = os.networkInterfaces()
      const validInterfaces = []
      for (const [name, interfaces] of Object.entries(networkInterfaces)) {
        if (!interfaces) continue
        
        for (const interface_ of interfaces) {
          if (interface_.family === 'IPv4' && !interface_.internal) {
            validInterfaces.push({
              name,
              address: interface_.address,
              priority: /^(docker|veth|br-|vmnet|vbox)/.test(name) ? 1 : 0
            })
          }
        }
      }
      validInterfaces.sort((a, b) => a.priority - b.priority)
  
      if (validInterfaces.length > 0) {
        const bestInterface = validInterfaces[0]
        console.log(`使用来自接口 ${bestInterface.name} 的本地网络IP`)
        return `http://${bestInterface.address}:${PORT}/${token}`
      }
    } catch (error) {
      console.error('获取本地网络IP错误:', error)
    }
  
    // 回退到localhost
    console.log('回退到localhost')
    return `http://127.0.0.1:${PORT}/${token}`
  }
  
  // 启动Web服务器
  startWebServer() {
    if (server) return
  
    // 创建HTTP服务器  
    server = http.createServer(async (req, res) => {
      try {
        // 允许CORS
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    
        if (req.method === 'OPTIONS') {
          res.writeHead(200)
          res.end()
          return
        }
    
        const urlPath = decodeURIComponent(req.url)
        const token = urlPath.split('/')[1]
        if (!activeSessions.has(token)) {
          res.writeHead(403, { 'Content-Type': 'text/plain' })
          res.end('Forbidden: Invalid or expired session')
          return
        }
    
        // 处理API请求
        if (urlPath.startsWith(`/${token}/api/status-data`)) {
          try {
            const systemData = await SystemUtils.collectSystemData()
            res.writeHead(200, { 
              'Content-Type': 'application/json',
              'Cache-Control': 'no-cache'
            })
            res.end(JSON.stringify(systemData))
            return
          } catch (error) {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: error.message }))
            return
          }
        }
    
        // 处理静态文件请求
        let filePath = urlPath.replace(`/${token}`, '')
        if (filePath === '' || filePath === '/') {
          filePath = '/index.html'
        }
    
        filePath = filePath.split('?')[0]
        const fullPath = path.join(this.webRoot, filePath)
        
        if (!fullPath.startsWith(this.webRoot)) {
          res.writeHead(403, { 'Content-Type': 'text/plain' })
          res.end('Forbidden: Access denied')
          return
        }
    
        if (!fs.existsSync(fullPath)) {
          res.writeHead(404, { 'Content-Type': 'text/plain' })
          res.end('File not found')
          return
        }
    
        const content = await fs.promises.readFile(fullPath)
        const ext = path.extname(fullPath).toLowerCase()
        
        const contentTypes = {
          '.html': 'text/html; charset=utf-8',
          '.css': 'text/css',
          '.js': 'application/javascript',
          '.json': 'application/json',
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.gif': 'image/gif',
          '.svg': 'image/svg+xml',
          '.ico': 'image/x-icon',
          '.ttf': 'font/ttf',
          '.woff': 'font/woff',
          '.woff2': 'font/woff2'
        }
        
        const contentType = contentTypes[ext] || 'application/octet-stream'
    
        if (ext === '.html') {
          let htmlContent = content.toString('utf8')
          htmlContent = htmlContent.replace(/(href|src)="(?!http|\/\/|data:)([^"]+)"/g, 
            (match, attr, url) => `${attr}="/${token}${url.startsWith('/') ? '' : '/'}${url}"`)
          htmlContent = htmlContent.replace(/\/api\/status-data/g, `/${token}/api/status-data`)
          
          res.writeHead(200, { 'Content-Type': contentType })
          res.end(htmlContent)
          return
        }
    
        const cacheControl = ext === '.html' ? 'no-cache' : 'public, max-age=86400'
        
        res.writeHead(200, { 
          'Content-Type': contentType,
          'Cache-Control': cacheControl
        })
        res.end(content)
    
      } catch (error) {
        console.error('处理请求失败:', error)
        res.writeHead(500, { 'Content-Type': 'text/plain' })
        res.end('Internal Server Error: ' + error.message)
      }
    })
    
    server.listen(PORT, () => {
      console.log(`状态面板服务器运行在端口 ${PORT}`)
    })
    
    server.on('error', (error) => {
      console.error('服务器错误:', error)
    })
  }
    
  async openStatusPanel(e) {
    try {
      this.startWebServer()
      const url = await this.getAccessUrl()
      await this.reply(`状态面板已启动，请访问（链接有效期10分钟）：\n${url}`)
      return true
    } catch (error) {
      console.error('启动状态面板失败:', error)
      await this.reply(`启动状态面板失败: ${error.message}`)
      return false
    }
  }
  
  // 处理HTML模板并替换变量
  async processTemplate(templateName, data, e) {
    try {
      const templatePath = path.join(this.webRoot, `${templateName}.html`)
      const outputPath = path.join(this.outputDir, `${templateName}_${Date.now()}.html`)
      
      if (!fs.existsSync(templatePath)) {
        throw new Error(`模板文件 ${templateName}.html 不存在`)
      }
      
      let htmlContent = fs.readFileSync(templatePath, 'utf8')
      
if (templateName === 'overview') {
  htmlContent = htmlContent
    .replace(/{{CPU_MODEL}}/g, data.cpu.model || 'N/A')
    .replace(/{{CPU_CORES}}/g, data.cpu.cores || 'N/A')
    .replace(/{{CPU_USAGE}}/g, data.cpu.usage || 'N/A')
    .replace(/{{CPU_SPEED}}/g, data.cpu.avgSpeed || 'N/A')
    .replace(/{{MEMORY_TOTAL}}/g, data.memory.total || 'N/A')
    .replace(/{{MEMORY_USED}}/g, data.memory.used || 'N/A')
    .replace(/{{MEMORY_FREE}}/g, data.memory.free || 'N/A')
    .replace(/{{MEMORY_USAGE}}/g, data.memory.usage || 'N/A')
    .replace(/{{DISK_FS}}/g, data.disk?.[0]?.filesystem || 'N/A')
    .replace(/{{DISK_TOTAL}}/g, data.disk?.[0]?.size || 'N/A')
    .replace(/{{DISK_FREE}}/g, data.disk?.[0]?.available || 'N/A')
    .replace(/{{DISK_USAGE}}/g, data.disk?.[0]?.percent || '0%')
    .replace(/{{OS_TYPE}}/g, data.os?.type || 'N/A')
    .replace(/{{HOSTNAME}}/g, data.os?.hostname || 'N/A')
    .replace(/{{UPTIME}}/g, data.os?.uptime || 'N/A')
    .replace(/{{BOT_NAME}}/g, data.bot?.name || 'baizi Bot')
    .replace(/{{BOT_VERSION}}/g, data.bot?.version || '1.0.0')
    .replace(/{{BOT_UPTIME}}/g, data.bot?.uptime || 'N/A')
} else if (templateName === 'cpu') {
          // 处理前5个进程
          const processes = data.processes || [];
          for (let i = 0; i < 5; i++) {
            const proc = processes[i] || { pid: 'N/A', name: 'N/A', cpu: '0', memory: '0' };
            htmlContent = htmlContent
              .replace(new RegExp(`{{PROCESS_${i+1}_PID}}`, 'g'), proc.pid)
              .replace(new RegExp(`{{PROCESS_${i+1}_NAME}}`, 'g'), proc.name)
              .replace(new RegExp(`{{PROCESS_${i+1}_CPU}}`, 'g'), `${proc.cpu}%`)
              .replace(new RegExp(`{{PROCESS_${i+1}_MEM}}`, 'g'), `${proc.memory}%`);
          }
          
          htmlContent = htmlContent
            .replace(/{{CPU_MODEL}}/g, data.cpu.model || 'N/A')
            .replace(/{{CPU_CORES}}/g, data.cpu.cores || 'N/A')
            .replace(/{{CPU_THREADS}}/g, data.cpu.cores || 'N/A') // 假设线程等于核心数
            .replace(/{{CPU_ARCH}}/g, data.cpu.arch || 'N/A')
            .replace(/{{CPU_SPEED}}/g, data.cpu.avgSpeed || 'N/A')
            .replace(/{{CPU_MAX_SPEED}}/g, data.cpu.maxSpeed || 'N/A')
            .replace(/{{CPU_USAGE}}/g, data.cpu.usage || 'N/A')
            .replace(/{{LOAD_AVG_1}}/g, data.os?.loadavg?.[0] || '0')
            .replace(/{{LOAD_AVG_5}}/g, data.os?.loadavg?.[1] || '0')
            .replace(/{{LOAD_AVG_15}}/g, data.os?.loadavg?.[2] || '0')
        } else if (templateName === 'memory') {
          // 处理前5个进程
          const processes = data.processes || [];
          for (let i = 0; i < 5; i++) {
            const proc = processes[i] || { pid: 'N/A', name: 'N/A', cpu: '0', memory: '0' };
            htmlContent = htmlContent
              .replace(new RegExp(`{{PROCESS_${i+1}_PID}}`, 'g'), proc.pid)
              .replace(new RegExp(`{{PROCESS_${i+1}_NAME}}`, 'g'), proc.name)
              .replace(new RegExp(`{{PROCESS_${i+1}_CPU}}`, 'g'), `${proc.cpu}%`)
              .replace(new RegExp(`{{PROCESS_${i+1}_MEM}}`, 'g'), `${proc.memory}%`);
          }
          
          htmlContent = htmlContent
            .replace(/{{MEMORY_TOTAL}}/g, data.memory.total || 'N/A')
            .replace(/{{MEMORY_USED}}/g, data.memory.used || 'N/A')
            .replace(/{{MEMORY_AVAILABLE}}/g, data.memory.free || 'N/A')
            .replace(/{{MEMORY_USAGE_PERCENT}}/g, data.memory.usage || 'N/A')
            .replace(/{{NODE_RSS}}/g, data.bot?.memoryUsage?.rss || 'N/A')
            .replace(/{{NODE_HEAP_TOTAL}}/g, data.bot?.memoryUsage?.heapTotal || 'N/A')
            .replace(/{{NODE_HEAP_USED}}/g, data.bot?.memoryUsage?.heapUsed || 'N/A')
            .replace(/{{NODE_EXTERNAL}}/g, data.bot?.memoryUsage?.external || '0 B')
            .replace(/{{NODE_PERCENT}}/g, data.bot?.memoryUsage?.percentage || '0%')
        } else if (templateName === 'bot') {
          // 处理机器人账号信息
          const accounts = data.bot?.accounts || [];
          htmlContent = htmlContent.replace(/dst_uin=(\d+)/, `dst_uin=${e.self_id || data.bot?.accounts?.[0]?.id || '123456'}`);
          for (let i = 0; i < 2; i++) {
            const account = accounts[i] || { id: 'N/A', nickname: 'N/A', platform: 'N/A', friends: '0', groups: '0', members: '0' };
            htmlContent = htmlContent
              .replace(new RegExp(`{{ACCOUNT_${i+1}_ID}}`, 'g'), account.id)
              .replace(new RegExp(`{{ACCOUNT_${i+1}_NICKNAME}}`, 'g'), account.nickname)
              .replace(new RegExp(`{{ACCOUNT_${i+1}_PLATFORM}}`, 'g'), account.platform)
              .replace(new RegExp(`{{ACCOUNT_${i+1}_FRIENDS}}`, 'g'), account.friends)
              .replace(new RegExp(`{{ACCOUNT_${i+1}_GROUPS}}`, 'g'), account.groups)
              .replace(new RegExp(`{{ACCOUNT_${i+1}_MEMBERS}}`, 'g'), account.members || '0');
          }
          const pluginList = data.plugins?.pluginsList || [];
          const popularPlugins = pluginList.slice(0, 8).map(p => p.name);
          for (let i = 0; i < 8; i++) {
            htmlContent = htmlContent.replace(new RegExp(`{{PLUGIN_${i+1}}}`, 'g'), popularPlugins[i] || '');
          }
          
          htmlContent = htmlContent
            .replace(/{{BOT_NAME}}/g, data.bot?.name || 'baizi Bot')
            .replace(/{{BOT_VERSION}}/g, data.bot?.version || '1.0.0')
            .replace(/{{BOT_UPTIME}}/g, data.bot?.uptime || 'N/A')
            .replace(/{{NODE_VERSION}}/g, data.bot?.nodeVersion || 'N/A')
            .replace(/{{BOT_PLATFORM}}/g, data.os?.platform || 'N/A')
            .replace(/{{BOT_ARCH}}/g, data.cpu?.arch || 'N/A')
            .replace(/{{MESSAGE_RECEIVED}}/g, '未知')
            .replace(/{{MESSAGE_SENT}}/g, '未知')
            .replace(/{{IMAGE_SENT}}/g, '未知')
            .replace(/{{PLUGIN_COUNT}}/g, data.plugins?.count || '0')
            .replace(/{{JS_COUNT}}/g, data.plugins?.jsCount || '0')
        } else if (templateName === 'disk') {
          const disks = data.disk || [];
          let totalStorage = '0';
          if (disks.length > 0) {
            totalStorage = disks.reduce((acc, disk) => acc + parseFloat(disk.size || 0), 0) + ' GB';
          }
          
          htmlContent = htmlContent.replace(/{{TOTAL_STORAGE}}/g, totalStorage);
          
          for (let i = 0; i < 4; i++) {
            const disk = disks[i] || { filesystem: '', size: '0', used: '0', available: '0', percent: '0%', mount: '' };
            htmlContent = htmlContent
              .replace(new RegExp(`{{DISK_${i+1}_FS}}`, 'g'), disk.filesystem)
              .replace(new RegExp(`{{DISK_${i+1}_SIZE}}`, 'g'), disk.size)
              .replace(new RegExp(`{{DISK_${i+1}_USED}}`, 'g'), disk.used)
              .replace(new RegExp(`{{DISK_${i+1}_AVAILABLE}}`, 'g'), disk.available)
              .replace(new RegExp(`{{DISK_${i+1}_PERCENT}}`, 'g'), disk.percent)
              .replace(new RegExp(`{{DISK_${i+1}_MOUNT}}`, 'g'), disk.mount);
          }
        } else if (templateName === 'network') {
          const networks = data.network || [];
          for (let i = 0; i < 2; i++) {
            const net = networks[i] || { name: '', address: '', mac: '', family: '', netmask: '', rxSpeed: '0', txSpeed: '0' };
            htmlContent = htmlContent
              .replace(new RegExp(`{{INTERFACE_${i+1}_NAME}}`, 'g'), net.name)
              .replace(new RegExp(`{{INTERFACE_${i+1}_ADDRESS}}`, 'g'), net.address)
              .replace(new RegExp(`{{INTERFACE_${i+1}_MAC}}`, 'g'), net.mac)
              .replace(new RegExp(`{{INTERFACE_${i+1}_FAMILY}}`, 'g'), net.family)
              .replace(new RegExp(`{{INTERFACE_${i+1}_NETMASK}}`, 'g'), net.netmask)
              .replace(new RegExp(`{{INTERFACE_${i+1}_TX_SPEED}}`, 'g'), net.txSpeed || '0 B/s')
              .replace(new RegExp(`{{INTERFACE_${i+1}_RX_SPEED}}`, 'g'), net.rxSpeed || '0 B/s')
              .replace(new RegExp(`{{INTERFACE_${i+1}_TX_TOTAL}}`, 'g'), '未知')
              .replace(new RegExp(`{{INTERFACE_${i+1}_RX_TOTAL}}`, 'g'), '未知');
          }
          
          htmlContent = htmlContent
            .replace(/{{TX_SPEED}}/g, networks[0]?.txSpeed || '0 B/s')
            .replace(/{{RX_SPEED}}/g, networks[0]?.rxSpeed || '0 B/s')
            .replace(/{{TOTAL_TX}}/g, '未知')
            .replace(/{{TOTAL_RX}}/g, '未知')
            .replace(/{{HOSTNAME}}/g, data.os?.hostname || 'N/A')
            .replace(/{{PUBLIC_IP}}/g, networks[0]?.address || 'N/A')
            .replace(/{{DNS_SERVERS}}/g, '未知')
            .replace(/{{ACTIVE_CONNECTIONS}}/g, '未知')
            .replace(/{{AVG_LATENCY}}/g, '未知')
        }
        fs.writeFileSync(outputPath, htmlContent, 'utf8')
        return outputPath
      } catch (error) {
        console.error('处理HTML模板失败:', error)
        throw error
      }
    }
    async makeForwardMsg(e, messages, title = '系统状态', entitle = '转发的系统状态信息') {
      const formatMessages = []
      const nickname = e.bot?.nickname || 'Bot'
      const user_id = e.bot?.uin || e.self_id
      
      messages.forEach((msg, idx) => {
        formatMessages.push({
          message: msg,
          nickname,
          user_id,
          time: Math.floor(Date.now() / 1000) + idx + 1,
        })
      })
      await makemsg(e, formatMessages, title, entitle)
    }
  
    // #baizi状态命令处理函数
    async sendSimpleStatus(e) {
      try {
        // 获取系统信息
        const sysInfo = await SystemUtils.collectSystemData()
        
        // 处理概览HTML模板
        const overviewHtmlPath = await this.processTemplate('overview', sysInfo, e)
        
        // 截取概览页面图片
        const screenshotPath = await takeScreenshot(overviewHtmlPath, 'status_overview')
        await e.reply([segment.image(screenshotPath)])
        
        return true
      } catch (error) {
        console.error('生成系统状态概览失败:', error)
        await e.reply(`生成系统状态概览失败: ${error.message}`)
        return false
      }
    }
  
    // #baizi状态pro命令处理函数
    async sendDetailedStatus(e) {
      try {
        const sysInfo = await SystemUtils.collectSystemData()
        const templates = ['overview', 'cpu', 'memory', 'disk', 'network', 'bot']
        const screenshots = []
        const messages = []
        for (const template of templates) {
          const htmlPath = await this.processTemplate(template, sysInfo, e)
          const screenshotPath = await takeScreenshot(htmlPath, `status_${template}`)
          screenshots.push(screenshotPath)
        }
        for (const screenshot of screenshots) {
          messages.push(segment.image(screenshot))
        }
        await this.makeForwardMsg(e, messages, 'baizi插件系统状态详情', ['云崽机器人状态详细信息'])
        
        return true
      } catch (error) {
        console.error('生成系统状态详情失败:', error)
        await e.reply(`生成系统状态详情失败: ${error.message}`)
        return false
      }
    }
  }import plugin from '../../../lib/plugins/plugin.js'

let server = null
const PORT = 35798
const activeSessions = new Map()
setInterval(() => {
  const now = Date.now()
  for (const [key, expiry] of activeSessions.entries()) {
    if (now > expiry) {
      activeSessions.delete(key)
    }
  }
}, 60000)

export class SystemMonitor extends plugin {
  constructor() {
    super({
      name: '系统监控',
      dsc: '查看系统的运行状态',
      event: 'message',
      priority: 5000,
      rule: [
        {
          reg: '^#?(baizi|baizi)面板$',
          fnc: 'openStatusPanel',
          permission: 'master'
        },
        {
          reg: '^#baizi状态$',
          fnc: 'sendSimpleStatus',
          permission: 'master'
        },
        {
          reg: '^#baizi状态pro$',
          fnc: 'sendDetailedStatus',
          permission: 'master'
        }
      ]
    })

    this.webRoot = path.join(process.cwd(), 'plugins', 'baizi-plugin', 'resources', 'zhuangtai')
    this.outputDir = path.join(process.cwd(), 'plugins', 'baizi-plugin', 'resources', 'zhuangtai', 'status-output')

    // 创建输出目录
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  // 生成安全令牌
  generateSecureToken() {
    return crypto.randomBytes(6).toString('hex')
  }

  // 获取访问URL
  async getAccessUrl() {
    const ipServices = [
      'http://ifconfig.me/ip'
    ]

    const token = this.generateSecureToken()
    activeSessions.set(token, Date.now() + 600000)

    const tryGetIP = async (url) => {
      try {
        return await new Promise((resolve, reject) => {
          const req = http.get(url, { timeout: 5000 }, (res) => {
            if (res.statusCode !== 200) {
              reject(new Error(`HTTP ${res.statusCode}`))
              return
            }
            
            let data = ''
            res.on('data', chunk => data += chunk)
            res.on('end', () => resolve(data.trim()))
          })
          
          req.on('error', reject)
          req.on('timeout', () => {
            req.destroy()
            reject(new Error('请求超时'))
          })
        })
      } catch (error) {
        throw error
      }
    }

    for (const service of ipServices) {
      try {
        const publicIP = await tryGetIP(service)
        if (/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(publicIP)) {
          const parts = publicIP.split('.').map(Number)
          const isPrivate = 
            parts[0] === 10 || 
            (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
            (parts[0] === 192 && parts[1] === 168)
              
          if (!isPrivate) {
            console.log(`成功从 ${service} 获取公网IP`)
            return `http://${publicIP}:${PORT}/${token}`
          }
        }
      } catch (error) {
        console.log(`从 ${service} 获取IP失败:`, error.message)
        continue
      }
    }
  
    // 尝试获取本地网络IP
    console.log('获取公网IP失败，回退到本地IP')
    try {
      const networkInterfaces = os.networkInterfaces()
      const validInterfaces = []
      for (const [name, interfaces] of Object.entries(networkInterfaces)) {
        if (!interfaces) continue
        
        for (const interface_ of interfaces) {
          if (interface_.family === 'IPv4' && !interface_.internal) {
            validInterfaces.push({
              name,
              address: interface_.address,
              priority: /^(docker|veth|br-|vmnet|vbox)/.test(name) ? 1 : 0
            })
          }
        }
      }
      validInterfaces.sort((a, b) => a.priority - b.priority)
  
      if (validInterfaces.length > 0) {
        const bestInterface = validInterfaces[0]
        console.log(`使用来自接口 ${bestInterface.name} 的本地网络IP`)
        return `http://${bestInterface.address}:${PORT}/${token}`
      }
    } catch (error) {
      console.error('获取本地网络IP错误:', error)
    }
  
    // 回退到localhost
    console.log('回退到localhost')
    return `http://127.0.0.1:${PORT}/${token}`
  }
  
  // 启动Web服务器
  startWebServer() {
    if (server) return
  
    // 创建HTTP服务器  
    server = http.createServer(async (req, res) => {
      try {
        // 允许CORS
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    
        if (req.method === 'OPTIONS') {
          res.writeHead(200)
          res.end()
          return
        }
    
        const urlPath = decodeURIComponent(req.url)
        const token = urlPath.split('/')[1]
        if (!activeSessions.has(token)) {
          res.writeHead(403, { 'Content-Type': 'text/plain' })
          res.end('Forbidden: Invalid or expired session')
          return
        }
    
        // 处理API请求
        if (urlPath.startsWith(`/${token}/api/status-data`)) {
          try {
            const systemData = await SystemUtils.collectSystemData()
            res.writeHead(200, { 
              'Content-Type': 'application/json',
              'Cache-Control': 'no-cache'
            })
            res.end(JSON.stringify(systemData))
            return
          } catch (error) {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: error.message }))
            return
          }
        }
    
        // 处理静态文件请求
        let filePath = urlPath.replace(`/${token}`, '')
        if (filePath === '' || filePath === '/') {
          filePath = '/index.html'
        }
    
        filePath = filePath.split('?')[0]
        const fullPath = path.join(this.webRoot, filePath)
        
        if (!fullPath.startsWith(this.webRoot)) {
          res.writeHead(403, { 'Content-Type': 'text/plain' })
          res.end('Forbidden: Access denied')
          return
        }
    
        if (!fs.existsSync(fullPath)) {
          res.writeHead(404, { 'Content-Type': 'text/plain' })
          res.end('File not found')
          return
        }
    
        const content = await fs.promises.readFile(fullPath)
        const ext = path.extname(fullPath).toLowerCase()
        
        const contentTypes = {
          '.html': 'text/html; charset=utf-8',
          '.css': 'text/css',
          '.js': 'application/javascript',
          '.json': 'application/json',
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.gif': 'image/gif',
          '.svg': 'image/svg+xml',
          '.ico': 'image/x-icon',
          '.ttf': 'font/ttf',
          '.woff': 'font/woff',
          '.woff2': 'font/woff2'
        }
        
        const contentType = contentTypes[ext] || 'application/octet-stream'
    
        if (ext === '.html') {
          let htmlContent = content.toString('utf8')
          htmlContent = htmlContent.replace(/(href|src)="(?!http|\/\/|data:)([^"]+)"/g, 
            (match, attr, url) => `${attr}="/${token}${url.startsWith('/') ? '' : '/'}${url}"`)
          htmlContent = htmlContent.replace(/\/api\/status-data/g, `/${token}/api/status-data`)
          
          res.writeHead(200, { 'Content-Type': contentType })
          res.end(htmlContent)
          return
        }
    
        const cacheControl = ext === '.html' ? 'no-cache' : 'public, max-age=86400'
        
        res.writeHead(200, { 
          'Content-Type': contentType,
          'Cache-Control': cacheControl
        })
        res.end(content)
    
      } catch (error) {
        console.error('处理请求失败:', error)
        res.writeHead(500, { 'Content-Type': 'text/plain' })
        res.end('Internal Server Error: ' + error.message)
      }
    })
    
    server.listen(PORT, () => {
      console.log(`状态面板服务器运行在端口 ${PORT}`)
    })
    
    server.on('error', (error) => {
      console.error('服务器错误:', error)
    })
  }
    
  async openStatusPanel(e) {
    try {
      this.startWebServer()
      const url = await this.getAccessUrl()
      await this.reply(`状态面板已启动，请访问（链接有效期10分钟）：\n${url}`)
      return true
    } catch (error) {
      console.error('启动状态面板失败:', error)
      await this.reply(`启动状态面板失败: ${error.message}`)
      return false
    }
  }
  
  // 处理HTML模板并替换变量
  async processTemplate(templateName, data, e) {
    try {
      const templatePath = path.join(this.webRoot, `${templateName}.html`)
      const outputPath = path.join(this.outputDir, `${templateName}_${Date.now()}.html`)
      
      if (!fs.existsSync(templatePath)) {
        throw new Error(`模板文件 ${templateName}.html 不存在`)
      }
      
      let htmlContent = fs.readFileSync(templatePath, 'utf8')
      
if (templateName === 'overview') {
  htmlContent = htmlContent
    .replace(/{{CPU_MODEL}}/g, data.cpu.model || 'N/A')
    .replace(/{{CPU_CORES}}/g, data.cpu.cores || 'N/A')
    .replace(/{{CPU_USAGE}}/g, data.cpu.usage || 'N/A')
    .replace(/{{CPU_SPEED}}/g, data.cpu.avgSpeed || 'N/A')
    .replace(/{{MEMORY_TOTAL}}/g, data.memory.total || 'N/A')
    .replace(/{{MEMORY_USED}}/g, data.memory.used || 'N/A')
    .replace(/{{MEMORY_FREE}}/g, data.memory.free || 'N/A')
    .replace(/{{MEMORY_USAGE}}/g, data.memory.usage || 'N/A')
    .replace(/{{DISK_FS}}/g, data.disk?.[0]?.filesystem || 'N/A')
    .replace(/{{DISK_TOTAL}}/g, data.disk?.[0]?.size || 'N/A')
    .replace(/{{DISK_FREE}}/g, data.disk?.[0]?.available || 'N/A')
    .replace(/{{DISK_USAGE}}/g, data.disk?.[0]?.percent || '0%')
    .replace(/{{OS_TYPE}}/g, data.os?.type || 'N/A')
    .replace(/{{HOSTNAME}}/g, data.os?.hostname || 'N/A')
    .replace(/{{UPTIME}}/g, data.os?.uptime || 'N/A')
    .replace(/{{BOT_NAME}}/g, data.bot?.name || 'baizi Bot')
    .replace(/{{BOT_VERSION}}/g, data.bot?.version || '1.0.0')
    .replace(/{{BOT_UPTIME}}/g, data.bot?.uptime || 'N/A')
} else if (templateName === 'cpu') {
          // 处理前5个进程
          const processes = data.processes || [];
          for (let i = 0; i < 5; i++) {
            const proc = processes[i] || { pid: 'N/A', name: 'N/A', cpu: '0', memory: '0' };
            htmlContent = htmlContent
              .replace(new RegExp(`{{PROCESS_${i+1}_PID}}`, 'g'), proc.pid)
              .replace(new RegExp(`{{PROCESS_${i+1}_NAME}}`, 'g'), proc.name)
              .replace(new RegExp(`{{PROCESS_${i+1}_CPU}}`, 'g'), `${proc.cpu}%`)
              .replace(new RegExp(`{{PROCESS_${i+1}_MEM}}`, 'g'), `${proc.memory}%`);
          }
          
          htmlContent = htmlContent
            .replace(/{{CPU_MODEL}}/g, data.cpu.model || 'N/A')
            .replace(/{{CPU_CORES}}/g, data.cpu.cores || 'N/A')
            .replace(/{{CPU_THREADS}}/g, data.cpu.cores || 'N/A') // 假设线程等于核心数
            .replace(/{{CPU_ARCH}}/g, data.cpu.arch || 'N/A')
            .replace(/{{CPU_SPEED}}/g, data.cpu.avgSpeed || 'N/A')
            .replace(/{{CPU_MAX_SPEED}}/g, data.cpu.maxSpeed || 'N/A')
            .replace(/{{CPU_USAGE}}/g, data.cpu.usage || 'N/A')
            .replace(/{{LOAD_AVG_1}}/g, data.os?.loadavg?.[0] || '0')
            .replace(/{{LOAD_AVG_5}}/g, data.os?.loadavg?.[1] || '0')
            .replace(/{{LOAD_AVG_15}}/g, data.os?.loadavg?.[2] || '0')
        } else if (templateName === 'memory') {
          // 处理前5个进程
          const processes = data.processes || [];
          for (let i = 0; i < 5; i++) {
            const proc = processes[i] || { pid: 'N/A', name: 'N/A', cpu: '0', memory: '0' };
            htmlContent = htmlContent
              .replace(new RegExp(`{{PROCESS_${i+1}_PID}}`, 'g'), proc.pid)
              .replace(new RegExp(`{{PROCESS_${i+1}_NAME}}`, 'g'), proc.name)
              .replace(new RegExp(`{{PROCESS_${i+1}_CPU}}`, 'g'), `${proc.cpu}%`)
              .replace(new RegExp(`{{PROCESS_${i+1}_MEM}}`, 'g'), `${proc.memory}%`);
          }
          
          htmlContent = htmlContent
            .replace(/{{MEMORY_TOTAL}}/g, data.memory.total || 'N/A')
            .replace(/{{MEMORY_USED}}/g, data.memory.used || 'N/A')
            .replace(/{{MEMORY_AVAILABLE}}/g, data.memory.free || 'N/A')
            .replace(/{{MEMORY_USAGE_PERCENT}}/g, data.memory.usage || 'N/A')
            .replace(/{{NODE_RSS}}/g, data.bot?.memoryUsage?.rss || 'N/A')
            .replace(/{{NODE_HEAP_TOTAL}}/g, data.bot?.memoryUsage?.heapTotal || 'N/A')
            .replace(/{{NODE_HEAP_USED}}/g, data.bot?.memoryUsage?.heapUsed || 'N/A')
            .replace(/{{NODE_EXTERNAL}}/g, data.bot?.memoryUsage?.external || '0 B')
            .replace(/{{NODE_PERCENT}}/g, data.bot?.memoryUsage?.percentage || '0%')
        } else if (templateName === 'bot') {
          // 处理机器人账号信息
          const accounts = data.bot?.accounts || [];
          htmlContent = htmlContent.replace(/dst_uin=(\d+)/, `dst_uin=${e.self_id || data.bot?.accounts?.[0]?.id || '123456'}`);
          for (let i = 0; i < 2; i++) {
            const account = accounts[i] || { id: 'N/A', nickname: 'N/A', platform: 'N/A', friends: '0', groups: '0', members: '0' };
            htmlContent = htmlContent
              .replace(new RegExp(`{{ACCOUNT_${i+1}_ID}}`, 'g'), account.id)
              .replace(new RegExp(`{{ACCOUNT_${i+1}_NICKNAME}}`, 'g'), account.nickname)
              .replace(new RegExp(`{{ACCOUNT_${i+1}_PLATFORM}}`, 'g'), account.platform)
              .replace(new RegExp(`{{ACCOUNT_${i+1}_FRIENDS}}`, 'g'), account.friends)
              .replace(new RegExp(`{{ACCOUNT_${i+1}_GROUPS}}`, 'g'), account.groups)
              .replace(new RegExp(`{{ACCOUNT_${i+1}_MEMBERS}}`, 'g'), account.members || '0');
          }
          const pluginList = data.plugins?.pluginsList || [];
          const popularPlugins = pluginList.slice(0, 8).map(p => p.name);
          for (let i = 0; i < 8; i++) {
            htmlContent = htmlContent.replace(new RegExp(`{{PLUGIN_${i+1}}}`, 'g'), popularPlugins[i] || '');
          }
          
          htmlContent = htmlContent
            .replace(/{{BOT_NAME}}/g, data.bot?.name || 'baizi Bot')
            .replace(/{{BOT_VERSION}}/g, data.bot?.version || '1.0.0')
            .replace(/{{BOT_UPTIME}}/g, data.bot?.uptime || 'N/A')
            .replace(/{{NODE_VERSION}}/g, data.bot?.nodeVersion || 'N/A')
            .replace(/{{BOT_PLATFORM}}/g, data.os?.platform || 'N/A')
            .replace(/{{BOT_ARCH}}/g, data.cpu?.arch || 'N/A')
            .replace(/{{MESSAGE_RECEIVED}}/g, '未知')
            .replace(/{{MESSAGE_SENT}}/g, '未知')
            .replace(/{{IMAGE_SENT}}/g, '未知')
            .replace(/{{PLUGIN_COUNT}}/g, data.plugins?.count || '0')
            .replace(/{{JS_COUNT}}/g, data.plugins?.jsCount || '0')
        } else if (templateName === 'disk') {
          const disks = data.disk || [];
          let totalStorage = '0';
          if (disks.length > 0) {
            totalStorage = disks.reduce((acc, disk) => acc + parseFloat(disk.size || 0), 0) + ' GB';
          }
          
          htmlContent = htmlContent.replace(/{{TOTAL_STORAGE}}/g, totalStorage);
          
          for (let i = 0; i < 4; i++) {
            const disk = disks[i] || { filesystem: '', size: '0', used: '0', available: '0', percent: '0%', mount: '' };
            htmlContent = htmlContent
              .replace(new RegExp(`{{DISK_${i+1}_FS}}`, 'g'), disk.filesystem)
              .replace(new RegExp(`{{DISK_${i+1}_SIZE}}`, 'g'), disk.size)
              .replace(new RegExp(`{{DISK_${i+1}_USED}}`, 'g'), disk.used)
              .replace(new RegExp(`{{DISK_${i+1}_AVAILABLE}}`, 'g'), disk.available)
              .replace(new RegExp(`{{DISK_${i+1}_PERCENT}}`, 'g'), disk.percent)
              .replace(new RegExp(`{{DISK_${i+1}_MOUNT}}`, 'g'), disk.mount);
          }
        } else if (templateName === 'network') {
          const networks = data.network || [];
          for (let i = 0; i < 2; i++) {
            const net = networks[i] || { name: '', address: '', mac: '', family: '', netmask: '', rxSpeed: '0', txSpeed: '0' };
            htmlContent = htmlContent
              .replace(new RegExp(`{{INTERFACE_${i+1}_NAME}}`, 'g'), net.name)
              .replace(new RegExp(`{{INTERFACE_${i+1}_ADDRESS}}`, 'g'), net.address)
              .replace(new RegExp(`{{INTERFACE_${i+1}_MAC}}`, 'g'), net.mac)
              .replace(new RegExp(`{{INTERFACE_${i+1}_FAMILY}}`, 'g'), net.family)
              .replace(new RegExp(`{{INTERFACE_${i+1}_NETMASK}}`, 'g'), net.netmask)
              .replace(new RegExp(`{{INTERFACE_${i+1}_TX_SPEED}}`, 'g'), net.txSpeed || '0 B/s')
              .replace(new RegExp(`{{INTERFACE_${i+1}_RX_SPEED}}`, 'g'), net.rxSpeed || '0 B/s')
              .replace(new RegExp(`{{INTERFACE_${i+1}_TX_TOTAL}}`, 'g'), '未知')
              .replace(new RegExp(`{{INTERFACE_${i+1}_RX_TOTAL}}`, 'g'), '未知');
          }
          
          htmlContent = htmlContent
            .replace(/{{TX_SPEED}}/g, networks[0]?.txSpeed || '0 B/s')
            .replace(/{{RX_SPEED}}/g, networks[0]?.rxSpeed || '0 B/s')
            .replace(/{{TOTAL_TX}}/g, '未知')
            .replace(/{{TOTAL_RX}}/g, '未知')
            .replace(/{{HOSTNAME}}/g, data.os?.hostname || 'N/A')
            .replace(/{{PUBLIC_IP}}/g, networks[0]?.address || 'N/A')
            .replace(/{{DNS_SERVERS}}/g, '未知')
            .replace(/{{ACTIVE_CONNECTIONS}}/g, '未知')
            .replace(/{{AVG_LATENCY}}/g, '未知')
        }
        fs.writeFileSync(outputPath, htmlContent, 'utf8')
        return outputPath
      } catch (error) {
        console.error('处理HTML模板失败:', error)
        throw error
      }
    }
    async makeForwardMsg(e, messages, title = '系统状态', entitle = '转发的系统状态信息') {
      const formatMessages = []
      const nickname = e.bot?.nickname || 'Bot'
      const user_id = e.bot?.uin || e.self_id
      
      messages.forEach((msg, idx) => {
        formatMessages.push({
          message: msg,
          nickname,
          user_id,
          time: Math.floor(Date.now() / 1000) + idx + 1,
        })
      })
      await makemsg(e, formatMessages, title, entitle)
    }
  
    // #baizi状态命令处理函数
    async sendSimpleStatus(e) {
      try {
        // 获取系统信息
        const sysInfo = await SystemUtils.collectSystemData()
        
        // 处理概览HTML模板
        const overviewHtmlPath = await this.processTemplate('overview', sysInfo, e)
        
        // 截取概览页面图片
        const screenshotPath = await takeScreenshot(overviewHtmlPath, 'status_overview')
        await e.reply([segment.image(screenshotPath)])
        
        return true
      } catch (error) {
        console.error('生成系统状态概览失败:', error)
        await e.reply(`生成系统状态概览失败: ${error.message}`)
        return false
      }
    }
  
    // #baizi状态pro命令处理函数
    async sendDetailedStatus(e) {
      try {
        const sysInfo = await SystemUtils.collectSystemData()
        const templates = ['overview', 'cpu', 'memory', 'disk', 'network', 'bot']
        const screenshots = []
        const messages = []
        for (const template of templates) {
          const htmlPath = await this.processTemplate(template, sysInfo, e)
          const screenshotPath = await takeScreenshot(htmlPath, `status_${template}`)
          screenshots.push(screenshotPath)
        }
        for (const screenshot of screenshots) {
          messages.push(segment.image(screenshot))
        }
        await this.makeForwardMsg(e, messages, 'baizi插件系统状态详情', ['云崽机器人状态详细信息'])
        
        return true
      } catch (error) {
        console.error('生成系统状态详情失败:', error)
        await e.reply(`生成系统状态详情失败: ${error.message}`)
        return false
      }
    }
  }
