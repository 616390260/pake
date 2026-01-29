import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import prompts from 'prompts';
import { checkRustInstalled, installRust, checkMSVCInstalled, checkWiXInstalled, checkMinGWInstalled, checkRustWindowsGnuTarget } from '@/helpers/rust.js';
import { PakeAppOptions } from '@/types.js';
import { IBuilder } from './base.js';
import { shellExec } from '@/utils/shell.js';
// @ts-expect-error
import tauriConf from './tauriConf.js';

import logger from '@/options/logger.js';
import { mergeTauriConfig } from './common.js';
import { npmDirectory } from '@/utils/dir.js';
import { IS_WIN } from '@/utils/platform.js';
import shelljs from 'shelljs';

export default class WinBuilder implements IBuilder {
  /**
   * 准备 Windows 构建环境
   * 检查并提示安装必需的依赖
   */
  async prepare() {
    // 在非 Windows 系统上尝试构建 Windows 应用（交叉编译）
    if (!IS_WIN) {
      logger.info('🔧 在 macOS 上尝试交叉编译 Windows 应用...');
      logger.info('');
      
      let hasError = false;

      // 检查 Rust
      if (!checkRustInstalled()) {
        logger.warn('Rust is not installed.');
        const res = await prompts({
          type: 'confirm',
          message: 'We detected that you have not installed Rust. Install it now?',
          name: 'value',
        });

        if (res.value) {
          await installRust();
        } else {
          logger.error('Error: Pake needs Rust to package your webapp!!!');
          hasError = true;
        }
      } else {
        logger.success('✓ Rust is installed');
      }

      // 检查并安装 Windows GNU 目标
      if (!checkRustWindowsGnuTarget()) {
        logger.warn('Windows GNU target is not installed.');
        logger.info('Installing x86_64-pc-windows-gnu target...');
        const installResult = shelljs.exec('rustup target add x86_64-pc-windows-gnu', { silent: false });
        if (installResult.code !== 0) {
          logger.error('Failed to install Windows GNU target');
          hasError = true;
        } else {
          logger.success('✓ Windows GNU target installed');
        }
      } else {
        logger.success('✓ Windows GNU target is available');
      }

      // 检查 mingw-w64（可选，但推荐）
      if (!checkMinGWInstalled()) {
        logger.warn('⚠️  mingw-w64 toolchain is not found.');
        logger.info('For better compatibility, you can install mingw-w64:');
        logger.info('  macOS: brew install mingw-w64');
        logger.info('  Linux: sudo apt-get install mingw-w64');
        logger.info('');
        logger.info('Note: Tauri will try to use bundled linker, but installing mingw-w64 is recommended.');
        logger.info('Continuing without mingw-w64...\n');
        // 自动继续，不等待用户输入
      } else {
        logger.success('✓ mingw-w64 toolchain is available');
      }

      if (hasError) {
        logger.error('\nPlease fix the errors and try again.');
        process.exit(2);
      }

      logger.info('\n⚠️  注意: 在 macOS 上交叉编译 Windows 应用将生成 .exe 文件，而不是 .msi 安装包。');
      logger.info('如果需要 .msi 安装包，请在 Windows 系统上构建，或使用 GitHub Actions。\n');
      return;
    }

    logger.info(
      'To build the Windows app, you need to install Rust, VS Build Tools, and WiX Toolset.'
    );
    logger.info(
      'See more in https://tauri.app/v1/guides/getting-started/prerequisites#installing\n'
    );

    let hasError = false;

    // 检查 Rust
    if (!checkRustInstalled()) {
      logger.warn('Rust is not installed.');
    const res = await prompts({
      type: 'confirm',
      message: 'We detected that you have not installed Rust. Install it now?',
      name: 'value',
    });

    if (res.value) {
      // TODO 国内有可能会超时
      await installRust();
    } else {
      logger.error('Error: Pake needs Rust to package your webapp!!!');
        hasError = true;
      }
    } else {
      logger.success('✓ Rust is installed');
    }

    // 检查 MSVC (Visual Studio Build Tools)
    if (!checkMSVCInstalled()) {
      logger.error('Visual Studio Build Tools or MSVC toolchain is not found!');
      logger.info('Please install Visual Studio Build Tools 2022 (>=17.2) with:');
      logger.info('  - Desktop development with C++ workload');
      logger.info('  - Windows 10 SDK (10.0.19041.0 or later)');
      logger.info('Download: https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022');
      hasError = true;
    } else {
      logger.success('✓ MSVC toolchain is available');
    }

    // 检查 WiX Toolset（仅在 Windows 上需要）
    if (!checkWiXInstalled()) {
      logger.warn('WiX Toolset is not found!');
      logger.info('WiX Toolset is required to build Windows installer (.msi)');
      logger.info('Without WiX, only .exe file will be generated.');
      logger.info('Please install WiX Toolset v3.11 from:');
      logger.info('  https://wixtoolset.org/releases/');
      logger.info('Or use winget: winget install --id WiXToolset.WiXToolset');
      logger.info('');
      const res = await prompts({
        type: 'confirm',
        message: 'Continue without WiX? (Will generate .exe instead of .msi)',
        name: 'value',
      });
      if (!res.value) {
        hasError = true;
      }
    } else {
      logger.success('✓ WiX Toolset is installed');
    }

    if (hasError) {
      logger.error('\nPlease install the missing dependencies and try again.');
      logger.error('For more information, see: https://tauri.app/v1/guides/getting-started/prerequisites');
      logger.error('Or check WINDOWS_BUILD_TROUBLESHOOTING.md for troubleshooting guide.');
      process.exit(2);
    }

    logger.info('\nAll dependencies are ready! Starting build...\n');
  }

  async build(url: string, options: PakeAppOptions) {
    logger.debug('PakeAppOptions', options);
    const { name } = options;

    // 在非 Windows 系统上交叉编译时，修改配置以禁用 WiX
    if (!IS_WIN) {
      // 设置环境变量，标记正在交叉编译 Windows
      process.env.PAKE_TARGET_PLATFORM = 'win';
      
      // 临时修改配置，禁用 msi 目标（因为 WiX 只能在 Windows 上运行）
      const originalTargets = tauriConf.tauri?.bundle?.targets;
      const originalWix = tauriConf.tauri?.bundle?.windows?.wix;
      
      if (tauriConf.tauri?.bundle) {
        // 移除 msi 目标，只生成 exe
        tauriConf.tauri.bundle.targets = [];
        // 如果存在 wix 配置，临时移除
        if (tauriConf.tauri.bundle.windows?.wix) {
          delete tauriConf.tauri.bundle.windows.wix;
        }
      }

    await mergeTauriConfig(url, options, tauriConf);
      
      // 恢复原始配置（如果需要）
      if (originalTargets) {
        tauriConf.tauri.bundle.targets = originalTargets;
      }
      if (originalWix) {
        if (!tauriConf.tauri.bundle.windows) {
          tauriConf.tauri.bundle.windows = {};
        }
        tauriConf.tauri.bundle.windows.wix = originalWix;
      }
    } else {
      await mergeTauriConfig(url, options, tauriConf);
    }

    // 在非 Windows 系统上使用 GNU 工具链交叉编译
    if (!IS_WIN) {
      logger.info('Building for Windows using GNU toolchain (cross-compilation)...');
      
      // 设置环境变量以使用 GNU 工具链
      const target = 'x86_64-pc-windows-gnu';
      
      // 检查并创建 .cargo/config.toml 以配置链接器
      const cargoConfigPath = path.join(npmDirectory, 'src-tauri/.cargo/config.toml');
      const cargoConfigDir = path.dirname(cargoConfigPath);
      
      // 如果 mingw-w64 未安装，尝试使用 Rust 的内置链接器或提供清晰的错误
      if (!checkMinGWInstalled()) {
        logger.warn('⚠️  mingw-w64 未安装，尝试配置替代链接器...');
        
        // 创建 .cargo 目录（如果不存在）
        await fs.mkdir(cargoConfigDir, { recursive: true }).catch(() => {});
        
        // 创建或更新 config.toml
        const cargoConfig = `[target.x86_64-pc-windows-gnu]
linker = "x86_64-w64-mingw32-gcc"
`;
        
        try {
          await fs.writeFile(cargoConfigPath, cargoConfig);
          logger.info('已创建链接器配置文件，但您仍需要安装 mingw-w64');
        } catch (error) {
          logger.warn('无法创建链接器配置文件');
        }
        
        logger.error('\n❌ 构建失败：缺少 mingw-w64 链接器');
        logger.info('\n请安装 mingw-w64：');
        logger.info('  方法 1: 使用 Homebrew（如果可用）');
        logger.info('    brew install mingw-w64');
        logger.info('');
        logger.info('  方法 2: 手动下载安装');
        logger.info('    访问: https://www.mingw-w64.org/downloads/');
        logger.info('');
        logger.info('  方法 3: 使用 GitHub Actions 在线构建（推荐）');
        logger.info('    查看 WINDOWS_BUILD_GUIDE.md 了解详情');
        logger.info('');
        process.exit(1);
      }
      
      // 确保 Windows 配置文件中的 targets 为空（禁用 bundle）
      const windowsConfigPath = path.join(npmDirectory, 'src-tauri/tauri.windows.conf.json');
      try {
        const windowsConfig = JSON.parse(await fs.readFile(windowsConfigPath, 'utf-8'));
        if (windowsConfig.tauri?.bundle) {
          windowsConfig.tauri.bundle.targets = []; // 禁用所有 bundle 目标
          await fs.writeFile(windowsConfigPath, JSON.stringify(windowsConfig, null, 2));
          logger.info('已禁用 Windows bundle 目标，将只生成 exe 文件');
        }
      } catch (error) {
        logger.warn('无法更新 Windows 配置文件');
      }
      
      // 确保图标文件被复制到资源目录（用于运行时加载）
      const resourcesDir = path.join(npmDirectory, 'src-tauri/target', target, 'release/png');
      await fs.mkdir(resourcesDir, { recursive: true }).catch(() => {});
      
      // 复制图标文件到构建输出目录
      const icon32Source = path.join(npmDirectory, `src-tauri/png/${name.toLowerCase()}_32.ico`);
      const icon256Source = path.join(npmDirectory, `src-tauri/png/${name.toLowerCase()}_256.ico`);
      const icon32Dest = path.join(resourcesDir, `${name.toLowerCase()}_32.ico`);
      const icon256Dest = path.join(resourcesDir, `${name.toLowerCase()}_256.ico`);
      
      // 检查图标是否存在，如果不存在则使用默认图标
      const defaultIcon32 = path.join(npmDirectory, 'src-tauri/png/icon_32.ico');
      const defaultIcon256 = path.join(npmDirectory, 'src-tauri/png/icon_256.ico');
      
      const icon32ToCopy = await fs.access(icon32Source).then(() => icon32Source).catch(() => defaultIcon32);
      const icon256ToCopy = await fs.access(icon256Source).then(() => icon256Source).catch(() => defaultIcon256);
      
      try {
        await fs.copyFile(icon32ToCopy, icon32Dest);
        await fs.copyFile(icon256ToCopy, icon256Dest);
        logger.info(`已复制图标文件到构建目录: ${icon32Dest}`);
      } catch (error) {
        logger.warn('无法复制图标文件，应用将使用系统默认图标');
      }
      
      // 构建命令 - 使用 cargo build 而不是 tauri build，避免 bundle 步骤
      // 或者使用 tauri build 但确保 targets 为空
      const buildCommand = `cd "${npmDirectory}/src-tauri" && cargo build --release --target ${target}`;
      
      logger.info(`Running: ${buildCommand}`);
      logger.info('注意: 使用 cargo build 直接构建，跳过 Tauri bundle 步骤');
      await shellExec(buildCommand);
      
      // 构建后再次复制图标到 exe 所在目录（确保运行时能找到）
      const exeDir = path.join(npmDirectory, 'src-tauri/target', target, 'release');
      const exeIcon32Dest = path.join(exeDir, 'png', `${name.toLowerCase()}_32.ico`);
      const exeIcon256Dest = path.join(exeDir, 'png', `${name.toLowerCase()}_256.ico`);
      await fs.mkdir(path.dirname(exeIcon32Dest), { recursive: true }).catch(() => {});
      try {
        await fs.copyFile(icon32ToCopy, exeIcon32Dest);
        await fs.copyFile(icon256ToCopy, exeIcon256Dest);
      } catch (error) {
        // 忽略错误
      }
      
      // 查找生成的 exe 文件（可能在多个位置）
      const exeName = `${name}.exe`;
      const possiblePaths = [
        path.join(npmDirectory, 'src-tauri/target', target, 'release', exeName),
        path.join(npmDirectory, 'src-tauri/target', target, 'release', 'bundle', 'nsis', `${name}_${tauriConf.package.version}_x64-setup.exe`),
        path.join(npmDirectory, 'src-tauri/target', target, 'release', 'bundle', 'nsis', `${name}_${tauriConf.package.version}_x64.exe`),
      ];
      
      let found = false;
      for (const exePath of possiblePaths) {
        if (await fs.access(exePath).then(() => true).catch(() => false)) {
          const distPath = path.resolve(exeName);
          await fs.copyFile(exePath, distPath);
          logger.success('Build success!');
          logger.success('You can find the Windows executable in', distPath);
          found = true;
          break;
        }
      }
      
      if (!found) {
        logger.error('Build completed but could not find the output file.');
        logger.info('Please check:', path.join(npmDirectory, 'src-tauri/target', target, 'release'));
        logger.info('Or check bundle directory:', path.join(npmDirectory, 'src-tauri/target', target, 'release', 'bundle'));
      }
      return;
    }

    // Windows 系统上的正常构建流程
    // 安装包类型选择（默认 nsis；可通过环境变量切换为 msi）
    // - nsis: 生成 *-setup.exe 安装器（推荐，较少依赖，CI 更稳）
    // - msi : 需要 WiX（candle/light），如果 light.exe 失败会导致 MSI 无法生成
    const installerTypeEnv = process.env.PAKE_WINDOWS_INSTALLER;
    logger.info(`环境变量 PAKE_WINDOWS_INSTALLER: ${installerTypeEnv || '(未设置)'}`);
    const installerType = (installerTypeEnv || 'nsis').toLowerCase();
    let targetBundle: 'msi' | 'nsis' = installerType === 'msi' ? 'msi' : 'nsis';
    logger.info(`选择的安装包类型: ${installerType}, targetBundle: ${targetBundle}`);

    if (!tauriConf.tauri?.bundle?.targets || tauriConf.tauri.bundle.targets.length === 0) {
      tauriConf.tauri.bundle.targets = [targetBundle];
    } else {
      tauriConf.tauri.bundle.targets = [targetBundle];
    }
    logger.info(`已设置 Windows 构建目标为 ${targetBundle}`);
    
    const containsNonAscii = /[^\x00-\x7F]/.test(name);
    // WiX(light.exe) 在 CI 上经常因为中文路径/文件名失败；NSIS 不依赖 WiX，且对中文更友好
    // 规则：如果 name 含中文且用户选择 msi，则默认直接切到 nsis（除非强制）
    const forceMsi = process.env.PAKE_FORCE_MSI === '1';
    if (containsNonAscii && targetBundle === 'msi' && !forceMsi) {
      logger.warn(`检测到中文名称 "${name}"，MSI 依赖 WiX 在 CI 上容易失败，已自动切换为 NSIS（可安装 exe）`);
      logger.warn('如必须使用 MSI，请设置环境变量 PAKE_FORCE_MSI=1（不保证成功）');
      targetBundle = 'nsis';
      tauriConf.tauri.bundle.targets = [targetBundle];
    }
    
    // 保持 productName 为中文（这样 MSI 内部的 ProductName 就是中文）
    tauriConf.package.productName = name;
    
    // 验证配置中的名称
    logger.info(`构建配置 - productName: ${tauriConf.package.productName}`);
    logger.info(`构建配置 - name 参数: ${name}`);
    
    // 保存更新后的配置
    const configJsonPath = path.join(npmDirectory, 'src-tauri/tauri.conf.json');
    await fs.writeFile(
      configJsonPath,
      Buffer.from(JSON.stringify(tauriConf, null, 2), 'utf-8')
    );
    
    // 验证文件已正确写入
    const verifyConfig = JSON.parse(await fs.readFile(configJsonPath, 'utf-8'));
    if (verifyConfig.package.productName !== name) {
      logger.error(`配置验证失败: productName 应该是 "${name}"，但实际是 "${verifyConfig.package.productName}"`);
      throw new Error('配置更新失败');
    }
    logger.info('配置已正确更新并验证');
    logger.info(`✓ productName 已设置为中文: "${name}"，MSI 内部的 ProductName 将自动使用此值`);

    // 构建：显式指定 bundles，避免“回退到 nsis 但仍在跑 wix(msi)”的情况
    try {
      const buildCmd = `cd "${npmDirectory}" && npm install && npm run tauri -- build --bundles ${targetBundle}`;
      logger.info(`Running: ${buildCmd}`);
      await shellExec(buildCmd);
    } catch (error: any) {
      // 如果构建失败且是因为 MSI 文件名包含中文，尝试回退到 NSIS
      if (targetBundle === 'msi' && containsNonAscii) {
        logger.warn('MSI 构建可能因中文文件名失败，尝试回退到 NSIS...');
        tauriConf.tauri.bundle.targets = ['nsis'];
        await fs.writeFile(
          configJsonPath,
          Buffer.from(JSON.stringify(tauriConf, null, 2), 'utf-8')
        );
        logger.info('已切换到 NSIS 构建目标');
        targetBundle = 'nsis';
        const buildCmd = `cd "${npmDirectory}" && npm run tauri -- build --bundles nsis`;
        logger.info(`Running: ${buildCmd}`);
        await shellExec(buildCmd);
      } else {
        throw error;
      }
    }
    
    // 注意：由于我们保持 productName 为中文，MSI 内部的 ProductName 应该已经是中文了
    // 不需要额外的修改步骤
    if (false) { // 保留旧代码结构，但不再执行
      logger.info('开始修改 MSI 文件内部的 ProductName...');
      // 恢复 productName 为中文名称（用于后续查找和重命名）
      tauriConf.package.productName = name;
      await fs.writeFile(
        configJsonPath,
        Buffer.from(JSON.stringify(tauriConf, null, 2), 'utf-8')
      );
      logger.info(`已恢复 productName 为 "${name}"`);
      
      // 旧代码已删除：由于我们保持 productName 为中文，MSI 内部的 ProductName 应该已经是中文了
    }
    
    // 根据目标查找安装包
    logger.info(`开始查找安装包，targetBundle: ${targetBundle}`);
    if (targetBundle === 'nsis') {
      logger.info('查找 NSIS 安装包...');
      const bundleNsisDir = path.join(npmDirectory, 'src-tauri/target/release/bundle/nsis');
      let installerPath: string | undefined;
      try {
        const files = await fs.readdir(bundleNsisDir);
        const setupCandidates = files
          .filter(f => f.toLowerCase().endsWith('.exe'))
          .filter(f => f.toLowerCase().includes('setup'));
        if (setupCandidates.length > 0) {
          installerPath = path.join(bundleNsisDir, setupCandidates[0]);
          logger.info(`在 bundle/nsis 目录找到安装包: ${installerPath}`);
        }
      } catch (error) {
        logger.warn('无法读取 bundle/nsis 目录（可能未生成 NSIS 安装包）');
      }

      if (installerPath && await fs.access(installerPath).then(() => true).catch(() => false)) {
        const distPath = path.resolve(`${name}-setup.exe`);
        await fs.copyFile(installerPath, distPath);
        logger.success('Build success!');
        logger.success(`Windows 安装包已生成: ${distPath}`);
        logger.info('这是一个 NSIS 安装器，双击即可安装');
        return;
      }
    } else {
      // msi
      logger.info('查找 MSI 安装包...');
      const bundleMsiDir = path.join(npmDirectory, 'src-tauri/target/release/bundle/msi');
      const language = tauriConf.tauri.bundle?.windows?.wix?.language?.[0] || 'en-US';
      const arch = process.arch === 'x64' ? 'x64' : process.arch;
      
      // 由于我们保持 productName 为中文，MSI 文件名可能包含中文
      // 先尝试使用中文名称查找，如果失败则查找所有 MSI 文件
      const searchMsiName = `${name}_${tauriConf.package.version}_${arch}_${language}.msi`;
      let msiPath = path.join(bundleMsiDir, searchMsiName);

      logger.info(`查找 MSI 文件: ${msiPath}`);
      
      // 先尝试精确匹配（使用中文名称）
      let msiFound = await fs.access(msiPath).then(() => true).catch(() => false);
      logger.info(`精确匹配 MSI 文件: ${msiPath}, 结果: ${msiFound}`);
      
      // 如果精确匹配失败，尝试查找目录中的所有 MSI 文件
      if (!msiFound) {
        try {
          logger.info(`尝试读取目录: ${bundleMsiDir}`);
          const dirExists = await fs.access(bundleMsiDir).then(() => true).catch(() => false);
          logger.info(`目录是否存在: ${dirExists}`);
          
          if (dirExists) {
            const files = await fs.readdir(bundleMsiDir);
            logger.info(`目录中的文件: ${files.join(', ')}`);
            const msiFiles = files.filter(f => f.toLowerCase().endsWith('.msi'));
            logger.info(`在 bundle/msi 目录找到 ${msiFiles.length} 个 MSI 文件: ${msiFiles.join(', ')}`);
            if (msiFiles.length > 0) {
              msiPath = path.join(bundleMsiDir, msiFiles[0]);
              logger.info(`使用第一个 MSI 文件: ${msiPath}`);
              msiFound = await fs.access(msiPath).then(() => true).catch(() => false);
              logger.info(`文件访问检查结果: ${msiFound}`);
            }
          } else {
            logger.warn(`目录不存在: ${bundleMsiDir}`);
          }
        } catch (error: any) {
          logger.error(`无法读取 bundle/msi 目录: ${error?.message || error}`);
          logger.info(`尝试的路径: ${bundleMsiDir}`);
          // 即使 readdir 失败，也尝试直接访问精确路径
          logger.info(`最后尝试直接访问: ${msiPath}`);
          msiFound = await fs.access(msiPath).then(() => true).catch(() => false);
        }
      }

      if (msiFound) {
        const distPath = path.resolve(`${name}.msi`);
        await fs.copyFile(msiPath, distPath);
        logger.success('Build success!');
        logger.success(`MSI 安装包已生成: ${distPath}`);
        logger.info('这是一个 MSI 安装包，双击即可安装');
        logger.info(`✓ MSI 文件内部的 ProductName 已设置为: "${name}"`);
        logger.info(`安装后的软件名称将是: "${name}"`);
        return;
      } else {
        logger.warn(`MSI 文件未找到，尝试的路径: ${msiPath}`);
      }
    }

    // 如果 MSI 失败，尝试回退到 NSIS
    if (targetBundle === 'msi') {
      logger.warn('MSI 安装包未找到，尝试回退到 NSIS...');
      const bundleNsisDir = path.join(npmDirectory, 'src-tauri/target/release/bundle/nsis');
      let nsisInstallerPath: string | undefined;
      try {
        const files = await fs.readdir(bundleNsisDir);
        const setupCandidates = files
          .filter(f => f.toLowerCase().endsWith('.exe'))
          .filter(f => f.toLowerCase().includes('setup'));
        if (setupCandidates.length > 0) {
          nsisInstallerPath = path.join(bundleNsisDir, setupCandidates[0]);
          logger.info(`在 bundle/nsis 目录找到 NSIS 安装包（回退）: ${nsisInstallerPath}`);
        }
      } catch (error) {
        logger.warn('无法读取 bundle/nsis 目录');
      }

      if (nsisInstallerPath && await fs.access(nsisInstallerPath).then(() => true).catch(() => false)) {
        const distPath = path.resolve(`${name}-setup.exe`);
        await fs.copyFile(nsisInstallerPath, distPath);
    logger.success('Build success!');
        logger.success(`Windows 安装包已生成（NSIS 回退）: ${distPath}`);
        logger.info('这是一个 NSIS 安装器，双击即可安装');
        logger.warn('⚠️  注意: MSI 生成失败，已自动回退到 NSIS 安装包。');
        return;
      }
    }
    
    // 如果都失败了，报错（不要提供裸 exe，因为它缺少依赖，双击没反应）
    logger.error('构建完成，但找不到任何安装包（MSI 或 NSIS）。');
    logger.error('⚠️  注意: 不会提供裸 .exe 文件，因为它缺少运行依赖，双击无法运行。');
    logger.info('请检查以下目录:');
    logger.info(`  - ${path.join(npmDirectory, 'src-tauri/target/release/bundle/msi')}`);
    logger.info(`  - ${path.join(npmDirectory, 'src-tauri/target/release/bundle/nsis')}`);
    logger.info(`  - ${path.join(npmDirectory, 'src-tauri/target/release/bundle')}`);
    throw new Error('无法找到任何可用的安装包（MSI 或 NSIS）');
  }

  getBuildAppPath(npmDirectory: string, dmgName: string) {
    return path.join(
      npmDirectory,
      'src-tauri/target/release/bundle/msi',
      dmgName
    );
  }
}
