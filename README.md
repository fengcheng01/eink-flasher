# eink-flasher 通用烧录终端 / Universal e-ink flasher

单文件网页烧录工具（通用墨水屏固件烧录终端 V3），从公开仓库 [fengcheng01/eink-flasher](https://github.com/fengcheng01/eink-flasher) 同步入库。当前同步自 `dd23a482cbe448a6e9774ea3ecf2bdd73b5591bf`（2026-10-03），该版本已含 `tools/patch_eink_flasher.py` 生成的 pico 复位序列补丁（页面内有 `picoRestartTransport`）。在通用版基础上，本仓库又加入了 **Metalio（ESP32-S31）支持**并把内联 esptool 升级到与 `web/` 一致的 0.7.0（改动同时推回上游仓库）。

A single-file web flasher (universal e-ink firmware flasher V3), synced from the public [fengcheng01/eink-flasher](https://github.com/fengcheng01/eink-flasher) repository. Current sync base is `dd23a482cbe448a6e9774ea3ecf2bdd73b5591bf` (2026-10-03), which already carries the pico reset-sequence patch produced by `tools/patch_eink_flasher.py` (`picoRestartTransport` is embedded). On top of that, this repository added **Metalio (ESP32-S31) support** and upgraded the inline esptool to 0.7.0 matching `web/` (the changes are pushed back upstream as well).

## Metalio（ESP32-S31）支持 / Metalio (ESP32-S31) support

连接后自动识别 S31（esptool 0.7.0 走 GET_SECURITY_INFO chip-id，无需选择芯片）。S31 分支不上传 stub：识别后按所选波特率提升（`changeS31Baud`：CHANGE_BAUDRATE → 主机串口重开 → sync 探测，两次失败自动回退 115200；本机曾用 esptool CLI `--no-stub` 以 460800 验证），随后执行 sync 排水 + 8 字节 SPI_ATTACH + 24 字节 SPI_SET_PARAMS + `FLASH_WRITE_SIZE=0x400`（源与测试同文件：`tools/eink_flasher_s31.js`），写入 `compress:false`，收尾复位只发 `flashFinish(true)` + RTS 脉冲。完整镜像写 `0x0`；保留数据升级写 `0x80000`（必须确认设备已运行 PageRest Metalio v1，否则设备无法启动）。S31 ROM 无法读取分区，页面不做校验；烧录后若停在下载模式请物理关机再开机。其余芯片仍走完整 stub 流程（识别后内联补完 `main()` 的 stub 收尾，不重复握手）。

The S31 is identified automatically after connecting (esptool 0.7.0 uses the GET_SECURITY_INFO chip-id; no chip picker needed). The S31 branch uploads no stub: after identification it raises the baud to the selected value (`changeS31Baud`: CHANGE_BAUDRATE → host reopen → sync probe, auto-fallback to 115200 after two failures; this device was previously written at 460800 via the esptool CLI `--no-stub` path), then performs sync draining + 8-byte SPI_ATTACH + 24-byte SPI_SET_PARAMS + `FLASH_WRITE_SIZE=0x400` (single source shared with tests: `tools/eink_flasher_s31.js`), writes with `compress:false`, and closes with only `flashFinish(true)` + the RTS pulse. Full images go to `0x0`; data-preserving upgrades write `0x80000` (requires the device to already run PageRest Metalio v1 or it will not boot). The S31 ROM cannot read flash, so the page performs no verification; power-cycle the device physically if it stays in download mode. All other chips keep the full stub flow (after identification the page completes `main()`'s stub tail inline without re-syncing).

## 内联库升级与重建 / Inline library upgrade and rebuild

页面内联的 esptool 打包来自 `web/` 依赖的 esptool-js 0.7.0（`web/node_modules`）。升级依赖或重打 IIFE 时，在 `web/` 依赖就位后执行：

The inline esptool bundle is built from esptool-js 0.7.0 as pinned by `web/` (`web/node_modules`). To upgrade the dependency or rebuild the IIFE, with `web/` dependencies installed:

```sh
printf "import { ESPLoader, Transport } from 'esptool-js';\nwindow.ESPLoader = ESPLoader;\nwindow.Transport = Transport;\n" > /tmp/entry.js
web/node_modules/.bin/rolldown /tmp/entry.js --format iife --platform browser --minify -o /tmp/bundle.js
```

然后把 `eink-flasher/index.html` 内旧 bundle（`class A extends Error{` 起至 `window.Transport=...` 止）替换为产物，并跑 `node tools/test_eink_flasher_s31.js`（含内联脚本与 worker 块的语法冒烟）。页面注入的 S31 助手以 `tools/eink_flasher_s31.js` 为单一来源，改动需同步页面并保持两份一致。

Then replace the old bundle inside `eink-flasher/index.html` (from `class A extends Error{` through `window.Transport=...`) with the output and run `node tools/test_eink_flasher_s31.js` (syntax smoke check for the inline scripts and the worker block included). The injected S31 helpers have `tools/eink_flasher_s31.js` as their single source; keep the page copy identical when changing them.

### 烧录后台线程 / Flasher worker

烧录在 `<script type="text/plain" id="flash-worker-src">` 内嵌的后台线程中执行（`eink-flasher/flash-worker.js` 是其入口源码）：页面 `requestPort` 后把串口移交进去，切换标签页不被浏览器限流。重建 worker 块：

Flashing runs inside the embedded `<script type="text/plain" id="flash-worker-src">` worker (`eink-flasher/flash-worker.js` is its entry source): the page transfers the serial port in after `requestPort`, so tab switching is never throttled. To rebuild the worker block:

```sh
cd /tmp && mkdir -p workerbuild && cd workerbuild
grep -v 'if (typeof module !== "undefined")' $PICO/tools/eink_flasher_s31.js > s31.mjs
printf '\nexport { prepareS31Rom, changeS31Baud, metalioRestartTransport };\n' >> s31.mjs
grep -v 'if (typeof module !== "undefined")' $PICO/tools/eink_flasher_reset.js > reset.mjs
printf '\nexport { picoRestartTransport };\n' >> reset.mjs
ln -sfn $PICO/web/node_modules node_modules
cp $PICO/eink-flasher/flash-worker.js .
$PICO/web/node_modules/.bin/rolldown flash-worker.js --format iife --platform browser --minify -o flash-worker-bundle.js
```

产物替换 `flash-worker-src` 块内容（确认无 `</script` 与 `<!--` 序列），随后运行 `node tools/test_eink_flasher_s31.js`。Worker 不可用时页面自动回退主线程路径（切后台会被限流，页面会提示）。

Replace the `flash-worker-src` block contents with the output (verify it has no `</script` or `<!--` sequence), then run `node tools/test_eink_flasher_s31.js`. When workers are unavailable the page falls back to the main-thread path (background throttling applies there; the page says so).

## 与 web/ 的边界 / Boundary from web/

本目录与 `web/`（React 官网与 `/metalio` 本地烧录页）相互独立：不共享运行时依赖、不参与 `npm run build`、不进官网产物。S31 支持的权威实现仍是 `web/` 的 React 烧录器；本页的 S31 分支与之保持行为一致，库版本跟随 `web/` 的 esptool-js 依赖。改动烧录行为时先改本页并推上游，必要时同步回 `web/`。

This directory is independent of `web/` (the React site and the `/metalio` local flasher route): no shared runtime dependencies, not part of `npm run build`, never shipped in the site bundle. The authoritative S31 implementation remains the React flasher in `web/`; this page keeps its S31 branch behaviorally identical, with the library version tracking `web/`'s esptool-js dependency. Flasher behavior changes land here first and are pushed upstream, then synced back to `web/` when applicable.

## 在别的电脑使用 / Using on another computer

1. **拿到页面 / Get the page**：克隆本仓库取 `eink-flasher/index.html`，或直接从公开上游仓库下载该单文件。
   Clone this repo for `eink-flasher/index.html`, or download the single file from the public upstream repository.
2. **拿到固件 / Get firmware**：固件 BIN 不入库（`firmware-release/` 与 `build/` 均被忽略）。小纸 Pico 的公开 BIN 见官网下载区；Metalio 与本机构建产物需从构建机携带。
   Firmware BINs are not tracked (both `firmware-release/` and `build/` are ignored). Fetch the public Read Pico BIN from the website download section; carry Metalio and locally built images from the build machine.
3. **打开 / Open**：桌面 Chrome 或 Edge 直接双击 `index.html`（本地文件属安全上下文，Web Serial 可用）。若浏览器策略不允许，在本目录运行 `python3 -m http.server 8000` 后访问 <http://localhost:8000/>。
   Open `index.html` by double-clicking in desktop Chrome or Edge (local files are a secure context, so Web Serial works). If browser policy blocks it, run `python3 -m http.server 8000` here and open <http://localhost:8000/>.
4. **烧录 / Flash**：选 `.bin` → 选地址（源码编译的 app 固件用 `0x10000`，合并完整镜像用 `0x0`）→ 波特率建议 921600。卡在 Connecting 先用 `lsof /dev/cu.usbmodem*` 排查串口占用，仍失败则长按 Boot 键进下载模式。
   Pick the `.bin`, choose the address (`0x10000` for compiled app images, `0x0` for merged full images), 921600 baud recommended. If stuck at Connecting, check serial ownership with `lsof /dev/cu.usbmodem*`, then force the Boot download mode.

芯片支持：ESP32 / S2 / S3 / C2 / C3 / C5 / C6 / H2 / P4 / C61（覆盖小纸 Pico 的 ESP32-S3），以及 Metalio 的 ESP32-S31（见上文专用说明）。

Chip support: ESP32 / S2 / S3 / C2 / C3 / C5 / C6 / H2 / P4 / C61 (covering the Read Pico ESP32-S3), plus the Metalio ESP32-S31 (see the dedicated section above).

## 重新同步 / Re-syncing

在仓库根目录执行 / Run from the repository root:

```sh
curl -fLO https://raw.githubusercontent.com/fengcheng01/eink-flasher/main/index.html
mv index.html eink-flasher/index.html
```

覆盖后更新本 README 顶部的 commit 引用。若上游新版本尚未含复位补丁（页面里搜不到 `picoRestartTransport`），先打补丁再用产物覆盖：

After replacing, update the commit reference at the top of this README. If a newer upstream page lacks the reset patch (searching the page finds no `picoRestartTransport`), patch it first and use its output:

```sh
python3 tools/patch_eink_flasher.py eink-flasher/index.html /tmp/eink-flasher-patched.html
mv /tmp/eink-flasher-patched.html eink-flasher/index.html
```

复位逻辑单独验证：`node tools/test_eink_flasher_reset.js`。若上游页面丢失 S31 支持（页面里搜不到 `prepareS31Rom`），按"内联库升级与重建"一节升级 bundle，并把 `tools/eink_flasher_s31.js` 整文件注入第一段脚本后重新运行 `node tools/test_eink_flasher_s31.js`。

Standalone reset-logic check: `node tools/test_eink_flasher_reset.js`. If an upstream page ever loses S31 support (searching finds no `prepareS31Rom`), rebuild the bundle per the section above and inject `tools/eink_flasher_s31.js` verbatim into the first script, then run `node tools/test_eink_flasher_s31.js`.
