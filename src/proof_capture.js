import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function captureProofAssets(workspacePath, { publicRoot = path.join(PACKAGE_ROOT, "public"), log = () => {} } = {}) {
  const out = path.resolve(workspacePath);
  const manifest = await optionalJson(path.join(out, "launchclip.json"));
  const terminal = await optionalText(path.join(out, "demo", "terminal.txt"));
  const receipt = await optionalJson(path.join(out, "demo", "command-receipt.json"));
  const source = manifest?.source_repo ?? {};
  const repoName = cleanText(source.name || path.basename(out), 42);
  const summary = cleanText(source.summary || source.package?.description || "working repo proof", 120);
  const command = cleanText(receipt?.command || firstTerminalCommand(terminal) || "launchclip direct <repo>", 72);
  const output = terminalOutput(terminal);
  const status = cleanText(receipt?.status || (terminal ? "captured" : "planned"), 20);
  const artifacts = packetArtifacts(out, receipt);
  const slug = `${slugify(repoName)}-${hashPath(out)}`;
  const shotsDir = path.join(publicRoot, "shots");
  await mkdir(shotsDir, { recursive: true });
  await mkdir(path.join(out, "video"), { recursive: true });

  const cards = [
    {
      name: "terminal",
      title: "Terminal receipt",
      svg: terminalSvg({ command, output, status }),
      description: `real terminal receipt; command: ${command}; status: ${status}; output: ${output || "not captured yet"}`
    },
    {
      name: "repo",
      title: "Repo context",
      svg: repoSvg({ repoName, summary, evidence: evidenceSources(out, manifest, terminal, receipt) }),
      description: `repo context card; name: ${repoName}; summary: ${summary}`
    },
    {
      name: "packet",
      title: "Generated packet",
      svg: packetSvg({ artifacts }),
      description: `artifact packet card; files: ${artifacts.map((artifact) => `${artifact.label} ${artifact.status}`).join(", ")}`
    }
  ];

  const assets = [];
  for (const card of cards) {
    const fileName = `proof-${slug}-${card.name}.svg`;
    await writeFile(path.join(shotsDir, fileName), card.svg);
    assets.push({
      path: `shots/${fileName}`,
      kind: `proof-${card.name}`,
      role: card.name === "terminal" ? "terminal_receipt" : "artifact_grid",
      description: card.description
    });
  }

  const proof = {
    schema_version: "launchclip.proof-assets.v1",
    source: { repo_name: repoName, summary },
    terminal: { command, output, status },
    artifacts,
    assets
  };
  await writeFile(path.join(out, "video", "proof-assets.json"), `${JSON.stringify(proof, null, 2)}\n`);
  log(`proof: captured ${assets.length} generated proof cards`);
  return proof;
}

function packetArtifacts(out, receipt) {
  const fromReceipt = (receipt?.artifacts ?? [])
    .map((artifact) => ({ label: labelForPath(artifact.path || artifact.type), path: artifact.path, status: receipt.status || "captured" }))
    .filter((artifact) => artifact.path);
  const expected = [
    ["Script", "video/script.json"],
    ["Teleprompter", "video/teleprompter.md"],
    ["Timeline", "video/motion-timeline.json"],
    ["Review", "REVIEW.md"],
    ["Render", "video/motion.mp4"]
  ].map(([label, relPath]) => ({ label, path: relPath, status: existsSync(path.join(out, relPath)) ? "ready" : "planned" }));
  return uniqueByPath([...fromReceipt, ...expected]).slice(0, 6);
}

function evidenceSources(out, manifest, terminal, receipt) {
  return [
    manifest ? "launchclip.json" : null,
    existsSync(path.join(out, "README.md")) ? "README.md" : null,
    existsSync(path.join(out, "package.json")) ? "package.json" : null,
    terminal ? "demo/terminal.txt" : null,
    receipt ? "demo/command-receipt.json" : null
  ].filter(Boolean);
}

function terminalSvg({ command, output, status }) {
  const lines = wrapLines(output || "No terminal output captured yet.", 44).slice(0, 5);
  return svgShell(`
    <rect x="36" y="48" width="828" height="504" rx="32" fill="#111310"/>
    <circle cx="86" cy="94" r="14" fill="#ff6b5f"/><circle cx="130" cy="94" r="14" fill="#ffd166"/><circle cx="174" cy="94" r="14" fill="#4fae85"/>
    <text x="676" y="102" font-size="24" font-weight="900" fill="#9ca3af">TERMINAL</text>
    <text x="72" y="164" font-size="36" font-weight="900" fill="#fffef7">Real command</text>
    <text x="72" y="234" font-family="Menlo, Consolas, monospace" font-size="32" font-weight="700" fill="#4fae85">$ ${escapeXml(command)}</text>
    ${lines.map((line, index) => `<text x="72" y="${312 + index * 42}" font-family="Menlo, Consolas, monospace" font-size="26" font-weight="700" fill="#d1d5db">${escapeXml(line)}</text>`).join("")}
    <rect x="642" y="476" width="164" height="48" rx="24" fill="#1f3b2d"/>
    <text x="684" y="509" font-size="22" font-weight="900" fill="#6ee7b7">${escapeXml(status.toUpperCase())}</text>
  `);
}

function repoSvg({ repoName, summary, evidence }) {
  const summaryLines = wrapLines(summary, 34).slice(0, 3);
  const evidenceLines = evidence.length ? evidence.slice(0, 4) : ["metadata fallback"];
  return svgShell(`
    <rect x="42" y="52" width="816" height="496" rx="34" fill="#fffefb" stroke="#ded8cc" stroke-width="3"/>
    <text x="78" y="142" font-size="30" font-weight="900" fill="#4fae85">REPO CONTEXT</text>
    <text x="78" y="202" font-family="Georgia, serif" font-size="48" font-weight="900" fill="#1a1a18">${escapeXml(repoName)}</text>
    ${summaryLines.map((line, index) => `<text x="78" y="${274 + index * 42}" font-size="30" font-weight="800" fill="#292824">${escapeXml(line)}</text>`).join("")}
    <text x="78" y="430" font-size="24" font-weight="900" fill="#737067">EVIDENCE</text>
    ${evidenceLines.map((line, index) => `<rect x="${78 + index * 190}" y="456" width="164" height="46" rx="23" fill="#e8f5ee"/><text x="${101 + index * 190}" y="486" font-size="20" font-weight="900" fill="#24664a">${escapeXml(line)}</text>`).join("")}
  `);
}

function packetSvg({ artifacts }) {
  return svgShell(`
    <rect x="42" y="52" width="816" height="496" rx="34" fill="#fffefb" stroke="#ded8cc" stroke-width="3"/>
    <text x="78" y="132" font-size="30" font-weight="900" fill="#7b5cff">PACKET RECEIPTS</text>
    ${artifacts.map((artifact, index) => {
      const y = 176 + index * 56;
      return `<rect x="78" y="${y - 32}" width="744" height="44" rx="22" fill="${artifact.status === "ready" || artifact.status === "passed" ? "#e8f5ee" : "#f3efe6"}"/>
      <text x="104" y="${y}" font-family="Georgia, serif" font-size="26" font-weight="900" fill="#1a1a18">${escapeXml(cleanText(artifact.label, 22))}</text>
      <text x="342" y="${y}" font-size="22" font-weight="800" fill="#737067">${escapeXml(cleanText(artifact.path, 34))}</text>
      <text x="700" y="${y}" font-size="18" font-weight="900" fill="#24664a">${escapeXml(cleanText(artifact.status.toUpperCase(), 12))}</text>`;
    }).join("")}
  `);
}

function svgShell(inner) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600" viewBox="0 0 900 600">
  <rect width="900" height="600" rx="36" fill="#fbfaf5"/>
  ${inner}
</svg>
`;
}

function terminalOutput(terminal) {
  return cleanText(String(terminal ?? "")
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("$ "))
    .join("\n")
    .trim(), 260);
}

function firstTerminalCommand(terminal) {
  const line = String(terminal ?? "").split(/\r?\n/).find((entry) => entry.trim().startsWith("$ "));
  return line ? line.replace(/^\s*\$\s*/, "") : "";
}

function wrapLines(text, maxChars) {
  const words = String(text ?? "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function cleanText(value, maxLength) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 3)).trim()}...` : text;
}

function labelForPath(value) {
  const base = path.basename(String(value ?? "artifact")).replace(/\.[^.]+$/, "");
  return cleanText(base.replace(/[-_]+/g, " "), 24) || "artifact";
}

function uniqueByPath(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (!item.path || seen.has(item.path)) return false;
    seen.add(item.path);
    return true;
  });
}

function slugify(value) {
  return String(value || "repo").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 36) || "repo";
}

function hashPath(value) {
  return createHash("sha1").update(String(value)).digest("hex").slice(0, 8);
}

function escapeXml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]);
}

async function optionalJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

async function optionalText(file) {
  try {
    return await readFile(file, "utf8");
  } catch {
    return null;
  }
}
