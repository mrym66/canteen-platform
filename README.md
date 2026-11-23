# 食堂大数据分析与智能决策平台

面向高校食堂场景的一体化平台：学生/教师点餐与充值，食堂员工维护菜品与库存，管理者查看经营大屏并获取 AI 经营建议。

- **前端**：原生 HTML / CSS / JavaScript 单页应用（SPA），ECharts 本地化，无构建步骤
- **接口层**：同源转发，前端只与本站 `/api/*` 通信，不暴露内部服务地址
- **服务端**：业务接口与数据落库，账号与业务数据分库存放
- **AI**：由服务端统一代理调用大模型，密钥不下发到浏览器

## 功能概览

| 角色 | 能力 |
|---|---|
| 学生 / 教师 | 浏览菜品、下单、钱包充值与流水、评价打分、AI 推荐 |
| 食堂员工 | 菜品上下架、库存与备餐量维护、订单处理 |
| 管理员 | 经营大屏、统计报表、充值审核、访客与设备概览、运维信息 |

## 目录结构

```
frontend/                  前端站点
├─ index.html              单页入口
├─ css/app.css
├─ js/
│  ├─ app.js               路由与全部视图
│  ├─ data.js              前端数据仓库（演示数据与离线降级）
│  ├─ ai.js                AI 客户端（走同源 /api/ai）
│  ├─ track.js             埋点与访客上报
│  ├─ login-boot.js        登录态引导
│  └─ echarts.min.js
├─ assets/                 背景视频、图标、占位图
├─ functions/              接口层
│  ├─ api/ai.js            大模型网关
│  ├─ api/auth.js          登录 / 注册 / 改密 / 退出
│  ├─ api/backend/[[path]].js  业务接口统一转发
│  ├─ api/{recharge,track,visitors}.js
│  └─ _lib/{proxy,session,accounts,http}.js
├─ _headers                安全响应头
├─ _routes.json            接口路由范围
└─ wrangler.toml           接口层配置文件

backend/                   服务端
├─ app.py                  业务 API（登录、下单、充值、统计、运维）
└─ migrate.py              数据库迁移脚本
```

## 说明

- 仓库内 `assets/wechat-qr.jpg` 与 `assets/qr-app.png` 是**占位图**，使用时请替换为自己的收款码与下载二维码。
- 演示数据由 `js/data.js` 在浏览器本地生成，用于无服务端时的离线演示；接入服务端后以服务端数据为准。
- 未附安卓安装包，如需客户端请自行打包。
