<div align="center">

<img src="docs/images/hero.svg" alt="TrackFerry" width="100%">

<br>

[![Release](https://img.shields.io/github/v/release/madrays/trackferry?style=for-the-badge&logo=github&label=Release&labelColor=142c38&color=f2a98f)](https://github.com/madrays/trackferry/releases)
[![Stars](https://img.shields.io/github/stars/madrays/trackferry?style=for-the-badge&logo=github&label=Stars&labelColor=142c38&color=f8c27e)](https://github.com/madrays/trackferry/stargazers)
[![Docker Pulls](https://img.shields.io/docker/pulls/madrays/trackferry?style=for-the-badge&logo=docker&logoColor=white&label=Pulls&labelColor=142c38&color=8fd3d6)](https://hub.docker.com/r/madrays/trackferry)
[![License](https://img.shields.io/badge/License-MIT-b7e4c7?style=for-the-badge&labelColor=142c38)](LICENSE)

<img src="https://img.shields.io/badge/amd64_%7C_arm64-142c38?style=flat-square&logo=linux&logoColor=white" alt="amd64 与 arm64">
<img src="https://img.shields.io/badge/Go-142c38?style=flat-square&logo=go" alt="Go">
<img src="https://img.shields.io/badge/React-142c38?style=flat-square&logo=react" alt="React">
<img src="https://img.shields.io/badge/SQLite-142c38?style=flat-square&logo=sqlite&logoColor=8fd3d6" alt="SQLite">

<br><br>

<a href="#快速开始"><img src="docs/images/tab-start.svg" alt="快速开始" height="44"></a>
<a href="#功能"><img src="docs/images/tab-features.svg" alt="功能" height="44"></a>
<a href="#界面"><img src="docs/images/tab-screens.svg" alt="界面" height="44"></a>
<a href="#文档"><img src="docs/images/tab-docs.svg" alt="文档" height="44"></a>
<a href="https://github.com/madrays/trackferry"><img src="docs/images/tab-star.svg" alt="点个星标" height="44"></a>

</div>

<br>

TrackFerry 让小爱音箱播放你 NAS 上的歌，也把手机变成音箱的遥控器。

说一句“播放潮汐来信”，它先查飞牛音乐，再查酷我、酷狗、咪咕、网易云，都没有时小爱照常回答。不想开口，就在手机上搜，点一下，音箱就响。

音箱不用刷机，NAS 上跑一个 Docker 容器就行。

<img src="docs/images/route.svg" alt="点歌流程" width="100%">

## 📱 掌上遥控器

<p align="center">
  <img src="docs/images/m-home.webp" alt="此刻" width="24%">
  <img src="docs/images/m-search.webp" alt="搜索" width="24%">
  <img src="docs/images/m-song.webp" alt="一首歌的操作" width="24%">
  <img src="docs/images/m-library.webp" alt="曲库" width="24%">
</p>

网页就是遥控器，添加到主屏后全屏打开，像一个应用。

- **此刻**：歌词跟着唱，切歌、拖音量、换播放方式、收藏、加入歌单、换一台音箱，都在一屏里
- **搜索**：歌、歌手、专辑和在线源一起搜，点一下就放，也可以排到下一首
- **曲库**：封面墙、收藏、歌单、新专辑和歌手，每一处都能整张、整单连播
- **随手可控**：在哪一页都有正在放的那条，暂停和切歌不用回去
- **液态玻璃**：底栏折射背后的水面，整页颜色跟着正在放的封面走

<p align="center">
  <img src="docs/images/m-album.webp" alt="专辑" width="24%">
  <img src="docs/images/m-online.webp" alt="在线搜索" width="24%">
  <img src="docs/images/m-speakers.webp" alt="音箱" width="24%">
  <img src="docs/images/m-missing.webp" alt="缺歌清单" width="24%">
</p>

## 功能

<table>
<tr>
<td width="33%" valign="top"><h3>🗣️ 开口点歌</h3>按歌名、歌手、专辑、歌单、收藏点歌。“换成林屿的版本”“换个版本”“收藏这首歌”都能接上，听错一个字也能按曲库纠正。</td>
<td width="33%" valign="top"><h3>🎵 飞牛曲库</h3>同步歌曲、封面、歌词、收藏和歌单，收藏和加歌单会写回飞牛。支持访问码。没有飞牛音乐，也可以只读挂载音乐文件夹。</td>
<td width="33%" valign="top"><h3>🌊 在线补歌</h3>曲库没有的歌，从酷我、酷狗、咪咕、网易云找免费完整版；登录自己的网易云账号，会员能完整听的也能放。每个来源都能单独关闭。</td>
</tr>
<tr>
<td valign="top"><h3>🔁 连续播放</h3>专辑、歌手、收藏、歌单一首接一首，可选随机、顺序、单曲循环。点完一首也能从曲库接着放，还能设最长时间。</td>
<td valign="top"><h3>⏭️ 下一首放</h3>听着歌就能把想听的排在后面，不打断正在放的。说“下一首”“上一首”也行。</td>
<td valign="top"><h3>⏯️ 断点续播</h3>听歌时和小爱说话，说完从刚才的位置继续。说了暂停就停下。</td>
</tr>
<tr>
<td valign="top"><h3>🤫 压住小爱</h3>普通、加强、等小爱说完，三种方式按音箱选，不让它的回答抢在歌前面。</td>
<td valign="top"><h3>🔊 多台音箱</h3>每台各放各的，单独设为不接入、观察或接管。观察只显示会放什么，不出声。</td>
<td valign="top"><h3>🐟 点歌流转</h3>一句话经过了哪里、为什么选这首、每一步用了多久，实时可看，也能回放。</td>
</tr>
<tr>
<td valign="top"><h3>📝 缺歌清单</h3>从线上放过、曲库里还没有的歌自动记下来，带点播次数，可导出；补进曲库后自动消失。</td>
<td valign="top"><h3>🏠 Home Assistant</h3>音箱成为媒体播放器，状态实时推送，歌词、队列和控制都能接进自动化。</td>
<td valign="top"><h3>⬆️ 一键更新</h3>页面里点一下就升级，更新包验签，起不来自动退回原版本。</td>
</tr>
</table>

## 界面

<img src="docs/images/home.webp" alt="此刻" width="100%">

### 🐟 流转

| 曲库命中 | 在线查找 |
| :---: | :---: |
| ![曲库命中](docs/images/flow.webp) | ![在线查找](docs/images/flow-online.webp) |

### 💿 曲库与搜索

| 曲库 | 专辑 |
| :---: | :---: |
| ![曲库](docs/images/library.webp) | ![专辑](docs/images/album.webp) |

| 搜索 | 怎么说 |
| :---: | :---: |
| ![搜索](docs/images/search.webp) | ![怎么说](docs/images/say.webp) |

### ⚙️ 音箱与设置

| 音箱 | 设置 |
| :---: | :---: |
| ![音箱](docs/images/speakers.webp) | ![设置](docs/images/settings.webp) |

<sub>截图使用演示数据。</sub>

## 快速开始

准备一台装有 Docker 的 NAS（amd64 或 arm64），以及同一局域网内的小爱音箱。

**1. 下载部署文件**

```sh
mkdir -p trackferry && cd trackferry && curl -fLO https://raw.githubusercontent.com/madrays/trackferry/main/compose.yaml
```

**2. 修改地址**

打开 `compose.yaml`，把 `TRACKFERRY_URL` 改成 NAS 的局域网地址：

```yaml
TRACKFERRY_URL: "http://192.168.1.10:18561"
```

**3. 启动**

```sh
docker compose up -d
```

**4. 查看初始化码**

```sh
docker exec trackferry /trackferry setup-code
```

**5. 完成设置**

打开 `http://<NAS 地址>:18561`，设置管理密码，登录小米账号和飞牛音乐。先把音箱设为“观察”，试过后再改成“接管”。

**6. 装到手机**

iPhone 用 Safari 打开，分享 → 添加到主屏幕。安卓和电脑见[装到手机或电脑桌面](docs/usage.md#装到手机或电脑桌面)。

> [!IMPORTANT]
> 接管前，先让 xiaomusic 等程序退出对这台音箱的控制。

> [!TIP]
> 管理页打不开或音箱不出声，多半是防火墙没有放行 TCP 18561。见[部署教程](docs/deployment.md#第四步放行端口)。

<details>
<summary><b>更新</b></summary>

“设置 → 关于”会提示新版本，点“更新”即可，起不来会自动退回。

也可以用命令：先备份 `data`，再在 `compose.yaml` 所在目录执行：

```sh
docker compose pull && docker compose up -d
```

</details>

<details>
<summary><b>从源码构建</b></summary>

```sh
git clone https://github.com/madrays/trackferry.git && cd trackferry
```

修改 `compose.yaml` 后执行：

```sh
docker compose -f compose.yaml -f compose.build.yaml up -d --build
```

</details>

## 文档

| 使用 | 了解与参与 |
| --- | --- |
| 🚀 [部署教程](docs/deployment.md) | 🧭 [架构](docs/architecture.md) |
| 🗣️ [使用说明](docs/usage.md) | 🔌 [接口](docs/api.md) |
| 📱 [装到手机](docs/usage.md#装到手机或电脑桌面) | 🎧 [音箱的三种模式](docs/usage.md#音箱的三种模式) |
| 🏠 [接入 Home Assistant](docs/homeassistant.md) | 🔁 [连续播放](docs/usage.md#连续播放) |
| ⚙️ [配置](docs/configuration.md) | 🤝 [参与贡献](CONTRIBUTING.md) |
| 🩺 [问题排查](docs/troubleshooting.md) | 📝 [更新记录](CHANGELOG.md) |
| 🔐 [隐私与安全](docs/security.md) | 💛 [致谢](docs/credits.md) |

## 参与

问题和建议请提 [Issue](https://github.com/madrays/trackferry/issues)，改代码前看一下[贡献说明](CONTRIBUTING.md)。

<div align="center">

喜欢 TrackFerry 的话，点个 ⭐ 吧。

<a href="https://star-history.com/#madrays/trackferry&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=madrays/trackferry&type=Date&theme=dark">
    <img src="https://api.star-history.com/svg?repos=madrays/trackferry&type=Date" alt="星标趋势" width="720">
  </picture>
</a>

</div>

## 致谢与许可

感谢 [xiaomusic](https://github.com/hanxi/xiaomusic)、[fnmusic-miot](https://github.com/le5inioo/fnmusic-miot)、[songloft-plugin-miot](https://github.com/songloft-org/songloft-plugin-miot)、[fnos_music_ext](https://github.com/javycoder/fnos_music_ext) 和 [musicdl](https://github.com/CharlesPikachu/musicdl)。

TrackFerry 以 [MIT](LICENSE) 许可开源。

### 本分支的来源

本仓库是 [madrays/trackferry](https://github.com/madrays/trackferry) 的衍生版本，版权归原作者 madrays 所有，依 MIT 许可使用。

在原版基础上，本仓库增加了以下功能（详见 `git log`）：

- 接入自建的洛雪音乐（LX Music）服务端，作为在线音源之一
- 曲库和线上都没有的歌，让音箱停下并保持安静，不交给小爱自己找版本
- 歌名相差一个字时也能对上（如「雨中的恋人」与「雨中的恋人们」）
- 歌词逐字特效

`main` 分支与本仓库无关，它是上游的镜像，请以 `feature/trackferry-plus` 为准。

**请注意**：上述改动未经上游作者审核，也不代表上游的立场。上游已明确表示不接入第三方解析脚本，洛雪音源属于此类，因此这些改动只在本仓库维护，不会合并回上游。

