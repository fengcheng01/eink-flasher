// SPDX-License-Identifier: Apache-2.0
// 中文：烧录后台线程入口。构建时先从 tools/eink_flasher_s31.js 与
// tools/eink_flasher_reset.js 去掉 module.exports 行生成 s31.mjs / reset.mjs，
// 再与 esptool-js 一起打成 IIFE，内嵌进 index.html 的
// <script type="text/plain" id="flash-worker-src"> 块。
// English: flasher worker entry. Build steps strip the module.exports lines from
// tools/eink_flasher_s31.js and tools/eink_flasher_reset.js into s31.mjs /
// reset.mjs, bundle them with esptool-js into an IIFE, and embed the result in
// the <script type="text/plain" id="flash-worker-src"> block of index.html.
import { ESPLoader, Transport } from 'esptool-js';
import { prepareS31Rom, changeS31Baud, metalioRestartTransport } from './s31.mjs';
import { picoRestartTransport } from './reset.mjs';

// 烧录全流程在 Worker 里跑：后台标签页的定时器限流不影响写入循环；
// 串口对象由页面 requestPort 后移交进来。/ The whole flow runs in the worker so
// background-tab timer throttling cannot stall the write loop; the page
// requests the serial port and transfers it in.
self.onmessage = async (event) => {
  const msg = event.data || {};
  if (msg.cmd === 'ping') { self.postMessage({ type: 'pong' }); return; }
  if (msg.cmd !== 'flash') return;
  const post = (type, extra) => self.postMessage(Object.assign({ type }, extra || {}));
  const log = line => post('log', { line: String(line) });
  let transport = null;
  try {
    transport = new Transport(msg.port, true);
    const terminal = { clean() {}, writeLine: d => log(d), write: d => log(d) };
    const loader = new ESPLoader({ transport, baudrate: msg.baudrate, romBaudrate: 115200, terminal, debugLogging: false });
    // 与页面主线程路径一致：先 ROM 握手识别，S31 走无 stub，其余补 main() 收尾。
    // / Same as the page path: ROM handshake first; S31 goes no-stub, others finish main()'s tail.
    await loader.detectChip();
    const isS31 = !!(loader.chip && loader.chip.CHIP_NAME === 'ESP32-S31');
    let chip;
    if (isS31) {
      chip = loader.chip.CHIP_NAME;
      const activeBaud = await changeS31Baud(loader, transport, msg.baudrate, ms => new Promise(resolve => setTimeout(resolve, ms)), log);
      await prepareS31Rom(loader, transport, log);
      log(`[S31] ROM 无 stub 模式 @ ${activeBaud} 波特率，写入期间请勿断开设备。`);
      if (Number(msg.offset) === 0x10000) log('[S31] 提示：Metalio 应用分区是 0x80000，不是 0x10000；请确认地址。');
    } else {
      const desc = await loader.chip.getChipDescription(loader);
      loader.info('Chip is ' + desc);
      if (loader.chip.getChipRevision) loader.info('Chip Revision: ' + await loader.chip.getChipRevision(loader));
      loader.info('Features: ' + await loader.chip.getChipFeatures(loader));
      loader.info('Crystal is ' + await loader.chip.getCrystalFreq(loader) + 'MHz');
      loader.info('MAC: ' + await loader.chip.readMac(loader));
      if (loader.chip.postConnect) await loader.chip.postConnect(loader);
      await loader.runStub();
      if (loader.romBaudrate !== loader.baudrate) await loader.changeBaud();
      chip = desc;
    }
    let detail = '';
    try { detail = 'MAC: ' + await loader.chip.readMac(loader); } catch (e) {}
    post('chip', { name: chip, detail });

    if (msg.eraseAll) {
      post('progress', { pct: 3, status: '正在全片擦除 Flash (可能需要 10-30 秒)...' });
      log('[Flash] 正在执行全片擦除...');
      try {
        await loader.eraseFlash();
        log('[Flash] 全片擦除完成');
      } catch (e) {
        // S31 ROM 全片擦除未经实机验证：失败不阻断，写入仍按区域擦除。
        // / S31 ROM chip erase is unverified: do not abort; writes still erase per region.
        if (!isS31) throw e;
        log(`[Flash] 全片擦除未确认 (${e.message || e})，继续按写入区域擦除。`);
      }
    }

    const hex = Number(msg.offset).toString(16).toUpperCase();
    post('progress', { pct: 5, status: `写入中 (地址 0x${hex})...` });
    log(`[烧录] 开始向 0x${hex} 写入固件...`);
    await loader.writeFlash({
      fileArray: [{ data: msg.data, address: Number(msg.offset) }],
      flashSize: 'keep',
      flashMode: 'keep',
      flashFreq: 'keep',
      eraseAll: false,
      // S31 ROM 不支持压缩写入 / The S31 ROM does not support compressed writes.
      compress: !isS31,
      reportProgress: (fileIndex, written, total) => {
        const pct = total > 0 ? Math.round((written / total) * 100) : 0;
        post('progress', { pct, status: `写入中: ${(written / 1024).toFixed(1)} / ${(total / 1024).toFixed(1)} KB` });
      }
    });

    post('progress', { pct: 96, status: '烧录完成！正在重启设备...' });
    log('✅ 固件烧录成功！正在退出下载模式并重启设备...');
    let resetSent = false;
    try {
      resetSent = await (isS31 ? metalioRestartTransport : picoRestartTransport)(loader, transport);
    } catch (err) {
      log(`复位未确认: ${err.message || err}`);
    }
    try { await transport.disconnect(); } catch (err) {}
    const alert = isS31
      ? '固件写入成功，已发送重启指令。若设备停在下载模式或黑屏，请物理关机再开机（S31 经 USB 复位可能落回下载模式）。'
      : (resetSent ? '固件写入成功，已发送重启指令。请在设备开机图底部核对固件版本。' : '固件写入成功，软复位未确认但已发送复位脉冲；屏幕无变化时请长按电源键重启，无需重新烧录。');
    post('done', { alert, status: '烧录完成！已发送重启指令。' });
  } catch (err) {
    post('error', { message: String((err && err.message) || err) });
    try { if (transport) await transport.disconnect(); } catch (e) {}
  }
};
