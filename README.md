# dsh-media-tab

在 DeepSeek Harness 里直接播放本地视频和音频：回复下方内联播放器、右侧栏播放页、最近播放列表。零运行时依赖，不需要 ffmpeg。

[English](README.en.md)

![内联播放器](docs/inline-player.webp)

## 安装

需要 DSH 0.2.x。

```sh
dsh plugin add github:Moosphan/dsh-media-tab
```

重启 DSH。装好后插件页出现「媒体播放」。

## 用法

- 模型用 `present` 交付音视频 → 播放器自动出现在回复下方
- 说「播一下 /path/a.mp4」→ 模型调用 `play_media`
- 点交付卡片或播放器上的「在侧栏打开」→ 右侧栏播放页
- 播放页底部「最近播放」：最近 20 条，可清空

`play_media` 参数：

| 参数 | 必填 | 说明 |
|---|---|---|
| `path` | 是 | 本地路径，支持 `~` 与会话相对路径 |
| `title` | 否 | 标题，默认文件名 |
| `autoplay` | 否 | 自动播放 |
| `loop` | 否 | 循环 |

## 支持的格式

| 类别 | 格式 |
|---|---|
| 视频 | `.mp4` `.m4v` `.mov` `.webm` `.ogv` `.mkv` `.3gp` |
| 音频 | `.mp3` `.wav` `.ogg` `.oga` `.m4a` `.aac` `.flac` `.opus` `.weba` |
| 不支持 | `.avi` `.flv` `.wmv` `.wma` `.ts` `.mpg` `.rmvb` 等，会给出 `ffmpeg` 转码命令 |

## 说明

- **桌面端可拖动进度条**：宿主把媒体签名为绝对 URL，播放器直连本地端口，Range 与 `Content-Length` 完整保留。
- **安全**：只服务白名单媒体文件，`realpath` 防符号链接；界面请求验登录 cookie，媒体请求验 HMAC 签名；不联网。
- **数据**：最近播放与签名密钥都在 `~/.dsh/cache/dsh-media-tab/`。
- 实现细节见 [docs/architecture.md](docs/architecture.md)。

## 排错

| 现象 | 处理 |
|---|---|
| 拖不动进度条 | 完全退出 DSH 重开；Network 里媒体请求应是 `http://127.0.0.1...` |
| 连不上播放服务 | 重启 DSH，确认 `/dsh-media-tab/api/health` 返回 `ok` |
| 解码失败 | 编码不在 Chromium 支持范围，按提示转码 |
| 视频有黑边 | 保持原始比例，正常 |

## License

[MIT](LICENSE)
