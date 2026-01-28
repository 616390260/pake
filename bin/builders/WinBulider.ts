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
    // 默认使用 NSIS 生成安装包（不依赖 WiX/light.exe）
    // 说明：MSI 需要 WiX，且在 CI 场景经常因 light.exe 失败导致无法产出安装包；
    // NSIS 生成的是 *-setup.exe 安装器，双击即可安装，且对中文路径/文件名更稳。
    if (!tauriConf.tauri?.bundle?.targets || tauriConf.tauri.bundle.targets.length === 0) {
      tauriConf.tauri.bundle.targets = ['nsis'];
      logger.info('已设置 Windows 构建目标为 nsis');
    } else {
      // 强制只用 nsis，避免 msi 失败让整个构建失败
      tauriConf.tauri.bundle.targets = ['nsis'];
      logger.info('已强制 Windows 构建目标为 nsis（禁用 msi）');
    }
    
    // 检查 productName 是否包含非 ASCII 字符（如中文）
    // 如果包含，使用英文名称生成 MSI 文件名，但保持应用内部显示名称为中文
    const containsNonAscii = /[^\x00-\x7F]/.test(name);
    let buildProductName = name;
    let msiFileName = name;
    
    if (containsNonAscii) {
      // 生成一个英文名称用于 MSI 文件名（使用拼音或音译，或简单的英文标识符）
      // 这里使用一个简单的方案：将中文转换为拼音首字母，或使用一个固定的英文前缀
      // 为了简单，我们使用 "App" + 时间戳，或者使用 name 的拼音首字母
      // 但为了保持一致性，我们使用一个基于 name 的哈希值
      const hash = crypto.createHash('md5').update(name).digest('hex').substring(0, 8);
      buildProductName = `App${hash}`;
      logger.info(`检测到中文名称 "${name}"，使用英文名称 "${buildProductName}" 生成 MSI 文件名`);
      logger.info(`应用内部显示名称仍为 "${name}"`);
      
      // 临时修改 productName 用于生成 MSI 文件名
      tauriConf.package.productName = buildProductName;
    }
    
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
    if (verifyConfig.package.productName !== buildProductName) {
      logger.error(`配置验证失败: productName 应该是 "${buildProductName}"，但实际是 "${verifyConfig.package.productName}"`);
      throw new Error('配置更新失败');
    }
    logger.info('配置已正确更新并验证');
    
    // 构建前再次验证配置
    const finalConfig = JSON.parse(await fs.readFile(path.join(npmDirectory, 'src-tauri/tauri.conf.json'), 'utf-8'));
    logger.info(`最终构建配置 - productName: ${finalConfig.package.productName}`);
    
    await shellExec(`cd "${npmDirectory}" && npm install && npm run build`);
    
    // 构建完成后，如果使用了英文名称，需要恢复中文名称并重命名 MSI 文件
    if (containsNonAscii) {
      // 恢复 productName 为中文名称
      tauriConf.package.productName = name;
      await fs.writeFile(
        configJsonPath,
        Buffer.from(JSON.stringify(tauriConf, null, 2), 'utf-8')
      );
      logger.info(`已恢复 productName 为 "${name}"`);
    }
    
    // 优先查找 NSIS 安装包（*-setup.exe）
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

    // 如果没有 NSIS 安装包，再尝试查找 exe（便携版）
    // 如果使用了英文名称生成 MSI，exe 文件名也是英文名称
    const exeSearchName = containsNonAscii ? buildProductName : name;
      const exeName = `${name}.exe`; // 最终输出文件名使用中文名称
      // 查找可能的 exe 文件位置
      const possibleExePaths = [
        path.join(npmDirectory, 'src-tauri/target/release', `${exeSearchName}.exe`), // 使用构建时的 productName
        path.join(npmDirectory, 'src-tauri/target/release', `${name}.exe`), // 使用原始名称
        path.join(npmDirectory, 'src-tauri/target/release', 'app.exe'), // Cargo 默认名称
      ];
      
      let foundExe = false;
      for (const exePath of possibleExePaths) {
        if (await fs.access(exePath).then(() => true).catch(() => false)) {
          const distPath = path.resolve(exeName);
          await fs.copyFile(exePath, distPath);
          logger.success('Build success!');
          logger.success(`可执行文件已生成: ${distPath}`);
          logger.warn('⚠️  注意: 只生成了 .exe 文件，而不是 .msi 安装包。');
          logger.warn('⚠️  这可能是因为 WiX 工具集配置问题。');
          logger.warn('⚠️  你可以直接运行 .exe 文件，但更推荐使用安装包（nsis *-setup.exe）。');
          foundExe = true;
          break;
        }
      }
      
      if (!foundExe) {
        logger.error('构建完成，但找不到输出文件。');
        logger.info('请检查以下目录:');
        logger.info(`  - ${path.join(npmDirectory, 'src-tauri/target/release')}`);
        logger.info(`  - ${path.join(npmDirectory, 'src-tauri/target/release/bundle/nsis')}`);
        logger.info(`  - ${path.join(npmDirectory, 'src-tauri/target/release/bundle')}`);
        throw new Error('无法找到构建输出文件');
      }
    }
  }

  getBuildAppPath(npmDirectory: string, dmgName: string) {
    return path.join(
      npmDirectory,
      'src-tauri/target/release/bundle/msi',
      dmgName
    );
  }
}
