import fs from 'fs';
import path from 'path';
import Puppeteer from '../../../renderers/puppeteer/lib/puppeteer.js';
import EventEmitter from 'events';
import yaml from 'yaml';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

const ROOT_PATH = process.cwd();
const helpCONFIG = path.join(ROOT_PATH, 'data/ymconfig/config.yaml');
let shot_Config = {};

try {
    if (fs.existsSync(helpCONFIG)) {
        shot_Config = yaml.parse(fs.readFileSync(helpCONFIG, 'utf8'));
    } else {
        shot_Config = { screen_shot_quality: 1 };
        logger.info('未找到配置文件，使用默认配置');
    }
} catch (e) {
    logger.info('读取配置文件失败，使用默认配置', e);
    shot_Config = { screen_shot_quality: 1 };
}

// SQLite数据库配置
const DB_PATH = path.join(ROOT_PATH, 'data/xrkconfig/browser-manager.db');

class DB {
    static instance = null;
    
    static async getInstance() {
        if (!DB.instance) {
            try {
                // 确保目录存在
                const dbDir = path.dirname(DB_PATH);
                if (!fs.existsSync(dbDir)) {
                    fs.mkdirSync(dbDir, { recursive: true });
                }
                
                DB.instance = await open({
                    filename: DB_PATH,
                    driver: sqlite3.Database
                });
                
                await DB.instance.exec(`
                    CREATE TABLE IF NOT EXISTS browsers (
                        id TEXT PRIMARY KEY,
                        status TEXT,
                        created_at INTEGER
                    );
                    
                    CREATE TABLE IF NOT EXISTS browser_counts (
                        browser_id TEXT PRIMARY KEY,
                        count INTEGER DEFAULT 0,
                        FOREIGN KEY (browser_id) REFERENCES browsers(id) ON DELETE CASCADE
                    );
                    
                    CREATE TABLE IF NOT EXISTS browser_last_used (
                        browser_id TEXT PRIMARY KEY,
                        last_used INTEGER,
                        FOREIGN KEY (browser_id) REFERENCES browsers(id) ON DELETE CASCADE
                    );
                    
                    CREATE TABLE IF NOT EXISTS screenshot_cache (
                        target TEXT,
                        config TEXT,
                        image_path TEXT,
                        created_at INTEGER,
                        PRIMARY KEY (target, config)
                    );
                    
                    CREATE TABLE IF NOT EXISTS render_stats (
                        date TEXT,
                        total_renders INTEGER DEFAULT 0,
                        PRIMARY KEY (date)
                    );
                    
                    CREATE TABLE IF NOT EXISTS image_stats (
                        date TEXT,
                        type TEXT,
                        count INTEGER DEFAULT 0,
                        PRIMARY KEY (date, type)
                    );
                    
                    CREATE TABLE IF NOT EXISTS cache_stats (
                        date TEXT,
                        hits INTEGER DEFAULT 0,
                        PRIMARY KEY (date)
                    );
                    
                    CREATE TABLE IF NOT EXISTS error_logs (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        date TEXT,
                        time TEXT,
                        error TEXT,
                        stack TEXT,
                        target TEXT
                    );
                `);
            } catch (err) {
                logger.error('初始化数据库失败:', err);
                // 返回一个空对象，模拟数据库操作
                return {
                    run: async () => ({ changes: 0 }),
                    get: async () => null,
                    all: async () => [],
                    exec: async () => {},
                    close: async () => {}
                };
            }
        }
        
        return DB.instance;
    }
    
    static async close() {
        if (DB.instance) {
            try {
                await DB.instance.close();
            } catch (e) {
                logger.error('关闭数据库连接失败:', e);
            }
            DB.instance = null;
        }
    }
}

class BrowserManager extends EventEmitter {
    static instance = null;
    static isBrowserCreating = false;
    
    static async getInstance(options = {}) {
        if (!BrowserManager.instance) {
            BrowserManager.instance = new BrowserManager(options);
            await BrowserManager.instance.init();
        }
        return BrowserManager.instance;
    }

    constructor(options = {}) {
        super();
        this.maxInstances = options.maxInstances || 3;
        this.maxRenderCount = options.maxRenderCount || 20;
        this.maxIdleTime = options.maxIdleTime || 3600000;
        
        this.browsers = new Map();
        this.renderCounts = new Map();
        this.lastUsedTime = new Map();
        this.monitoring = false;
        this.monitorInterval = null;
        this.db = null;
        
        this.defaultPuppeteerOptions = {
            headless: 'new',
            args: [
                '--disable-gpu',
                '--no-sandbox', 
                '--disable-dev-shm-usage',
                '--disable-setuid-sandbox',
                '--no-zygote',
                '--disable-web-security',
                '--allow-file-access-from-files',
                '--disable-features=site-per-process',
                '--disable-web-security',
                '--disable-infobars',
                '--disable-notifications',
                '--window-size=1920,1080',
                '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.127 Safari/537.36'
            ],
            protocolTimeout: 60000, // 增加超时时间
            defaultViewport: null
        };
    }

    async init() {
        try {
            this.db = await DB.getInstance();
            await this._cleanupDatabase();
        } catch (error) {
            logger.error('初始化BrowserManager失败:', error);
            // 错误处理 - 继续运行，但将错误记录下来
        }
    }

    async _cleanupDatabase() {
        try {
            // 删除可能遗留的浏览器记录
            const deleteResult = await this.db.run('DELETE FROM browsers');
            
            if (deleteResult && deleteResult.changes > 0) {
                this.emit('info', `已清理 ${deleteResult.changes} 个过期的浏览器记录`);
            }
        } catch (error) {
            logger.error('清理数据库失败:', error);
            // 仅记录错误，不中断执行
        }
    }

    startMonitoring(interval = 30000) {
        if (this.monitoring) return;
        this.monitoring = true;
        this.monitorInterval = setInterval(async () => {
            try {
                let status = { 
                    activeInstances: 0, 
                    renderCounts: {}, 
                    memoryUsage: process.memoryUsage() 
                };
                
                const browsers = await this.db.all('SELECT id FROM browsers');
                status.activeInstances = browsers ? browsers.length : 0;
                
                if (browsers) {
                    for (const browser of browsers) {
                        const browserId = browser.id;
                        const countRow = await this.db.get(
                            'SELECT count FROM browser_counts WHERE browser_id = ?', 
                            browserId
                        );
                        
                        status.renderCounts[browserId] = countRow ? countRow.count : 0;
                    }
                }
                
                this.emit('monitoring', status);
                await this.cleanup();
            } catch (error) {
                logger.error('监控过程中发生错误:', error);
                // 错误处理 - 继续监控
            }
        }, interval);
    }

    stopMonitoring() {
        if (this.monitorInterval) {
            clearInterval(this.monitorInterval);
            this.monitorInterval = null;
            this.monitoring = false;
        }
    }

    async getBrowser() {
        const browserId = 'singleton-browser';
        const retryCount = 3; // 添加重试机制
        
        for (let attempt = 0; attempt < retryCount; attempt++) {
            try {
                // 如果浏览器已存在于内存中
                if (this.browsers.has(browserId)) {
                    this.lastUsedTime.set(browserId, Date.now());
                    try {
                        await this.db.run(
                            'UPDATE browser_last_used SET last_used = ? WHERE browser_id = ?',
                            Date.now(), browserId
                        );
                    } catch (e) {
                        console.warn('更新浏览器使用时间失败:', e);
                        // 继续使用现有浏览器
                    }
                    return this.browsers.get(browserId);
                }
                
                // 避免并发创建同一个浏览器实例
                if (BrowserManager.isBrowserCreating) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                    if (this.browsers.has(browserId)) {
                        return this.browsers.get(browserId);
                    }
                    continue; // 重试
                }
                
                BrowserManager.isBrowserCreating = true;
                
                // 检查数据库中是否存在浏览器
                const browserExists = await this.db.get(
                    'SELECT id FROM browsers WHERE id = ?', 
                    browserId
                );
                
                if (!browserExists) {
                    // 创建新浏览器并在事务中插入相关记录
                    const puppeteerInstance = new Puppeteer(this.defaultPuppeteerOptions);
                    const browser = await puppeteerInstance.browserInit();
                    
                    this.browsers.set(browserId, browser);
                    this.renderCounts.set(browserId, 0);
                    this.lastUsedTime.set(browserId, Date.now());
                    
                    const now = Date.now();
                    
                    try {
                        // 使用事务确保原子性
                        await this.db.exec('BEGIN TRANSACTION');
                        
                        // 插入浏览器记录
                        await this.db.run(
                            'INSERT OR REPLACE INTO browsers (id, status, created_at) VALUES (?, ?, ?)',
                            browserId, 'active', now
                        );
                        
                        // 插入计数记录 - 使用INSERT OR REPLACE代替INSERT
                        await this.db.run(
                            'INSERT OR REPLACE INTO browser_counts (browser_id, count) VALUES (?, ?)',
                            browserId, 0
                        );
                        
                        // 插入最后使用时间记录 - 使用INSERT OR REPLACE代替INSERT
                        await this.db.run(
                            'INSERT OR REPLACE INTO browser_last_used (browser_id, last_used) VALUES (?, ?)',
                            browserId, now
                        );
                        
                        await this.db.exec('COMMIT');
                    } catch (err) {
                        await this.db.exec('ROLLBACK');
                        logger.error('创建浏览器记录失败:', err);
                        // 即使数据库操作失败，也返回已创建的浏览器实例
                    }
                    
                    process.once('beforeExit', async () => {
                        try {
                            await browser.close();
                        } catch (err) {
                            // 忽略关闭错误
                            console.warn('关闭浏览器失败:', err);
                        }
                    });
                    
                    this.emit('browserCreated', { browserId, totalInstances: 1 });
                    BrowserManager.isBrowserCreating = false;
                    return browser;
                } else if (!this.browsers.has(browserId)) {
                    // 数据库中存在，但内存中不存在，创建新实例
                    const puppeteerInstance = new Puppeteer(this.defaultPuppeteerOptions);
                    const browser = await puppeteerInstance.browserInit();
                    
                    this.browsers.set(browserId, browser);
                    this.renderCounts.set(browserId, 0);
                    this.lastUsedTime.set(browserId, Date.now());
                    
                    try {
                        // 更新计数记录
                        await this.db.run(
                            'UPDATE browser_counts SET count = ? WHERE browser_id = ?',
                            0, browserId
                        );
                        
                        // 更新最后使用时间
                        await this.db.run(
                            'UPDATE browser_last_used SET last_used = ? WHERE browser_id = ?',
                            Date.now(), browserId
                        );
                    } catch (err) {
                        console.warn('更新浏览器记录失败:', err);
                        // 继续使用已创建的浏览器实例
                    }
                    
                    BrowserManager.isBrowserCreating = false;
                    return browser;
                }
            } catch (error) {
                logger.error(`获取浏览器实例失败 (尝试 ${attempt+1}/${retryCount}):`, error);
                
                if (attempt === retryCount - 1) {
                    BrowserManager.isBrowserCreating = false;
                    this.emit('error', `获取浏览器实例失败: ${error.message}`);
                    throw new Error(`获取浏览器实例失败: ${error.message}`);
                }
                
                // 等待一段时间后重试
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        
        BrowserManager.isBrowserCreating = false;
        throw new Error('无法获取浏览器实例，多次尝试均失败');
    }

    async incrementRenderCount(browserId) {
        try {
            let currentCount = 0;
            
            // 更新数据库中的计数
            await this.db.run(
                `UPDATE browser_counts 
                 SET count = count + 1 
                 WHERE browser_id = ?`,
                browserId
            );
            
            // 获取更新后的计数
            const countRow = await this.db.get(
                'SELECT count FROM browser_counts WHERE browser_id = ?',
                browserId
            );
            
            currentCount = countRow ? countRow.count : 0;
            
            // 更新最后使用时间
            this.lastUsedTime.set(browserId, Date.now());
            await this.db.run(
                'UPDATE browser_last_used SET last_used = ? WHERE browser_id = ?',
                Date.now(), browserId
            );
            
            if (currentCount >= this.maxRenderCount) {
                setTimeout(async () => {
                    await this.resetBrowser(browserId);
                }, 1000);
            }
            
            return currentCount;
        } catch (error) {
            logger.error('增加渲染计数失败:', error);
            return 0; // 返回0，避免中断流程
        }
    }

    async resetBrowser(browserId) {
        try {
            this.emit('info', `重置浏览器实例: ${browserId}，已达到最大渲染次数`);
            
            if (this.browsers.has(browserId)) {
                const oldBrowser = this.browsers.get(browserId);
                
                const puppeteerInstance = new Puppeteer(this.defaultPuppeteerOptions);
                const newBrowser = await puppeteerInstance.browserInit();
                
                this.browsers.set(browserId, newBrowser);
                
                setTimeout(async () => {
                    try {
                        await oldBrowser.close();
                    } catch (err) {
                        logger.error('关闭旧浏览器实例失败:', err);
                    }
                }, 5000);
                
                this.renderCounts.set(browserId, 0);
                this.lastUsedTime.set(browserId, Date.now());
                
                try {
                    // 重置数据库中的计数
                    await this.db.run(
                        'UPDATE browser_counts SET count = ? WHERE browser_id = ?',
                        0, browserId
                    );
                    
                    // 更新最后使用时间
                    await this.db.run(
                        'UPDATE browser_last_used SET last_used = ? WHERE browser_id = ?',
                        Date.now(), browserId
                    );
                } catch (err) {
                    console.warn('更新浏览器记录失败:', err);
                    // 继续使用新的浏览器实例
                }
            }
        } catch (error) {
            logger.error('重置浏览器失败:', error);
            // 错误处理 - 继续运行
        }
    }

    async cleanup() {
        try {
            const now = Date.now();
            
            // 获取所有浏览器及其最后使用时间
            const browsers = await this.db.all(`
                SELECT b.id, bl.last_used 
                FROM browsers b
                JOIN browser_last_used bl ON b.id = bl.browser_id
            `);
            
            if (!browsers || browsers.length === 0) return;
            
            for (const browser of browsers) {
                if (now - browser.last_used > this.maxIdleTime) {
                    this.emit('info', `关闭空闲浏览器: ${browser.id}`);
                    await this.closeBrowser(browser.id);
                }
            }
        } catch (error) {
            logger.error('清理浏览器实例失败:', error);
            // 错误处理 - 继续运行
        }
    }

    async closeBrowser(browserId) {
        try {
            if (this.browsers.has(browserId)) {
                const browser = this.browsers.get(browserId);
                await browser.close();
                this.browsers.delete(browserId);
            }
            
            this.renderCounts.delete(browserId);
            this.lastUsedTime.delete(browserId);
            
            try {
                // 从数据库删除浏览器
                await this.db.run('DELETE FROM browsers WHERE id = ?', browserId);
            } catch (err) {
                console.warn('从数据库删除浏览器记录失败:', err);
            }
            
            this.emit('browserClosed', { browserId, remainingInstances: this.browsers.size });
        } catch (error) {
            logger.error('关闭浏览器失败:', error);
            // 错误处理 - 继续运行
        }
    }

    async closeAll() {
        try {
            // 获取所有浏览器ID
            const browsers = await this.db.all('SELECT id FROM browsers');
            const browserIds = browsers ? browsers.map(b => b.id) : [];
            
            const closePromises = browserIds.map(id => this.closeBrowser(id));
            await Promise.all(closePromises);
            
            // 遍历内存中的浏览器实例并关闭
            for (const [id, browser] of this.browsers.entries()) {
                try {
                    await browser.close();
                    this.browsers.delete(id);
                } catch (err) {
                    console.warn(`关闭浏览器实例 ${id} 失败:`, err);
                }
            }
            
            this.browsers.clear();
            this.renderCounts.clear();
            this.lastUsedTime.clear();
            
            this.stopMonitoring();
            this.emit('info', '所有浏览器已关闭');
        } catch (error) {
            logger.error('关闭所有浏览器失败:', error);
            // 错误处理 - 继续运行
        }
    }
}

class ScreenshotManager {
    constructor(outputBasePath) {
        this.browserManager = null;
        this.outputBasePath = outputBasePath;
        this.db = null;
        this.isInitialized = false;
        this.defaultImage = path.join(process.cwd(), 'plugins/xrk-plugin/resources/error.jpg');
        this.setupCleanup();
    }

    async init() {
        try {
            if (!this.isInitialized) {
                this.browserManager = await BrowserManager.getInstance();
                this.db = await DB.getInstance();
                this.isInitialized = true;
            }
        } catch (error) {
            logger.error('初始化ScreenshotManager失败:', error);
            // 错误处理 - 继续运行
        }
    }

    setupCleanup() {
        process.on('exit', async () => {
            if (this.browserManager) {
                await this.browserManager.closeAll();
            }
        });
        
        process.on('SIGINT', async () => {
            if (this.browserManager) {
                await this.browserManager.closeAll();
            }
            process.exit();
        });
    }

    _getCacheKey(target, config) {
        return JSON.stringify({ target, config });
    }

    async _checkCache(target, imageName, config) {
        try {
            const configStr = JSON.stringify(config);
            
            const cachedImage = await this.db.get(
                `SELECT image_path FROM screenshot_cache 
                 WHERE target = ? AND config = ?`,
                target, configStr
            );
            
            if (cachedImage && fs.existsSync(cachedImage.image_path)) {
                const imagePath = path.join(this.outputBasePath, `${imageName}.${config.type}`);
                fs.copyFileSync(cachedImage.image_path, imagePath);
                
                // 更新缓存命中统计
                const today = new Date().toISOString().split('T')[0];
                await this.db.run(
                    `INSERT INTO cache_stats (date, hits) 
                     VALUES (?, 1)
                     ON CONFLICT(date) DO UPDATE SET hits = hits + 1`,
                    today
                );
                
                return imagePath;
            }
        } catch (error) {
            console.warn('检查缓存失败:', error);
            // 错误处理 - 继续运行
        }
        
        return null;
    }

    async _updateCache(target, config, imagePath) {
        try {
            const configStr = JSON.stringify(config);
            const now = Date.now();
            
            await this.db.run(
                `INSERT OR REPLACE INTO screenshot_cache 
                 (target, config, image_path, created_at)
                 VALUES (?, ?, ?, ?)`,
                target, configStr, imagePath, now
            );
            
            // 删除旧缓存条目（超过1小时）
            const oneHourAgo = now - 3600000;
            await this.db.run(
                'DELETE FROM screenshot_cache WHERE created_at < ?',
                oneHourAgo
            );
        } catch (error) {
            console.warn('更新缓存失败:', error);
            // 错误处理 - 继续运行
        }
    }

    async takeScreenshot(target, imageName, config = {}) {
        // 如果尚未初始化，执行初始化
        if (!this.isInitialized) {
            await this.init();
        }
        
        if (this.browserManager) {
            this.browserManager.startMonitoring();
        }

        // 截图配置参数说明
        const defaultConfig = {
            width: null,                  // 截图宽度，为null时自动适应内容
            height: null,                 // 截图高度，为null时自动适应内容
            quality: 100,                 // JPEG图片质量(1-100)
            type: 'jpeg',                 // 图片类型(jpeg, png)
            deviceScaleFactor: shot_Config.screen_shot_quality || 1, // 设备缩放比例
            selector: null,               // 截取特定元素的CSS选择器
            waitForSelector: null,        // 等待特定元素出现的CSS选择器
            waitForTimeout: null,         // 等待固定时间(毫秒)
            waitUntil: 'networkidle2',    // 页面加载完成条件
            fullPage: false,              // 是否截取整个页面
            topCutRatio: 0,               // 顶部裁剪比例(0-1)
            bottomCutRatio: 0,            // 底部裁剪比例(0-1)
            leftCutRatio: 0,              // 左侧裁剪比例(0-1)
            rightCutRatio: 0,             // 右侧裁剪比例(0-1)
            cacheTime: 3600,              // 缓存时间(秒)，0表示不缓存
            emulateDevice: null,          // 模拟设备，如'iPhone 12'
            userAgent: null,              // 自定义UA
            timeout: 120000,              // 总超时时间(毫秒)，增加到2分钟
            scrollToBottom: true,         // 是否滚动到底部
            cookies: null,                // 自定义Cookie
            allowFailure: true,           // 默认允许失败并返回默认图片
            defaultImage: this.defaultImage, // 失败时的默认图片
            authentication: null,         // HTTP认证
            clip: null,                   // 直接设置裁剪区域
            omitBackground: false,        // 是否省略背景
            encoding: 'binary',           // 图片编码(binary, base64)
            hideScrollbars: true,         // 隐藏滚动条
            javascript: true,             // 是否启用JavaScript
            dark: false,                  // 暗黑模式
            retryCount: 2,                // 重试次数
            retryDelay: 1000              // 重试间隔(毫秒)
        };

        const finalConfig = { ...defaultConfig, ...config };
        const browserId = 'singleton-browser';
        
        // 确保输出目录存在
        if (!fs.existsSync(this.outputBasePath)) {
            try {
                fs.mkdirSync(this.outputBasePath, { recursive: true });
            } catch (err) {
                logger.error('创建输出目录失败:', err);
                // 如果允许失败，返回默认图片
                if (finalConfig.allowFailure && finalConfig.defaultImage) {
                    const defaultImagePath = path.join(this.outputBasePath, `${imageName}.${finalConfig.type}`);
                    try {
                        if (!fs.existsSync(path.dirname(defaultImagePath))) {
                            fs.mkdirSync(path.dirname(defaultImagePath), { recursive: true });
                        }
                        if (fs.existsSync(finalConfig.defaultImage)) {
                            fs.copyFileSync(finalConfig.defaultImage, defaultImagePath);
                            return defaultImagePath;
                        }
                    } catch (copyErr) {
                        logger.error('复制默认图片失败:', copyErr);
                    }
                }
                throw err;
            }
        }
        
        // 尝试从缓存获取
        try {
            const cachedPath = await this._checkCache(target, imageName, finalConfig);
            if (cachedPath) {
                logger.info(`使用缓存的截图: ${cachedPath}`);
                return cachedPath;
            }
        } catch (err) {
            console.warn('检查缓存失败:', err);
            // 继续，尝试重新生成截图
        }

        let page = null;
        let browser = null;
        
        // 添加重试逻辑
        for (let retryAttempt = 0; retryAttempt <= finalConfig.retryCount; retryAttempt++) {
            try {
                // 设置截图超时
                const timeoutPromise = new Promise((_, reject) => {
                    setTimeout(() => reject(new Error(`截图超时: ${finalConfig.timeout}ms`)), finalConfig.timeout);
                });
                
                if (!browser) {
                    browser = await this.browserManager.getBrowser().catch(err => {
                        logger.error('获取浏览器实例失败:', err);
                        throw err;
                    });
                }
                
                if (!page) {
                    page = await browser.newPage().catch(err => {
                        logger.error('创建新页面失败:', err);
                        throw err;
                    });
                }
                
                // 记录页面超时
                const now = Date.now();
                try {
                    await this.db.run(
                        `INSERT OR REPLACE INTO browser_last_used (browser_id, last_used) 
                         VALUES (?, ?)`,
                        browserId, now
                    );
                } catch (err) {
                    console.warn('更新浏览器使用时间失败:', err);
                    // 继续流程
                }
                
                if (finalConfig.authentication) {
                    await page.authenticate(finalConfig.authentication);
                }
                
                if (finalConfig.cookies) {
                    await page.setCookie(...finalConfig.cookies);
                }
                
                if (finalConfig.userAgent) {
                    await page.setUserAgent(finalConfig.userAgent);
                }
                
                if (finalConfig.emulateDevice) {
                    try {
                        const puppeteer = await import('puppeteer');
                        const devices = puppeteer.devices;
                        const device = devices[finalConfig.emulateDevice];
                        if (device) {
                            await page.emulate(device);
                        } else {
                            console.warn(`未知设备: ${finalConfig.emulateDevice}`);
                        }
                    } catch (err) {
                        console.warn('模拟设备失败:', err);
                        await page.setViewport({
                            width: finalConfig.width || 800,
                            height: finalConfig.height || 800,
                            deviceScaleFactor: finalConfig.deviceScaleFactor,
                            isMobile: finalConfig.isMobile || false,
                            hasTouch: finalConfig.hasTouch || false,
                            isLandscape: finalConfig.isLandscape || false
                        });
                    }
                } else {
                    await page.setViewport({
                        width: finalConfig.width || 800,
                        height: finalConfig.height || 800,
                        deviceScaleFactor: finalConfig.deviceScaleFactor,
                        isMobile: finalConfig.isMobile || false,
                        hasTouch: finalConfig.hasTouch || false,
                        isLandscape: finalConfig.isLandscape || false
                    });
                }
                
                await page.setJavaScriptEnabled(finalConfig.javascript);
                
                if (finalConfig.dark) {
                    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
                }
                
                const isUrl = target.startsWith('http') || target.startsWith('https');
                try {
                    await Promise.race([
                        page.goto(isUrl ? target : `file://${target}`, {
                            waitUntil: finalConfig.waitUntil,
                            timeout: finalConfig.timeout - 5000
                        }),
                        timeoutPromise
                    ]);
                } catch (err) {
                    logger.error('页面加载失败:', err);
                    throw err;
                }
                
                if (finalConfig.waitForSelector) {
                    try {
                        await page.waitForSelector(finalConfig.waitForSelector, { 
                            timeout: 30000 
                        });
                    } catch (err) {
                        console.warn(`等待选择器失败: ${finalConfig.waitForSelector}`, err);
                        // 继续执行
                    }
                }
                
                if (finalConfig.waitForTimeout) {
                    await page.waitForTimeout(finalConfig.waitForTimeout);
                }
                
                if (finalConfig.scrollToBottom) {
                    try {
                        await page.evaluate(async () => {
                            await new Promise((resolve) => {
                                let totalHeight = 0;
                                const distance = 100;
                                const timer = setInterval(() => {
                                    window.scrollBy(0, distance);
                                    totalHeight += distance;
                                    if (totalHeight >= document.body.scrollHeight) {
                                        clearInterval(timer);
                                        window.scrollTo(0, 0);
                                        resolve();
                                    }
                                }, 100);
                            });
                        });
                    } catch (err) {
                        console.warn('滚动到底部失败:', err);
                        // 继续执行
                    }
                }
                
                if (finalConfig.hideScrollbars) {
                    try {
                        await page.evaluate(() => {
                            document.documentElement.style.overflow = 'hidden';
                            document.body.style.overflow = 'hidden';
                        });
                    } catch (err) {
                        console.warn('隐藏滚动条失败:', err);
                        // 继续执行
                    }
                }
                
                const contentDimensions = await page.evaluate(() => {
                    return {
                        width: Math.max(
                            document.body.scrollWidth,
                            document.documentElement.scrollWidth,
                            document.body.offsetWidth,
                            document.documentElement.offsetWidth,
                            document.body.clientWidth,
                            document.documentElement.clientWidth
                        ),
                        height: Math.max(
                            document.body.scrollHeight,
                            document.documentElement.scrollHeight,
                            document.body.offsetHeight,
                            document.documentElement.offsetHeight,
                            document.body.clientHeight,
                            document.documentElement.clientHeight
                        )
                    };
                }).catch(err => {
                    console.warn('获取内容尺寸失败:', err);
                    return { width: 800, height: 800 }; // 返回默认尺寸
                });
                
                if (!config.width) {
                    finalConfig.width = contentDimensions.width;
                }
                if (!config.height) {
                    finalConfig.height = contentDimensions.height;
                }
                
                if (!finalConfig.fullPage) {
                    await page.setViewport({
                        width: finalConfig.width,
                        height: finalConfig.height,
                        deviceScaleFactor: finalConfig.deviceScaleFactor
                    });
                }
                
                const screenshotOptions = await this.prepareScreenshotOptions(page, finalConfig);
                const imagePath = await this.captureAndSave(page, imageName, screenshotOptions, finalConfig);
                
                if (finalConfig.cacheTime > 0) {
                    await this._updateCache(target, finalConfig, imagePath);
                }
                
                // 更新渲染统计
                try {
                    const today = new Date().toISOString().split('T')[0];
                    await this.db.run(
                        `INSERT INTO render_stats (date, total_renders) 
                         VALUES (?, 1)
                         ON CONFLICT(date) DO UPDATE SET total_renders = total_renders + 1`,
                        today
                    );
                    
                    // 更新图片类型统计
                    await this.db.run(
                        `INSERT INTO image_stats (date, type, count) 
                         VALUES (?, ?, 1)
                         ON CONFLICT(date, type) DO UPDATE SET count = count + 1`,
                        today, finalConfig.type
                    );
                } catch (err) {
                    console.warn('更新统计信息失败:', err);
                    // 继续流程
                }
                
                if (this.browserManager) {
                    await this.browserManager.incrementRenderCount(browserId);
                }
                
                return imagePath;
            } catch (error) {
                logger.error(`截图失败 (尝试 ${retryAttempt+1}/${finalConfig.retryCount+1}):`, error);
                
                // 如果不是最后一次尝试，则重试
                if (retryAttempt < finalConfig.retryCount) {
                    logger.info(`将在 ${finalConfig.retryDelay}ms 后重试...`);
                    
                    // 关闭之前的页面，防止内存泄漏
                    if (page) {
                        try {
                            await page.close();
                        } catch (err) {
                            console.warn('关闭页面失败:', err);
                        }
                        page = null;
                    }
                    
                    // 如果浏览器实例有问题，重置它
                    if (error.message.includes('浏览器') || error.message.includes('Protocol')) {
                        try {
                            if (browser) {
                                try {
                                    await browser.close();
                                } catch (err) {
                                    console.warn('关闭浏览器失败:', err);
                                }
                            }
                            browser = null;
                            
                            // 可选：重置浏览器管理器中的实例
                            if (this.browserManager) {
                                await this.browserManager.resetBrowser(browserId);
                            }
                        } catch (err) {
                            console.warn('重置浏览器失败:', err);
                        }
                    }
                    
                    await new Promise(resolve => setTimeout(resolve, finalConfig.retryDelay));
                    continue;
                }
                
                // 记录错误
                try {
                    const today = new Date().toISOString().split('T')[0];
                    const now = new Date().toISOString();
                    
                    await this.db.run(
                        `INSERT INTO error_logs (date, time, error, stack, target)
                         VALUES (?, ?, ?, ?, ?)`,
                        today, now, error.message, error.stack, target
                    );
                } catch (err) {
                    console.warn('记录错误失败:', err);
                }
                
                // 使用默认图片
                if (finalConfig.allowFailure && finalConfig.defaultImage) {
                    const defaultImagePath = path.join(this.outputBasePath, `${imageName}.${finalConfig.type}`);
                    
                    try {
                        if (!fs.existsSync(path.dirname(defaultImagePath))) {
                            fs.mkdirSync(path.dirname(defaultImagePath), { recursive: true });
                        }
                        
                        if (fs.existsSync(finalConfig.defaultImage)) {
                            fs.copyFileSync(finalConfig.defaultImage, defaultImagePath);
                            logger.info(`使用默认图片: ${defaultImagePath}`);
                            return defaultImagePath;
                        } else {
                            console.warn(`默认图片不存在: ${finalConfig.defaultImage}`);
                        }
                    } catch (copyErr) {
                        logger.error('复制默认图片失败:', copyErr);
                    }
                }
                
                throw error;
            } finally {
                if (page) {
                    try {
                        await page.close();
                    } catch (closeError) {
                        console.warn('关闭页面失败:', closeError);
                    }
                }
            }
        }
    }

    async prepareScreenshotOptions(page, config) {
        const screenshotOptions = {
            type: config.type,
            quality: config.type === 'jpeg' ? config.quality : undefined,
            fullPage: config.fullPage,
            omitBackground: config.omitBackground,
            encoding: config.encoding === 'base64' ? 'base64' : 'binary'
        };
        
        if (config.fullPage) {
            return screenshotOptions;
        }
        
        if (config.clip && typeof config.clip === 'object') {
            screenshotOptions.clip = config.clip;
            return screenshotOptions;
        }
        
        let contentDimensions;
        try {
            contentDimensions = await page.evaluate(() => {
                return {
                    width: Math.max(
                        document.body.scrollWidth,
                        document.documentElement.scrollWidth,
                        document.body.offsetWidth,
                        document.documentElement.offsetWidth,
                        document.body.clientWidth,
                        document.documentElement.clientWidth
                    ),
                    height: Math.max(
                        document.body.scrollHeight,
                        document.documentElement.scrollHeight,
                        document.body.offsetHeight,
                        document.documentElement.offsetHeight,
                        document.body.clientHeight,
                        document.documentElement.clientHeight
                    )
                };
            });
        } catch (err) {
            console.warn('获取内容尺寸失败:', err);
            contentDimensions = { width: 800, height: 800 }; // 默认尺寸
        }
        
        let { width, height } = contentDimensions;
        let x = 0;
        let y = 0;
        
        const actualLeftCut = Math.floor(width * config.leftCutRatio);
        const actualRightCut = Math.floor(width * config.rightCutRatio);
        x += actualLeftCut;
        width -= actualLeftCut + actualRightCut;
        
        const actualTopCut = Math.floor(height * config.topCutRatio);
        const actualBottomCut = Math.floor(height * config.bottomCutRatio);
        y += actualTopCut;
        height -= actualTopCut + actualBottomCut;
        
        // 确保尺寸不会为负
        width = Math.max(width, 1);
        height = Math.max(height, 1);
        
        screenshotOptions.clip = { x, y, width, height };
        
        if (config.selector) {
            try {
                const elementHandle = await page.$(config.selector);
                if (elementHandle) {
                    const box = await elementHandle.boundingBox();
                    if (box) {
                        const clipX = Math.max(x, box.x);
                        const clipY = Math.max(y, box.y);
                        const clipWidth = Math.min(width, box.width);
                        const clipHeight = Math.min(height, box.height);
                        
                        if (clipWidth > 0 && clipHeight > 0) {
                            screenshotOptions.clip = {
                                x: clipX,
                                y: clipY,
                                width: clipWidth,
                                height: clipHeight
                            };
                        }
                    }
                }
            } catch (error) {
                console.warn(`处理选择器时出错: ${error.message}`);
                // 继续使用默认裁剪区域
            }
        }
        
        return screenshotOptions;
    }

    async captureAndSave(page, imageName, screenshotOptions, config) {
        try {
            const imageBuffer = await page.screenshot(screenshotOptions);
            
            // 确保输出目录存在
            const outputDir = path.dirname(path.join(this.outputBasePath, `${imageName}.${config.type}`));
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, { recursive: true });
            }
            
            const imagePath = path.join(this.outputBasePath, `${imageName}.${config.type}`);
            
            if (typeof imageBuffer === 'string') {
                fs.writeFileSync(imagePath, imageBuffer, 'base64');
            } else {
                fs.writeFileSync(imagePath, imageBuffer);
            }
            
            return imagePath;
        } catch (error) {
            logger.error('保存截图失败:', error);
            throw new Error(`保存截图失败: ${error.message}`);
        }
    }
    
    async getStats() {
        try {
            // 获取总渲染次数
            const renderStats = await this.db.get(
                `SELECT SUM(total_renders) as totalRenders 
                 FROM render_stats`
            );
            
            // 获取错误数量
            const errorStats = await this.db.get(
                `SELECT COUNT(*) as errorsCount 
                 FROM error_logs`
            );
            
            // 获取图片类型统计
            const imageStats = await this.db.all(
                `SELECT type, SUM(count) as count 
                 FROM image_stats 
                 GROUP BY type`
            );
            
            // 获取缓存命中次数
            const cacheStats = await this.db.get(
                `SELECT SUM(hits) as cacheHits 
                 FROM cache_stats`
            );
            
            const byType = {};
            if (imageStats) {
                imageStats.forEach(stat => {
                    byType[stat.type] = stat.count;
                });
            }
            
            return {
                totalRenders: renderStats ? renderStats.totalRenders || 0 : 0,
                errorsCount: errorStats ? errorStats.errorsCount || 0 : 0,
                byType,
                cacheHits: cacheStats ? cacheStats.cacheHits || 0 : 0
            };
        } catch (error) {
            logger.error('获取统计信息失败:', error);
            return {
                totalRenders: 0,
                errorsCount: 0,
                byType: {},
                cacheHits: 0,
                error: error.message
            };
        }
    }
}

let screenshotManagerInstance = null;

export async function takeScreenshot(target, imageName, config = {}) {
    const outputBasePath = path.join(process.cwd(), 'plugins/xrk-plugin/resources/help_other');
    
    try {
        if (!screenshotManagerInstance) {
            screenshotManagerInstance = new ScreenshotManager(outputBasePath);
            await screenshotManagerInstance.init();
        }
        
        return await screenshotManagerInstance.takeScreenshot(target, imageName, config);
    } catch (error) {
        logger.error('截图失败:', error);
        
        try {
            const logDir = path.join(process.cwd(), 'logs');
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, { recursive: true });
            }
            
            const logPath = path.join(logDir, 'screenshot-errors.log');
            const logMessage = `[${new Date().toISOString()}] 截图失败 - 目标: ${target}, 错误: ${error.message}\n${error.stack}\n\n`;
            fs.appendFileSync(logPath, logMessage);
        } catch (logError) {
            logger.error('写入错误日志失败:', logError);
        }
        
        // 返回默认图片路径
        const defaultImagePath = path.join(outputBasePath, `${imageName}.${config.type || 'jpeg'}`);
        const errorImage = path.join(process.cwd(), 'plugins/xrk-plugin/resources/error.jpg');
        
        try {
            if (!fs.existsSync(path.dirname(defaultImagePath))) {
                fs.mkdirSync(path.dirname(defaultImagePath), { recursive: true });
            }
            
            if (fs.existsSync(errorImage)) {
                fs.copyFileSync(errorImage, defaultImagePath);
                return defaultImagePath;
            }
        } catch (copyErr) {
            logger.error('复制默认错误图片失败:', copyErr);
        }
        
        throw error;
    }
}

export async function getScreenshotStats() {
    const outputBasePath = path.join(process.cwd(), 'plugins/xrk-plugin/resources/help_other');
    
    try {
        if (!screenshotManagerInstance) {
            screenshotManagerInstance = new ScreenshotManager(outputBasePath);
            await screenshotManagerInstance.init();
        }
        
        return await screenshotManagerInstance.getStats();
    } catch (error) {
        logger.error('获取统计信息失败:', error);
        return {
            totalRenders: 0,
            errorsCount: 0,
            byType: {},
            cacheHits: 0,
            error: error.message
        };
    }
}

export async function closeAllBrowsers() {
    if (screenshotManagerInstance && screenshotManagerInstance.browserManager) {
        try {
            await screenshotManagerInstance.browserManager.closeAll();
        } catch (error) {
            logger.error('关闭所有浏览器失败:', error);
        }
    }
}

// 在进程退出时清理数据库连接
process.on('exit', async () => {
    try {
        await DB.close();
    } catch (error) {
        logger.error('关闭数据库连接失败:', error);
    }
});

// 添加未捕获异常处理
process.on('uncaughtException', (err) => {
    logger.error('未捕获的异常:', err);
    // 不退出进程，记录错误并继续运行
});

// 添加未处理的Promise拒绝处理
process.on('unhandledRejection', (reason, promise) => {
    logger.error('未处理的Promise拒绝:', reason);
    // 不退出进程，记录错误并继续运行
});

export { ScreenshotManager, BrowserManager };