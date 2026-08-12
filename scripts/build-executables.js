#!/usr/bin/env node
/**
 * Build standalone Hermes executables for Fedora/Linux, Windows and macOS.
 *
 * Uses pkg to embed the Node.js runtime + all code/assets into a single
 * binary per platform — users need no Node.js installation at all.
 *
 * Output (in ./dist):
 *   hermes-linux-x64          Fedora / Linux x86_64 (double-click or .desktop)
 *   hermes-win-x64.exe        Windows 64-bit (double-click)
 *   Hermes-darwin-x64.app/    macOS bundle — drag into /Applications
 *   Hermes-darwin-arm64.app/  macOS bundle for Apple Silicon
 *
 * Usage: npm run build
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const LOGO = path.join(ROOT, 'Hermes-Logo.png');

const TARGETS = [
  { platform: 'node18-linux-x64', file: 'hermes-dashboard-linux-x64', app: false },
  { platform: 'node18-win-x64', file: 'hermes-dashboard-win-x64.exe', app: false },
  { platform: 'node18-macos-x64', file: 'hermes-dashboard-macos-x64', app: true },
  { platform: 'node18-macos-arm64', file: 'hermes-dashboard-macos-arm64', app: true },
];

// Marker string embedded by every binary; used to verify the payload contains
// the app (a failed arm64 build previously produced empty payloads silently).
const PAYLOAD_MARKER = 'openBrowser';

function sh(cmd, args) {
  console.log(`\n> ${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, { stdio: 'inherit', cwd: ROOT });
}

function signForMacOs(binaryPath) {
  // macOS 13+ requires binaries to be signed (ad-hoc is enough). pkg on Linux
  // can't sign, so we use ldid when available; otherwise document the step.
  let ldid = null;
  for (const dir of ['/usr/local/bin', '/usr/bin', '/bin', ROOT]) {
    const candidate = path.join(dir, 'ldid');
    if (fs.existsSync(candidate)) {
      ldid = candidate;
      break;
    }
  }
  if (!ldid) {
    console.warn(`WARNING: ldid not found — ${binaryPath} is unsigned. On a Mac run: codesign --sign - "${binaryPath}"`);
    return;
  }
  try {
    execFileSync(ldid, ['-S', binaryPath], { stdio: 'ignore' });
    console.log(`Ad-hoc signed ${binaryPath}`);
  } catch (err) {
    console.warn(`WARNING: ad-hoc signing failed for ${binaryPath}: ${err.message}`);
  }
}

function makeMacApp(binaryName, appName) {
  const macosDir = path.join(DIST, `${appName}.app`, 'Contents', 'MacOS');
  fs.mkdirSync(macosDir, { recursive: true });

  const source = path.join(DIST, binaryName);
  const target = path.join(macosDir, 'Hermes');
  fs.copyFileSync(source, target);
  fs.chmodSync(target, 0o755);
  signForMacOs(source);

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Hermes</string>
  <key>CFBundleDisplayName</key><string>Hermes Dashboard</string>
  <key>CFBundleIdentifier</key><string>com.hermes.dashboard</string>
  <key>CFBundleExecutable</key><string>Hermes</string>
  <key>CFBundleVersion</key><string>1.0.0</string>
  <key>CFBundleShortVersionString</key><string>1.0.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSMinimumSystemVersion</key><string>10.15</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
`;
  fs.writeFileSync(path.join(DIST, `${appName}.app`, 'Contents', 'Info.plist'), plist);
  console.log(`Created ${appName}.app`);
}

function makeLinuxDesktopFile() {
  const exe = path.join(DIST, 'hermes-dashboard-linux-x64');
  const desktop = `[Desktop Entry]
Type=Application
Name=Hermes Dashboard
Comment=Google Calendar Email Automation Dashboard
Exec=${exe}
Icon=${LOGO}
Terminal=true
Categories=Office;Network;Utility;
StartupNotify=true
`;
  fs.writeFileSync(path.join(DIST, 'hermes.desktop'), desktop);
  console.log('Created dist/hermes.desktop — install on Fedora with:');
  console.log('  mkdir -p ~/.local/share/applications ~/.local/share/icons');
  console.log('  cp dist/hermes.desktop ~/.local/share/applications/');
  console.log('  cp dist/Hermes-Logo.png ~/.local/share/icons/');
}

function main() {
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });

  // macOS arm64: pkg generates bytecode by executing a target-arch binary,
  // which is impossible on an x86_64 host without QEMU/binfmt. --no-bytecode
  // --public embeds the JS as plain source instead (no QEMU needed).
  for (const t of TARGETS) {
    const args = ['pkg', '.', '--targets', t.platform, '--output', path.join(DIST, t.file)];
    if (t.platform === 'node18-macos-arm64') {
      args.push('--no-bytecode', '--public');
    }
    sh('npx', args);
  }

  for (const t of TARGETS) {
    const built = path.join(DIST, t.file);
    if (!fs.existsSync(built)) throw new Error(`Build failed, missing output: ${built}`);

    // Sanity check: the payload must actually contain the app code, otherwise
    // the binary would start the Node runtime and fail to find the entrypoint.
    const contents = fs.readFileSync(built);
    if (!contents.includes(Buffer.from(PAYLOAD_MARKER))) {
      throw new Error(`Build failed, payload missing app code: ${built} (no "${PAYLOAD_MARKER}" marker)`);
    }
    console.log(`Payload sanity check passed for ${t.file}`);

    if (t.app) makeMacApp(t.file, t.file.replace('hermes-macos-', 'Hermes-darwin-'));
    console.log(`Built ${t.file} (${t.platform})`);
  }

  fs.copyFileSync(LOGO, path.join(DIST, 'Hermes-Logo.png'));
  makeLinuxDesktopFile();

  console.log('\nDone. Executables are in ./dist — see README for per-OS notes.');
}

main();