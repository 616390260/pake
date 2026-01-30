// at the top of main.rs - that will prevent the console from showing
// 临时注释掉以显示错误信息，生产环境可以恢复
// #![windows_subsystem = "windows"]
extern crate image;
use tauri_utils::config::{Config, WindowConfig};
use wry::{
    application::{
        event::{Event, StartCause, WindowEvent},
        event_loop::{ControlFlow, EventLoop},
        menu::MenuType,
        window::{Fullscreen, Window, WindowBuilder},
    },
    webview::WebViewBuilder,
};

#[cfg(target_os = "macos")]
use wry::application::{
    accelerator::{Accelerator, SysMods},
    keyboard::KeyCode,
    menu::{MenuBar as Menu, MenuItem, MenuItemAttributes},
    platform::macos::WindowBuilderExtMacOS,
};

#[cfg(target_os = "windows")]
use wry::application::window::Icon;

#[cfg(any(target_os = "linux", target_os = "windows"))]
use wry::webview::WebContext;

use dirs::download_dir;
use std::path::PathBuf;

enum UserEvent {
    DownloadStarted(String, String),
    DownloadComplete(#[allow(dead_code)] Option<PathBuf>, bool), // path 字段保留用于未来扩展
}

fn main() {
    // 立即刷新输出，确保能看到日志
    use std::io::Write;
    let _ = std::io::stdout().flush();
    let _ = std::io::stderr().flush();
    
    println!("=== Pake 应用启动 ===");
    println!("版本: 调试版本（显示控制台）");
    println!("如果应用闪退，请查看下面的错误信息...");
    println!("");
    
    // 设置 panic hook，捕获 panic 并显示错误信息
    #[cfg(target_os = "windows")]
    {
        std::panic::set_hook(Box::new(|panic_info| {
            use std::fs::OpenOptions;
            use std::io::Write;
            
            let error_msg = format!("应用崩溃: {:?}", panic_info);
            eprintln!("{}", error_msg);
            let _ = std::io::stderr().flush();
            
            // 写入日志文件
            let log_path = std::env::var("APPDATA").unwrap_or_default() + "\\pake_crash.log";
            if let Ok(mut file) = OpenOptions::new()
                .create(true)
                .append(true)
                .open(&log_path)
            {
                let _ = writeln!(file, "=== 崩溃时间: {:?} ===", std::time::SystemTime::now());
                let _ = writeln!(file, "{}", error_msg);
                let _ = writeln!(file, "位置: {:?}", panic_info.location());
                if let Some(s) = panic_info.payload().downcast_ref::<&str>() {
                    let _ = writeln!(file, "消息: {}", s);
                } else if let Some(s) = panic_info.payload().downcast_ref::<String>() {
                    let _ = writeln!(file, "消息: {}", s);
                }
                let _ = file.flush();
            }
            eprintln!("错误日志已保存到: {}", log_path);
            
            // 保持窗口打开 60 秒，让用户看到错误信息
            eprintln!("\n窗口将在 60 秒后关闭，请查看上面的错误信息...");
            eprintln!("或者查看日志文件: {}", log_path);
            let _ = std::io::stderr().flush();
            std::thread::sleep(std::time::Duration::from_secs(60));
        }));
    }
    
    println!("[1/5] 设置 panic hook... 完成");
    let _ = std::io::stdout().flush();
    
    // 使用 catch_unwind 捕获 panic
    let result = std::panic::catch_unwind(|| {
        println!("[2/5] 进入 main_inner...");
        let _ = std::io::stdout().flush();
        
        match main_inner() {
            Ok(_) => {
                println!("[5/5] 应用正常退出");
                let _ = std::io::stdout().flush();
            }
            Err(e) => {
                eprintln!("[错误] 应用错误: {:?}", e);
                let _ = std::io::stderr().flush();
                eprintln!("\n窗口将在 60 秒后关闭，请查看上面的错误信息...");
                let _ = std::io::stderr().flush();
                std::thread::sleep(std::time::Duration::from_secs(60));
            }
        }
    });
    
    if let Err(e) = result {
        eprintln!("[崩溃] 应用崩溃: {:?}", e);
        let _ = std::io::stderr().flush();
        eprintln!("\n窗口将在 60 秒后关闭，请查看上面的错误信息...");
        let _ = std::io::stderr().flush();
        std::thread::sleep(std::time::Duration::from_secs(60));
    }
}

fn main_inner() -> wry::Result<()> {
    println!("Pake 应用启动中...");
    
    #[cfg(target_os = "macos")]
    let (menu_bar_menu, close_item) = {
        let mut menu_bar_menu = Menu::new();
        let mut first_menu = Menu::new();
        first_menu.add_native_item(MenuItem::Hide);
        first_menu.add_native_item(MenuItem::EnterFullScreen);
        first_menu.add_native_item(MenuItem::Minimize);
        first_menu.add_native_item(MenuItem::Separator);
        first_menu.add_native_item(MenuItem::Copy);
        first_menu.add_native_item(MenuItem::Cut);
        first_menu.add_native_item(MenuItem::Paste);
        first_menu.add_native_item(MenuItem::Undo);
        first_menu.add_native_item(MenuItem::Redo);
        first_menu.add_native_item(MenuItem::SelectAll);
        first_menu.add_native_item(MenuItem::Separator);
        let close_item = first_menu.add_item(
            MenuItemAttributes::new("CloseWindow")
                .with_accelerators(&Accelerator::new(SysMods::Cmd, KeyCode::KeyW)),
        );
        first_menu.add_native_item(MenuItem::Quit);
        menu_bar_menu.add_submenu("App", true, first_menu);
        (menu_bar_menu, close_item)
    };

    #[cfg(any(target_os = "linux", target_os = "windows"))]
    let (
        package_name,
        WindowConfig {
            url,
            width,
            height,
            resizable,
            fullscreen,
            ..
        },
    ) = {
        println!("[3/5] 正在读取配置文件...");
        let _ = std::io::stdout().flush();
        let (package_name, windows_config) = match std::panic::catch_unwind(|| get_windows_config()) {
            Ok(result) => result,
            Err(e) => {
                eprintln!("错误: 读取配置文件时发生 panic: {:?}", e);
                std::process::exit(1);
            }
        };
        let package_name = match package_name {
            Some(name) => name.to_lowercase(),
            None => {
                eprintln!("错误: 配置文件中没有 package name");
                std::process::exit(1);
            }
        };
        let config = windows_config.unwrap_or_default();
        println!("配置读取成功: package_name={}, url={}", package_name, config.url.to_string());
        (package_name, config)
    };

    #[cfg(target_os = "macos")]
    let WindowConfig {
        url,
        width,
        height,
        resizable,
        transparent,
        fullscreen,
        ..
    } = get_windows_config().1.unwrap_or_default();

    let event_loop: EventLoop<UserEvent> = EventLoop::with_user_event();
    let proxy = event_loop.create_proxy();
    let common_window = WindowBuilder::new()
        .with_title("")
        .with_resizable(resizable)
        .with_fullscreen(if fullscreen {
            Some(Fullscreen::Borderless(None))
        } else {
            None
        })
        .with_inner_size(wry::application::dpi::LogicalSize::new(width, height));

    #[cfg(target_os = "windows")]
    let window = {
        // 获取可执行文件所在目录，用于查找资源文件
        let exe_dir = match std::env::current_exe() {
            Ok(exe_path) => {
                exe_path.parent().map(|p| p.to_path_buf()).unwrap_or_default()
            }
            Err(e) => {
                println!("警告: 无法获取可执行文件路径: {:?}，使用当前目录", e);
                std::env::current_dir().unwrap_or_default()
            }
        };
        println!("可执行文件目录: {}", exe_dir.display());
        
        // 尝试查找图标文件，支持中文名称和英文哈希名称
        // 先尝试相对路径（开发环境），再尝试可执行文件目录（安装后）
        let mut icon_paths = vec![
            format!("png/{}_32.ico", package_name),
            exe_dir.join(format!("png/{}_32.ico", package_name)).to_string_lossy().to_string(),
        ];
        
        // 如果 package_name 包含非 ASCII 字符，添加英文哈希名称路径
        let has_non_ascii = package_name.chars().any(|c| c as u32 > 127);
        if has_non_ascii {
            let hash = md5::compute(package_name.as_bytes());
            let hash_hex = format!("{:x}", hash);
            let hash_prefix = &hash_hex[..8.min(hash_hex.len())];
            icon_paths.push(format!("png/app{}_32.ico", hash_prefix));
            icon_paths.push(exe_dir.join(format!("png/app{}_32.ico", hash_prefix)).to_string_lossy().to_string());
        }
        
        // 添加默认图标路径
        icon_paths.push("png/icon_32.ico".to_string());
        icon_paths.push(exe_dir.join("png/icon_32.ico").to_string_lossy().to_string());
        
        // 尝试每个路径，找到第一个存在的
        let mut icon_path = None;
        for path_str in &icon_paths {
            let path = std::path::Path::new(path_str);
            if path.exists() {
                println!("找到图标文件: {}", path_str);
                icon_path = Some(path_str.clone());
                break;
            }
        }
        
        let icon = if let Some(ref path_str) = icon_path {
            match load_icon(std::path::Path::new(path_str)) {
                Ok(icon) => {
                    println!("图标加载成功: {}", path_str);
                    Some(icon)
                }
                Err(e) => {
                    println!("警告: 无法加载图标 {}: {:?}，跳过图标", path_str, e);
                    None
                }
            }
        } else {
            println!("警告: 未找到任何图标文件，跳过图标");
            None
        };
        
        let mut window_builder = common_window.with_decorations(true);
        if let Some(icon) = icon {
            window_builder = window_builder.with_window_icon(Some(icon));
        }
        println!("正在创建窗口...");
        window_builder.build(&event_loop)
            .map_err(|e| {
                eprintln!("错误: 无法创建窗口: {:?}", e);
                e
            })?
    };

    #[cfg(target_os = "linux")]
    let window = common_window.build(&event_loop)
        .map_err(|e| {
            eprintln!("错误: 无法创建窗口: {:?}", e);
            e
        })?;

    #[cfg(target_os = "macos")]
    let window = common_window
        .with_fullsize_content_view(true)
        .with_titlebar_buttons_hidden(false)
        .with_titlebar_transparent(transparent)
        .with_title_hidden(true)
        .with_menu(menu_bar_menu)
        .build(&event_loop)
        .map_err(|e| {
            eprintln!("错误: 无法创建窗口: {:?}", e);
            e
        })?;

    // Handling events of JS -> Rust
    let handler = move |window: &Window, req: String| {
        if req == "drag_window" {
            let _ = window.drag_window();
        } else if req == "fullscreen" {
            let is_maximized = window.is_maximized();
            window.set_maximized(!is_maximized);
        } else if req.starts_with("open_browser") {
            let href = req.replace("open_browser:", "");
            if let Err(e) = webbrowser::open(&href) {
                eprintln!("警告: 无法打开浏览器: {:?}", e);
            }
        }
    };

    let download_started = {
        let proxy = proxy.clone();
        move |uri: String, default_path: &mut PathBuf| {
            let path = match download_dir() {
                Some(dir) => dir.join(default_path.display().to_string()).as_path().to_path_buf(),
                None => {
                    eprintln!("警告: 无法找到下载目录，使用临时目录");
                    std::env::temp_dir().join(default_path.display().to_string())
                }
            };
            *default_path = path.clone();
            let submitted = proxy
                .send_event(UserEvent::DownloadStarted(uri, path.display().to_string()))
                .is_ok();
            submitted
        }
    };

    let download_completed = {
        move |_uri, path, success| {
            let _ = proxy.send_event(UserEvent::DownloadComplete(path, success));
        }
    };

    #[cfg(target_os = "macos")]
    let webview = {
        let user_agent_string = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.1 Safari/605.1.15";
        let url_str = url.to_string();
        println!("[4/5] 正在加载 URL: {}", url_str);
        let _ = std::io::stdout().flush();
        
        // 验证 URL 格式
        if url_str.is_empty() || url_str == "null" {
            eprintln!("[错误] URL 为空或无效: '{}'", url_str);
            return Err(wry::Error::from(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "URL 为空或无效"
            )));
        }
        
        println!("[4/5] 正在创建 WebView...");
        let _ = std::io::stdout().flush();
        
        let webview_result = WebViewBuilder::new(window)
            .with_user_agent(user_agent_string)
            .with_url(&url_str);
        
        match webview_result {
            Ok(mut builder) => {
                println!("[4/5] WebView 构建器创建成功，继续配置...");
                let _ = std::io::stdout().flush();
                builder
                    .with_devtools(cfg!(feature = "devtools"))
                    .with_initialization_script(include_str!("pake.js"))
                    .with_ipc_handler(handler)
                    .with_back_forward_navigation_gestures(true)
                    .with_download_started_handler(download_started)
                    .with_download_completed_handler(download_completed)
                    .build()
            }
            Err(e) => {
                eprintln!("[错误] 无法创建 WebView 或加载 URL '{}': {:?}", url_str, e);
                let _ = std::io::stderr().flush();
                Err(e)
            }
        }?
    };

    #[cfg(any(target_os = "linux", target_os = "windows"))]
    let webview = {
        let home_dir = match home::home_dir() {
            Some(path1) => {
                println!("找到用户主目录: {}", path1.display());
                path1
            }
            None => {
                eprintln!("错误: 无法找到用户主目录");
                std::process::exit(1);
            }
        };
        #[cfg(target_os = "windows")]
        let data_dir = home_dir.join("AppData").join("Roaming").join(package_name);
        #[cfg(target_os = "linux")]
        let data_dir = home_dir.join(".config").join(package_name);
        if !data_dir.exists() {
            println!("创建数据目录: {}", data_dir.display());
            if let Err(e) = std::fs::create_dir_all(&data_dir) {
                eprintln!("警告: 无法创建数据目录 {}: {:?}", data_dir.display(), e);
                // 继续执行，不因为目录创建失败而退出
            } else {
                println!("数据目录创建成功");
            }
        } else {
            println!("数据目录已存在: {}", data_dir.display());
        }
        let mut web_content = WebContext::new(Some(data_dir));
        #[cfg(target_os = "windows")]
        let user_agent_string = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36";
        #[cfg(target_os = "linux")]
        let user_agent_string = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36";
        let url_str = url.to_string();
        println!("[4/5] 正在加载 URL: {}", url_str);
        let _ = std::io::stdout().flush();
        WebViewBuilder::new(window)?
            .with_user_agent(user_agent_string)
            .with_url(&url_str)?
            .with_devtools(cfg!(feature = "devtools"))
            .with_initialization_script(include_str!("pake.js"))
            .with_ipc_handler(handler)
            .with_web_context(&mut web_content)
            .with_download_started_handler(download_started)
            .with_download_completed_handler(download_completed)
            .build()?
    };
    #[cfg(feature = "devtools")]
    {
        webview.open_devtools();
    }

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;

        match event {
            Event::NewEvents(StartCause::Init) => println!("Wry has started!"),
            Event::WindowEvent {
                event: WindowEvent::CloseRequested,
                ..
            } => *control_flow = ControlFlow::Exit,
            Event::MenuEvent {
                menu_id,
                origin: MenuType::MenuBar,
                ..
            } => {
                #[cfg(target_os = "macos")]
                if menu_id == close_item.clone().id() {
                    webview.window().set_minimized(true);
                }
                println!("Clicked on {menu_id:?}");
            }
            Event::UserEvent(UserEvent::DownloadStarted(uri, temp_dir)) => {
                println!("Download: {uri}");
                println!("Will write to: {temp_dir:?}");
            }
            Event::UserEvent(UserEvent::DownloadComplete(_, success)) => {
                println!("Succeeded: {success}");
                if success {
                    let _ = webview.evaluate_script("window.pakeToast('Save in downloads folder')");
                } else {
                    println!("No output path")
                }
            }
            _ => (),
        }
    });
}

fn get_windows_config() -> (Option<String>, Option<WindowConfig>) {
    let config_file = include_str!("../tauri.conf.json");
    let config: Config = match serde_json::from_str(config_file) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("错误: 无法解析配置文件: {:?}", e);
            eprintln!("配置文件内容: {}", config_file);
            return (None, None);
        }
    };
    (
        config.package.product_name.clone(),
        config.tauri.windows.first().cloned(),
    )
}

#[cfg(target_os = "windows")]
fn load_icon(path: &std::path::Path) -> Result<Icon, String> {
    let image = match image::open(path) {
        Ok(img) => img,
        Err(e) => return Err(format!("无法打开图标文件 {}: {:?}", path.display(), e)),
    };
    let rgba_image = image.into_rgba8();
    let (width, height) = rgba_image.dimensions();
    let rgba = rgba_image.into_raw();
    Icon::from_rgba(rgba, width, height)
        .map_err(|e| format!("无法创建图标: {:?}", e))
}
