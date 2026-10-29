# 开发与构建

## 环境

- Node.js 18 及以上（CI 用 22）。冒烟脚本和单元测试直接用 Node 跑。
- 打包所需的 LG `ares-*` 命令行工具是 `app/` 的开发依赖，不用全局安装。

## 日常开发

视频 CDN 会拒绝带站外 Origin 的请求，而 hls.js 一定会带，所以在浏览器和模拟器里播放也要经过本地代理。先在一个终端里把代理开着：

```bash
cd app
npm install
npm run proxy      # 本地媒体代理，监听 127.0.0.1:7654（就是 Luna 服务那份代码）
```

再开一个终端：

```bash
cd app
npm run dev        # 开发服务器；接口直连，媒体经代理
npm run build      # 生产构建到 app/dist（目标 chrome108，base './'）
npm run preview    # 本地预览构建产物
npm run sim        # 构建后在本机 webOS 模拟器里启动（模拟器路径写死为 /Applications）
```

启动时控制台会打一行 `[luna] …` 说明当前模式：电视上是 `Luna service`，开着代理是 `direct + HTTP proxy`，没开代理是 `direct, no proxy`（列表和详情照常，视频播不了）。

浏览器里用键盘代替遥控器：方向键移动，Enter 确认，Esc 返回。真机上返回键是 webOS 的 keyCode 461。

## 测试

```bash
cd app
node --test                  # 单元测试：签名向量、请求信封、字段归一化、筛选、续播规则、焦点引擎、播放会话
node scripts/smoke.mjs       # 冒烟：真实请求走一遍列表、详情、取址，经代理拉 m3u8 和首个分片（要先 npm run proxy）
```

界面改动没有自动化测试，改完至少保证 `npm run build` 和 `node --test` 通过，再在浏览器、预览或模拟器里用键盘把涉及的界面走一遍。

## 打包

```bash
bash build.sh                     # 产物在 out/：.ipk 和 com.yfsp.app.manifest.json
VERSION=1.0.2 bash build.sh       # 指定版本号
```

装到电视、远程调试等细节见 [打包与发布](dev/packaging.md)。

## 发版

推送 `v*` tag 后，GitHub Actions 会构建 `.ipk`，并把它和 manifest 一起发布成 Release。说明由上一个 tag 以来的提交自动生成。版本号取自 tag，源码里的版本字段只是占位。带后缀的 tag（如 `v1.1.0-beta.1`）会标为预发布。

```bash
git tag v1.0.2 && git push origin v1.0.2
```

## 提交约定

提交信息用一行 Conventional Commits：`type(scope): summary`。
