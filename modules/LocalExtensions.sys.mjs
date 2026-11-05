/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Installation d'une extension depuis un fichier .xpi / .zip ou un dossier,
// signée ou non (Réglages > Extensions). L'installation est permanente :
// l'extension est copiée dans le profil et reste après un redémarrage.
//
// Le gestionnaire d'extensions n'installe en permanent qu'une archive dont
// manifest.json est à la racine et qui porte un identifiant. On reconstruit
// donc une archive temporaire quand il le faut :
//  - un dossier est mis en archive ;
//  - une archive dont tout est dans un seul sous-dossier (« Download ZIP » de
//    GitHub) est remise à plat ;
//  - une extension sans identifiant Gecko en reçoit un, tiré de son nom :
//    réinstaller une version plus récente remplace la précédente.
//
// La confirmation (une seule, à l'installation) est posée par
// ExtensionsUI.sys.mjs, comme pour une extension d'addons.mozilla.org.

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  AddonManager: "resource://gre/modules/AddonManager.sys.mjs",
  ExtensionsUI: "resource:///modules/ExtensionsUI.sys.mjs",
  NetUtil: "resource://gre/modules/NetUtil.sys.mjs",
});

const PR_RDWR = 0x04;
const PR_CREATE_FILE = 0x08;
const PR_TRUNCATE = 0x20;

// Même règle que XPIInstall.sys.mjs (gIDTest).
const ID_TEST =
  /^(\{[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}|[a-z0-9-\._]*\@[a-z0-9-\._]+)$/i;

// Dossiers jamais mis dans l'archive d'un dossier d'extension.
const SKIPPED = new Set([".git", ".hg", ".svn", ".DS_Store"]);

class InstallError extends Error {}

// Lecture du manifeste : Firefox tolère les lignes de commentaire « // ».
function parseJSON(text) {
  return JSON.parse(text.replace(/^\s*\/\/.*/gm, ""));
}

function geckoId(manifest) {
  return (
    manifest.browser_specific_settings?.gecko?.id ??
    manifest.applications?.gecko?.id ??
    null
  );
}

function sha256Hex(text) {
  let hash = Cc["@mozilla.org/security/hash;1"].createInstance(Ci.nsICryptoHash);
  hash.init(Ci.nsICryptoHash.SHA256);
  let data = new TextEncoder().encode(text);
  hash.update(data, data.length);
  return Array.from(hash.finish(false), c =>
    c.charCodeAt(0).toString(16).padStart(2, "0")
  ).join("");
}

// Identifiant stable tiré du nom (traduit si le nom est « __MSG_clé__ ») :
// « mon-extension-1a2b3c4d@core.local ».
function makeId(name) {
  let slug = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return `${slug || "extension"}-${sha256Hex(name).slice(0, 8)}@core.local`;
}

// Source d'une extension, lue dans un dossier ou dans une archive.
class DirSource {
  constructor(dir) {
    this.dir = dir;
  }

  file(path) {
    let file = this.dir.clone();
    for (let part of path.split("/")) {
      file.append(part);
    }
    return file;
  }

  readText(path) {
    let file = this.file(path);
    if (!file.exists() || !file.isFile()) {
      return null;
    }
    let stream = Cc["@mozilla.org/network/file-input-stream;1"].createInstance(
      Ci.nsIFileInputStream
    );
    stream.init(file, -1, -1, 0);
    try {
      return lazy.NetUtil.readInputStreamToString(stream, stream.available(), {
        charset: "UTF-8",
      });
    } finally {
      stream.close();
    }
  }

  // Écrit tout le dossier dans l'archive, sauf manifest.json.
  copyTo(writer, dir = this.dir, prefix = "") {
    for (let entries = dir.directoryEntries; entries.hasMoreElements(); ) {
      let file = entries.nextFile;
      if (SKIPPED.has(file.leafName)) {
        continue;
      }
      let path = prefix + file.leafName;
      if (file.isDirectory()) {
        writer.addEntryDirectory(path + "/", file.lastModifiedTime * 1000, false);
        this.copyTo(writer, file, path + "/");
      } else if (path != "manifest.json") {
        writer.addEntryFile(path, Ci.nsIZipWriter.COMPRESSION_DEFAULT, file, false);
      }
    }
  }

  close() {}
}

class ZipSource {
  constructor(file) {
    this.reader = Cc["@mozilla.org/libjar/zip-reader;1"].createInstance(
      Ci.nsIZipReader
    );
    try {
      this.reader.open(file);
    } catch (e) {
      throw new InstallError("ce fichier n'est pas une archive .xpi ou .zip.");
    }
    this.entries = [];
    for (let entries = this.reader.findEntries(null); entries.hasMore(); ) {
      this.entries.push(entries.getNext());
    }
    // manifest.json à la racine, ou dans l'unique dossier de premier niveau.
    this.prefix = "";
    if (!this.reader.hasEntry("manifest.json")) {
      let tops = new Set(this.entries.map(name => name.split("/")[0]));
      let [top] = tops;
      if (tops.size == 1 && this.reader.hasEntry(`${top}/manifest.json`)) {
        this.prefix = `${top}/`;
      }
    }
  }

  readText(path) {
    let name = this.prefix + path;
    if (!this.reader.hasEntry(name)) {
      return null;
    }
    let stream = this.reader.getInputStream(name);
    try {
      return lazy.NetUtil.readInputStreamToString(stream, stream.available(), {
        charset: "UTF-8",
      });
    } finally {
      stream.close();
    }
  }

  copyTo(writer) {
    for (let name of this.entries) {
      if (!name.startsWith(this.prefix) || name == this.prefix) {
        continue;
      }
      let path = name.slice(this.prefix.length);
      let entry = this.reader.getEntry(name);
      if (entry.isDirectory) {
        writer.addEntryDirectory(path, entry.lastModifiedTime, false);
      } else if (path != "manifest.json") {
        writer.addEntryStream(
          path,
          entry.lastModifiedTime,
          Ci.nsIZipWriter.COMPRESSION_DEFAULT,
          this.reader.getInputStream(name),
          false
        );
      }
    }
  }

  close() {
    this.reader.close();
  }
}

// Nom de l'extension pour l'identifiant, traduit si besoin.
function extensionName(source, manifest) {
  let name = String(manifest.name ?? "");
  let match = /^__MSG_(.+)__$/.exec(name);
  if (match && manifest.default_locale) {
    try {
      let messages = parseJSON(
        source.readText(`_locales/${manifest.default_locale}/messages.json`) ?? "{}"
      );
      let key = match[1].toLowerCase();
      for (let [k, v] of Object.entries(messages)) {
        if (k.toLowerCase() == key && v?.message) {
          return v.message;
        }
      }
    } catch (e) {}
  }
  return name;
}

function tempXPI() {
  let file = Services.dirsvc.get("TmpD", Ci.nsIFile);
  file.append("core-extension.xpi");
  file.createUnique(Ci.nsIFile.NORMAL_FILE_TYPE, 0o600);
  return file;
}

// Renvoie { file, temporary } : le fichier à donner au gestionnaire
// d'extensions, et s'il faut le supprimer après l'installation.
function prepare(file) {
  let isDir = file.isDirectory();
  let source = isDir ? new DirSource(file) : new ZipSource(file);
  try {
    let text = source.readText("manifest.json");
    if (text == null) {
      throw new InstallError(
        isDir
          ? "ce dossier ne contient pas de fichier manifest.json."
          : "cette archive ne contient pas de fichier manifest.json."
      );
    }
    let manifest;
    try {
      manifest = parseJSON(text);
    } catch (e) {
      throw new InstallError(`manifest.json est illisible (${e.message}).`);
    }
    let id = geckoId(manifest);
    if (id && !ID_TEST.test(id)) {
      throw new InstallError(`l'identifiant « ${id} » n'est pas valide.`);
    }
    // Archive utilisable telle quelle (cas des .xpi signés).
    if (!isDir && id && !source.prefix) {
      return { file, temporary: false };
    }
    if (!id) {
      let bss = (manifest.browser_specific_settings ??= {});
      bss.gecko = { ...bss.gecko, id: makeId(extensionName(source, manifest)) };
      text = JSON.stringify(manifest, null, 2);
    }

    let xpi = tempXPI();
    let writer = Cc["@mozilla.org/zipwriter;1"].createInstance(Ci.nsIZipWriter);
    writer.open(xpi, PR_RDWR | PR_CREATE_FILE | PR_TRUNCATE);
    try {
      let bytes = new TextEncoder().encode(text);
      let stream = Cc["@mozilla.org/io/arraybuffer-input-stream;1"].createInstance(
        Ci.nsIArrayBufferInputStream
      );
      stream.setData(bytes.buffer, 0, bytes.length);
      writer.addEntryStream(
        "manifest.json",
        Date.now() * 1000,
        Ci.nsIZipWriter.COMPRESSION_DEFAULT,
        stream,
        false
      );
      source.copyTo(writer);
    } catch (e) {
      writer.close();
      xpi.remove(false);
      throw e;
    }
    writer.close();
    return { file: xpi, temporary: true };
  } finally {
    source.close();
  }
}

export const LocalExtensions = {
  // Ouvre un sélecteur (mode "file" ou "folder") sur la fenêtre `win`, puis
  // installe. `onDone(name)` est appelé quand l'extension est installée.
  pick(win, mode, onDone) {
    let picker = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
    if (mode == "folder") {
      picker.init(
        win.browsingContext,
        "Dossier de l'extension (avec manifest.json)",
        Ci.nsIFilePicker.modeGetFolder
      );
    } else {
      picker.init(win.browsingContext, "Fichier de l'extension", Ci.nsIFilePicker.modeOpen);
      picker.appendFilter("Extensions (*.xpi, *.zip)", "*.xpi;*.zip");
      picker.appendFilters(Ci.nsIFilePicker.filterAll);
    }
    picker.open(result => {
      if (result == Ci.nsIFilePicker.returnOK) {
        this.install(win, picker.file, onDone).catch(console.error);
      }
    });
  },

  async install(win, file, onDone) {
    let prepared;
    try {
      prepared = prepare(file);
    } catch (e) {
      let reason = e instanceof InstallError ? e.message : `erreur inattendue (${e.message}).`;
      Services.prompt.alert(win, "Extensions", `${file.leafName} n'a pas pu être ajoutée : ${reason}`);
      if (!(e instanceof InstallError)) {
        console.error(e);
      }
      return;
    }
    let cleanup = () => {
      if (prepared.temporary) {
        prepared.file.remove(false);
      }
    };

    let install = await lazy.AddonManager.getInstallForFile(prepared.file, null, {
      source: "about:addons",
      method: "install-from-file",
    });
    if (!install || install.state == lazy.AddonManager.STATE_DOWNLOAD_FAILED) {
      cleanup();
      let reason = lazy.ExtensionsUI.errorText(install?.error);
      Services.prompt.alert(win, "Extensions", `${file.leafName} n'a pas pu être ajoutée : ${reason}`);
      return;
    }

    // Les questions et erreurs de cette installation s'ouvrent sur `win`.
    lazy.ExtensionsUI.setDialogParent(install, win);
    install.addListener({
      onInstallEnded(_install, addon) {
        cleanup();
        onDone?.(addon.name);
      },
      onInstallFailed: cleanup,
      onInstallCancelled: cleanup,
      onDownloadCancelled: cleanup,
    });
    lazy.AddonManager.installAddonFromAOM(
      null,
      win.document.documentURIObject,
      install
    );
  },
};
