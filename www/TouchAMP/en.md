![TouchAMP Preview](../../PREVIEW.png)

# 🚀 TouchAMP — Premium Local Development Environment

TouchAMP is a high-performance, portable, and visually stunning local development environment (WAMP alternative) built with Node.js and Electron. It allows developers to manage Apache, PHP, and MySQL with ease, offering a "one-click" experience for local web development.

---

## ✨ Key Features

- **🚀 Portable & Lightweight**: Run your environment from any folder or USB drive.
- **🛠️ Service Management**: One-click control for Apache, PHP, and MySQL.
- **🌐 Auto Virtual Hosts**: Automatically creates `.test` domains for subfolders in `www/`.
- **🔒 Automatic SSL (HTTPS)**: Generates and handles SSL certificates for your local sites.
- **🔄 Smart Multi-PHP**: Easily switch between PHP versions and manage extensions.
- **📦 Backup System**: Integrated SQL and file backup/restore with high-speed ZIP compression.
- **⚡ Quick Access**: A sidebar for one-click access to localhost, phpMyAdmin, and your custom links, folders, or executables.
- **⏰ Scheduled Tasks**: Built-in cron-like task runner for database backups or custom scripts (Node, PHP, Batch).
- **📂 {APP} Dynamic Path**: Use the `{APP}` variable in settings to make your folder configurations fully portable.
- **🛡️ UAC Elevation**: Automatically requests administrator privileges to manage system `hosts` and services securely.
- **📡 System Tray Integration**: Real-time monitoring and controls directly from the Windows tray.
- **🌍 Internationalization**: Full support for English and Turkish out of the box.
- **💻 Premium UI/UX**: Dark mode, glassmorphism, and smooth animations powered by Lucide and Inter.

---

## 🛠️ Technology Stack

- **Frontend**: Vanilla JavaScript (ES6+), CSS3 (Modern Glassmorphism), Lucide Icons.
- **Backend**: Node.js, Express (API), Child Process (Service Management).
- **Desktop**: Electron (Native Window & Single Instance).
- **Utilities**: `openssl` (SSL generation), `bash` (CLI tools).

---

## 🚀 Getting Started

### 1. Requirements
- **Node.js**: v18.0 or higher is recommended.
- **Windows**: (Optimized for Windows 10/11).

### 2. Installation (for Development)
Clone the repository:
```bash
git clone https://github.com/aytackayin/TouchAMP.git
cd TouchAMP
npm install
```

### 3. Running for Development
You can run the application in development mode using the following command:
```bash
npm start
```
Or use the provided batch script:
- **`start.bat`**: (Run as Administrator) Automatically checks for dependencies, installs them if missing, and starts the server.

---

## 🛠️ Folder Structure & Files

- **`/www`**: Place your local projects here.
- **`/bin`**: Contains binaries for Apache, PHP, and MySQL.
- **`/data`**: MySQL data directories (stored separately per version).
- **`/lang`**: Translation files for i18n support.
- **`start.bat`**: Main entry script to start the server.
- **`close.bat`**: Emergency script to forcefully terminate all backend services (Node, Apache, MySQL). Use this if something gets stuck.

---

## 🌍 Adding New Languages

Adding a new language is simple:
1. Create a `{lang_code}.json` file in the `/lang` directory (e.g., `fr.json`).
2. Add the `_name` field (e.g., `"fr": "Français"`) at the top of the file.
3. Translate the keys from `en.json`.
4. The application will automatically detect and list the new language in the settings menu.

---

## 📦 Building the Application

To create a standalone portable `.exe` build:
1. Ensure all dependencies are settled.
2. Run the custom build script:
```bash
node build-custom.js
```
The output will be generated in the `/dist` directory.

---

## 👨‍💻 Developer
Developed with ❤️ by **[Aytaç KAYIN](https://github.com/aytackayin)**

---

## 📄 License
TouchAMP is released under the MIT License.
