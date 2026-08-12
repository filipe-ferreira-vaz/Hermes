const path = require('path');

/**
 * Portable path resolution — works both from the repo (npm start) and from
 * packaged executables (pkg). In packaged mode, __dirname points inside the
 * read-only snapshot, so all runtime writes (.env, hermes.db) go next to the
 * executable, which stays writable and portable.
 */

const IS_PACKAGED = typeof process.pkg !== 'undefined';

function resolveBaseDir() {
  if (IS_PACKAGED) return path.dirname(process.execPath);
  return path.join(__dirname, '..');
}

const baseDir = resolveBaseDir();

module.exports = {
  IS_PACKAGED,
  baseDir,
  envPath: path.join(baseDir, '.env'),
  dbPath: path.join(baseDir, 'hermes.db'),
  publicDir: path.join(__dirname, '..', 'public'),
  envTemplatePath: path.join(__dirname, '..', 'env.template'),
  sqlWasmDevPath: path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
  sqlWasmCachePath: path.join(baseDir, 'sql-wasm.wasm'),
};