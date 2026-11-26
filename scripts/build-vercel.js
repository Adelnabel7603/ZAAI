const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const output = path.join(root, "dist");
const excluded = new Set([".git", ".data", "node_modules", "uploads", "dist", ".vercel"]);
const excludedFiles = new Set(["server.js", "package.json", "package-lock.json", "render.yaml", "vercel.json"]);

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });

function copyDirectory(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    if (entry.isDirectory()) copyDirectory(sourcePath, destinationPath);
    else if (entry.isFile() && !excludedFiles.has(entry.name)) fs.copyFileSync(sourcePath, destinationPath);
  }
}

copyDirectory(root, output);

const indexPath = path.join(output, "index.html");
const indexHtml = fs.readFileSync(indexPath, "utf8");
if (!indexHtml.includes('<base href="/">')) {
  const headIndex = indexHtml.indexOf("<head>");
  if (headIndex === -1) throw new Error("Could not find <head> in index.html.");
  const insertionPoint = headIndex + "<head>".length;
  const deploymentHtml = `${indexHtml.slice(0, insertionPoint)}\n        <base href="/">${indexHtml.slice(insertionPoint)}`;
  fs.writeFileSync(indexPath, deploymentHtml);
}
