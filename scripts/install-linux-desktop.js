#!/usr/bin/env node
/**
 * Install the Hermes shortcut on Fedora/Linux GNOME (or any freedesktop.org
 * desktop) so the dashboard appears in the app grid and can be pinned.
 *
 * Usage: npm run build && npm run install-desktop
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const DESKTOP = path.join(DIST, 'hermes.desktop');
const LOGO = path.join(DIST, 'Hermes-Logo.png');
const EXE = path.join(DIST, 'hermes-dashboard-linux-x64');
const ICONS_DIR = path.join(os.homedir(), '.local', 'share', 'icons');
const APPS_DIR = path.join(os.homedir(), '.local', 'share', 'applications');

if (!fs.existsSync(DESKTOP) || !fs.existsSync(EXE)) {
  console.error('dist/hermes.desktop or dist/hermes-linux-x64 missing. Run "npm run build" first.');
  process.exit(1);
}

fs.mkdirSync(APPS_DIR, { recursive: true });
fs.mkdirSync(ICONS_DIR, { recursive: true });

fs.copyFileSync(DESKTOP, path.join(APPS_DIR, 'hermes.desktop'));
fs.copyFileSync(LOGO, path.join(ICONS_DIR, 'hermes-logo.png'));

try {
  execFileSync('update-desktop-database', [APPS_DIR], { stdio: 'ignore' });
} catch {
  // optional, non-fatal
}

console.log('Hermes Dashboard installed in your app grid.');
console.log('Launch it from the Activities overview, or pin it to the dock.');
console.log(`Binary used: ${EXE}`);