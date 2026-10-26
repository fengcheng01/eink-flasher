<script>
    const { ESPLoader, Transport } = window;
    const envBadge = document.getElementById("env-badge");
    const envDot = document.getElementById("env-dot");
    const envText = document.getElementById("env-text");

    const dropzone = document.getElementById("dropzone");
    const fileInput = document.getElementById("file-input");
    const fileCard = document.getElementById("file-card");
    const fileName = document.getElementById("file-name");
    const fileSize = document.getElementById("file-size");
    const fileRemoveBtn = document.getElementById("file-remove-btn");

    const offsetInput = document.getElementById("offset-input");
    const presetBtns = document.querySelectorAll(".preset-btn");
    const baudrateSelect = document.getElementById("baudrate-select");
    const eraseCheckbox = document.getElementById("erase-checkbox");
    const filterCheckbox = document.getElementById("filter-checkbox");
    const flashBtn = document.getElementById("flash-btn");
    const flashBtnText = document.getElementById("flash-btn-text");

    const progressSection = document.getElementById("progress-section");
    const progressStatus = document.getElementById("progress-status");
    const progressPercent = document.getElementById("progress-percent");
    const progressFill = document.getElementById("progress-fill");

    const chipInfoBar = document.getElementById("chip-info-bar");
    const chipName = document.getElementById("chip-name");
    const chipDetail = document.getElementById("chip-detail");
    const disconnectBtn = document.getElementById("disconnect-btn");

    const terminalBody = document.getElementById("terminal-body");
    const clearTermBtn = document.getElementById("clear-term-btn");

    // 运行状态变量
    let selectedFile = null;
    let fileBinaryData = null;
    let esploader = null;
    let transport = null;
    let isFlashing = false;

    // 终端模拟器对象
    const terminal = {
      clean() {
        terminalBody.textContent = "";
      },
      writeLine(data) {
        terminalBody.textContent += data + "\n";
        terminalBody.scrollTop = terminalBody.scrollHeight;
      },
      write(data) {
        terminalBody.textContent += data;
        terminalBody.scrollTop = terminalBody.scrollHeight;
      }
    };

    clearTermBtn.addEventListener("click", () => terminal.clean());

    // 1. 环境自检
    function checkSupport() {
      if (!("serial" in navigator)) {
        envDot.className = "env-dot warn";
        envText.textContent = "浏览器不支持 Web 串口";
        flashBtnText.textContent = "请使用 Chrome 或 Edge 浏览器";
        flashBtn.disabled = true;
        terminal.writeLine("⚠️ 当前浏览器不支持 Web Serial API。请在桌面端使用 Google Chrome 或 Microsoft Edge 访问。");
        return false;
      }
      if (!window.isSecureContext) {
        envDot.className = "env-dot error";
        envText.textContent = "需 HTTPS 或 Localhost";
        flashBtnText.textContent = "需在安全上下文 (HTTPS) 打开";
        flashBtn.disabled = true;
        terminal.writeLine("🔒 错误：Web Serial 仅允许在 HTTPS 或 localhost 环境下运行。");
        return false;
      }
      envDot.className = "env-dot";
      envDot.style.background = "var(--success)";
      envText.textContent = "串口接口已就绪";
      return true;
    }
    const isSupported = checkSupport();

    // 2. 文件选择与拖拽处理 (全面适配点击选择与拖拽载入)
    // 全局阻止默认拖拽行为，防止误拖拽时浏览器直接跳转打开文件
    window.addEventListener("dragover", (e) => e.preventDefault());
    window.addEventListener("drop", (e) => e.preventDefault());

    fileInput.addEventListener("change", (e) => {
      if (e.target.files && e.target.files[0]) {
        handleFile(e.target.files[0]);
      }
    });

    ["dragenter", "dragover"].forEach(evt => {
      dropzone.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.add("dragover");
      });
      fileInput.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.add("dragover");
      });
    });

    ["dragleave", "dragend"].forEach(evt => {
      dropzone.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.remove("dragover");
      });
      fileInput.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.remove("dragover");
      });
    });

    const onDropHandler = (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove("dragover");
      const dt = e.dataTransfer;
      if (dt && dt.files && dt.files.length > 0) {
        handleFile(dt.files[0]);
      }
    };

    dropzone.addEventListener("drop", onDropHandler);
    fileInput.addEventListener("drop", onDropHandler);

    function handleFile(file) {
      if (!file) return;
      selectedFile = file;
      fileName.textContent = file.name;
      const sizeKb = (file.size / 1024).toFixed(1);
      const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
      fileSize.textContent = file.size > 1048576 
        ? `${sizeMb} MB (${file.size.toLocaleString()} 字节)`
        : `${sizeKb} KB (${file.size.toLocaleString()} 字节)`;

      // 读取文件二进制内容
      const reader = new FileReader();
      reader.onload = (ev) => {
        fileBinaryData = ev.target.result;
        terminal.writeLine(`[文件载入] 成功载入: ${file.name} (${file.size.toLocaleString()} 字节)`);
        dropzone.style.display = "none";
        fileCard.style.display = "flex";
        updateFlashButtonState();
      };
      reader.onerror = (err) => {
        console.error("FileReader error:", err);
        alert("读取文件失败，请重新选择！");
        terminal.writeLine(`[错误] 读取固件文件失败`);
      };
      reader.readAsBinaryString(file);
    }

    fileRemoveBtn.addEventListener("click", () => {
      selectedFile = null;
      fileBinaryData = null;
      fileInput.value = "";
      fileCard.style.display = "none";
      dropzone.style.display = "block";
      updateFlashButtonState();
      terminal.writeLine("[文件移除] 已取消当前固件文件");
    });
    // 3. 预设地址按钮
    presetBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        presetBtns.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        offsetInput.value = btn.dataset.offset;
      });
    });

    offsetInput.addEventListener("input", () => {
      presetBtns.forEach(btn => {
        if (btn.dataset.offset.toLowerCase() === offsetInput.value.trim().toLowerCase()) {
          btn.classList.add("active");
        } else {
          btn.classList.remove("active");
        }
      });
    });

    function updateFlashButtonState() {
      if (!isSupported) return;
      if (!selectedFile || !fileBinaryData) {
        flashBtn.disabled = true;
        flashBtnText.textContent = "请先选择本地 .bin 固件";
      } else {
        flashBtn.disabled = false;
        flashBtnText.textContent = "连接设备并开始烧录";
      }
    }

    // 4. 断开连接处理
    async function disconnectDevice() {
      if (transport) {
        try {
          await transport.disconnect();
        } catch (err) {
          console.warn(err);
        }
      }
      transport = null;
      esploader = null;
      chipInfoBar.style.display = "none";
      terminal.writeLine("[串口] 设备已断开");
    }

    disconnectBtn.addEventListener("click", disconnectDevice);

    // 5. 核心烧录交互
    flashBtn.addEventListener("click", async () => {
      if (isFlashing) return;
      if (!selectedFile || !fileBinaryData) return;

      const offsetStr = offsetInput.value.trim();
      let offset = parseInt(offsetStr, 16);
      if (isNaN(offset)) {
        alert("请输入有效的十六进制物理地址，如 0x10000 或 0x0");
        return;
      }

      const baudrate = parseInt(baudrateSelect.value);
      const eraseAll = eraseCheckbox.checked;

      try {
        isFlashing = true;
        flashBtn.disabled = true;
        flashBtnText.textContent = "正在连接并烧录...";
        progressSection.style.display = "flex";
        progressFill.style.width = "0%";
        progressPercent.textContent = "0%";
        progressStatus.textContent = "请求串口访问...";

        // 请求用户选择串口 (支持根据 USB VID 过滤系统与蓝牙无关虚拟端口)
        terminal.writeLine("[串口] 打开串口选择器...");
        const espUsbFilters = [
          { usbVendorId: 0x303a }, // 乐鑫 Espressif (ESP32-C3 / S3 原生 USB JTAG/CDC)
          { usbVendorId: 0x1a86 }, // 沁恒 WCH (CH340 / CH341 / CH9102)
          { usbVendorId: 0x10c4 }, // 芯科 Silicon Labs (CP2102 / CP2104)
          { usbVendorId: 0x0403 }  // FTDI (FT232R 等)
        ];

        const portOptions = filterCheckbox.checked ? { filters: espUsbFilters } : {};
        const port = await navigator.serial.requestPort(portOptions);
        transport = new Transport(port, true);
        terminal.writeLine(`[串口] 正在与设备握手 (波特率 ${baudrate})...`);
        progressStatus.textContent = "正在握手并识别芯片...";

        const loaderOptions = {
          transport: transport,
          baudrate: baudrate,
          romBaudrate: 115200,
          terminal: terminal,
          debugLogging: false
        };

        esploader = new ESPLoader(loaderOptions);
        const chip = await esploader.main();

        // 识别芯片信息展示
        chipName.textContent = chip || "ESP32";
        try {
          const mac = await esploader.chip.readMac(esploader);
          chipDetail.textContent = `MAC: ${mac}`;
        } catch (e) {
          chipDetail.textContent = "";
        }
        chipInfoBar.style.display = "flex";

        if (eraseAll) {
          progressStatus.textContent = "正在全片擦除 Flash (可能需要 10-30 秒)...";
          terminal.writeLine("[Flash] 正在执行全片擦除...");
          await esploader.eraseFlash();
          terminal.writeLine("[Flash] 全片擦除完成");
        }

        // 开始写入
        progressStatus.textContent = `写入中 (地址 0x${offset.toString(16).toUpperCase()})...`;
        terminal.writeLine(`[烧录] 开始向 0x${offset.toString(16).toUpperCase()} 写入 ${selectedFile.name}...`);

        const fileArray = [
          { data: fileBinaryData, address: offset }
        ];

        await esploader.writeFlash({
          fileArray: fileArray,
          flashSize: "keep",
          flashMode: "keep",
          flashFreq: "keep",
          eraseAll: false,
          compress: true,
          reportProgress: (fileIndex, written, total) => {
            const pct = Math.round((written / total) * 100);
            progressPercent.textContent = `${pct}%`;
            progressFill.style.width = `${pct}%`;
            progressStatus.textContent = `写入中: ${(written / 1024).toFixed(1)} / ${(total / 1024).toFixed(1)} KB`;
          }
        });

        // 烧录完成
        progressFill.style.width = "100%";
        progressPercent.textContent = "100%";
        progressStatus.textContent = "烧录完成！正在重启设备...";
        terminal.writeLine("\n✅ 固件烧录成功！正在退出下载模式并重启设备...");

        // 重启设备并释放串口 / Reset and release the port.
        let resetSent = false;
        try {
          resetSent = await picoRestartTransport(esploader, transport);
        } catch (err) {
          terminal.writeLine(`复位未确认: ${err.message || err}`);
        }
        try { await transport.disconnect(); } catch (err) { console.log(err); }
        chipInfoBar.style.display = "none";

        alert(resetSent ? "固件写入成功，已发送重启指令。请在设备开机图底部核对固件版本。" : "固件写入成功，软复位未确认但已发送复位脉冲；屏幕无变化时请长按电源键重启，无需重新烧录。");

      } catch (err) {
        console.error(err);
        terminal.writeLine(`\n❌ 发生错误: ${err.message || err}`);
        progressStatus.textContent = "烧录失败";
        alert(`烧录中断或失败: ${err.message || err}\n请检查线缆连接并查看下方控制台日志。`);
      } finally {
        isFlashing = false;
        flashBtn.disabled = false;
        flashBtnText.textContent = "连接设备并开始烧录";
      }
    });
  </script>
</body>
</html>
