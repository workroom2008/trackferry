# 配置

日常设置都在管理页里，这里只有启动时需要的几项。环境变量写在 `compose.yaml`，也可以写进 `data/config.yaml`（示例见 [config.example.yaml](../config.example.yaml)）。两边都有时环境变量优先。

| 环境变量 | 配置文件 | 默认 | 说明 |
| --- | --- | --- | --- |
| `TRACKFERRY_URL` | `public_base_url` | 空 | 音箱取歌的局域网地址，如 `http://192.168.1.10:18561`。空着时接管不会开始 |
| `TRACKFERRY_TAKEOVER` | `takeover_speakers` | 空 | 允许设为接管的音箱，名字的一部分，逗号分隔；`*` 为全部；空为一台都不允许 |
| `TRACKFERRY_LISTEN` | `listen` | `:18561` | 监听地址与端口。只监听一个地址时写成 `192.168.1.10:18561` |
| `TRACKFERRY_UPDATE_CHECK` | `update_check` | 开 | `off` 关闭定时检查新版本；页面上的手动检查仍可用 |
| `TRACKFERRY_LX_URL` | `lx.url` | 空 | 自己部署的洛雪音乐（LX Music 服务端）的 Subsonic 地址，如 `http://192.168.1.10:9527/rest`。填了才会用它一起找歌 |
| `TRACKFERRY_LX_USER` | `lx.user` | 空 | 洛雪账号 |
| `TRACKFERRY_LX_PASSWORD` | `lx.password` | 空 | 洛雪账号的密码 |
| 无，在管理页设置 | 无 | 直接连接 | 更新代理，“设置 → 关于”，只用于检查和下载更新 |
| `TRACKFERRY_LOG` | 无 | 文字 | `json` 输出机器可读的日志 |
| `TRACKFERRY_DEBUG` | 无 | 关 | 任意值打开调试日志，包含每个页面请求 |
| `TRACKFERRY_CONFIG` | 无 | `/data/config.yaml` | 配置文件位置，可以不存在 |
| `TRACKFERRY_RELAY_TARGET` | 无 | `127.0.0.1:5667` | 只用于备选的 `relay` 容器 |
| `PUID`、`PGID` | 无 | `10001` | 程序运行的普通身份，启动时 `data` 会改成它的；不能是 0。`compose.yaml` 写了 `user` 时不起作用 |
| 挂载 `/cache` | 无 | 不挂载 | 放听过的线上歌，例如机械盘上的目录；不挂载就放在 `data/cache` |
| `TZ` | 无 | `Asia/Shanghai` | 时区 |
| 无 | `data_dir` | `/data` | 容器内数据目录 |
| 无 | `music_dir` | `/music` | 容器内音乐目录，可选 |

配置写错时程序不会启动，日志会指出是哪一项。

## 管理页里的设置

| 设置 | 位置 |
| --- | --- |
| 音箱模式、别名 | 音箱 |
| 飞牛音乐、小米账号、线上音源开关、线上歌曲缓存上限、Home Assistant 接口、管理密码、检查更新 | 设置 |

## 命令

| 命令 | 作用 |
| --- | --- |
| `docker exec trackferry /trackferry setup-code` | 显示初始化码 |
| `docker exec trackferry /trackferry reset-admin` | 清除管理密码，退出所有浏览器 |
| `docker exec trackferry /trackferry version` | 版本 |
