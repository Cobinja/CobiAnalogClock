#!/usr/bin/python
#
# settings.py
# Copyright (C) 2013 Lars Mueller <cobinja@yahoo.de>
# 
# CobiAnalogClock is free software: you can redistribute it and/or modify it
# under the terms of the GNU General Public License as published by the
# Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
# 
# CobiAnalogClock is distributed in the hope that it will be useful, but
# WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
# See the GNU General Public License for more details.
# 
# You should have received a copy of the GNU General Public License along
# with this program.  If not, see <http://www.gnu.org/licenses/>.

from gi.repository import Gtk, GLib, Gio, GObject
import os, sys
import json
import collections

DESKLET_DIR = os.path.dirname(os.path.abspath(__file__))
UI_FILE = DESKLET_DIR + "/settings.ui"

UUID = "analog-clock@cobinja.de"

def getThemeNames(path):
  themeNames = [];
  for (path, dirs, files) in os.walk(path):
    if "metadata.json" in files:
      themeNames.append(os.path.basename(path))
  themeNames.sort()
  return themeNames

class CobiSettings:
  def __init__(self, instanceId):
    self.instanceId = instanceId
    settingsDirName = GLib.get_user_config_dir()
    if not settingsDirName:
      settingsDirName = GLib.get_home_dir() + "/.config"
    settingsDirName += "/cobinja/" + UUID
    settingsDir = Gio.file_new_for_path(settingsDirName)
    
    if not settingsDir.query_exists(None):
      settingsDir.make_directory_with_parents(None)
    
    self.__settingsFile = settingsDir.get_child(instanceId + ".json")
    if not self.__settingsFile.query_exists(None):
      self.__getDefaultSettingsFile().copy(self.__settingsFile, 0, None, None, None)
    
    self.values = collections.OrderedDict()
    
    self.__loadSettings()
    
    self.__monitor = self.__settingsFile.monitor(Gio.FileMonitorFlags.NONE, None)
    self.__monitorChangedId = self.__monitor.connect("changed", self.__onSettingsChanged)
  
  def __getDefaultSettingsFile(self):
    return Gio.file_new_for_path(DESKLET_DIR + "/default_settings.json")
  
  def writeSettings(self):
    if self.changed():
      f = open(self.__settingsFile.get_path(), 'w')
      f.write(json.dumps(self.values, sort_keys=False, indent=2))
      f.close()
      self.__origSettings = collections.OrderedDict(self.values)
  
  def setEntry(self, key, value, writeToFile):
    if key in self.values.keys() and self.values[key] != value:
      self.values[key] = value
      if writeToFile:
        self.writeSettings()
  
  def __onSettingsChanged(self, monitor, thisFile, otherFile, eventType):
    self.__loadSettings()
  
  def __loadSettings(self):
    f = open(self.__settingsFile.get_path(), 'r')
    settings = json.loads(f.read(), object_pairs_hook=collections.OrderedDict)
    f.close()
    for key in settings:
      value = settings[key]
      oldValue = self.values[key] if key in self.values.keys() else None
      if value != oldValue:
        self.values[key] = value
    self.__origSettings = collections.OrderedDict(self.values)
  
  def changed(self):
    return self.values != self.__origSettings
  
  def __del__(self):
    self.__monitor.disconnect(self.__monitorChangedId)
    self.__monitor.cancel()

class CobiAnalogClockSettings:
  def __init__(self):
    instanceId = sys.argv[1];
    self.__settings = CobiSettings(instanceId)
    
    self.builder = Gtk.Builder()
    self.builder.add_from_file(UI_FILE)
    self.builder.connect_signals(self)
    
    self.lsTheme = Gtk.ListStore(GObject.TYPE_INT, GObject.TYPE_STRING)
    cbTheme = self.builder.get_object("cbTheme")
    # Load theme names
    themeNames = getThemeNames(DESKLET_DIR + "/themes")
    activeIndex = 0
    for i in range(0, len(themeNames)):
      themeName = themeNames[i]
      self.lsTheme.append([i, themeName])
      if themeName == self.__settings.values["theme"]:
        activeIndex = i
    cbTheme.set_model(self.lsTheme)
    cell = Gtk.CellRendererText()
    cbTheme.pack_start(cell, True)
    cbTheme.add_attribute(cell, "text", 1)
    cbTheme.set_active(activeIndex)
    cbTheme.connect("changed", self.onThemeChanged)
    
    cbShowSeconds = self.builder.get_object("cbShowSeconds")
    cbShowSeconds.set_active(self.__settings.values["show-seconds"])
    cbShowSeconds.connect("toggled", self.onShowSecondsChanged)
    
    sbSize = self.builder.get_object("sbSize")
    sbSize.set_range(20, 1000)
    sbSize.set_increments(1, 1)
    sbSize.set_value(self.__settings.values["size"])
    sbSize.connect("value-changed", self.onSizeChanged)
    
    self.updateApplyButtonSensitivity()

    window = self.builder.get_object("SettingsWindow")
    window.show_all()
    
  def destroy(self, window):
    Gtk.main_quit()
    
  def okPressed(self, button):
    self.applySettings(button)
    Gtk.main_quit()
  
  def applySettings(self, button):
    self.__settings.writeSettings()
    self.updateApplyButtonSensitivity()
  
  def cancel(self, button):
    Gtk.main_quit()
  
  def onThemeChanged(self, button):
    tree_iter = button.get_active_iter()
    if tree_iter != None:
      themeName = self.lsTheme[tree_iter][1]
    if themeName:
      self.__settings.setEntry("theme", themeName, False)
    self.updateApplyButtonSensitivity()
  
  def onSizeChanged(self, button):
    self.__settings.setEntry("size", int(button.get_value()), False)
    self.updateApplyButtonSensitivity()
  
  def onShowSecondsChanged(self, button):
    self.__settings.setEntry("show-seconds", button.get_active(), False)
    self.updateApplyButtonSensitivity()
  
  def updateApplyButtonSensitivity(self):
    btn = self.builder.get_object("buttonApply")
    changed = self.__settings.changed()
    btn.set_sensitive(changed)

def main():
  app = CobiAnalogClockSettings()
  Gtk.main()
    
if __name__ == "__main__":
  if len(sys.argv) != 2:
    print "Usage: settings.py <desklet_id>"
    exit(0);
  main()
