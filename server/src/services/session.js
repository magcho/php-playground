import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';

const PACKAGE_NAME_RE = /^[a-z0-9]([_.-]?[a-z0-9]+)*\/[a-z0-9]([_.-]?[a-z0-9]+)*$/i;
// Allow constraints like *, ^3.0, ~2.1, >=8.1, dev-main, 3.2.1
const VERSION_CONSTRAINT_RE = /^[a-zA-Z0-9*^~><=@v][a-zA-Z0-9._\-|*^~><=,@\s\/]{0,80}$/;

function defaultMeta() {
  return {
    id: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    phpVersion: '8.3',
    packages: {},
    lastRunAt: null,
  };
}

export class SessionStore {
  constructor(dataDir = config.dataDir) {
    this.root = path.join(dataDir, 'sessions');
  }

  async init() {
    await fs.mkdir(this.root, { recursive: true });
  }

  sessionDir(id) {
    return path.join(this.root, id);
  }

  metaPath(id) {
    return path.join(this.sessionDir(id), 'meta.json');
  }

  codePath(id) {
    return path.join(this.sessionDir(id), 'index.php');
  }

  async create() {
    const id = randomUUID();
    const dir = this.sessionDir(id);
    await fs.mkdir(dir, { recursive: true });
    const meta = { ...defaultMeta(), id };
    await fs.writeFile(this.metaPath(id), JSON.stringify(meta, null, 2));
    await fs.writeFile(this.codePath(id), config.defaultCode);
    return this.get(id);
  }

  async exists(id) {
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return false;
    try {
      await fs.access(this.metaPath(id));
      return true;
    } catch {
      return false;
    }
  }

  async get(id) {
    if (!(await this.exists(id))) return null;
    const meta = JSON.parse(await fs.readFile(this.metaPath(id), 'utf8'));
    const code = await fs.readFile(this.codePath(id), 'utf8');
    return { ...meta, code };
  }

  async touch(id) {
    const meta = JSON.parse(await fs.readFile(this.metaPath(id), 'utf8'));
    meta.updatedAt = new Date().toISOString();
    await fs.writeFile(this.metaPath(id), JSON.stringify(meta, null, 2));
    return meta;
  }

  async setCode(id, code) {
    if (typeof code !== 'string') throw new Error('code must be a string');
    if (Buffer.byteLength(code, 'utf8') > config.maxCodeBytes) {
      throw new Error(`code exceeds ${config.maxCodeBytes} bytes`);
    }
    await fs.writeFile(this.codePath(id), code);
    return this.touch(id);
  }

  async setPhpVersion(id, version) {
    if (!config.phpVersions[version]) {
      throw new Error(`unsupported PHP version: ${version}`);
    }
    const meta = JSON.parse(await fs.readFile(this.metaPath(id), 'utf8'));
    meta.phpVersion = version;
    meta.updatedAt = new Date().toISOString();
    await fs.writeFile(this.metaPath(id), JSON.stringify(meta, null, 2));
    return meta;
  }

  /**
   * @param {string} id
   * @param {Record<string, string>} packages
   */
  async setPackages(id, packages) {
    const normalized = validatePackages(packages);
    const meta = JSON.parse(await fs.readFile(this.metaPath(id), 'utf8'));
    meta.packages = normalized;
    meta.updatedAt = new Date().toISOString();
    await fs.writeFile(this.metaPath(id), JSON.stringify(meta, null, 2));
    return meta;
  }

  async markRun(id) {
    const meta = JSON.parse(await fs.readFile(this.metaPath(id), 'utf8'));
    meta.lastRunAt = new Date().toISOString();
    meta.updatedAt = meta.lastRunAt;
    await fs.writeFile(this.metaPath(id), JSON.stringify(meta, null, 2));
    return meta;
  }

  async cleanupExpired() {
    const cutoff = Date.now() - config.sessionTtlMs;
    let removed = 0;
    let entries = [];
    try {
      entries = await fs.readdir(this.root, { withFileTypes: true });
    } catch {
      return 0;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const metaFile = this.metaPath(entry.name);
      try {
        const meta = JSON.parse(await fs.readFile(metaFile, 'utf8'));
        const updated = Date.parse(meta.updatedAt || meta.createdAt || 0);
        if (!Number.isFinite(updated) || updated < cutoff) {
          await fs.rm(this.sessionDir(entry.name), { recursive: true, force: true });
          removed += 1;
        }
      } catch {
        // ignore corrupt sessions
      }
    }
    return removed;
  }
}

/**
 * Normalize and validate Composer package map. Throws on invalid input.
 * @param {Record<string, string>} packages
 * @returns {Record<string, string>}
 */
export function validatePackages(packages) {
  if (!packages || typeof packages !== 'object' || Array.isArray(packages)) {
    throw new Error('packages must be an object of name -> version');
  }
  const entries = Object.entries(packages);
  if (entries.length > config.maxPackages) {
    throw new Error(`at most ${config.maxPackages} packages allowed`);
  }
  const normalized = {};
  for (const [name, version] of entries) {
    if (!PACKAGE_NAME_RE.test(name)) {
      throw new Error(`invalid package name: ${name}`);
    }
    const ver = String(version || '*').trim() || '*';
    if (!VERSION_CONSTRAINT_RE.test(ver)) {
      throw new Error(`invalid version constraint for ${name}`);
    }
    normalized[name] = ver;
  }
  return normalized;
}

export { PACKAGE_NAME_RE, VERSION_CONSTRAINT_RE };
