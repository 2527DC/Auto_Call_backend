"use strict";

const express = require("express");
const path = require("path");
const fs = require("fs-extra");
const { migSync, datSync, liSync } = require("../node/src/lib/helpers");
const { publicPath } = require("../node/src/lib/paths");

class InstallWizard {
  constructor(app) {
    this.app = app;
    this.installApp = null;
    this.mountPath = "/install";
  }

  init(mountPath = "/install") {
    this.mountPath = mountPath;
    this.installApp = express();

    const engine = require("ejs-mate");
    this.installApp.engine("ejs", engine);
    this.installApp.set("view engine", "ejs");
    this.installApp.set("views", path.join(__dirname, "../node/views"));

    const publicInstallPath = path.join(process.cwd(), "public", "install");
    this.installApp.use("/install", express.static(publicInstallPath));

    this.installApp.use(express.urlencoded({ extended: true }));
    this.installApp.use(express.json());

    this.installApp.use((req, res, next) => {
      console.log(`[Installer] Request: ${req.method} ${req.url}`);
      if (!req.app.locals.currentRouteName) {
        req.app.locals.currentRouteName = "";
      }
      res.locals._errors = req.session?._errors || {};
      res.locals._old = req.session?._old || {};
      if (req.session) {
        delete req.session._errors;
        delete req.session._old;
      }
      next();
    });

    const router = require("../node/routes/index");
    this.installApp.use(router);

    console.log(`[Installer] Mounted at ${this.mountPath}`);
    this.app.use(this.mountPath, this.installApp);
  }

  async isInstalled() {
    try {
      return await migSync();
    } catch (error) {
      console.error("Error checking installation status:", error);
      return false;
    }
  }

  async getStatus() {
    try {
      return {
        isInstalled: await migSync(),
        hasDatabase: await datSync(),
        hasLicense: await liSync(),
        requirements: true,
        directories: true,
      };
    } catch (error) {
      console.log("Error getting installation status:", error);
      return {
        isInstalled: false,
        hasDatabase: false,
        hasLicense: false,
        requirements: false,
        directories: false,
      };
    }
  }

  async uninstall() {
    try {
      const files = [
        publicPath("_log.dic.xml"),
        publicPath("fzip.li.dic"),
        publicPath("cj7kl89.tmp"),
        publicPath("_migZip.xml"),
        publicPath("installation.json"),
      ];
      for (const file of files) {
        try {
          await fs.remove(file);
        } catch (e) {}
      }
      console.log("✅ Installation markers removed");
      return true;
    } catch (error) {
      console.error("Error uninstalling:", error);
      return false;
    }
  }
}

function initializeInstaller(app) {
  try {
    const wizard = new InstallWizard(app);
    wizard.init("/install");
    return wizard;
  } catch (error) {
    console.error("❌ Failed to initialize installer:", error.message);
    throw error;
  }
}

function createInstallationMiddleware() {
  return async (req, res, next) => {
    const pathStr = req.path || req.originalUrl || "";
    if (
      pathStr.includes("/install") ||
      pathStr.includes("/uploads") ||
      pathStr === "/favicon.ico" ||
      pathStr === "/health"
    ) {
      return next();
    }

    try {
      const isInstalled = await migSync();
      if (!isInstalled) {
        console.log(`⚠️ Installation not complete - redirecting to /install (path: ${pathStr})`);
        return res.redirect("/install");
      }
    } catch (error) {
      console.warn("⚠️ Could not check installation status:", error.message);
    }
    next();
  };
}

module.exports = {
  InstallWizard,
  initializeInstaller,
  createInstallationMiddleware,
};
