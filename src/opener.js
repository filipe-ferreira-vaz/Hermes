const { spawn } = require('child_process');

/**
 * Open a URL in the OS default browser.
 *
 * Deliberately does NOT use the `open` npm package: it is ESM-only
 * (import.meta.url), which breaks when bundled into a pkg executable
 * (Node 18 inside the snapshot cannot require ESM). Spawning the system
 * opener directly works identically in dev and packaged mode.
 */
function openBrowser(url) {
  let command;
  let args;

  if (process.platform === 'darwin') {
    command = 'open';
    args = [url];
  } else if (process.platform === 'win32') {
    command = 'cmd';
    args = ['/c', 'start', '""', url];
  } else {
    command = 'xdg-open';
    args = [url];
  }

  try {
    const subprocess = spawn(command, args, { stdio: 'ignore', detached: true });
    subprocess.unref();
    subprocess.on('error', err => {
      console.error(`[Server] Failed to open browser (${command}):`, err.message);
    });
  } catch (err) {
    console.error('[Server] Failed to open browser:', err.message);
  }
}

module.exports = { openBrowser };