# 兆辉投标情报台

为江苏兆辉防腐科技做的本地投标情报采集工具，每天自动搜索钢衬四氟、钢衬 PE/PO、储罐、塔器、反应釜、管道相关的项目、采购和招标公告。

## 快速启动

1. 双击 `启动软件.command`。
2. 浏览器打开 `http://localhost:8710`。
3. 在“数据源”页保存中能联合、企查查、中国化学账号，点击“打开登录”并完成登录，再点“完成并保存会话”。
4. 在“采集设置”页确认关键词和每日时间，默认每天 07:00 自动采集。

也可以手动启动：

```bash
cd /Users/linjunjie/Documents/Codex/2026-08-04/2-pe-po-2/outputs/zhaohui-bid-hunter
/Users/linjunjie/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node server/index.js
```

## 数据源

- 中能联合（cceup.com）：项目托管 + 项目采购，需要登录会话。
- 全国招标投标公共服务平台：采购公告、变更公告、结果公示。
- 中国化学电子招标平台（bid.cncecyc.com）：公开搜索即可采集招标、采购、成交公告；账号登录入口已接入，会话保存在本机。
- 搜狗全网搜索：招标、采购关键词。
- 企查查：手动或自动补充线索中的企业信息。
- 水滴信用：手动或自动补充线索中的企业信息，账号登录后会话会保存在本机。

账号密码只保存在本机 `data/secrets.json`，不会上传。

## 每日自动采集

软件运行时，会在设置的每日时间自动采集一次。如果电脑关机，当天开机后只要软件启动，也会补采当天数据。

如果想开机自动运行，双击 `安装开机自启.command`，之后不需要手动打开软件。安装后访问地址仍然是 `http://localhost:8710`。
不需要开机自启时，双击 `停止开机自启.command` 即可。

## 微信推送

在“采集设置”页开启微信推送，支持三种方式：

- PushPlus：填写 Token，最简单，扫码关注后即可。
- Server酱：填写 SendKey。
- 企业微信群机器人：填写 Webhook。

每次采集有新线索时，会自动推送当天新增线索标题、来源、匹配分和原文链接。可以先点“发送测试”验证设置。

## 上传 GitHub 与部署阿里云

项目已经附带部署脚本：

- `deploy/deploy-github.sh`：把项目推送到 `github.com/zhaohui332/zhaohui-bid-hunter`。
- `deploy/deploy-aliyun.sh`：把项目同步到阿里云服务器并注册为系统服务。
- `Dockerfile` / `docker-compose.yml`：也可以直接用 Docker 部署。

上传脚本使用 GitHub API，不依赖本机 git。部署到阿里云时，脚本会顺便把本机的 `data/storage-*.json` 登录会话同步过去，服务器上不用重新登录。

运行脚本前需要准备：

- GitHub Personal Access Token（仓库权限）。
- 阿里云服务器地址和登录账号，例如 `root@1.2.3.4`。

## 导出

在“线索库”页筛选后，点击右上角“导出CSV”，可用 Excel 打开。

## 常见问题

- 登录窗口打开后未操作：在数据源页重新点击“打开登录”。
- 企查查触发验证：稍后重试，或重新登录企查查。
- 端口被占用：设置环境变量 `PORT=8711` 后启动。
- 想清空全部数据：停止软件后删除 `data/zhbid.db`，重新启动。

## 线上访问

当前阿里云地址：`http://47.116.41.25/zhbid/`，由 Nginx 反代到 8710 端口。
