# DuckDuckGo search: env-paths node cache directory convention XDG windows LOCALAPPDATA model download

## 1. env-paths - npm
<https://www.npmjs.com/package/env-paths>

Get paths for storing things like data, config, cache, etc. Latest version: 4.0.0, last published: 6 months ago. Start using env-paths in your project by running `npm i env-paths`. There are 1844 other projects in the npm registry using env-paths.

## 2. How to Get the Local Application Data Directory Path Cross-Platform...
<https://www.w3tutorials.net/blog/what-is-the-cross-platform-way-of-obtaining-the-path-to-the-local-application-data-directory/>

# PowerShell $localAppData = $env:LOCALAPPDATA Write-Host "Local App Data Path: $localAppData".In Node.js, use process.env for environment variables and os.homedir() to get the user’s home directory. Method 1: Use appdata-path (Third-Party Library)#.

## 3. typescript - Where can I see deno downloaded... - Stack Overflow
<https://stackoverflow.com/questions/61799309/where-can-i-see-deno-downloaded-packages>

On Windows: %LOCALAPPDATA%/deno (%LOCALAPPDATA% = FOLDERID_LocalAppData).You can use deno info to get the cache directory of remote modules. Sample output (Windows 10)

## 4. Установка Node.js и пакетного менеджера NPM в Windows
<https://winitpro.ru/index.php/2024/09/05/ustanovka-node-js-npm-windows/>

Node.js это кроссплатформенная среда исполнения, позволяющая запускать серверные (бэкенд) приложения JavaScript вне браузера. В этой статье мы рассмотрим, как установить фреймворк Node.js и его менеджер пакетов NPM в Windows.

## 5. What is "%localappdata%\Programs" ? - Microsoft Q&A
<https://learn.microsoft.com/en-us/answers/questions/3235887/what-is-localappdataprograms>

AppData is the folder where Windows saves all the configuration information of the applications installed on your computer, having one for each of the users that you have created. It is to protect user data and settings from any unwanted change or deletion.

## 6. Node.js — Download Node.js
<https://nodejs.org/en/download>

Node.js® is a free, open-source, cross-platform JavaScript runtime environment that lets developers create servers, web apps, command line tools and scripts.Download a signed Node.js source. tarball. Check out our nightly.

## 7. AppData – Where to Find the AppData Folder in Windows 10
<https://www.freecodecamp.org/news/appdata-where-to-find-the-appdata-folder-in-windows-10/>

By Vijit Ail The AppData folder includes application settings, files, and data unique to the applications on your Windows PC. The folder is hidden by default in Windows File Explorer and has three hidden sub-folders: Local, LocalLow, and Roaming.

## 8. Ithy - Resolving the Go Build Cache Error: GOCACHE...
<https://ithy.com/article/fixing-go-build-cache-error-definition-296xu8nh>

echo $env:GOCACHE echo $env:XDG_CACHE_HOME echo $env:HOME. 4. Ensuring Proper Permissions. Verify that the user has read and write permissions to the cache directories.Windows: %LocalAppData%\go-build. Ensure these directories exist and are writable.

## 9. How to Find the AppData Folder in Windows 11 and 10 | Beebom
<https://beebom.com/how-find-appdata-folder-windows-11-10/>

Press “Windows + R” to open the Run prompt. Here, type %localappdata% and hit Enter. This will open the Local folder inside the AppData folder. This is where large amounts of data are stored. open localappdata in windows 11.

## 10. Configuration | 1.8 | Documentation | Poetry - Python dependency...
<https://python-poetry.org/docs/1.8/configuration/>

Windows: %LOCALAPPDATA%\pypoetry.Environment Variable: POETRY_CACHE_DIR. The path to the cache directory used by Poetry. Defaults to one of the following directories

## 11. Каталог изменений PowerShell: навигация по файловой системе
<https://ru.a-d.site/?p=3585>

Символ + переносит вас вперед по истории местоположений, а символ - — назад. # Sets the system root directory as the current directory Set-Location -Path $env:SystemRoot #. Navigates back to the previous directory in history (certificate provider) Set-Location -Path

## 12. Advanced Installation Instructions | Electron
<https://www.electronjs.org/docs/latest/tutorial/installation>

By default, ELECTRON_CUSTOM_DIR is set to v$VERSION. To change the format, use the {{ version }} placeholder.Alternatively, you can override the local cache. @electron/get will cache downloaded binaries in a local directory to not stress your network.

## 13. dirs-lite — Rust filesystem library // Lib.rs
<https://lib.rs/crates/dirs-lite>

dirs-lite. Get platform-specific config, data, and cache directories. Supports XDG-style on macOS.dirs-lite. crates.io docs.rs License. A minimal, dependency-free crate for getting the user's config, data, and cache directories. Usage. use dirs_lite::{config_dir, data_dir, cache_dir}

## 14. Installation · Hugging Face
<https://huggingface.co/docs/transformers/installation>

XDG_CACHE_HOME + /huggingface (only if HF_HOME is not set). Offline mode. To use Transformers in an offline or firewalled environment requires the downloaded and cached files ahead of time. Download a model repository from the Hub with the snapshot_download method.
