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

fn main() -> wry::Result<()> {
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
        println!("正在读取配置文件...");
        let (package_name, windows_config) = match std::panic::catch_unwind(|| get_windows_config()) {
            Ok(result) => result,
            Err(e) => {
                println!("错误: 读取配置文件时发生 panic: {:?}", e);
                return Err(wry::Error::Init("配置文件读取失败".into()));
            }
        };
        let package_name = match package_name {
            Some(name) => name.to_lowercase(),
            None => {
                println!("错误: 配置文件中没有 package name");
                return Err(wry::Error::Init("配置文件中没有 package name".into()));
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
        // 尝试查找图标文件，支持中文名称和英文哈希名称
        let mut icon_path = format!("png/{}_32.ico", package_name);
        
        // 如果使用中文名称找不到图标，尝试使用英文哈希名称（和 JavaScript 相同的 MD5 逻辑）
        if !std::path::Path::new(&icon_path).exists() {
            // 如果 package_name 包含非 ASCII 字符，生成英文哈希名称
            let has_non_ascii = package_name.chars().any(|c| c as u32 > 127);
            if has_non_ascii {
                let hash = md5::compute(package_name.as_bytes());
                let hash_hex = format!("{:x}", hash);
                let hash_prefix = &hash_hex[..8.min(hash_hex.len())];
                icon_path = format!("png/app{}_32.ico", hash_prefix);
            }
        }
        
        // 如果还是找不到，使用默认图标
        if !std::path::Path::new(&icon_path).exists() {
            icon_path = "png/icon_32.ico".to_string();
        }
        
        println!("尝试加载图标: {}", icon_path);
        let icon = match load_icon(std::path::Path::new(&icon_path)) {
            Ok(icon) => {
                println!("图标加载成功: {}", icon_path);
                Some(icon)
            }
            Err(e) => {
                println!("警告: 无法加载图标 {}: {:?}，使用默认图标", icon_path, e);
                None
            }
        };
        let mut window_builder = common_window.with_decorations(true);
        if let Some(icon) = icon {
            window_builder = window_builder.with_window_icon(Some(icon));
        }
        println!("正在创建窗口...");
        window_builder.build(&event_loop)
            .map_err(|e| {
                println!("错误: 无法创建窗口: {:?}", e);
                e
            })?
    };

    #[cfg(target_os = "linux")]
    let window = common_window.build(&event_loop)
        .map_err(|e| {
            eprintln!("错误: 无法创建窗口: {:?}", e);
            wry::Error::Init(format!("无法创建窗口: {:?}", e))
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
            wry::Error::Init(format!("无法创建窗口: {:?}", e))
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
            let path = download_dir()
                .map_err(|e| {
                    eprintln!("错误: 无法创建图标: {:?}", e);
                    wry::Error::Init(format!("无法创建图标: {:?}", e))
                })?
                .join(default_path.display().to_string())
                .as_path()
                .to_path_buf();
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
        println!("正在加载 URL: {}", url_str);
        WebViewBuilder::new(window)?
            .with_user_agent(user_agent_string)
            .with_url(&url_str)?
            .with_devtools(cfg!(feature = "devtools"))
            .with_initialization_script(include_str!("pake.js"))
            .with_ipc_handler(handler)
            .with_back_forward_navigation_gestures(true)
            .with_download_started_handler(download_started)
            .with_download_completed_handler(download_completed)
            .build()?
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
        println!("正在加载 URL: {}", url_str);
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
