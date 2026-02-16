#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const projectDir = __dirname;
const contentDir = path.join(projectDir, 'content');
const manifestPath = path.join(contentDir, 'manifest.json');
const outputPath = path.join(projectDir, 'content-data.js');

// Read manifest
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

// Read each file listed in the manifest
const files = {};
for (const filename of manifest) {
  const filePath = path.join(contentDir, filename);
  let content = fs.readFileSync(filePath, 'utf8');
  // Escape backslashes, backticks, and template literal expressions
  content = content.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
  files[filename] = content;
}

// Build output
let output = 'const CONTENT_DATA = {\n';
output += '  manifest: ' + JSON.stringify(manifest, null, 2).replace(/\n/g, '\n  ') + ',\n';
output += '  files: {\n';

const entries = Object.entries(files);
entries.forEach(([filename, content], i) => {
  const comma = i < entries.length - 1 ? ',' : '';
  output += '    "' + filename + '": `' + content + '`' + comma + '\n';
});

output += '  }\n';
output += '};\n';

fs.writeFileSync(outputPath, output, 'utf8');
console.log('Wrote ' + outputPath + ' with ' + manifest.length + ' files from manifest.');
