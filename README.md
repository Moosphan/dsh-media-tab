# dsh-media-tab

[![test](https://github.com/Moosphan/dsh-media-tab/actions/workflows/test.yml/badge.svg)](https://github.com/Moosphan/dsh-media-tab/actions/workflows/test.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![DSH](https://img.shields.io/badge/DSH-0.2.x-4D6BFE)](#要求)
[![version](https://img.shields.io/badge/version-0.1.0-blue)](CHANGELOG.md)

**在 DeepSeek Harness 里直接播放本地视频和音频。**
回复下方内联播放器 · 右侧栏独立播放页 · 最近播放列表 · 零运行时依赖 · 零 ffmpeg

[简体中文](README.md) | [English](README.en.md)

![内联播放器](docs/inline-player.webp)

*回复下方的内联播放器：宽度撑满、原生控件、支持拖动 / 全屏 / 画中画。*

## 目录

- [为什么](#为什么)
- [特性](#特性)
- [要求](#要求)
- [安装](#安装)
- [快速开始](#快速开始)
- [用法](#用法)
- [支持的格式](#支持的格式)
- [工作方式](#工作方式)
- [安全与隐私](#安全与隐私)
- [数据与配置](#数据与配置)
- [排错](#排错)
- [FAQ](#faq)
- [开发](#开发)
- [路线图](#路线图)
- [贡献](#贡献)
- [致谢](#致谢)
- [License](#license)

## 为什么

DSH 0.2.1-rc.3 的消息渲染块只有 `text / image / file / table`，客户端 bundle 里没有任何 `<video>` / `<audio>`；右侧栏文档预览只注册了 Markdown、代码、图片、PDF、Office、HTML 和纯文本。于是 agent 用 `present` 交付一个 mp4 时：

- 点交付卡片 → 右侧栏显示「不可预览」
- 点卡片上的打开按钮 → 跳到系统默认播放器（QuickTime / IINA / VLC）

`dsh-media-tab` 只补三件事：

1. **内联播放**：本轮 `present` 的音视频自动出现在回复下方，模型不需要额外调用
2. **独立播放页**：点交付卡片或文件链接，右侧栏变成播放器
3. **最近播放**：播放页底部列出最近 20 条，点一条即切换

它**不是**媒体库，也不是转码器。没有收藏、搜索、标签、播放列表、HLS、远程 URL。范围小是刻意的。

## 特性

| 能力 | 说明 |
|---|---|
| **内联播放** | `present` 交付的音视频直接渲染在回复下方；超过 3 个折叠 |
| **独立播放页** | 接管 `documentPreviews`，媒体文件不再落入「不可预览」 |
| **最近播放** | 20 条、按播放时间倒序、失效文件标灰、可清空；桌面端与 Web 端共享 |
| **原生控件** | 播放、拖动、音量、倍速、全屏、画中画由浏览器提供，不重造轮子 |
| **HTTP Range** | 200 / 206 / 416 / HEAD 完整实现，大文件不整读进内存 |
| **桌面端可 seek** | 签名绝对地址直连主机端口，绕开 `dsh-app://` 转发丢 `Content-Length` 的问题 |
| **单实例** | 新的播放会暂停其它播放器，不会两个声音叠在一起 |
| **错误分级** | 文件不存在、无权限、编码不支持、路由未就绪分别给出不同文案 |
| **零依赖** | 不 import 任何 `@deepseek-ai/*` 运行时模块，不打包二进制 |
| **安全默认** | 扩展名白名单、`realpath`、Host/Origin 围栏、HMAC 签名、`0600` 密钥 |

## 要求

- DSH `>=0.2.0-rc.1 <0.4.0-0`（已在 **0.2.1-rc.3 桌面端**实测内联、侧栏、音频与最近播放）
- 桌面端或 Web 端均可
- **不需要 ffmpeg**，也不需要额外的 Node 运行时
- 仅开发/测试需要 Node 22+

## 安装

### 从 GitHub 安装

```sh
dsh plugin add github:Moosphan/dsh-media-tab
```

### 从 npm 安装（发布后）

```sh
dsh plugin add dsh-media-tab
```

### 本地开发

```sh
dsh plugin --profile desktop add link:/absolute/path/to/dsh-media-tab
```

装完**重启 DSH**：宿主路由在启动时注册。之后客户端改动刷新页面即可，宿主改动仍需重启。

### 验证安装

```sh
curl -s http://127.0.0.1:<port>/dsh-media-tab/api/health
# {"ok":true,"name":"dsh-media-tab","version":"0.1.0"}
```

插件页（侧栏 → 插件）应出现「媒体播放」卡片。

## 快速开始

1. 让模型交付一个本地视频：

   ```text
   present({ files: [{ path: "/Users/me/Movies/demo.mp4" }] })
   ```

2. 播放器出现在回复下方，可直接播放、拖动。
3. 点「在侧栏打开」或交付卡片 → 右侧栏播放页。
4. 播放页底部出现「最近播放」，点条目即切换。

也可以直接说「播一下 /path/a.mp4」，模型会调用 `play_media`。

## 用法

### present（推荐）

模型用自带的 `present` 工具交付音视频，播放器自动出现，同时写入官方 `deliverables/presented` 事件，交付卡片和侧栏都能打开同一个文件。

### play_media

| 参数 | 必填 | 说明 |
|---|---|---|
| `path` | 是 | 本地路径，支持 `~` 与会话工作目录下的相对路径 |
| `title` | 否 | 播放器标题，默认文件名 |
| `autoplay` | 否 | 自动播放（浏览器通常会拦） |
| `loop` | 否 | 循环播放 |

返回结果里带一个签名绝对 URL，可直接在浏览器打开。

### 独立播放页

- 点交付卡片 → 右侧栏播放页
- 或点内联播放器右上角「在侧栏打开」
- 播放页底部固定「最近播放」，点击条目在当前页内切换

### 关闭 / 移除

- 播放器：点暂停即可，关闭标签页会停止播放
- 插件：侧栏 → 插件 → 已安装插件 → 卸载，然后重启 DSH

## 支持的格式

播放能力由 Chromium 的解码器决定：

| 类别 | 格式 |
|---|---|
| 视频 | `.mp4` `.m4v` `.mov` `.webm` `.ogv` `.mkv` `.3gp` |
| 音频 | `.mp3` `.wav` `.ogg` `.oga` `.m4a` `.aac` `.flac` `.opus` `.weba` |
| 取决于编码 | `.mkv`、`.3gp`、HEVC 的 `.mov`：与文件编码和操作系统有关（macOS / Windows 有平台解码器，Linux 可能没有） |
| 不支持 | `.avi` `.flv` `.wmv` `.wma` `.ts` `.mpg` `.mpeg` `.rm` `.rmvb` `.amr` `.ape` `.ac3` `.dts` `.mid` |

不支持的容器不会给黑框，而是给出可复制的命令：

```sh
# 视频
ffmpeg -i in.avi -c:v libx264 -c:a aac -movflags +faststart out.mp4
# 音频
ffmpeg -i in.wma -c:a aac out.m4a
```

插件本身**不依赖 ffmpeg**，也不内置转码。

## 工作方式

### 挂载点

| 位置 | DSH 挂载点 | 数据来源 |
|---|---|---|
| 回复下方 | `conversation.chat.turnTail` | `turn.data.get('deliverables').presented` |
| 侧栏播放页 | `documentPreviews` 渲染器 + `sidebar.right.tab.document` | 文件地址（交付卡片 / 文件链接 / 最近列表） |
| 工具链接 | `play_media` 结果 | 签名绝对 URL |

### 请求路径

```text
present / play_media
        │
        └─ deliverables/presented ──► turnTail ──┐
                                                  │
交付卡片 / 文件链接 ──► documentPreviews ─────────┼──► MediaPlayer
                                                  │        │
最近播放 ─────────────────────────────────────────┘        │ GET /api/sign（带登录 cookie）
                                                           ▼
                                              绝对地址 + HMAC 签名 URL
                                                           │ <video src>
                                                           ▼
                                     /dsh-media-tab/media?t=…  ── Range ──► 磁盘
```

### 为什么播放地址是绝对的

桌面端页面加载自 `dsh-app://app`，普通请求由 Electron 转发到本地 HTTP 服务。转发器在 `forwardWebRequest` 里会删除 `Content-Length`，206 响应因此没有长度，Chromium 把媒体流判定为「不可 seek」——表现就是进度条拖不动、暂停拖拽不换帧。

所以播放器先向 `/api/sign` 换一个**绝对主机地址**的签名 URL，`<video>` 直连 `http://127.0.0.1:<port>`，`Content-Length` / `Content-Range` 完整保留，seek 正常。

### 路由

| 路由 | 鉴权 | 用途 |
|---|---|---|
| `GET /dsh-media-tab/api/health` | Host 围栏 | 客户端探测宿主是否就绪 |
| `GET /dsh-media-tab/api/sign?p=` | 登录 cookie + 围栏 | 换取绝对签名 URL |
| `GET/HEAD /dsh-media-tab/media?p=&t=` | **HMAC 签名** | Range 流式播放 |
| `GET/HEAD /dsh-media-tab/preview?p=` | 登录 cookie + 围栏 | 诊断探针 / 兼容路径 |
| `GET/POST /dsh-media-tab/api/recent` | 登录 cookie + 围栏 | 读取 / 记录最近播放 |
| `POST /dsh-media-tab/api/recent/clear` | 登录 cookie + 围栏 | 清空 |

## 安全与隐私

DSH 的本地 Web 服务本身不带鉴权，所以本插件自己把门：

- **只给媒体文件**：扩展名白名单；软链接按 `realpath` 后的真实文件判断；目录、文本、任意路径一律 403
- **防 DNS 重绑定 / 跨站**：Host 必须是回环或 DSH 自己的地址；`Sec-Fetch-Site: cross-site` 拒绝；带 `Origin` 时必须与 Host 一致
- **两条鉴权路径**：
  - `/preview`、`/api/sign`、`/api/recent*` 交给 DSH 的 `connection` 服务验登录 cookie（拿不到该服务的旧版本只收本机连接）
  - `/media` 只认 HMAC-SHA256（截取 32 位十六进制），密钥持久化在 `~/.dsh/cache/dsh-media-tab/secret`（`0600`）
- **媒体响应显式跨源**：`Access-Control-Allow-Origin: *` 与 `Cross-Origin-Resource-Policy: cross-origin` 只为让 `dsh-app://` 页面加载签名地址；没有签名拿不到任何字节
- **Range 流式**：`fs.createReadStream` 按请求区间读盘，不整文件进内存；读盘错误只断当前响应，不影响宿主
- **不联网、不上报、不扫描目录**

安全问题请走私密渠道，见 [SECURITY.md](SECURITY.md)。

## 数据与配置

| 项 | 位置 |
|---|---|
| 最近播放 | `$DSH_HOME/cache/dsh-media-tab/recent.json` |
| 签名密钥 | `$DSH_HOME/cache/dsh-media-tab/secret` |

`DSH_HOME` 默认 `~/.dsh`。最近播放文件结构：

```json
{
  "v": 1,
  "items": [
    {
      "path": "/Users/me/Movies/demo.mp4",
      "title": "demo.mp4",
      "kind": "video",
      "size": 29312618,
      "duration": 60.4,
      "position": 12.3,
      "plays": 2,
      "lastPlayedAt": 1761000000000
    }
  ]
}
```

原子写入（临时文件 + rename）；损坏的 JSON 会改名留档，而不是反复报错。删掉这两个文件即可回到初始状态。

## 排错

| 现象 | 原因 | 处理 |
|---|---|---|
| 进度条拖不动 / 暂停拖拽不换帧 | 宿主还是旧代码，或客户端仍在用相对地址 | 完全退出 DSH 再打开；Network 里媒体请求应是 `http://127.0.0.1:<port>/dsh-media-tab/media` |
| 播放器显示「连不上播放服务」 | 宿主路由未挂载 / 插件未加载 | 重启 DSH；`curl` 一下 `/api/health` 应返回 `{"ok":true}` |
| 「文件不在了」 | 文件被移动或删除 | 重新交付新路径 |
| 「没有权限读取这个文件」 | macOS TCC / 文件权限 | 给 DSH 相应目录权限，或换可读路径 |
| 「解码失败」 | 编码不在 Chromium 支持范围 | 用上面的 `ffmpeg` 命令转码 |
| 插件页没有「媒体播放」 | bundle 未选中 / 安装后未重启 | 插件页启用后 Cmd+Q 重开 |
| 视频上下留黑边 | 源文件是竖屏或非 16:9 | 正常行为，`object-fit: contain` 保证不裁切 |

## FAQ

**为什么拖进度条没有反应？**
桌面端旧版本把媒体地址解析成 `dsh-app://`，外壳转发时丢掉了 `Content-Length`，Chromium 无法 seek。0.1.0 起改为 `/api/sign` + 绝对地址直连；确认宿主已重启、Network 里的请求是 `http://127.0.0.1...`。

**为什么视频两边/上下有黑边？**
播放器用 `object-fit: contain` 保持原始比例，不会裁切画面。内联模式宽度撑满、高度按比例；竖屏视频会在 `85vh` 处封顶。

**支持字幕吗？**
暂不支持。路线图里有 VTT / SRT。

**会上传我的文件吗？**
不会。插件不发起任何外部网络请求，媒体只从本机宿主路由读取。

**能关掉最近播放吗？**
当前不能单独关闭；可以一键清空，或让文件保持不播放。记录只存在本机。

**和 `present` 是什么关系？**
`present` 负责“交付文件”，本插件负责“播放”。`play_media` 只是换了一条更方便的入口，最终仍写入同一个 `deliverables/presented` 事件。

## 开发

```sh
npm test          # node --test：39 个用例
npm pack --dry-run
```

| 文件 | 职责 |
|---|---|
| `lib/index.js` | 宿主：路由注册、`play_media`、`deliverables/presented` 桥接 |
| `lib/server.js` | Range、HMAC、鉴权、围栏、签名 API、流式响应 |
| `lib/recent.js` | 最近播放：原子写、LRU、去重、失效标记 |
| `lib/client.js` | 浏览器半边：内联播放器、侧栏播放页、最近列表、签名 URL 缓存 |
| `cordis.patch.yml` | bundle 挂载声明 |

测试覆盖：Range（200/206/416/HEAD）、签名与越权、跨站围栏、`/api/sign`、最近列表 LRU/去重/损坏恢复/并发写、清单一致性、客户端组件冒烟。

### 发布清单

1. `npm test`
2. 在真实 DSH 里过一遍[手动验收](#手动验收)
3. `npm publish --access public`
4. GitHub Release 附 `npm pack` 产物
5. 更新 `CHANGELOG.md`

### 手动验收

1. `link:` 安装并重启，插件页出现「媒体播放」
2. `present` 一个 mp4 → 回复下方出现播放器，宽度撑满、拖动正常
3. 点交付卡片 → 右侧栏播放页
4. 播放后看底部「最近播放」→ 该文件出现，点击可切换
5. 播放一个 `.avi` → 错误卡片给出 `ffmpeg` 命令
6. 暂停后拖动 → 画面跟着换帧
7. DevTools → Network：媒体请求为 `206 Partial Content`，地址是 `http://127.0.0.1:<port>/dsh-media-tab/media...`

## 路线图

- [ ] 字幕轨（VTT 原生 / SRT 转换）
- [ ] 播放进度续播
- [ ] 音频波形（可选，按需生成）
- [ ] 可选 ffmpeg 转码（检测到才启用，不打包）
- [ ] 独立的「最近播放」侧栏入口
- [ ] 播放列表 / HLS

## 贡献

- 报 bug 请附：DSH 版本、插件版本、操作系统、复现步骤、Console 里 `[dsh-media-tab]` 开头的日志
- PR 请保持零运行时依赖，并跑 `npm test`
- 安全漏洞请走私密报告，见 [SECURITY.md](SECURITY.md)
- 新格式/新行为请先开 issue 讨论范围，避免 PR 做到一半被砍

## 致谢

- DSH 插件 API 与 `present` 交付通道：DeepSeek Harness 官方文档与 `@deepseek-ai/dsh-*` 包
- 同类项目的先行探索：[`@orderg-x/dsh-video-preview`](https://github.com/OrderG-X/dsh-video-preview)、[`dsh-media-inline-preview`](https://github.com/seeingrain/dsh-media-inline-preview)、[`dsh-preview-media`](https://www.npmjs.com/package/dsh-preview-media)
- 设计取舍：不做 DOM 围栏扫描，不依赖第三方运行时，媒体只从宿主路由出

## License

[MIT](LICENSE)
