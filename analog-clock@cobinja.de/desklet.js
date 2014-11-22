const Cinnamon = imports.gi.Cinnamon;
const St = imports.gi.St;

const Desklet = imports.ui.desklet;

const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Signals = imports.signals;
const Util = imports.misc.util;
const UPowerGlib = imports.gi.UPowerGlib;
const Rsvg = imports.gi.Rsvg;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;

const UUID = "analog-clock@cobinja.de";

const DESKLET_DIR = imports.ui.deskletManager.deskletMeta[UUID].path;

const M_PI = 3.141592654;
const RAD_PER_DEGREE = M_PI / 180;
const MARGIN = 5;

function CobiSignalTracker() {
  this._init();
}

CobiSignalTracker.prototype = {
  _init: function() {
      this._data = [];
  },

  // params = {
  //   signalName: Signal Name
  //   callback: Callback Function
  //   bind: Context to bind to
  //   target: target to connect to
  //}
  connect: function (params) {
    let signalName = params["signalName"];
    let callback = params["callback"];
    let bind = params["bind"];
    let target = params["target"];
    let signalId = null;

    signalId = target.connect(signalName, Lang.bind(bind, callback));
    this._data.push({
      signalName: signalName,
      callback: callback,
      target: target,
      signalId: signalId,
      bind: bind
    });
  },

  disconnect: function (params) {
    for (let i = 0; i < this._data.length; i++) {
      let data = this._data[i];
      if (params["signalName"] == data["signalName"] &&
          params["target"] == data["target"] &&
          params["callback"] == data["callback"] &&
          params["bind"] == data["bind"]) {
        data["target"].disconnect(data["signalId"]);
        data = null;
        this._data.splice(i, 1);
        break;
      }
    }
  },

  disconnectAll: function () {
    for (let i = 0; i < this._data.length; i++) {
      let data = this._data[i];
      data["target"].disconnect(data["signalId"]);
      data[i] = null;
    }
    this._data = [];
  },
  
  destroy: function() {
    this.disconnectAll();
    this._data = null;
  }
}

function CobiAnalogClockSettings(instanceId) {
  this._init(instanceId);
}

CobiAnalogClockSettings.prototype = {
  _init: function(instanceId) {
    this._instanceId = instanceId;
    this._signalTracker = new CobiSignalTracker();
    this.values = {};
    
    let settingsDirName = GLib.get_user_config_dir();
    if (!settingsDirName) {
      settingsDirName = GLib.get_home_dir() + "/.config";
    }
    settingsDirName += "/cobinja/" + UUID;
    this._settingsDir = Gio.file_new_for_path(settingsDirName);
    if (!this._settingsDir.query_exists(null)) {
      this._settingsDir.make_directory_with_parents(null);
    }
    
    this._settingsFile = this._settingsDir.get_child(this._instanceId + ".json");
    if (!this._settingsFile.query_exists(null)) {
      this._getDefaultSettingsFile().copy(this._settingsFile, 0, null, null);
    }
    
    this._onSettingsChanged();
    
    this._upgradeSettings();
    
    this._monitor = this._settingsFile.monitor(Gio.FileMonitorFlags.NONE, null);
    this._signalTracker.connect({signalName: "changed", callback: Lang.bind(this, this._onSettingsChanged), bind: this, target: this._monitor});
  },
  
  _getDefaultSettingsFile: function() {
    return Gio.file_new_for_path(DESKLET_DIR + "/default_settings.json");
  },
  
  _onSettingsChanged: function() {
    let settings;
    try {
      settings = JSON.parse(Cinnamon.get_file_contents_utf8_sync(this._settingsFile.get_path()));
    }
    catch (e) {
      global.logError("Could not parse CobiAnalogClock's settings.json", e)
      return true;
    }
    
    for (let key in settings) {
      if (settings.hasOwnProperty(key)) {
        let comparison;
        if (settings[key] instanceof Array) {
          comparison = !compareArray(this.values[key], settings[key]);
        }
        else {
          comparison = this.values[key] !== settings[key];
        }
        if (comparison) {
          this.values[key] = settings[key];
          this.emit(key + "-changed", this.values[key]);
        }
      }
    }
    return true;
  },
  
  _upgradeSettings: function() {
    let defaultSettings;
    try {
      defaultSettings = JSON.parse(Cinnamon.get_file_contents_utf8_sync(this._getDefaultSettingsFile().get_path()));
    }
    catch (e) {
      global.logError("Could not parse CobiAnalogClock's default_settings.json", e);
      return true;
    }
    for (let key in defaultSettings) {
      if (defaultSettings.hasOwnProperty(key) && !(key in this.values)) {
        this.values[key] = defaultSettings[key];
      }
    }
    for (let key in this.values) {
      if (this.values.hasOwnProperty(key) && !(key in defaultSettings)) {
        delete this.values[key];
      }
    }
    this._writeSettings();
    return false;
  },
    
  setValue: function(key, value) {
    if (!compareArray(value, this.values[key])) {
      this.values[key] = value;
      this.emit(key + "-changed", this.values[key]);
      this._writeSettings();
    }
  },
  
  _writeSettings: function() {
    let filedata = JSON.stringify(this.values, null, "  ");
    GLib.file_set_contents(this._settingsFile.get_path(), filedata, filedata.length);
  },
  
  destroy: function() {
    this._signalTracker.disconnectAll();
    this._signalTracker.destroy();
    this._monitor.cancel();
    this.values = null;
  }
}

Signals.addSignalMethods(CobiAnalogClockSettings.prototype);

function CobiAnalogClock(metadata, instanceId){
    this._init(metadata, instanceId);
}

CobiAnalogClock.prototype = {
  __proto__: Desklet.Desklet.prototype,

  _init: function(metadata, instanceId){
    Desklet.Desklet.prototype._init.call(this, metadata, instanceId);
    this._signalTracker = new CobiSignalTracker();
    this._paintSignals = new CobiSignalTracker();
    this._settings = new CobiAnalogClockSettings(instanceId);
    
    this._displayTime = new GLib.DateTime();
    if (this._settings.values["timezone-use"] && this._tzId != null) {
      let tz = GLib.TimeZone.new(this._tzId);
      this._displayTime = this._displayTime.to_timezone(tz);
    }
    
    this._menu.addAction(_("Settings"), Lang.bind(this, function() {Util.spawnCommandLine(DESKLET_DIR + "/settings.py " + instanceId);}));
  },
  
  on_desklet_added_to_desktop: function(userEnabled) {
    this.metadata["prevent-decorations"] = this._settings.values["hide-decorations"];
    this._updateDecoration();
    
    this._clockSize = this._settings.values["size"];
    
    this._clockActor = new St.Group();
    
    this._tzLabel = new St.Label();
    
    this.setHeader(_("Clock"));
    this.setContent(this._clockActor);
    
    //this._clock = this._loadTheme();
    this._loadClock();
    
    let currentMillis = new Date().getMilliseconds();
    let timeoutMillis = (1000 - currentMillis) % 1000;
    this._timeoutId = Mainloop.timeout_add(timeoutMillis, Lang.bind(this, this._updateClock));
    
    this._signalTracker.connect({signalName: "size-changed", target: this._settings, bind: this, callback: Lang.bind(this, this._onSizeChanged)});
    this._signalTracker.connect({signalName: "theme-changed", target: this._settings, bind: this, callback: Lang.bind(this, this._onThemeChanged)});
    this._signalTracker.connect({signalName: "hide-decorations-changed", target: this._settings, bind: this, callback: Lang.bind(this, this._onHideDecorationsChanged)});
    this._signalTracker.connect({signalName: "show-seconds-changed", target: this._settings, bind: this, callback: Lang.bind(this, this._onShowSecondsChanged)});
    
    this._signalTracker.connect({signalName: "timezone-use-changed", target: this._settings, bind: this, callback: Lang.bind(this, this._onTimezoneChanged)});
    this._signalTracker.connect({signalName: "timezone-changed", target: this._settings, bind: this, callback: Lang.bind(this, this._onTimezoneChanged)});
    this._signalTracker.connect({signalName: "timezone-display-changed", target: this._settings, bind: this, callback: Lang.bind(this, this._onTimezoneDisplayChanged)});
    
    this._upClient = new UPowerGlib.Client();
    this._upClient.connect('notify-resume', Lang.bind(this, this._updateClock));
  },
  
  _loadTheme: function() {
    let themeName = this._settings.values["theme"];
    let themesDir = Gio.file_new_for_path(DESKLET_DIR + "/themes");
    let themeDir = themesDir.get_child(themeName);
    let metaDataFile = themeDir.get_child("metadata.json");
    let metaData = JSON.parse(Cinnamon.get_file_contents_utf8_sync(metaDataFile.get_path()));
    
    let clock = {"size": metaData["size"], "tz-label": metaData["tz-label"]};
    clock.bottomActor = new St.DrawingArea({width: this._clockSize + 2*MARGIN, height: this._clockSize + 2*MARGIN});
    clock.topActor = new St.DrawingArea({width: this._clockSize + 2*MARGIN, height: this._clockSize + 2*MARGIN});
    
    let bodyFileName = metaData["body"];
    let body = {};
    body.rsvgHandle = Rsvg.Handle.new_from_file(themeDir.get_child(bodyFileName).get_path());
    clock.body = body;
    
    let clockfaceFileName = metaData["clockface"];
    let clockface = {};
    clockface.rsvgHandle = Rsvg.Handle.new_from_file(themeDir.get_child(clockfaceFileName).get_path());
    clock.clockface = clockface;
    
    let frameFileName = metaData["frame"];
    let frame = {};
    frame.rsvgHandle = Rsvg.Handle.new_from_file(themeDir.get_child(frameFileName).get_path());
    clock.frame = frame;
    
    let hourFileName = metaData["hour"]["fileName"];
    let hour = {};
    hour.rsvgHandle = Rsvg.Handle.new_from_file(themeDir.get_child(hourFileName).get_path());
    hour.pivotX = metaData["hour"]["pivot-x"];
    hour.pivotY = metaData["hour"]["pivot-y"];
    clock.hour = hour;
    
    let minuteFileName = metaData["minute"]["fileName"];
    let minute = {};
    minute.rsvgHandle = Rsvg.Handle.new_from_file(themeDir.get_child(minuteFileName).get_path());
    minute.pivotX = metaData["minute"]["pivot-x"];
    minute.pivotY = metaData["minute"]["pivot-y"];
    clock.minute = minute;
    
    let secondFileName = metaData["second"]["fileName"];
    let second = {};
    second.rsvgHandle = Rsvg.Handle.new_from_file(themeDir.get_child(secondFileName).get_path());
    second.pivotX = metaData["second"]["pivot-x"];
    second.pivotY = metaData["second"]["pivot-y"];
    clock.second = second;
    
    return clock;
  },
  
  _loadClock: function() {
    let newClock = this._loadTheme();
    this._paintSignals.disconnectAll();
    this._clock = newClock;
    this._clockActor.remove_all_children();
    this._clockActor.add_actor(this._clock.bottomActor);
    // add timezone label
    this._clockActor.add_actor(this._tzLabel);
    this._tzLabel.set_style(this._clock["tz-label"]);
    this._updateTzLabel();
    this._clockActor.add_actor(this._clock.topActor);
    this._paintSignals.connect({signalName: "repaint", target: this._clock.bottomActor, bind: this, callback: Lang.bind(this, this._onPaintBottomActor)});
    this._paintSignals.connect({signalName: "repaint", target: this._clock.topActor, bind: this, callback: Lang.bind(this, this._onPaintTopActor)});
  },
  
  _onThemeChanged: function() {
    Mainloop.source_remove(this._timeoutId);
    try {
      this._loadClock();
    }
    catch (e) {
      global.logError("Could not load analog clock theme", e);
    }
    this._updateClock();
  },
  
  _onSizeChanged: function() {
    let size = this._settings.values["size"];
    this._clockActor.set_width(size + 2 * MARGIN);
    this._clockActor.set_height(size + 2 * MARGIN);
    this._clock.bottomActor.set_width(size + 2 * MARGIN);
    this._clock.bottomActor.set_height(size + 2 * MARGIN);
    this._clock.topActor.set_width(size + 2 * MARGIN);
    this._clock.topActor.set_height(size + 2 * MARGIN);
    
    this._clockSize = size;
    this._updateClock();
  },
  
  _onShowSecondsChanged: function() {
    this._updateClock();
  },
  
  _onHideDecorationsChanged: function() {
    this.metadata["prevent-decorations"] = this._settings.values["hide-decorations"];
    this._updateDecoration();
    this._updateTzLabel();
  },
  
  _onTimezoneChanged: function() {
    let tz = this._settings.values["timezone"];
    let zoneName = tz["region"];
    if (tz["city"] != "") {
      zoneName += "/" + tz["city"];
    }
    let zoneDirName = "/usr/share/zoneinfo/";
    let zoneDir = Gio.file_new_for_path(zoneDirName);
    let tzId = zoneDirName + tz["region"];
    if (tz["city"]) {
      tzId += "/" + tz["city"];
    }
    tzId = tzId.replace(" ", "_");
    let tzFile = Gio.file_new_for_path(tzId);
    this._tzId = tzFile.query_exists(null) ? ":" + tzId : null;
    this._updateHeader();
    this._updateTzLabel();
    this._updateClock();
  },
  
  _onTimezoneDisplayChanged: function() {
    this._updateHeader();
    this._updateTzLabel();
  },
  
  _getTzLabelText: function() {
    let result = _("Clock");
    if (this._settings.values["timezone-use"] && this._settings.values["timezone-display"]) {
      let tz = this._settings.values["timezone"];
      if (tz["city"] && tz["city"] != "") {
        result = tz["city"];
      }
      else {
        result = tz["region"];
      }
    }
    return result;
  },
  
  _updateTzLabel: function() {
    this._tzLabel.set_text(this._getTzLabelText());
    let lSize = this._tzLabel.size;
    let aSize = this._clockActor.size;
    let x = Math.round((aSize.width - lSize.width) / 2.0);
    let y = Math.round((aSize.height - lSize.height) * 2 / 3.0);
    this._tzLabel.set_position(x, y);
    let showLabel = (this._settings.values["hide-decorations"] || global.settings.get_int("desklet-decorations") <= 1) &&
                     this._settings.values["timezone-use"] &&
                     this._settings.values["timezone-display"];
    showLabel ? this._tzLabel.show() : this._tzLabel.hide();
  },
  
  _updateHeader: function() {
    this.setHeader(this._getTzLabelText());
  },
  
  _updateClock: function() {
    this._displayTime = new GLib.DateTime();
    if (this._settings.values["timezone-use"] && this._tzId != null) {
      let tz = GLib.TimeZone.new(this._tzId);
      this._displayTime = this._displayTime.to_timezone(tz);
    }
    
    this._clock.bottomActor.queue_repaint();
    this._clock.topActor.queue_repaint();
    
    let newTimeoutSeconds = 1;
    if (!this._settings.values["show-seconds"]) {
      let seconds = this._displayTime.get_second();
      newTimeoutSeconds = 60 - seconds;
    }
    this._timeoutId = Mainloop.timeout_add_seconds(newTimeoutSeconds, Lang.bind(this, this._updateClock));
    return false;
  },
  
  _onPaintBottomActor: function() {
    let scale = this._clockSize / this._clock["size"];
    let cr = this._clock.bottomActor.get_context();
    
    cr.save();
    cr.translate(MARGIN, MARGIN);
    if (scale != 1) {
      cr.scale(scale, scale);
    }
    
    this._clock.body.rsvgHandle.render_cairo(cr);
    this._clock.clockface.rsvgHandle.render_cairo(cr);
    
    cr.restore();
    cr.fill();
    cr = null;
    //global.gc();
  },
  
  _onPaintTopActor: function() {
    let scale = this._clockSize / this._clock["size"];
    let cr = this._clock.topActor.get_context();
    
    let hours = this._displayTime.get_hour();
    let minutes = this._displayTime.get_minute();
    let seconds = this._displayTime.get_second();
    hours = (hours + (minutes / 60.0)) % 12;
    
    let rsvgDim;
    let angle;
    
    cr.save();
    cr.translate(MARGIN, MARGIN);
    if (scale != 1) {
      cr.scale(scale, scale);
    }
    
    // hour
    cr.save()
    rsvgDim = this._clock.hour.rsvgHandle.get_dimensions();
    angle = RAD_PER_DEGREE * 30 * hours;
    cr.translate(this._clock["size"] / 2, this._clock["size"] / 2);
    cr.rotate(angle);
    cr.translate(-(this._clock.hour.pivotX), -(this._clock.hour.pivotY));
    this._clock.hour.rsvgHandle.render_cairo(cr);
    cr.restore();
    
    // minute
    cr.save();
    rsvgDim = this._clock.minute.rsvgHandle.get_dimensions();
    angle = RAD_PER_DEGREE * 6 * minutes;
    cr.translate(this._clock["size"] / 2, this._clock["size"] / 2);
    cr.rotate(angle);
    cr.translate(-(this._clock.minute.pivotX), -(this._clock.minute.pivotY));
    this._clock.minute.rsvgHandle.render_cairo(cr);
    cr.restore();
    
    // second
    if (this._settings.values["show-seconds"]) {
      cr.save();
      rsvgDim = this._clock.second.rsvgHandle.get_dimensions();
      angle = RAD_PER_DEGREE * 6 * seconds;
      cr.translate(this._clock["size"] / 2, this._clock["size"] / 2);
      cr.rotate(angle);
      cr.translate(-(this._clock.second.pivotX), -(this._clock.second.pivotY));
      this._clock.second.rsvgHandle.render_cairo(cr);
      cr.restore();
    }
    
    cr.save();
    this._clock.frame.rsvgHandle.render_cairo(cr);
    cr.restore();
    
    cr.restore();
    cr.fill();
    cr = null;
    //global.gc();
  },
  
  on_desklet_removed: function() {
    this._paintSignals.disconnectAll();
    this._paintSignals.destroy();
    if (this._timeoutId != undefined) {
      Mainloop.source_remove(this._timeoutId);
    }
    this._signalTracker.destroy();
    this._settings.destroy();
    //global.gc();
  }
}

function main(metadata, instanceId){
  let desklet = new CobiAnalogClock(metadata, instanceId);
  return desklet;
}
