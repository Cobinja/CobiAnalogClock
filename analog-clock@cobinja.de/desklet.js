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
    
    for (key in settings) {
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
    for (key in defaultSettings) {
      if (defaultSettings.hasOwnProperty(key) && !(key in this.values)) {
        this.values[key] = defaultSettings[key];
      }
    }
    for (key in this.values) {
      if (this.values.hasOwnProperty(key) && !(key in defaultSettings)) {
        delete this.values[key];
      }
    }
    this._writeSettings();
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
    this._settings = new CobiAnalogClockSettings(instanceId);
    
    this._menu.addAction(_("Settings"), Lang.bind(this, function() {Util.spawnCommandLine(DESKLET_DIR + "/settings.py " + instanceId);}));
    
    this._clockSize = this._settings.values["size"];
    
    this._clockActor = new St.DrawingArea({width: this._clockSize + 2*MARGIN, height: this._clockSize + 2*MARGIN});
    
    this.setHeader(_("Clock"));
    this.setContent(this._clockActor);
    
    this._clock = this._loadTheme();
    
    this._signalTracker.connect({signalName: "repaint", target: this._clockActor, bind: this, callback: Lang.bind(this, this._paintClock)});
    
    let currentMillis = new Date().getMilliseconds();
    let timeoutMillis = (1000 - currentMillis) % 1000;
    this._timeoutId = Mainloop.timeout_add(timeoutMillis, Lang.bind(this, this._updateClock));
    
    this._signalTracker.connect({signalName: "size-changed", target: this._settings, bind: this, callback: Lang.bind(this, this._onSizeChanged)});
    this._signalTracker.connect({signalName: "theme-changed", target: this._settings, bind: this, callback: Lang.bind(this, this._onThemeChanged)});
    
    this._upClient = new UPowerGlib.Client();
    this._upClient.connect('notify-resume', Lang.bind(this, this._updateClock));
  },
  
  _loadTheme: function() {
    let themeName = this._settings.values["theme"];
    let themesDir = Gio.file_new_for_path(DESKLET_DIR + "/themes");
    let themeDir = themesDir.get_child(themeName);
    let metaDataFile = themeDir.get_child("metadata.json");
    let metaData = JSON.parse(Cinnamon.get_file_contents_utf8_sync(metaDataFile.get_path()));
    
    let clock = {"size": metaData["size"]};
    
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
  
  _onThemeChanged: function() {
    Mainloop.source_remove(this._timeoutId);
    try {
      let newClock = this._loadTheme();
      this._clock = newClock;
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
    this._clockSize = size;
    this._updateClock();
  },
  
  _onShowSecondsChanged: function() {
    this._updateClock();
  },
  
  _updateClock: function() {
    this._displayTime = new Date();
    this._clockActor.queue_repaint();
    let newTimeoutSeconds = 1;
    if (!this._settings.values["show-seconds"]) {
      let seconds = this._displayTime.getSeconds();
      newTimeoutSeconds = 60 - seconds;
    }
    this._timeoutId = Mainloop.timeout_add_seconds(newTimeoutSeconds, Lang.bind(this, this._updateClock));
    return false;
  },
  
  _paintClock: function() {
    let scale = this._clockSize / this._clock["size"];
    let cr = this._clockActor.get_context();
    cr.translate(MARGIN, MARGIN);
    
    let hours = this._displayTime.getHours();
    let minutes = this._displayTime.getMinutes();
    let seconds = this._displayTime.getSeconds();
    hours = (hours + (minutes / 60.0)) % 12;
    
    // body
    cr.save();
    cr.scale(scale, scale);
    this._clock.body.rsvgHandle.render_cairo(cr);
    cr.restore();
    
    // clockface
    cr.save();
    cr.scale(scale, scale);
    this._clock.clockface.rsvgHandle.render_cairo(cr);
    cr.restore();
    
    // hour hand
    cr.save();
    let rsvgDim = this._clock.hour.rsvgHandle.get_dimensions();
    let angle = RAD_PER_DEGREE * 30 * hours;
    
    cr.translate(this._clockSize / 2, this._clockSize / 2);
    cr.rotate(angle);
    cr.translate(-(this._clock.hour.pivotX * scale), -(this._clock.hour.pivotY * scale));
    
    if (scale != 1) {
      cr.scale(scale, scale);
    }
    this._clock.hour.rsvgHandle.render_cairo(cr);
    cr.restore();
    
    // minute
    cr.save();
    rsvgDim = this._clock.minute.rsvgHandle.get_dimensions();
    
    angle = RAD_PER_DEGREE * 6 * minutes;
    
    cr.translate(this._clockSize / 2, this._clockSize / 2);
    cr.rotate(angle);
    cr.translate(-(this._clock.minute.pivotX * scale), -(this._clock.minute.pivotY * scale));
    
    if (scale != 1) {
      cr.scale(scale, scale);
    }
    this._clock.minute.rsvgHandle.render_cairo(cr);
    cr.restore();
    
    // second
    if (this._settings.values["show-seconds"]) {
      cr.save();
      rsvgDim = this._clock.second.rsvgHandle.get_dimensions();
      
      angle = RAD_PER_DEGREE * 6 * seconds;
      
      cr.translate(this._clockSize / 2, this._clockSize / 2);
      cr.rotate(angle);
      cr.translate(-(this._clock.second.pivotX * scale), -(this._clock.second.pivotY * scale));
      
      if (scale != 1) {
        cr.scale(scale, scale);
      }
      this._clock.second.rsvgHandle.render_cairo(cr);
      cr.restore();
    }
    
    // frame
    cr.save();
    cr.scale(scale, scale);
    this._clock.frame.rsvgHandle.render_cairo(cr);
    cr.restore();
    
    cr.fill();
  },
  
  on_desklet_removed: function() {
    if (this._timeoutId != undefined) {
      Mainloop.source_remove(this._timeoutId);
    }
    this._signalTracker.destroy();
    this._settings.destroy();
    
  }
}

function main(metadata, instanceId){
    let desklet = new CobiAnalogClock(metadata, instanceId);
    return desklet;
}
