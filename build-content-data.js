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
const images = {};
for (const filename of manifest) {
  const filePath = path.join(contentDir, filename);
  let content = fs.readFileSync(filePath, 'utf8');
  // Check frontmatter for img references and embed as base64
  const imgMatch = content.match(/^img:\s*(.+)$/m);
  if (imgMatch) {
    const imgPath = path.join(projectDir, imgMatch[1].trim());
    if (fs.existsSync(imgPath)) {
      const imgData = fs.readFileSync(imgPath);
      const ext = path.extname(imgPath).slice(1);
      const mime = ext === 'jpg' ? 'image/jpeg' : 'image/' + ext;
      const dataUrl = 'data:' + mime + ';base64,' + imgData.toString('base64');
      images[imgMatch[1].trim()] = dataUrl;
    }
  }
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

output += '  },\n';
output += '  images: {\n';
const imgEntries = Object.entries(images);
imgEntries.forEach(([imgPath, dataUrl], i) => {
  const comma = i < imgEntries.length - 1 ? ',' : '';
  output += '    "' + imgPath + '": "' + dataUrl + '"' + comma + '\n';
});
output += '  }\n';
output += '};\n';

fs.writeFileSync(outputPath, output, 'utf8');
console.log('Wrote ' + outputPath + ' with ' + manifest.length + ' files from manifest.');
