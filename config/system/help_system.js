/*
* 此配置文件为系统使用，请勿修改，否则可能无法正常使用
*
*/

export const helpCfg = {
  "themeSet": false,
  "title": "baizi帮助",
  "subTitle": "Yunzai-Bot & baizi-plugin",
  "colWidth": 265,
  "theme": "all",
  "themeExclude": [
    "default"
  ],
  "colCount": 3,
  "bgBlur": true
}
export const helpList = [
  {
    "group": "基本功能",
    "list": [
      {
        "icon": 41,
        "title": "#随机emo文案",
        "desc": "#随机发送一条emo的文案"
      },
      {
        "icon": 10,
        "title": "#随机治愈文案",
        "desc": "随机发送一条治愈系的文案"
      },
      {
        "icon": 9,
        "title": "#鸡音盒",
        "desc": "小黑子，被我抓住了吧"
      },
      {
        "icon": 8,
        "title": "#遥遥领先",
        "desc": "手机里有很严重的杂音"
      },
      {
        "icon": 7,
        "title": "#菜就多练",
        "desc": "菜就多练，输不起就别玩"
      },
      {
        "icon": 6,
        "title": "#模块传奇",
        "desc": "云端不是最强的，模块才是王道"
      },
      {
        "icon": 5,
        "title": "#投喂榜",
        "desc": "查看赞助列表"
      },
      {
        "icon": 4,
        "title": "#赞助/我要赞助",
        "desc": "赞助作者支持作者"
      }
    ]
  },
  {
    "group": "管理命令，仅管理员可用",
    "auth": "master",
    "list": [
      {
        "icon": 3,
        "title": "#baizi(强制)更新",
        "desc": "更新baizi插件"
      },
      {
        "icon": 2,
        "title": "#baizi设置",
        "desc": "配置baizi功能"
      },
      {
        "icon": 1,
        "title": "#baizi版本  #baizi更新日志",   
        "desc": "查看当前版本和更新日志"
      }
    ]
  }
]
export const isSys = true