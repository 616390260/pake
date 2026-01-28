import { PakeAppOptions } from '@/types.js';
import prompts from 'prompts';
import path from 'path';
import fs from 'fs/promises';
import { npmDirectory } from '@/utils/dir.js';
import logger from '@/options/logger.js';

export async function promptText(message: string, initial?: string) {
  const response = await prompts({
    type: 'text',
    name: 'content',
    message,
    initial,
  });
  return response.content;
}

export async function mergeTauriConfig(
  url: string,
  options: PakeAppOptions,
  tauriConf: any
) {
  const {
    width,
    height,
    fullscreen,
    transparent,
    resizable,
    identifier,
    name,
  } = options;

  const tauriConfWindowOptions = {
    width,
    height,
    fullscreen,
    transparent,
    resizable,
  };
  // Package name is valid ?
  // for Linux, package name must be a-z, 0-9 or "-", not allow to A-Z and other
  if (process.platform === "linux") {
    const reg = new RegExp(/[0-9]*[a-z]+[0-9]*\-?[0-9]*[a-z]*[0-9]*\-?[0-9]*[a-z]*[0-9]*/);
    if (!reg.test(name) || reg.exec(name)[0].length != name.length) {
      logger.error("package name is illegal， it must be lowercase letters, numbers, dashes, and it must contain the lowercase letters.")
      logger.error("E.g com-123-xxx, 123pan, pan123,weread, we-read");
      process.exit();
    }
  }
  if (process.platform === "win32") {
    // Windows productName 可以包含中文字符，只需要至少包含一个字符即可
    // identifier 会由 getIdentifier 函数处理，确保是有效的包标识符
    if (!name || name.trim().length === 0) {
      logger.error("package name cannot be empty");
      process.exit();
    }
    // 允许中文、字母、数字和常见符号
    // productName 用于显示，可以包含任何字符
    logger.info(`Windows productName: ${name} (允许包含中文)`);
  }


  Object.assign(tauriConf.tauri.windows[0], { url, ...tauriConfWindowOptions });
  tauriConf.package.productName = name;
  tauriConf.tauri.bundle.identifier = identifier;
  // 处理图标配置
  const exists = await fs.stat(options.icon)
    .then(() => true)
    .catch(() => false);
  
  // 检查是否在交叉编译 Windows 应用
  const isCrossCompilingWindows = process.env.PAKE_TARGET_PLATFORM === 'win' || 
                                   (process.platform !== 'win32' && tauriConf.tauri?.bundle?.targets?.includes('msi') === false);
  
  if (exists) {
    let updateIconPath = true;
    let customIconExt = path.extname(options.icon).toLowerCase();
    
    // Windows 平台或交叉编译 Windows
    if (process.platform === "win32" || isCrossCompilingWindows) {
      if (customIconExt === ".ico") {
        // 复制图标到 png 目录
        const ico_32_path = path.join(npmDirectory, `src-tauri/png/${name.toLowerCase()}_32.ico`);
        const ico_256_path = path.join(npmDirectory, `src-tauri/png/${name.toLowerCase()}_256.ico`);
        await fs.copyFile(options.icon, ico_32_path).catch(() => {});
        await fs.copyFile(options.icon, ico_256_path).catch(() => {});
        // 设置 Windows 图标配置
        tauriConf.tauri.bundle.icon = [
          `png/${name.toLowerCase()}_256.ico`,
          `png/${name.toLowerCase()}_32.ico`
        ];
        tauriConf.tauri.bundle.resources = [`png/${name.toLowerCase()}_32.ico`];
      } else {
        updateIconPath = false;
        logger.warn(`icon file in Windows must be 256 * 256 pix with .ico type, but you give ${customIconExt}`);
      }
    }
    
    if (process.platform === "linux" && !isCrossCompilingWindows) {
      delete tauriConf.tauri.bundle.deb.files;
      if (customIconExt != ".png") {
        updateIconPath = false;
        logger.warn(`icon file in Linux must be 512 * 512 pix with .png type, but you give ${customIconExt}`);
      }
    }

    if (process.platform === "darwin" && customIconExt !== ".icns" && !isCrossCompilingWindows) {
        updateIconPath = false;
        logger.warn(`icon file in MacOS must be .icns type, but you give ${customIconExt}`);
    }
    
    if (updateIconPath && !isCrossCompilingWindows) {
      tauriConf.tauri.bundle.icon = [options.icon];
    } else if (!updateIconPath) {
      logger.warn(`icon file will not change with default.`);
    }
  } else {
    // 如果没有提供图标，使用默认图标
    if (isCrossCompilingWindows || process.platform === "win32") {
      // Windows 使用默认图标
      const defaultIcon32 = path.join(npmDirectory, 'src-tauri/png/icon_32.ico');
      const defaultIcon256 = path.join(npmDirectory, 'src-tauri/png/icon_256.ico');
      const defaultExists32 = await fs.stat(defaultIcon32).then(() => true).catch(() => false);
      const defaultExists256 = await fs.stat(defaultIcon256).then(() => true).catch(() => false);
      
      if (defaultExists32 && defaultExists256) {
        // 复制默认图标到应用名称
        const appIcon32 = path.join(npmDirectory, `src-tauri/png/${name.toLowerCase()}_32.ico`);
        const appIcon256 = path.join(npmDirectory, `src-tauri/png/${name.toLowerCase()}_256.ico`);
        await fs.copyFile(defaultIcon32, appIcon32).catch(() => {});
        await fs.copyFile(defaultIcon256, appIcon256).catch(() => {});
        tauriConf.tauri.bundle.icon = [
          `png/${name.toLowerCase()}_256.ico`,
          `png/${name.toLowerCase()}_32.ico`
        ];
        tauriConf.tauri.bundle.resources = [`png/${name.toLowerCase()}_32.ico`];
        logger.info(`Using default icon for Windows app: ${name}`);
      } else {
        logger.warn("Default icon files not found, app will use system default icon");
      }
    } else {
      logger.warn("the custom icon path may not exists. we will use default icon to replace it");
    }
  }

  // 如果是 Windows 构建（包括交叉编译），确保图标配置正确
  if (isCrossCompilingWindows || process.platform === "win32") {
    // 确保 Windows 配置文件中的图标路径是相对路径
    if (tauriConf.tauri?.bundle?.icon) {
      const iconArray = Array.isArray(tauriConf.tauri.bundle.icon) 
        ? tauriConf.tauri.bundle.icon 
        : [tauriConf.tauri.bundle.icon];
      
      // 将绝对路径转换为相对路径
      tauriConf.tauri.bundle.icon = iconArray.map((icon: string) => {
        if (path.isAbsolute(icon)) {
          // 如果是绝对路径，提取相对路径部分
          const relativePath = path.relative(path.join(npmDirectory, 'src-tauri'), icon);
          return relativePath.startsWith('png/') ? relativePath : icon;
        }
        return icon;
      });
    }
  }
  
  let configPath = "";
  switch (process.platform) {
    case "win32": {
      configPath = path.join(npmDirectory, 'src-tauri/tauri.windows.conf.json');
      break;
    }
    case "darwin": {
      // 如果交叉编译 Windows，使用 Windows 配置
      if (isCrossCompilingWindows) {
        configPath = path.join(npmDirectory, 'src-tauri/tauri.windows.conf.json');
      } else {
        configPath = path.join(npmDirectory, 'src-tauri/tauri.macos.conf.json');
      }
      break;
    }
    case "linux": {
      // 如果交叉编译 Windows，使用 Windows 配置
      if (isCrossCompilingWindows) {
        configPath = path.join(npmDirectory, 'src-tauri/tauri.windows.conf.json');
      } else {
        configPath = path.join(npmDirectory, 'src-tauri/tauri.linux.conf.json');
      }
      break;
    }
  }

  // 对于 Windows 构建，确保 WiX 配置支持中文
  if (process.platform === "win32" || isCrossCompilingWindows) {
    if (!tauriConf.tauri.bundle.windows) {
      tauriConf.tauri.bundle.windows = {};
    }
    if (!tauriConf.tauri.bundle.windows.wix) {
      tauriConf.tauri.bundle.windows.wix = {};
    }
    // 设置 WiX 语言和 codepage，支持中文
    if (!tauriConf.tauri.bundle.windows.wix.language) {
      tauriConf.tauri.bundle.windows.wix.language = ['zh-CN', 'en-US'];
    }
    // 确保 codepage 支持 UTF-8 (65001) 或 GBK (936)
    // Tauri 会自动处理 codepage，但我们可以确保配置正确
  }
  
  let bundleConf = {tauri: {bundle: tauriConf.tauri.bundle}};
  await fs.writeFile(
    configPath,
    Buffer.from(JSON.stringify(bundleConf), 'utf-8')
  );


  const configJsonPath = path.join(npmDirectory, 'src-tauri/tauri.conf.json')
  await fs.writeFile(
    configJsonPath,
    Buffer.from(JSON.stringify(tauriConf), 'utf-8')
  );
}
