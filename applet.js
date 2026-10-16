const Cinnamon = imports.gi.Cinnamon;
const Lang = imports.lang;
const St = imports.gi.St;
const Gio = imports.gi.Gio;
const Clutter = imports.gi.Clutter;
const Interfaces = imports.misc.interfaces;
const Applet = imports.ui.applet;
const Main = imports.ui.main;
const Mainloop = imports.mainloop;
const SignalManager = imports.misc.signalManager;
const Gtk = imports.gi.Gtk;
const XApp = imports.gi.XApp;
const GLib = imports.gi.GLib;
const Tooltips = imports.ui.tooltips;
const PopupMenu = imports.ui.popupMenu;
const Settings = imports.ui.settings;
const DND = imports.ui.dnd;
const Util = imports.misc.util;
const Gettext = imports.gettext;

const UUID = "win11-tray@cinnamon";
Gettext.bindtextdomain(UUID, GLib.get_home_dir() + "/.local/share/locale");

function _(str) {
    let customTranslation = Gettext.dgettext(UUID, str);
    if (customTranslation != str) return customTranslation;
    return Gettext.gettext(str);
}

function getIconIdentifier(icon_proxy) {
    if (icon_proxy.name && icon_proxy.name.trim().length > 0) {
        return icon_proxy.name.trim().toLowerCase();
    }
    if (icon_proxy.icon_name && icon_proxy.icon_name.trim().length > 0) {
        return icon_proxy.icon_name.trim().toLowerCase();
    }
    return (icon_proxy.get_name() + icon_proxy.get_object_path()).toLowerCase();
}

function getIconDisplayName(icon_proxy) {
    if (icon_proxy.tooltip_text && icon_proxy.tooltip_text.trim().length > 0) {
        let clean = icon_proxy.tooltip_text.replace(/<[^>]*>/g, '').split('\n')[0].trim();
        if (clean.length > 0) return clean;
    }
    if (icon_proxy.name && icon_proxy.name.trim().length > 0) {
        let name = icon_proxy.name.trim();
        name = name.replace(/\.py$/, '').replace(/^org\..*\./, '');
        return name.charAt(0).toUpperCase() + name.slice(1);
    }
    if (icon_proxy.icon_name && icon_proxy.icon_name.trim().length > 0) {
        return icon_proxy.icon_name;
    }
    return _("Aplicativo");
}

class RecorderIcon {
    constructor(applet) {
        this.applet = applet;
        this.actor = new St.BoxLayout({
            style_class: "applet-box",
            reactive: false,
            visible: false,
            x_expand: true,
            y_expand: true
        });

        this.icon_holder = new St.Bin();
        this.iconSize = this.applet.getPanelIconSize(St.IconType.FULLCOLOR);

        this.actor.add_actor(this.icon_holder);

        this._indicator = new St.DrawingArea();
        this._indicator.connect("repaint", (area) => this._paint(area));
        this.icon_holder.add_actor(this._indicator);

        this._recordListenerId = Main.screenRecorder.connect("recording", () => this._recordingStateChanged());
        this._recordingStateChanged();

        this.refresh();
    }

    _recordingStateChanged() {
        this.actor.visible = Main.screenRecorder.recording;
        this._indicator.queue_repaint();
    }

    _paint(area) {
        let [width, height] = area.get_surface_size();
        let size = Math.max(width, height);
        let node = area.get_theme_node();
        let border = node.get_foreground_color();

        let cr = area.get_context();

        let color = new Clutter.Color({ red: 255, green: 0, blue: 0, alpha: 255 });
        Clutter.cairo_set_source_color(cr, color);

        cr.arc(width / 2, height / 2, size / 4.0, 0.0, 2.0 * Math.PI);
        cr.fillPreserve();
        Clutter.cairo_set_source_color(cr, border);
        cr.stroke();
        cr.$dispose();
    }

    refresh() {
        this.setOrientation(this.applet.orientation);
        this.iconSize = this.applet.getPanelIconSize(St.IconType.FULLCOLOR);
        this._indicator.set_size(this.iconSize, this.iconSize);
        this._indicator.queue_repaint();
    }

    setOrientation(orientation) {
        switch (orientation) {
            case St.Side.TOP:
            case St.Side.BOTTOM:
                this.actor.vertical = false;
                this.actor.remove_style_class_name("vertical");
                break;
            case St.Side.LEFT:
            case St.Side.RIGHT:
                this.actor.vertical = true;
                this.actor.add_style_class_name("vertical");
                break;
        }
    }

    destroy() {
        if (this._recordListenerId > 0) {
            Main.screenRecorder.disconnect(this._recordListenerId);
            this._recordListenerId = 0;
        }
        this.actor.destroy();
    }
}

class XAppStatusIcon {
    constructor(applet, proxy) {
        this.name = proxy.get_name();
        this.applet = applet;
        this.proxy = proxy;
        this.isInPopup = false;
        this.iconName = null;
        this.rawTooltipText = "";

        this.actor = new St.Button({
            style_class: "win11-tray-item win11-tray-panel-item",
            reactive: !global.settings.get_boolean('panel-edit-mode'),
            track_hover: true,
            can_focus: true,
            x_align: St.Align.MIDDLE,
            y_align: St.Align.MIDDLE,
            x_fill: false,
            y_fill: false
        });

        this.box = new St.BoxLayout({
            vertical: false,
            x_expand: false,
            y_expand: false,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER
        });
        this.actor.set_child(this.box);

        this.icon_holder = new St.Bin({
            x_align: St.Align.MIDDLE,
            y_align: St.Align.MIDDLE
        });
        this.iconSize = this.applet.getPanelIconSize(St.IconType.FULLCOLOR);
        this.proxy.icon_size = this.iconSize;

        this.label = new St.Label({
            'y-align': St.Align.END
        });

        this.box.add_actor(this.icon_holder);

        this._tooltip = new Tooltips.PanelItemTooltip(this, "", applet.orientation);

        this.actor.connect('button-press-event', Lang.bind(this, this.onButtonPressEvent));
        this.actor.connect('button-release-event', Lang.bind(this, this.onButtonReleaseEvent));
        this.actor.connect('scroll-event', (...args) => this.onScrollEvent(...args));
        this.actor.connect('enter-event', Lang.bind(this, this.onEnterEvent));

        this._proxy_prop_change_id = this.proxy.connect('g-properties-changed', Lang.bind(this, this.on_properties_changed));

        this._setupDnd();
        this.refresh();
    }

    get vertical() {
        return this.box ? this.box.vertical : false;
    }

    _setupDnd() {
        this._isDragging = false;
        this._draggable = DND.makeDraggable(this.actor, {
            manualMode: false,
            restoreOnSuccess: false
        });
        this._draggable._statusIcon = this;

        this.actor._delegate = {
            statusIcon: this,
            _statusIcon: this,
            getDragActor: () => {
                let clone = new Clutter.Clone({ source: this.icon_holder });
                clone.width = this.icon_holder.width;
                clone.height = this.icon_holder.height;
                clone.opacity = 240;
                return clone;
            },
            getDragActorSource: () => {
                return this.icon_holder;
            },
            handleDragOver: (source, actor, x, y, time) => {
                let dragged = source && (source.statusIcon || source._statusIcon);
                if (dragged && dragged !== this) {
                    let [tW, tH] = this.actor.get_size();
                    let isAfter = (x > tW / 2);
                    this.applet.showIndicator(this.actor, isAfter);
                    return DND.DragMotionResult.MOVE_DROP;
                }
                this.applet.hideIndicator();
                return DND.DragMotionResult.NO_DROP;
            },
            handleDragOut: () => {
                this.applet.hideIndicator();
            },
            acceptDrop: (source, actor, x, y, time) => {
                this.applet.hideIndicator();
                let dragged = source && (source.statusIcon || source._statusIcon);
                if (dragged && dragged !== this) {
                    let [tW, tH] = this.actor.get_size();
                    let isAfter = (x > tW / 2);
                    this.applet.handleIconDropOnIcon(dragged, this, isAfter);
                    return true;
                }
                return false;
            }
        };

        this._draggable.connect('drag-begin', () => {
            this._isDragging = true;
            this.actor.opacity = 80;
            this._tooltip.hide();
            this._tooltip.preventShow = true;
            this.applet.setDraggingState(true);
        });
        this._draggable.connect('drag-cancelled', () => {
            this._isDragging = false;
            this.actor.opacity = 255;
            this._tooltip.preventShow = false;
            this.applet.setDraggingState(false);
            this.applet.hideIndicator();
            this.applet.sortIcons();
        });
        this._draggable.connect('drag-end', () => {
            this._isDragging = false;
            this.actor.opacity = 255;
            this._tooltip.preventShow = false;
            this.applet.setDraggingState(false);
            this.applet.hideIndicator();
        });
    }

    setInPopup(isInPopup) {
        if (this.isInPopup === isInPopup) return;
        this.isInPopup = isInPopup;

        if (this.isInPopup) {
            this.actor.remove_style_class_name("win11-tray-panel-item");
            this.actor.add_style_class_name("win11-tray-popup-item");
            if (this.box.contains(this.label)) {
                this.box.remove_actor(this.label);
            }
            this.label.visible = false;
        } else {
            this.actor.remove_style_class_name("win11-tray-popup-item");
            this.actor.add_style_class_name("win11-tray-panel-item");
            if (this.show_label && !this.box.contains(this.label)) {
                this.box.add_actor(this.label);
            }
            this.label.visible = this.show_label;
        }

        this.refresh();
    }

    on_properties_changed(proxy, changed_props, invalidated_props) {
        let prop_names = changed_props.deep_unpack();

        if ('IconName' in prop_names) {
            this.setIconName(proxy.icon_name);
        }
        if ('TooltipText' in prop_names) {
            this.setTooltipText(proxy.tooltip_text);
        }
        if ('Label' in prop_names) {
            this.setLabel(proxy.label);
        }
        if ('Visible' in prop_names) {
            this.setVisible(proxy.visible);
        }
        if ('Name' in prop_names) {
            this.applet.sortIcons();
        }
    }

    refresh() {
        this.setIconName(this.proxy.icon_name);
        this.setLabel(this.proxy.label);
        this.setTooltipText(this.proxy.tooltip_text);
        this.setVisible(this.proxy.visible);
        this.setOrientation(this.applet.orientation);

        this.actor.queue_relayout();
    }

    setOrientation(orientation) {
        if (this.isInPopup) {
            this.box.vertical = false;
            this.actor.remove_style_class_name("vertical");
            return;
        }

        switch (orientation) {
            case St.Side.TOP:
            case St.Side.BOTTOM:
                this.box.vertical = false;
                this.actor.remove_style_class_name("vertical");
                break;
            case St.Side.LEFT:
            case St.Side.RIGHT:
                this.box.vertical = true;
                this.actor.add_style_class_name("vertical");
                break;
        }
    }

    setIconName(iconName) {
        if (iconName) {
            let type;
            if (iconName.match(/symbolic/)) {
                type = St.IconType.SYMBOLIC;
            } else {
                type = St.IconType.FULLCOLOR;
            }

            this.iconName = iconName;
            this.iconSize = this.applet.getPanelIconSize(type);
            this.proxy.icon_size = this.iconSize;

            if (iconName.includes("/") && type != St.IconType.SYMBOLIC) {
                this.icon_loader_handle = St.TextureCache.get_default().load_image_from_file_async(
                    iconName,
                    this.vertical ? this.iconSize : -1,
                    this.iconSize,
                    (...args) => this._onImageLoaded(...args)
                );
                return;
            } else {
                let icon = new St.Icon({ "icon-type": type, "icon-size": this.iconSize, "icon-name": iconName });
                this.icon_holder.show();
                this.icon_holder.child = icon;
            }
        } else {
            this.iconName = null;
            this.icon_holder.hide();
        }
    }

    _onImageLoaded(cache, handle, actor, data=null) {
        if (handle !== this.icon_loader_handle) return;
        this.icon_holder.child = actor;
        this.icon_holder.show();
    }

    setTooltipText(tooltipText) {
        this.rawTooltipText = tooltipText || "";
        let isPinned = this.applet.isIconPinned(this);
        let pinHint = isPinned 
            ? _("\n(Clique do meio para recolher no menu)") 
            : _("\n(Clique do meio para fixar na barra)");

        let baseName = this.rawTooltipText.length > 0 
            ? this.rawTooltipText 
            : getIconDisplayName(this.proxy);

        let escapedName = GLib.markup_escape_text(baseName, -1);
        let escapedHint = GLib.markup_escape_text(pinHint, -1);

        this._tooltip.preventShow = false;
        this._tooltip.set_markup(escapedName + escapedHint);

        if (this._tooltip.visible) {
            this._tooltip.hide();
            this._tooltip.show();
        }
    }

    setLabel(label) {
        if (label) {
            this.label.set_text(label);
        } else {
            this.label.set_text("");
        }

        this.show_label = !this.isInPopup &&
                          (this.applet.orientation == St.Side.TOP || this.applet.orientation == St.Side.BOTTOM) &&
                          this.proxy.label && this.proxy.label.trim().length > 0;

        if (this.show_label) {
            if (!this.box.contains(this.label)) {
                this.box.add_actor(this.label);
            }
            this.label.show();
        } else {
            if (this.box.contains(this.label)) {
                this.box.remove_actor(this.label);
            }
            this.label.hide();
        }
    }

    setVisible(visible) {
        if (visible) {
            this.actor.show();
        } else {
            this.actor.hide();
        }
    }

    onEnterEvent(actor, event) {
        this._tooltip.preventShow = false;
    }

    getEventPositionInfo(actor) {
        let allocation = Cinnamon.util_get_transformed_allocation(actor);

        let x = Math.round(allocation.x1 / global.ui_scale);
        let y = Math.round(allocation.y1 / global.ui_scale);
        let w = Math.round((allocation.x2 - allocation.x1) / global.ui_scale);
        let h = Math.round((allocation.y2 - allocation.y1) / global.ui_scale);

        let final_x, final_y, final_o;

        switch (this.applet.orientation) {
            case St.Side.TOP:
                final_x = x;
                final_y = y + h;
                final_o = Gtk.PositionType.TOP;
                break;
            case St.Side.BOTTOM:
            default:
                final_x = x;
                final_y = y;
                final_o = Gtk.PositionType.BOTTOM;
                break;
            case St.Side.LEFT:
                final_x = x + w;
                final_y = y;
                final_o = Gtk.PositionType.LEFT;
                break;
            case St.Side.RIGHT:
                final_x = x;
                final_y = y;
                final_o = Gtk.PositionType.RIGHT;
                break;
        }

        return [final_x, final_y, final_o];
    }

    onButtonPressEvent(actor, event) {
        this._tooltip.hide();
        this._tooltip.preventShow = true;

        let button = event.get_button();
        let state = event.get_state();

        // Shortcut for Pin/Unpin toggle:
        // 1. Middle click
        // 2. Shift + Left click
        // 3. Ctrl + Right click
        if (button === Clutter.BUTTON_MIDDLE ||
            (button === Clutter.BUTTON_PRIMARY && (state & Clutter.ModifierType.SHIFT_MASK)) ||
            (button === Clutter.BUTTON_SECONDARY && (state & Clutter.ModifierType.CONTROL_MASK))) {
            this.applet.togglePinIcon(this);
            return Clutter.EVENT_STOP;
        }

        if (button === Clutter.BUTTON_SECONDARY) {
            let [x, y, o] = this.getEventPositionInfo(actor);
            if (this.isInPopup) {
                this.applet.menu.close();
                this.proxy.call_button_press(x, y, button, event.get_time(), o, null, null);
                this.proxy.call_button_release(x, y, button, event.get_time(), o, null, null);
                return Clutter.EVENT_STOP;
            }
            this.proxy.call_button_press(x, y, button, event.get_time(), o, null, null);
            return Clutter.EVENT_STOP;
        }

        // Left click (button 1): save coordinates and propagate so DND can detect drag threshold
        let [x, y, o] = this.getEventPositionInfo(actor);
        this._pressInfo = { x: x, y: y, o: o, time: event.get_time() };
        return Clutter.EVENT_PROPAGATE;
    }

    onButtonReleaseEvent(actor, event) {
        let button = event.get_button();

        // If drag was in progress, DND already handled the action
        if (this._isDragging || DND.isDragging()) {
            this._pressInfo = null;
            return Clutter.EVENT_STOP;
        }

        if (button === Clutter.BUTTON_SECONDARY && this.isInPopup) {
            return Clutter.EVENT_STOP;
        }

        if (button === Clutter.BUTTON_PRIMARY && this._pressInfo) {
            let [x, y, o] = this.getEventPositionInfo(actor);
            this.proxy.call_button_press(this._pressInfo.x, this._pressInfo.y, 1, this._pressInfo.time, this._pressInfo.o, null, null);
            this.proxy.call_button_release(x, y, 1, event.get_time(), o, null, null);
            this._pressInfo = null;

            if (this.isInPopup && this.applet.closeOnClick) {
                Mainloop.timeout_add(150, () => {
                    this.applet.menu.close();
                    return GLib.SOURCE_REMOVE;
                });
            }
            return Clutter.EVENT_STOP;
        }

        let [x, y, o] = this.getEventPositionInfo(actor);
        this.proxy.call_button_release(x, y, button, event.get_time(), o, null, null);

        return Clutter.EVENT_STOP;
    }

    onScrollEvent(actor, event) {
        let direction = event.get_scroll_direction();

        if (direction != Clutter.ScrollDirection.SMOOTH) {
            let x_dir = XApp.ScrollDirection.UP;
            let delta = 0;

            if (direction == Clutter.ScrollDirection.UP) {
                x_dir = XApp.ScrollDirection.UP;
                delta = -1;
            } else if (direction == Clutter.ScrollDirection.DOWN) {
                x_dir = XApp.ScrollDirection.DOWN;
                delta = 1;
            } else if (direction == Clutter.ScrollDirection.LEFT) {
                x_dir = XApp.ScrollDirection.LEFT;
                delta = -1;
            } else if (direction == Clutter.ScrollDirection.RIGHT) {
                x_dir = XApp.ScrollDirection.RIGHT;
                delta = 1;
            }

            this.proxy.call_scroll(delta, x_dir, event.get_time(), null, null);
        }

        return Clutter.EVENT_STOP;
    }

    destroy() {
        if (this._proxy_prop_change_id > 0) {
            this.proxy.disconnect(this._proxy_prop_change_id);
            this._proxy_prop_change_id = 0;
        }
        this._tooltip.destroy();
        this.actor.destroy();
    }
}

class Win11TrayMenu extends Applet.AppletPopupMenu {
    constructor(applet, orientation) {
        super(applet, orientation);
        this.applet = applet;
        this.sourceActor = applet.chevronButton;
        this.setCustomStyleClass('win11-tray-popup');

        this.mainBox = new St.BoxLayout({
            vertical: true,
            style_class: 'win11-tray-popup-content'
        });
        this.box.add_actor(this.mainBox);

        this.gridBox = new St.BoxLayout({
            vertical: true,
            style_class: 'win11-tray-grid'
        });
        this.mainBox.add_actor(this.gridBox);

        // Drop target for Drag and Drop from taskbar panel to popup
        let dropDelegate = {
            handleDragOver: (source, actor, x, y, time) => {
                let dragged = source && (source.statusIcon || source._statusIcon);
                if (dragged) return DND.DragMotionResult.MOVE_DROP;
                return DND.DragMotionResult.NO_DROP;
            },
            handleDragOut: () => {
                this.applet.hideIndicator();
            },
            acceptDrop: (source, actor, x, y, time) => {
                this.applet.hideIndicator();
                let dragged = source && (source.statusIcon || source._statusIcon);
                if (dragged) {
                    this.applet.unpinIcon(dragged);
                    return true;
                }
                return false;
            }
        };

        this.box._delegate = dropDelegate;
        this.mainBox._delegate = dropDelegate;
        this.gridBox._delegate = dropDelegate;
    }

    _calculatePosition() {
        let [xPos, yPos] = super._calculatePosition();
        const GAP = 12 * global.ui_scale;
        switch (this._orientation) {
            case St.Side.BOTTOM:
                yPos -= GAP;
                break;
            case St.Side.TOP:
                yPos += GAP;
                break;
            case St.Side.LEFT:
                xPos += GAP;
                break;
            case St.Side.RIGHT:
                xPos -= GAP;
                break;
        }
        return [xPos, yPos];
    }
}

class Win11TrayApplet extends Applet.Applet {
    constructor(orientation, panel_height, instance_id) {
        super(orientation, panel_height, instance_id);

        this.orientation = orientation;
        this.setAllowedLayout(Applet.AllowedLayout.BOTH);

        this.actor.remove_style_class_name('applet-box');
        this.actor.set_important(true);

        // Add icons path
        Gtk.IconTheme.get_default().append_search_path(GLib.get_home_dir() + "/.local/share/cinnamon/applets/" + UUID + "/icons");

        // Settings
        this.settings = new Settings.AppletSettings(this, UUID, instance_id);
        this.settings.bindProperty(Settings.BindingDirection.IN, "columns", "columns", () => this.sortIcons());
        this.settings.bindProperty(Settings.BindingDirection.IN, "default-pinned", "defaultPinned");
        this.settings.bindProperty(Settings.BindingDirection.IN, "always-show-chevron", "alwaysShowChevron", () => this._updateChevronVisibility());
        this.settings.bindProperty(Settings.BindingDirection.IN, "close-on-click", "closeOnClick");
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "pinned-icons", "pinnedIconsList", () => this.sortIcons());
        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "unpinned-order", "unpinnedOrderList", () => this.sortIcons());

        if (!this.pinnedIconsList || !Array.isArray(this.pinnedIconsList)) {
            this.pinnedIconsList = [];
        }
        if (!this.unpinnedOrderList || !Array.isArray(this.unpinnedOrderList)) {
            this.unpinnedOrderList = [];
        }

        let isVertical = (this.orientation == St.Side.LEFT || this.orientation == St.Side.RIGHT);

        // Main Layout Container
        this.mainContainer = new St.BoxLayout({
            style_class: 'win11-tray-main-container',
            vertical: isVertical
        });
        this.actor.add_actor(this.mainContainer);

        // Chevron Button (Toggles Windows 11 style popup)
        this.chevronButton = new St.Button({
            style_class: 'applet-box win11-tray-chevron',
            reactive: true,
            can_focus: true,
            track_hover: true
        });
        this.chevronIcon = new St.Icon({
            style_class: 'win11-tray-chevron-icon',
            icon_size: 14,
            icon_type: St.IconType.SYMBOLIC
        });
        this.chevronButton.set_child(this.chevronIcon);
        this._chevronTooltip = new Tooltips.Tooltip(this.chevronButton, _("Mostrar ícones ocultos"));

        // Drag & Drop onto Chevron button sends icon to popup (with hover-to-open)
        let chevronHoverTimer = 0;
        this.chevronButton._delegate = {
            handleDragOver: (source, actor, x, y, time) => {
                let dragged = source && (source.statusIcon || source._statusIcon);
                if (dragged) {
                    this.hideIndicator();
                    if (!this.menu.isOpen && chevronHoverTimer === 0) {
                        chevronHoverTimer = Mainloop.timeout_add(300, () => {
                            chevronHoverTimer = 0;
                            if (DND.isDragging() && !this.menu.isOpen) {
                                this.menu.open(true);
                            }
                            return GLib.SOURCE_REMOVE;
                        });
                    }
                    return DND.DragMotionResult.MOVE_DROP;
                }
                return DND.DragMotionResult.NO_DROP;
            },
            handleDragOut: () => {
                if (chevronHoverTimer > 0) {
                    Mainloop.source_remove(chevronHoverTimer);
                    chevronHoverTimer = 0;
                }
                this.hideIndicator();
            },
            acceptDrop: (source, actor, x, y, time) => {
                if (chevronHoverTimer > 0) {
                    Mainloop.source_remove(chevronHoverTimer);
                    chevronHoverTimer = 0;
                }
                this.hideIndicator();
                let dragged = source && (source.statusIcon || source._statusIcon);
                if (dragged) {
                    this.unpinIcon(dragged);
                    return true;
                }
                return false;
            }
        };

        // Pinned Icons Container (shown on the taskbar panel)
        this.pinnedIconsBox = new St.BoxLayout({
            style_class: 'win11-tray-panel-box',
            vertical: isVertical
        });

        // Drag & Drop onto Pinned Icons Box or Main Container pins icon to panel
        let panelDropDelegate = {
            handleDragOver: (source, actor, x, y, time) => {
                let dragged = source && (source.statusIcon || source._statusIcon);
                if (dragged) {
                    let children = this.pinnedIconsBox.get_children();
                    if (children.length > 0) {
                        let lastChild = children[children.length - 1];
                        this.showIndicator(lastChild, true);
                    }
                    return DND.DragMotionResult.MOVE_DROP;
                }
                return DND.DragMotionResult.NO_DROP;
            },
            handleDragOut: () => {
                this.hideIndicator();
            },
            acceptDrop: (source, actor, x, y, time) => {
                this.hideIndicator();
                let dragged = source && (source.statusIcon || source._statusIcon);
                if (dragged) {
                    this.pinIcon(dragged);
                    return true;
                }
                return false;
            }
        };

        this.pinnedIconsBox._delegate = panelDropDelegate;
        this.mainContainer._delegate = panelDropDelegate;

        // Recorder Icon
        this._recording_indicator = new RecorderIcon(this);

        // Assemble panel actors
        this.mainContainer.add_actor(this.chevronButton);
        this.mainContainer.add_actor(this.pinnedIconsBox);
        this.mainContainer.add_actor(this._recording_indicator.actor);

        // Popup Menu Setup
        this.menuManager = new PopupMenu.PopupMenuManager(this);
        this.menu = new Win11TrayMenu(this, this.orientation);
        this.menuManager.addMenu(this.menu);

        this.chevronButton.connect('button-press-event', (actor, event) => {
            if (event.get_button() === Clutter.BUTTON_PRIMARY) {
                this.menu.toggle();
                return Clutter.EVENT_STOP;
            } else if (event.get_button() === Clutter.BUTTON_SECONDARY) {
                this._applet_context_menu.toggle();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        this.chevronButton.connect('clicked', () => {
            if (!this.menu.isOpen) {
                this.menu.toggle();
            }
        });

        this.menu.connect('open-state-changed', (menu, isOpen) => {
            this._onMenuStateChanged(isOpen);
        });

        this._updateChevronIcon(false);

        // State Tracking
        this.statusIcons = {};
        this.ignoredProxies = {};

        // Signals & Monitors
        this.signalManager = new SignalManager.SignalManager(null);
        this._scaleUpdateId = 0;

        this.monitor = new XApp.StatusIconMonitor();
        this.signalManager.connect(this.monitor, "icon-added", this.onMonitorIconAdded, this);
        this.signalManager.connect(this.monitor, "icon-removed", this.onMonitorIconRemoved, this);

        this.signalManager.connect(Gtk.IconTheme.get_default(), 'changed', this.on_icon_theme_changed, this);
        this.signalManager.connect(global.settings, 'changed::panel-edit-mode', this.on_panel_edit_mode_changed, this);
        this.signalManager.connect(Main.systrayManager, "changed", this.onSystrayRolesChanged, this);
        this.signalManager.connect(this.panel, "icon-size-changed", this.icon_size_changed, this);
        this.signalManager.connect(global, "scale-changed", this.ui_scale_changed, this);

        this._setupContextMenu();
    }

    _setupContextMenu() {
        this.pinnedSubMenu = new PopupMenu.PopupSubMenuMenuItem(_("Ícones na barra de tarefas"));
        this._applet_context_menu.addMenuItem(this.pinnedSubMenu);

        let pinAllItem = new PopupMenu.PopupMenuItem(_("Fixar todos na barra"));
        pinAllItem.connect('activate', () => this.pinAllIcons());
        this._applet_context_menu.addMenuItem(pinAllItem);

        let unpinAllItem = new PopupMenu.PopupMenuItem(_("Ocultar todos no menu"));
        unpinAllItem.connect('activate', () => this.unpinAllIcons());
        this._applet_context_menu.addMenuItem(unpinAllItem);

        this._applet_context_menu.connect('open-state-changed', (menu, isOpen) => {
            if (isOpen) {
                this._updateContextMenuSubItems();
            }
        });
    }

    _updateContextMenuSubItems() {
        this.pinnedSubMenu.menu.removeAll();
        let keys = Object.keys(this.statusIcons);
        if (keys.length === 0) {
            let item = new PopupMenu.PopupMenuItem(_("Nenhum aplicativo ativo"), { reactive: false });
            this.pinnedSubMenu.menu.addMenuItem(item);
            return;
        }

        for (let key of keys) {
            let icon = this.statusIcons[key];
            let name = getIconDisplayName(icon.proxy);
            let isPinned = this.isIconPinned(icon);

            let switchItem = new PopupMenu.PopupSwitchMenuItem(name, isPinned);
            switchItem.connect('toggled', (item) => {
                if (item.state) {
                    this.pinIcon(icon);
                } else {
                    this.unpinIcon(icon);
                }
            });
            this.pinnedSubMenu.menu.addMenuItem(switchItem);
        }
    }

    _onMenuStateChanged(isOpen) {
        this._updateChevronIcon(isOpen);
        if (isOpen) {
            this.chevronButton.add_style_pseudo_class('active');
            this.chevronButton.add_style_class_name('active');
            this._chevronTooltip.set_text(_("Ocultar ícones"));
            this._relayoutPopupGrid();
        } else {
            this.chevronButton.remove_style_pseudo_class('active');
            this.chevronButton.remove_style_class_name('active');
            this._chevronTooltip.set_text(_("Mostrar ícones ocultos"));
        }
    }

    _updateChevronIcon(isOpen) {
        let iconName = 'pan-up-symbolic';
        switch (this.orientation) {
            case St.Side.TOP:
                iconName = isOpen ? 'pan-up-symbolic' : 'pan-down-symbolic';
                break;
            case St.Side.LEFT:
                iconName = isOpen ? 'pan-start-symbolic' : 'pan-end-symbolic';
                break;
            case St.Side.RIGHT:
                iconName = isOpen ? 'pan-end-symbolic' : 'pan-start-symbolic';
                break;
            case St.Side.BOTTOM:
            default:
                iconName = isOpen ? 'pan-down-symbolic' : 'pan-up-symbolic';
                break;
        }
        this.chevronIcon.set_icon_name(iconName);
    }

    isIconPinned(icon) {
        let id = getIconIdentifier(icon.proxy);
        return this.pinnedIconsList.includes(id);
    }

    pinIcon(icon) {
        let id = getIconIdentifier(icon.proxy);
        if (!this.pinnedIconsList.includes(id)) {
            this.pinnedIconsList = [...this.pinnedIconsList, id];
            this.settings.setValue("pinned-icons", this.pinnedIconsList);
        }
        if (this.unpinnedOrderList.includes(id)) {
            this.unpinnedOrderList = this.unpinnedOrderList.filter(item => item !== id);
            this.settings.setValue("unpinned-order", this.unpinnedOrderList);
        }
        icon.setTooltipText(icon.rawTooltipText);
        this.sortIcons();
    }

    unpinIcon(icon) {
        let id = getIconIdentifier(icon.proxy);
        if (this.pinnedIconsList.includes(id)) {
            this.pinnedIconsList = this.pinnedIconsList.filter(item => item !== id);
            this.settings.setValue("pinned-icons", this.pinnedIconsList);
        }
        if (!this.unpinnedOrderList.includes(id)) {
            this.unpinnedOrderList = [...this.unpinnedOrderList, id];
            this.settings.setValue("unpinned-order", this.unpinnedOrderList);
        }
        icon.setTooltipText(icon.rawTooltipText);
        this.sortIcons();
    }

    showIndicator(targetActor, isAfter = false) {
        if (!targetActor || targetActor.is_finalized() || !targetActor.get_stage()) {
            this.hideIndicator();
            return;
        }

        if (!this.indicatorBar) {
            this.indicatorBar = new St.Bin({
                style_class: 'win11-tray-drop-indicator',
                reactive: false
            });
            Main.uiGroup.add_actor(this.indicatorBar);
        }

        let [tX, tY] = targetActor.get_transformed_position();
        let [tW, tH] = targetActor.get_transformed_size();

        let isVerticalPanel = (targetActor.get_parent() === this.pinnedIconsBox) &&
                              (this.orientation === St.Side.LEFT || this.orientation === St.Side.RIGHT);

        if (isVerticalPanel) {
            let barW = Math.min(18 * global.ui_scale, tW - 4);
            let barH = Math.max(2, Math.round(2 * global.ui_scale));
            let gap = 2 * global.ui_scale;
            let barX = Math.round(tX + (tW - barW) / 2);
            let barY = isAfter
                ? Math.round(tY + tH + (gap / 2) - (barH / 2))
                : Math.round(tY - (gap / 2) - (barH / 2));
            this.indicatorBar.set_size(barW, barH);
            this.indicatorBar.set_position(barX, barY);
        } else {
            let barW = Math.max(2, Math.round(2 * global.ui_scale));
            let barH = Math.min(18 * global.ui_scale, tH - 4);
            if (barH < 14 * global.ui_scale) {
                barH = 16 * global.ui_scale;
            }
            let gap = 2 * global.ui_scale;
            let barX = isAfter 
                ? Math.round(tX + tW + (gap / 2) - (barW / 2)) 
                : Math.round(tX - (gap / 2) - (barW / 2));
            let barY = Math.round(tY + (tH - barH) / 2);
            this.indicatorBar.set_size(barW, barH);
            this.indicatorBar.set_position(barX, barY);
        }

        this.indicatorBar.show();
        this.indicatorBar.raise_top();
    }

    hideIndicator() {
        if (this.indicatorBar) {
            this.indicatorBar.hide();
        }
    }

    setDraggingState(isDragging) {
        this._isDragging = isDragging;
        if (isDragging) {
            this.actor.add_style_class_name('win11-tray-dragging');
            this.mainContainer.add_style_class_name('win11-tray-dragging');
            if (this.menu && this.menu.actor) {
                this.menu.actor.add_style_class_name('win11-tray-dragging');
            }
            if (this.menu && this.menu.mainBox) {
                this.menu.mainBox.add_style_class_name('win11-tray-dragging');
            }
            if (this.menu && this.menu.gridBox) {
                this.menu.gridBox.add_style_class_name('win11-tray-dragging');
            }
            for (let key in this.statusIcons) {
                let icon = this.statusIcons[key];
                icon.actor.track_hover = false;
                icon.actor.hover = false;
                icon.actor.add_style_class_name('win11-tray-dragging');
            }
        } else {
            this.actor.remove_style_class_name('win11-tray-dragging');
            this.mainContainer.remove_style_class_name('win11-tray-dragging');
            if (this.menu && this.menu.actor) {
                this.menu.actor.remove_style_class_name('win11-tray-dragging');
            }
            if (this.menu && this.menu.mainBox) {
                this.menu.mainBox.remove_style_class_name('win11-tray-dragging');
            }
            if (this.menu && this.menu.gridBox) {
                this.menu.gridBox.remove_style_class_name('win11-tray-dragging');
            }
            let panelEditMode = global.settings.get_boolean('panel-edit-mode');
            for (let key in this.statusIcons) {
                let icon = this.statusIcons[key];
                icon.actor.remove_style_class_name('win11-tray-dragging');
                icon.actor.track_hover = !panelEditMode;
                icon.actor.sync_hover();
            }
        }
    }

    handleIconDropOnIcon(draggedIcon, targetIcon, isAfter = false) {
        if (!draggedIcon || !targetIcon || draggedIcon === targetIcon) return;

        let draggedId = getIconIdentifier(draggedIcon.proxy);
        let targetId = getIconIdentifier(targetIcon.proxy);

        let targetIsPinned = this.isIconPinned(targetIcon);
        let draggedIsPinned = this.isIconPinned(draggedIcon);

        if (targetIsPinned) {
            // Target is on the taskbar panel
            let pinnedList = this.pinnedIconsList.filter(id => id !== draggedId);
            let targetIdx = pinnedList.indexOf(targetId);
            if (targetIdx !== -1) {
                let insertIdx = isAfter ? targetIdx + 1 : targetIdx;
                pinnedList.splice(insertIdx, 0, draggedId);
            } else {
                pinnedList.push(draggedId);
            }
            this.pinnedIconsList = pinnedList;
            this.settings.setValue("pinned-icons", this.pinnedIconsList);

            if (this.unpinnedOrderList.includes(draggedId)) {
                this.unpinnedOrderList = this.unpinnedOrderList.filter(id => id !== draggedId);
                this.settings.setValue("unpinned-order", this.unpinnedOrderList);
            }
        } else {
            // Target is in the popup menu
            if (draggedIsPinned) {
                this.pinnedIconsList = this.pinnedIconsList.filter(id => id !== draggedId);
                this.settings.setValue("pinned-icons", this.pinnedIconsList);
            }

            let unpinnedList = this.unpinnedOrderList.filter(id => id !== draggedId);
            let targetIdx = unpinnedList.indexOf(targetId);
            if (targetIdx !== -1) {
                let insertIdx = isAfter ? targetIdx + 1 : targetIdx;
                unpinnedList.splice(insertIdx, 0, draggedId);
            } else {
                unpinnedList.push(draggedId);
            }
            this.unpinnedOrderList = unpinnedList;
            this.settings.setValue("unpinned-order", this.unpinnedOrderList);
        }

        draggedIcon.setTooltipText(draggedIcon.rawTooltipText);
        this.sortIcons();
    }

    togglePinIcon(icon) {
        if (this.isIconPinned(icon)) {
            this.unpinIcon(icon);
        } else {
            this.pinIcon(icon);
        }
    }

    pinAllIcons() {
        let list = [];
        for (let key in this.statusIcons) {
            list.push(getIconIdentifier(this.statusIcons[key].proxy));
        }
        this.settings.setValue("pinned-icons", list);
        this.sortIcons();
    }

    unpinAllIcons() {
        this.settings.setValue("pinned-icons", []);
        this.sortIcons();
    }

    getKey(icon_proxy) {
        let proxy_name = icon_proxy.get_name();
        let proxy_path = icon_proxy.get_object_path();
        return proxy_name + proxy_path;
    }

    onMonitorIconAdded(monitor, icon_proxy) {
        let key = this.getKey(icon_proxy);

        if (this.statusIcons[key]) return;

        if (this.shouldIgnoreStatusIcon(icon_proxy)) {
            global.log(`win11-tray: Hiding XAppStatusIcon (applet exists): ${icon_proxy.name}`);
            this.ignoreStatusIcon(icon_proxy);
            return;
        }

        global.log(`win11-tray: Adding XAppStatusIcon: ${icon_proxy.name} (${key})`);
        let statusIcon = new XAppStatusIcon(this, icon_proxy);
        this.statusIcons[key] = statusIcon;

        // Auto-pin if defaultPinned is enabled
        let id = getIconIdentifier(icon_proxy);
        if (this.defaultPinned && !this.pinnedIconsList.includes(id)) {
            let list = [...this.pinnedIconsList, id];
            this.settings.setValue("pinned-icons", list);
        }

        this.sortIcons();
    }

    onMonitorIconRemoved(monitor, icon_proxy) {
        let key = this.getKey(icon_proxy);

        if (!this.statusIcons[key]) {
            if (this.ignoredProxies[key]) {
                delete this.ignoredProxies[key];
            }
            return;
        }

        global.log(`win11-tray: Removing XAppStatusIcon: ${icon_proxy.name} (${key})`);
        let statusIcon = this.statusIcons[key];
        if (statusIcon.actor.get_parent()) {
            statusIcon.actor.get_parent().remove_actor(statusIcon.actor);
        }
        statusIcon.destroy();
        delete this.statusIcons[key];

        this.sortIcons();
    }

    onSystrayRolesChanged() {
        let hiddenIcons = Main.systrayManager.getRoles();

        for (let i in this.statusIcons) {
            let icon_proxy = this.statusIcons[i].proxy;

            if (this.shouldIgnoreStatusIcon(icon_proxy)) {
                let statusIcon = this.statusIcons[i];
                if (statusIcon.actor.get_parent()) {
                    statusIcon.actor.get_parent().remove_actor(statusIcon.actor);
                }
                statusIcon.destroy();
                delete this.statusIcons[i];
                this.ignoreStatusIcon(icon_proxy);
            }
        }

        for (let i in this.ignoredProxies) {
            let icon_proxy = this.ignoredProxies[i];

            if (!this.shouldIgnoreStatusIcon(icon_proxy)) {
                delete this.ignoredProxies[i];
                let key = this.getKey(icon_proxy);
                let statusIcon = new XAppStatusIcon(this, icon_proxy);
                this.statusIcons[key] = statusIcon;
            }
        }
    }

    ignoreStatusIcon(icon_proxy) {
        let key = this.getKey(icon_proxy);
        if (this.ignoredProxies[key]) return;
        this.ignoredProxies[key] = icon_proxy;
    }

    shouldIgnoreStatusIcon(icon_proxy) {
        let hiddenIcons = Main.systrayManager.getRoles();
        let name = icon_proxy.name.toLowerCase();
        if (hiddenIcons.indexOf(name) != -1) {
            return true;
        }
        return false;
    }

    _sortFunc(a, b) {
        let asym = a.proxy.icon_name && a.proxy.icon_name.includes("-symbolic");
        let bsym = b.proxy.icon_name && b.proxy.icon_name.includes("-symbolic");

        if (asym && !bsym) return 1;
        if (bsym && !asym) return -1;

        let aName = (a.proxy.name || "").replace("org.x.StatusIcon.", "").toLowerCase();
        let bName = (b.proxy.name || "").replace("org.x.StatusIcon.", "").toLowerCase();
        return GLib.utf8_collate(aName, bName);
    }

    sortIcons() {
        this.onSystrayRolesChanged();
        this._relayoutPinnedIcons();
        this._relayoutPopupGrid();
        this._updateChevronVisibility();
    }

    _relayoutPinnedIcons() {
        let pinned = [];
        for (let key in this.statusIcons) {
            let icon = this.statusIcons[key];
            if (this.isIconPinned(icon)) {
                pinned.push(icon);
            }
        }

        pinned.sort((a, b) => {
            let idA = getIconIdentifier(a.proxy);
            let idB = getIconIdentifier(b.proxy);
            let idxA = this.pinnedIconsList.indexOf(idA);
            let idxB = this.pinnedIconsList.indexOf(idB);
            if (idxA !== -1 && idxB !== -1) {
                return idxA - idxB;
            }
            if (idxA !== -1) return -1;
            if (idxB !== -1) return 1;
            return this._sortFunc(a, b);
        });

        let oldChildren = this.pinnedIconsBox.get_children();
        for (let child of oldChildren) {
            this.pinnedIconsBox.remove_actor(child);
        }

        for (let icon of pinned) {
            icon.setInPopup(false);
            if (icon.actor.get_parent()) {
                icon.actor.get_parent().remove_actor(icon.actor);
            }
            this.pinnedIconsBox.add_actor(icon.actor);
        }
    }

    _relayoutPopupGrid() {
        let unpinned = [];
        for (let key in this.statusIcons) {
            let icon = this.statusIcons[key];
            if (!this.isIconPinned(icon)) {
                unpinned.push(icon);
            }
        }

        unpinned.sort((a, b) => {
            let idA = getIconIdentifier(a.proxy);
            let idB = getIconIdentifier(b.proxy);
            let idxA = this.unpinnedOrderList.indexOf(idA);
            let idxB = this.unpinnedOrderList.indexOf(idB);
            if (idxA !== -1 && idxB !== -1) {
                return idxA - idxB;
            }
            if (idxA !== -1) return -1;
            if (idxB !== -1) return 1;
            return this._sortFunc(a, b);
        });

        let oldRows = this.menu.gridBox.get_children();
        for (let row of oldRows) {
            if (row instanceof St.BoxLayout) {
                let rowItems = row.get_children();
                for (let item of rowItems) {
                    row.remove_actor(item);
                }
            }
            row.destroy();
        }

        if (unpinned.length === 0) {
            let emptyLabel = new St.Label({
                text: _("Nenhum ícone oculto"),
                style_class: 'win11-tray-empty'
            });
            this.menu.gridBox.add_actor(emptyLabel);
            return;
        }

        let numCols = Math.max(3, Math.min(8, this.columns || 5));
        let currentRow = null;

        for (let i = 0; i < unpinned.length; i++) {
            if (i % numCols === 0) {
                currentRow = new St.BoxLayout({
                    vertical: false,
                    style_class: 'win11-tray-row'
                });
                this.menu.gridBox.add_actor(currentRow);
            }
            let icon = unpinned[i];
            icon.setInPopup(true);
            if (icon.actor.get_parent()) {
                icon.actor.get_parent().remove_actor(icon.actor);
            }
            currentRow.add_actor(icon.actor);
        }
    }

    _updateChevronVisibility() {
        let unpinnedCount = 0;
        for (let key in this.statusIcons) {
            if (!this.isIconPinned(this.statusIcons[key])) {
                unpinnedCount++;
            }
        }

        if (unpinnedCount === 0 && !this.alwaysShowChevron) {
            this.chevronButton.hide();
            if (this.menu.isOpen) {
                this.menu.close();
            }
        } else {
            this.chevronButton.show();
        }
    }

    refreshIcons() {
        for (let owner in this.statusIcons) {
            let icon = this.statusIcons[owner];
            icon.refresh();
        }
        this._recording_indicator.refresh();
    }

    icon_size_changed() {
        this.refreshIcons();
    }

    on_icon_theme_changed() {
        this.refreshIcons();
    }

    ui_scale_changed() {
        if (this._scaleUpdateId > 0) {
            Mainloop.source_remove(this._scaleUpdateId);
        }

        this._scaleUpdateId = Mainloop.timeout_add(1500, () => {
            this.refreshIcons();
            this._scaleUpdateId = 0;
            return GLib.SOURCE_REMOVE;
        });
    }

    on_panel_edit_mode_changed() {
        let reactive = !global.settings.get_boolean('panel-edit-mode');
        for (let owner in this.statusIcons) {
            let icon = this.statusIcons[owner];
            icon.actor.reactive = reactive;
        }
    }

    on_orientation_changed(newOrientation) {
        this.orientation = newOrientation;
        let isVertical = (newOrientation == St.Side.LEFT || newOrientation == St.Side.RIGHT);

        this.mainContainer.vertical = isVertical;
        this.pinnedIconsBox.vertical = isVertical;

        this.menu.setOrientation(newOrientation);
        this._updateChevronIcon(this.menu.isOpen);
        this.refreshIcons();
    }

    on_applet_removed_from_panel() {
        this.signalManager.disconnectAllSignals();

        for (let key in this.statusIcons) {
            this.statusIcons[key].destroy();
            delete this.statusIcons[key];
        }

        for (let key in this.ignoredProxies) {
            delete this.ignoredProxies[key];
        }

        this._recording_indicator.destroy();
        this._recording_indicator = null;
        this.monitor = null;
        this.menu.destroy();

        this.hideIndicator();
        if (this.indicatorBar) {
            this.indicatorBar.destroy();
            this.indicatorBar = null;
        }
    }
}

function main(metadata, orientation, panel_height, instance_id) {
    return new Win11TrayApplet(orientation, panel_height, instance_id);
}
