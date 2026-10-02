"use strict";
const fs = require("fs");
const path = require("path");
const SRC_INDEX = path.join(__dirname, "index.html");
const SRC_MAIN = path.join(__dirname, "main.pjs");
const DIST = path.join(__dirname, "dist");
function readTitle() {
  try {
    const mjs = fs.readFileSync(SRC_MAIN, "utf8");
    const m = mjs.match(/^title\s*=\s*(.+)$/m);
    return m ? m[1].trim() : "Chat Room";
  } catch (e) { return "Chat Room"; }
}
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dest, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}
function build() {
  const html = fs.readFileSync(SRC_INDEX, "utf8");
  const title = readTitle();
  const out = html.split("[title]").join(title);
  fs.mkdirSync(DIST, { recursive: true });
  fs.writeFileSync(path.join(DIST, "index.html"), out);
  copyDir(path.join(__dirname, "css"), path.join(DIST, "css"));
  copyDir(path.join(__dirname, "js"), path.join(DIST, "js"));
  return { bytes: out.length, title };
}
if (require.main === module) {
  const r = build();
  console.log("exported dist/ (index " + r.bytes + " bytes, title=" + JSON.stringify(r.title) + ")");
}
module.exports = { build };
