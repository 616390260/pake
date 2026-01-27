import path from 'path';
import { IS_WIN } from '@/utils/platform.js';
import ora from 'ora';
import shelljs from 'shelljs';
import { shellExec } from '../utils/shell.js';

const RustInstallScriptFocMac =
  "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y";
const RustInstallScriptForWin = 'winget install --id Rustlang.Rustup';

/**
 * 安装 Rust 工具链
 */
export async function installRust() {
  const spinner = ora('Downloading Rust').start();
  try {
    await shellExec(IS_WIN ? RustInstallScriptForWin : RustInstallScriptFocMac);
    spinner.succeed();
  } catch (error) {
    console.error('Error codes that occur during the Rust installation process.', error.message);
    spinner.fail();

    process.exit(1);
  }
}

/**
 * 检查 Rust 是否已安装
 */
export function checkRustInstalled() {
  return shelljs.exec('rustc --version', { silent: true }).code === 0;
}

/**
 * 检查 Visual Studio Build Tools 是否已安装
 * 通过检查 cl.exe 或 link.exe 是否在 PATH 中
 */
export function checkMSVCInstalled() {
  if (!IS_WIN) {
    return true;
  }
  
  // 检查 cl.exe (MSVC 编译器)
  const clCheck = shelljs.exec('where cl.exe', { silent: true }).code === 0;
  // 检查 link.exe (MSVC 链接器)
  const linkCheck = shelljs.exec('where link.exe', { silent: true }).code === 0;
  
  // 如果都不在 PATH 中，尝试检查常见的 Visual Studio 安装路径
  if (!clCheck && !linkCheck) {
    const programFiles = process.env['ProgramFiles(x86)'] || process.env.ProgramFiles || '';
    const vsPaths = [
      path.join(programFiles, 'Microsoft Visual Studio', '2022', 'BuildTools', 'VC', 'Tools', 'MSVC'),
      path.join(programFiles, 'Microsoft Visual Studio', '2022', 'Community', 'VC', 'Tools', 'MSVC'),
      path.join(programFiles, 'Microsoft Visual Studio', '2022', 'Professional', 'VC', 'Tools', 'MSVC'),
      path.join(programFiles, 'Microsoft Visual Studio', '2019', 'BuildTools', 'VC', 'Tools', 'MSVC'),
      path.join(programFiles, 'Microsoft Visual Studio', '2019', 'Community', 'VC', 'Tools', 'MSVC'),
    ];
    
    // 检查是否存在 MSVC 目录
    for (const vsPath of vsPaths) {
      if (shelljs.test('-d', vsPath)) {
        return true;
      }
    }
    return false;
  }
  
  return clCheck || linkCheck;
}

/**
 * 检查 WiX Toolset 是否已安装
 * WiX 用于生成 Windows 安装包 (.msi)
 * 在非 Windows 系统上返回 false（因为 WiX 只能在 Windows 上运行）
 */
export function checkWiXInstalled() {
  if (!IS_WIN) {
    return false; // WiX 只能在 Windows 上运行
  }
  
  // 检查 candle.exe (WiX 编译器)
  const candleCheck = shelljs.exec('where candle.exe', { silent: true }).code === 0;
  // 检查 light.exe (WiX 链接器)
  const lightCheck = shelljs.exec('where light.exe', { silent: true }).code === 0;
  
  // 如果都不在 PATH 中，检查常见的 WiX 安装路径
  if (!candleCheck && !lightCheck) {
    const programFiles = process.env['ProgramFiles(x86)'] || process.env.ProgramFiles || '';
    const wixPath = path.join(programFiles, 'WiX Toolset v3.11', 'bin');
    return shelljs.test('-d', wixPath);
  }
  
  return candleCheck || lightCheck;
}

/**
 * 检查 mingw-w64 工具链是否可用（用于交叉编译）
 */
export function checkMinGWInstalled() {
  if (IS_WIN) {
    // 在 Windows 上，优先使用 MSVC
    return false;
  }
  
  // 检查 x86_64-w64-mingw32-gcc 或 i686-w64-mingw32-gcc
  const x64Check = shelljs.exec('which x86_64-w64-mingw32-gcc', { silent: true }).code === 0;
  const x86Check = shelljs.exec('which i686-w64-mingw32-gcc', { silent: true }).code === 0;
  
  return x64Check || x86Check;
}

/**
 * 检查 Rust Windows GNU 目标是否已安装
 */
export function checkRustWindowsGnuTarget() {
  const result = shelljs.exec('rustup target list --installed', { silent: true });
  if (result.code !== 0) {
    return false;
  }
  return result.stdout.includes('x86_64-pc-windows-gnu') || result.stdout.includes('i686-pc-windows-gnu');
}
