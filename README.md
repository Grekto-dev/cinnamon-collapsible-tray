# Cinnamon Collapsible Tray (`cinnamon-collapsible-tray@cinnamon`)

A modern system tray applet for the **Cinnamon Desktop Environment** (Linux Mint and other distributions) that faithfully recreates the **Windows 11 collapsible overflow tray menu**, bringing native chevron expand/collapse functionality and taskbar pin management to modern **StatusNotifierItem / XApp Status** background applications.

---

## ✨ Features

- **Windows 11 Tray Overflow Geometry & Design**:
  - Floating dark translucent acrylic popup window with rounded corners, subtle borders, and smooth elevation shadows.
  - Sits directly above the chevron toggle button with precision alignment.
  - Matches the exact visual look and feel of Windows 11 Fluent Design while integrating naturally with your Cinnamon theme.

- **Dynamic Chevron Toggle Button**:
  - Displays a clean upward chevron (`^`) when closed and automatically flips to downward (`v`) when opened.
  - **Smart Auto-hide** (Windows 11 behavior): The chevron button automatically hides when all icons are pinned to the taskbar, and smoothly reappears whenever background apps are hidden in the overflow menu.
  - Fully supports all four panel positions (Bottom, Top, Left, Right) with directional chevron arrows.

- **StatusNotifierItem & XApp Status Native Support**:
  - Full compatibility with modern Linux apps using AppIndicator, Ayatana, and StatusNotifierItem protocols (e.g. **Discord**, **Steam**, **Telegram**, **Spotify**, **qBittorrent**, **KeePass**, **Nvidia**, etc.).
  - Replaces the static `xapp-status@cinnamon.org` applet without losing any functionality or app integration.

- **Taskbar Pinning & Unpinning**:
  - **Middle-Click / Shift + Click**: Middle-click or Shift+Click any icon (in the popup or on the taskbar) to instantly toggle its pinned state!
  - **Drag and Drop (DND)**: Drag icons from the popup menu down to the taskbar to pin them, or drag taskbar icons over to the chevron or popup to hide them!
  - **Context Menu Submenu**: Right-click the chevron button to open a live list of all running background apps with toggle switches.
  - **Batch Actions**: One-click "Fixar todos na barra" (Pin all) and "Ocultar todos no menu" (Hide all) actions.

- **Customization Settings**:
  - Adjustable grid column count (default: 5 columns, matching Windows 11).
  - Default behavior for new apps (hide in menu vs show on taskbar).
  - Optional toggle to always keep the chevron button visible even when empty.
  - Option to auto-close the popup menu on left-clicking an app.

---

## 🚀 Installation

### Option 1: Git Clone

Run the following command in your terminal:

```bash
git clone https://github.com/Grekto-dev/cinnamon-collapsible-tray.git ~/.local/share/cinnamon/applets/cinnamon-collapsible-tray@cinnamon
```

### Option 2: Enabling the Applet

1. Right-click on your Cinnamon panel and choose **Miniaplicativos** (*Applets*).
2. Look for **Cinnamon Collapsible Tray** under the "Manage" tab.
3. Click the `+` button to add it to your panel.
4. (Recommended) Remove the old `xapp-status@cinnamon.org` applet from your panel to avoid showing duplicate icons.

---

## 🖱️ Quick Shortcuts

| Action | Result |
| :--- | :--- |
| **Click Chevron** | Open / close the Windows 11 overflow menu |
| **Middle-Click Icon** | Toggle pin (move between taskbar and overflow menu) |
| **Shift + Left-Click** | Toggle pin (move between taskbar and overflow menu) |
| **Ctrl + Right-Click** | Toggle pin (move between taskbar and overflow menu) |
| **Drag & Drop** | Drag between popup and taskbar to reassign |
| **Right-Click Chevron** | Access applet settings and quick switches for all running apps |

---

## 📄 License

GPLv3 License.
