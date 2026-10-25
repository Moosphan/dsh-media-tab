# dsh-media-tab

在 DeepSeek Harness（DSH）里直接播放本地视频和音频：**回复下方内联播放**，点开文件卡片则进入**右侧栏独立播放页**，旁边带一个最小的「最近播放」列表。

- 零运行时依赖，零 ffmpeg：装完即用
- 原生 `<video>` / `<audio>` 控件：拖动、音量、倍速、全屏、画中画都交给浏览器
- HTTP Range 流式：60 MB 的成片拖进度条也不会整文件进内存
- 深浅色主题跟随 DSH 的设计变量

> English summary at the bottom.

## 安装

发布到 npm 后：

```sh
dsh plugin add dsh-media-tab
```

本地开发（link 到源码目录）：

```sh
dsh plugin --profile desktop add link:/absolute/path/to/dsh-media-tab
```

装完**重启 DSH**（宿主路由在启动时注册）；客户端改动刷新页面即可。

## 怎么用

| 场景 | 操作 |
|---|---|
| 模型生成了视频/配音 | 正常用 `present` 交付（或让模型调 `play_media`），播放器自动出现在回复下方 |
| 想看某个已有文件 | 对模型说「播一下 /path/a.mp4」，它会调 `play_media` |
| 想大屏看 | 点交付卡片，或播放器上的「在侧栏打开」 |
| 想找上次看的 | 侧栏播放页底部的「最近播放」，点一条即切换 |

`play_media` 参数：

| 参数 | 必填 | 说明 |
|---|---|---|
| `path` | 是 | 本地文件路径，支持 `~` 和会话工作目录下的相对路径 |
| `title` | 否 | 播放器标题，默认文件名 |
| `autoplay` | 否 | 自动播放（浏览器通常会拦） |
| `loop` | 否 | 循环 |

## 支持的格式

由 Chromium 的解码能力决定：

| 类别 | 格式 |
|---|---|
| 视频 | `.mp4` `.m4v` `.mov` `.webm` `.ogv` `.mkv` `.3gp` |
| 音频 | `.mp3` `.wav` `.ogg` `.oga` `.m4a` `.aac` `.flac` `.opus` `.weba` |

`.mkv`、`.3gp`、HEVC 的 `.mov` 取决于文件里的编码和操作系统（macOS / Windows 有平台解码器，Linux 可能没有）。播放失败时播放器会说明原因。

**不支持**（会直接给出转码命令，不会转码）：

`.avi` `.flv` `.wmv` `.wma` `.ts` `.mpg` `.mpeg` `.rm` `.rmvb` `.amr` `.ape` `.ac3` `.dts` `.mid` 等。

```sh
# 视频
ffmpeg -i in.avi -c:v libx264 -c:a aac -movflags +faststart out.mp4
# 音频
ffmpeg -i in.wma -c:a aac out.m4a
```

## 最近播放

- 只记**真正播放过**的文件，最多 20 条，按时间倒序
- 存在 `$DSH_HOME/cache/dsh-media-tab/recent.json`（默认 `~/.dsh/...`，权限 `0600`），浏览器/桌面端共享
- 文件被移走或删除时标灰，点不开，但记录保留
- 不做收藏、搜索、标签、排序——这是一个播放器，不是媒体库

## 安全

DSH 的本地 Web 服务本身不带鉴权，所以本插件的路由自己把门：

- **只给媒体**：按扩展名白名单，软链接按 `realpath` 后的真实文件判断，其他文件一律 403
- **防 DNS 重绑定 / 跨站**：Host 必须是回环或 DSH 自己的地址，`Sec-Fetch-Site: cross-site` 拒绝，`Origin` 必须与 Host 一致
- **两条路由**：
  - `/dsh-media-tab/preview` 交给 DSH 的 `connection` 服务验登录 cookie（拿不到该服务的旧版本只收本机连接）
  - `/dsh-media-tab/media` 额外要求 HMAC 签名，签名密钥存在 `~/.dsh/cache/dsh-media-tab/secret`（`0600`）
- **Range 流式**：只读请求的字节区间，不整文件读入内存
- 不联网、不上报、不扫描目录

## 配置

| 环境变量 | 默认 | 说明 |
|---|---|---|
| `DSH_HOME` | `~/.dsh` | 插件缓存与最近播放文件的位置 |

没有设置页。缓存文件：

```
$DSH_HOME/cache/dsh-media-tab/recent.json   最近播放
$DSH_HOME/cache/dsh-media-tab/secret        媒体签名密钥
```

删掉这两个文件即可回到初始状态。

## 手动验收

发布前在真实 DSH 里过一遍：

1. `link:` 安装并重启，插件页出现「媒体播放」
2. 让模型 `present` 一个 mp4 → 回复下方出现播放器，拖动进度条正常
3. 点交付卡片 → 右侧栏出现播放页
4. 播放后看播放页底部「最近播放」→ 该文件出现，点击可切换
5. 播放一个 `.avi` → 错误卡片给出 `ffmpeg` 命令
6. DevTools → Network：媒体请求应是 `206 Partial Content`

## 已知限制

- 不转码、不解析播放列表、不支持 HLS（`.m3u8`）和远程 URL
- 最近播放列表里的条目在当前播放页内切换，不会新开标签页
- 内联播放器固定高度（视频 240px），不做悬浮/画中画以外的自定义布局
- 一次只让一个播放器出声（新的播放会暂停其它）

## 开发

```sh
npm test          # node --test：路由、Range、鉴权、最近列表、清单
```

```
lib/index.js      宿主：路由注册 + play_media 工具 + present 通道
lib/server.js     纯函数：Range、签名、鉴权、流式响应
lib/recent.js     最近播放存储（原子写、LRU、失效标记）
lib/client.js     浏览器半边：turnTail 播放器 + 侧栏播放页 + 最近列表
cordis.patch.yml  bundle patch
```

设计约束：宿主与客户端都不 import 任何 `@deepseek-ai/*` 运行时模块，避免 profile 解析问题；工具对象按 `dsh-tools` 的线上形状手写。

## License

MIT

---

## English

A DeepSeek Harness plugin that plays local video and audio **inline under the reply** and in a **dedicated right-sidebar tab**, with a minimal recently-played list.

- No runtime dependencies, no ffmpeg
- Native controls, HTTP Range streaming, theme-aware
- Install: `dsh plugin add dsh-media-tab`, then restart DSH
- Formats: mp4/m4v/mov/webm/ogv/mkv/3gp and mp3/wav/ogg/oga/m4a/aac/flac/opus/weba
- Unsupported containers return a copyable ffmpeg command instead of transcoding

Security: extension whitelist, `realpath` symlink check, Host/Origin/`Sec-Fetch-Site` fence, DSH connection-cookie gate, HMAC-signed media URLs, and Range-only streaming.
