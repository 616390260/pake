import { IS_MAC, IS_WIN, IS_LINUX } from '@/utils/platform.js';
import { IBuilder } from './base.js';
import MacBuilder from './MacBuilder.js';
import WinBuilder from './WinBulider.js';
import LinuxBuilder from './LinuxBuilder.js';
import logger from '@/options/logger.js';

export default class BuilderFactory {
  /**
   * 创建构建器实例
   * @param targetPlatform 目标平台，可选值: 'mac' | 'win' | 'linux'
   *                       如果不指定，则根据当前系统自动选择
   */
  static create(targetPlatform?: 'mac' | 'win' | 'linux'): IBuilder {
    // 如果指定了目标平台，使用指定的平台
    if (targetPlatform) {
      if (targetPlatform === 'mac') {
        return new MacBuilder();
      }
      if (targetPlatform === 'win') {
        // 在非 Windows 系统上使用交叉编译
        if (!IS_WIN) {
          logger.info('🔧 将使用交叉编译方式构建 Windows 应用');
          logger.info('注意: 将生成 .exe 文件，而不是 .msi 安装包\n');
        }
        return new WinBuilder();
      }
      if (targetPlatform === 'linux') {
        return new LinuxBuilder();
      }
      throw new Error(`不支持的目标平台: ${targetPlatform}`);
    }

    // 如果没有指定目标平台，根据当前系统自动选择
    if (IS_MAC) {
      return new MacBuilder();
    }
    if (IS_WIN) {
      return new WinBuilder();
    }
    if (IS_LINUX) {
      return new LinuxBuilder();
    }
    throw new Error('The current system does not support!!');
  }
}
