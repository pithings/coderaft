// Minimal @vscode/windows-process-tree shim — replaces the Windows-only native
// addon with cross-platform process inspection using Node.js child_process.
//
// On non-Windows platforms, VS Code's terminal and task systems still call into
// this module but gracefully handle empty/undefined results — so returning
// minimal data is safe. On Linux/macOS we read from /proc or use `ps`.

const { execFile } = require("node:child_process");
const path = require("node:path");

const ProcessDataFlag = { None: 0, Memory: 1, CommandLine: 2 };

function getProcessTree(rootPid, callback, flags) {
  _getProcessList(rootPid, flags || ProcessDataFlag.None, (list) => {
    if (!list) return callback(undefined);
    callback(buildProcessTree(rootPid, list));
  });
}

// Support util.promisify
getProcessTree.__promisify__ = function (rootPid, flags) {
  return new Promise((resolve) => getProcessTree(rootPid, resolve, flags));
};

function getProcessList(rootPid, callback, flags) {
  _getProcessList(rootPid, flags || ProcessDataFlag.None, (list) => {
    callback(list || undefined);
  });
}

getProcessList.__promisify__ = function (rootPid, flags) {
  return new Promise((resolve) => getProcessList(rootPid, resolve, flags));
};

function getProcessCpuUsage(processList, callback) {
  // CPU usage tracking requires sampling over time — return 0 for all
  callback(processList.map((p) => ({ ...p, cpu: 0 })));
}

getProcessCpuUsage.__promisify__ = function (processList) {
  return new Promise((resolve) => getProcessCpuUsage(processList, resolve));
};

function buildProcessTree(rootPid, processList, maxDepth) {
  if (maxDepth === undefined) maxDepth = 256;
  const map = new Map();
  for (const p of processList) {
    map.set(p.pid, {
      pid: p.pid,
      ppid: p.ppid,
      name: p.name,
      memory: p.memory,
      commandLine: p.commandLine,
      children: [],
    });
  }
  let root;
  for (const p of processList) {
    const node = map.get(p.pid);
    if (p.pid === rootPid) {
      root = node;
    } else {
      const parent = map.get(p.ppid);
      if (parent) parent.children.push(node);
    }
  }
  if (root && maxDepth > 0) _pruneDepth(root, 0, maxDepth);
  return root;
}

function filterProcessList(rootPid, processList, maxDepth) {
  const tree = buildProcessTree(rootPid, processList, maxDepth);
  if (!tree) return undefined;
  const result = [];
  const queue = [tree];
  while (queue.length > 0) {
    const node = queue.shift();
    result.push({
      pid: node.pid,
      ppid: node.ppid || 0,
      name: node.name,
      memory: node.memory,
      commandLine: node.commandLine,
    });
    for (const child of node.children) queue.push(child);
  }
  return result;
}

// --- internal helpers ---

function _pruneDepth(node, depth, maxDepth) {
  if (depth >= maxDepth) {
    node.children = [];
    return;
  }
  for (const child of node.children) _pruneDepth(child, depth + 1, maxDepth);
}

function _getProcessList(rootPid, flags, callback) {
  if (process.platform === "win32") {
    _getProcessListWin32(rootPid, flags, callback);
  } else {
    _getProcessListUnix(rootPid, flags, callback);
  }
}

function _getProcessListUnix(rootPid, flags, callback) {
  const wantCmd = flags & ProcessDataFlag.CommandLine;
  // Use `args=` for full command line, `comm=` for just the process name.
  // `args=`/`comm=` must be last since they can contain spaces.
  const fmt = wantCmd ? "pid=,ppid=,rss=,args=" : "pid=,ppid=,rss=,comm=";
  const args = wantCmd ? ["-eww", "-o", fmt] : ["-e", "-o", fmt];
  execFile("ps", args, { maxBuffer: 1024 * 1024 }, (err, stdout) => {
    if (err) return callback(null);
    const list = [];
    for (const line of stdout.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parts = trimmed.split(/\s+/);
      if (parts.length < 4) continue;
      const pid = Number.parseInt(parts[0], 10);
      const ppid = Number.parseInt(parts[1], 10);
      const rss = Number.parseInt(parts[2], 10);
      const rest = parts.slice(3).join(" ");
      if (Number.isNaN(pid)) continue;
      const info = { pid, ppid, name: wantCmd ? path.basename(rest.split(" ")[0]) : rest };
      if (flags & ProcessDataFlag.Memory) info.memory = rss * 1024; // rss is in KB
      if (wantCmd) info.commandLine = rest;
      list.push(info);
    }
    callback(list.length > 0 ? list : null);
  });
}

function _getProcessListWin32(rootPid, flags, callback) {
  const args = ["process", "get", "ProcessId,ParentProcessId,WorkingSetSize,Name"];
  if (flags & ProcessDataFlag.CommandLine) {
    args[2] += ",CommandLine";
  }
  execFile("wmic", args, { maxBuffer: 1024 * 1024 }, (err, stdout) => {
    if (err) return callback(null);
    const lines = stdout.split("\n").filter((l) => l.trim());
    if (lines.length < 2) return callback(null);
    const list = [];
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].trim().split(/\s{2,}/);
      if (parts.length < 4) continue;
      // wmic output order: CommandLine?, Name, ParentProcessId, ProcessId, WorkingSetSize
      const hasCmd = flags & ProcessDataFlag.CommandLine;
      const offset = hasCmd ? 1 : 0;
      const name = parts[offset];
      const ppid = Number.parseInt(parts[offset + 1], 10);
      const pid = Number.parseInt(parts[offset + 2], 10);
      const ws = Number.parseInt(parts[offset + 3], 10);
      if (Number.isNaN(pid)) continue;
      const info = { pid, ppid, name };
      if (flags & ProcessDataFlag.Memory) info.memory = ws;
      if (hasCmd) info.commandLine = parts[0];
      list.push(info);
    }
    callback(list.length > 0 ? list : null);
  });
}

function getAllProcesses(callback, flags) {
  _getProcessList(0, flags || ProcessDataFlag.None, (list) => {
    callback(list || undefined);
  });
}

getAllProcesses.__promisify__ = function (flags) {
  return new Promise((resolve) => getAllProcesses(resolve, flags));
};

module.exports = {
  getProcessTree,
  getProcessList,
  getProcessCpuUsage,
  getAllProcesses,
  buildProcessTree,
  filterProcessList,
  ProcessDataFlag,
};
