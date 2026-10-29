# 安装与升级

应用不在 LG 应用商店上架，要以侧载方式安装到电视。先从 [最新 Release](https://github.com/shichen35/yfsp-webos/releases/latest) 下载 `com.yfsp.app_<版本>_all.ipk`。

要求：LG webOS 24 及以上的电视（2024 年及之后的机型）。目前只在 LG C4 上实测过；更老的系统没有测试，大概率无法运行。

## 方式一：开发者模式 + 命令行（推荐）

### 1. 打开电视的开发者模式

1. 在电视上登录 LG 账号。没有的话先到 [LG 开发者网站](https://webostv.developer.lge.com/) 注册。
2. 从 LG 应用商店安装 **Developer Mode** 应用，打开后登录同一个账号。
3. 打开 **Dev Mode Status**，电视会重启。
4. 重启后再次进入 Developer Mode 应用，打开 **Key Server**，记下界面上显示的 IP 地址和 Passphrase。

### 2. 在电脑上安装命令行工具

需要 Node.js：

```bash
npm install -g @webos-tools/cli
```

### 3. 连接电视并安装

注册电视（IP 换成 Developer Mode 应用里显示的地址）：

```bash
ares-setup-device -a tv -i "host=192.168.1.100" -i "port=9922" -i "username=prisoner"
```

取 SSH 私钥，按提示输入 Passphrase：

```bash
ares-novacom --device tv --getkey
```

安装并启动：

```bash
ares-install --device tv com.yfsp.app_1.0.0_all.ipk
```

```bash
ares-launch --device tv com.yfsp.app
```

之后在电视的应用列表里就能找到「爱壹帆」。

### 注意：开发者模式会过期

开发者模式的会话有效期约 50 小时，在 Developer Mode 应用里可以看到剩余时间，点 **Extend** 续期。过期后，所有侧载的应用都会被系统删除，本地的收藏、历史和记住的账号也会一起丢掉。经常用的话，记得定期打开 Developer Mode 应用续期。

## 方式二：webOS Dev Manager（图形界面）

不想用命令行，可以用社区做的 [webOS Dev Manager](https://github.com/webosbrew/dev-manager-desktop)。它支持 Windows、macOS 和 Linux：添加电视后直接选择 `.ipk` 安装，也能在里面给开发者模式续期。电视端同样要先完成上面第 1 步。

## 方式三：已 root 的电视

装了 [Homebrew Channel](https://github.com/webosbrew/webos-homebrew-channel) 的已 root 电视不受开发者模式 50 小时的限制，侧载的应用会一直保留。安装 `.ipk` 的方法同上（命令行或 Dev Manager）。本应用没有上架 Homebrew Channel 的官方仓库。

## 升级

下载新版 `.ipk`，按同样的方式再装一次，会直接覆盖旧版。应用 ID 不变，所以本地的收藏、历史和设置都会保留。

## 卸载

在电视的应用列表里长按应用图标删除，或者执行：

```bash
ares-install --device tv --remove com.yfsp.app
```

卸载会清除这台电视上的全部本地数据：收藏、观看历史、搜索记录和设置。

## 常见问题

- **`ares-novacom --getkey` 失败**：确认 Key Server 已打开，Passphrase 区分大小写。开发者模式过期后 Passphrase 会变，要重新获取。
- **装好了但打不开**：多半是系统版本太老。应用需要 webOS 24（Chromium 108）。
- **VIP 剧集或高清画质播不了**：本应用不支持登录，只能播放免费的 576P（标清），见 README 的「已知限制」。
