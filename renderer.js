// Book renderer: loads markdown content files and renders the book preview

// Compute a polygon from an image's alpha channel for shape-outside
// Scans each row to find the leftmost opaque pixel, returns polygon points as percentages
function computeShapePolygon(imgEl, flip) {
  const canvas = document.createElement('canvas');
  const w = imgEl.naturalWidth;
  const h = imgEl.naturalHeight;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (flip) {
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(imgEl, 0, 0);
  const data = ctx.getImageData(0, 0, w, h).data;
  const step = Math.max(1, Math.floor(h / 30)); // ~30 sample rows
  const points = [];
  // Scan from top to bottom, find leftmost opaque pixel per row
  for (let y = 0; y < h; y += step) {
    let leftmost = w; // default to right edge (fully transparent row)
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 20) { // alpha > 20
        leftmost = x;
        break;
      }
    }
    points.push({ x: (leftmost / w) * 100, y: (y / h) * 100 });
  }
  // Close the polygon: go down the right side and back up
  points.push({ x: (points[points.length - 1].x), y: 100 });
  points.push({ x: 100, y: 100 });
  points.push({ x: 100, y: 0 });
  points.push({ x: (points[0].x), y: 0 });
  return 'polygon(' + points.map(p => p.x.toFixed(1) + '% ' + p.y.toFixed(1) + '%').join(', ') + ')';
}

const CONTENT_DIR = 'content/';
const COVER_IMG = 'assets/cover.jpg';
const DED_IMG = 'assets/dedication.jpg';

const CLOUD_SVGS = [
  '<svg viewBox="0 0 120 50" xmlns="http://www.w3.org/2000/svg"><ellipse cx="35" cy="32" rx="28" ry="16" fill="FILLc"/><ellipse cx="60" cy="26" rx="26" ry="20" fill="FILLc"/><ellipse cx="85" cy="32" rx="24" ry="15" fill="FILLc"/></svg>',
  '<svg viewBox="0 0 100 45" xmlns="http://www.w3.org/2000/svg"><ellipse cx="28" cy="28" rx="22" ry="14" fill="FILLc"/><ellipse cx="50" cy="22" rx="24" ry="18" fill="FILLc"/><ellipse cx="72" cy="28" rx="20" ry="13" fill="FILLc"/></svg>',
  '<svg viewBox="0 0 140 50" xmlns="http://www.w3.org/2000/svg"><ellipse cx="35" cy="32" rx="25" ry="15" fill="FILLc"/><ellipse cx="65" cy="25" rx="28" ry="20" fill="FILLc"/><ellipse cx="95" cy="30" rx="30" ry="16" fill="FILLc"/><ellipse cx="115" cy="34" rx="18" ry="12" fill="FILLc"/></svg>'
];

const CLOUD_BANDS = [
  { yMin: 5, yMax: 80 },
  { yMin: 130, yMax: 210 },
  { yMin: 260, yMax: 320 }
];

// --- Markdown to HTML ---

function markdownToHtml(md) {
  // Strip illustration notes before parsing (they can span lines and merge with content)
  md = md.replace(/\*\[[\s\S]*?\]\*/g, '');
  const lines = md.split('\n');
  const htmlParts = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Skip empty lines
    if (line.trim() === '') { i++; continue; }

    // Pullquote (poem-styled callout) - lines starting with ~~
    if (line.trimStart().startsWith('~~')) {
      let block = line.replace(/^\s*~~\s?/, '');
      i++;
      while (i < lines.length && lines[i].trim() !== '' && !lines[i].trimStart().startsWith('>')) {
        block += ' ' + lines[i];
        i++;
      }
      block = inlineFormat(block.trim());
      htmlParts.push('<div class="pullquote">' + block + '</div>');
      continue;
    }

    // Blockquote (parent note) - collect consecutive > lines
    if (line.trimStart().startsWith('>')) {
      let block = '';
      while (i < lines.length && lines[i].trimStart().startsWith('>')) {
        block += lines[i].replace(/^\s*>\s?/, '') + ' ';
        i++;
      }
      block = inlineFormat(block.trim());
      htmlParts.push('<div class="pn-note">' + block + '</div>');
      continue;
    }

    // Regular paragraph
    let para = line;
    i++;
    // Collect continuation lines (non-empty, non-blockquote)
    while (i < lines.length && lines[i].trim() !== '' && !lines[i].trimStart().startsWith('>')) {
      para += ' ' + lines[i];
      i++;
    }

    const formatted = inlineFormat(para.trim());

    // Check if this is an illustration note: *[...]*
    if (/^\*\[.*\]\*$/.test(para.trim())) {
      const noteText = formatted.replace(/^<em>\[/, '').replace(/\]<\/em>$/, '');
      htmlParts.push('<div class="il">' + noteText + '</div>');
      continue;
    }

    htmlParts.push('<p>' + formatted + '</p>');
  }

  return htmlParts.join('');
}

function inlineFormat(text) {
  // Bold+italic: ***text*** or **_text_**
  text = text.replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>');
  // Bold: **text**
  text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  // Italic: *text*
  text = text.replace(/\*(.*?)\*/g, '<em>$1</em>');
  // Escaped quotes
  text = text.replace(/\\"/g, '"');
  return text;
}

// --- Frontmatter parsing ---

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };

  const meta = {};
  match[1].split('\n').forEach(line => {
    const idx = line.indexOf(':');
    if (idx === -1) return;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    // Remove surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    // Try to parse as number
    if (/^\d+$/.test(val)) val = parseInt(val, 10);
    meta[key] = val;
  });

  return { meta, body: match[2] };
}

// --- File loading ---

async function loadContentFiles() {
  let mdFiles, getFileContent;

  if (typeof CONTENT_DATA !== 'undefined') {
    // Use inline data (works without a server)
    mdFiles = CONTENT_DATA.manifest;
    getFileContent = (filename) => CONTENT_DATA.files[filename];
  } else {
    // Fetch from server
    const manifestResp = await fetch(CONTENT_DIR + 'manifest.json');
    mdFiles = await manifestResp.json();
    getFileContent = async (filename) => {
      const r = await fetch(CONTENT_DIR + filename);
      return await r.text();
    };
  }

  const sections = await Promise.all(mdFiles.map(async (filename) => {
    const raw = await getFileContent(filename);
    const { meta, body } = parseFrontmatter(raw);
    return {
      filename,
      label: meta.label || filename,
      page: meta.page || 0,
      type: meta.type || null,
      bg: meta.bg || null,
      img: meta.img || null,
      img_pos: meta.img_pos || 'bottom-right',
      img_size: meta.img_size || 25,
      html: markdownToHtml(body)
    };
  }));

  return sections;
}

// --- Page building ---

function rectsOverlap(a, b, margin) {
  return !(a.right + margin < b.left || b.right + margin < a.left ||
           a.bottom + margin < b.top || b.bottom + margin < a.top);
}

function addClouds(pg, pageNum) {
  const seed = pageNum * 7;
  const pgRect = pg.getBoundingClientRect();

  // Get exclusion zones from pn-note elements (relative to pg)
  const exclusions = Array.from(pg.querySelectorAll('.pn-note')).map(el => {
    const r = el.getBoundingClientRect();
    return {
      left: r.left - pgRect.left,
      top: r.top - pgRect.top,
      right: r.right - pgRect.left,
      bottom: r.bottom - pgRect.top
    };
  });

  const margin = 10;

  CLOUD_BANDS.forEach((band, c) => {
    const w = 72 + ((seed * (c + 3) * 13) % 45);
    const h = w * 0.4;
    const edgeX = 15; // half of 30px left/right padding
    const edgeY = 14; // half of 28px top/bottom padding
    const pageW = 380;
    const pageH = 380;
    let x = edgeX + ((seed * (c + 1) * 37) % (pageW - w - edgeX * 2));
    let y = band.yMin + ((seed * (c + 2) * 19) % (band.yMax - band.yMin));
    // Clamp to keep clouds within half-margin of edges
    x = Math.max(edgeX, Math.min(x, pageW - w - edgeX));
    y = Math.max(edgeY, Math.min(y, pageH - h - edgeY));

    const cloudRect = { left: x, top: y, right: x + w, bottom: y + h };

    // Skip clouds in bottom half of pages with overlay images
    if (pg.classList.contains('has-overlay-img') && y > 190) return;

    // Skip this cloud if it overlaps any exclusion zone
    const overlaps = exclusions.some(ex => rectsOverlap(cloudRect, ex, margin));
    if (overlaps) return;

    const cloud = document.createElement('div');
    cloud.className = 'cloud cloud-' + c;
    const op = 1;
    const svgIdx = (seed + c) % CLOUD_SVGS.length;
    cloud.innerHTML = CLOUD_SVGS[svgIdx].replace(/FILLc/g, '#F3D7C7');
    cloud.style.width = w + 'px';
    cloud.style.left = x + 'px';
    cloud.style.top = y + 'px';
    cloud.style.opacity = op;
    pg.appendChild(cloud);
  });
}

function buildPage(section) {
  const pg = document.createElement('div');
  pg.className = 'pg';
  const pageNum = section.page;

  if (section.type === 'cover') {
    pg.classList.add('cover');
    pg.style.backgroundImage = 'url(' + COVER_IMG + ')';
    pg.innerHTML = '<div class="cover-text"><h1>THE<br>BIG WOBBLY BOOK<br>OF<br>SKATEBOARDING</h1><div class="sub">A Real, Actual, Legitimate Guide<br>(With Only Moderate Amounts of Silliness)</div></div>';
  } else if (section.type === 'dedication') {
    pg.classList.add('dedication');
    pg.style.backgroundImage = 'url(' + DED_IMG + ')';
    pg.innerHTML = '<div class="ded-text">' + section.html + '</div>';
  } else {
    pg.innerHTML = section.html;
  }

  if (section.type === 'poem') {
    pg.classList.add('poem-page');
  }

  // Background image from frontmatter
  if (section.bg) {
    pg.style.backgroundImage = 'url(' + section.bg + ')';
    pg.style.backgroundSize = 'cover';
    pg.style.backgroundPosition = 'center';
  }

  // Overlay image (transparent PNG with text wrapping around shape)
  if (section.img) {
    pg.classList.add('has-overlay-img');
    const imgEl = document.createElement('img');
    // Use embedded base64 data URL if available (avoids CORS issues in Safari)
    const imgSrc = (typeof CONTENT_DATA !== 'undefined' && CONTENT_DATA.images && CONTENT_DATA.images[section.img])
      ? CONTENT_DATA.images[section.img]
      : section.img;
    if (window.location.protocol !== 'file:' && !imgSrc.startsWith('data:')) {
      imgEl.crossOrigin = 'anonymous';
    }
    imgEl.src = imgSrc;
    imgEl.style.width = '65%';
    imgEl.style.height = '65%';
    imgEl.style.objectFit = 'contain';
    imgEl.style.pointerEvents = 'none';
    imgEl.style.zIndex = '2';
    const pos = section.img_pos || 'bottom-right';

    if (pos.includes('bottom')) {
      // Bottom images: absolute position (text sits above)
      imgEl.style.position = 'absolute';
      imgEl.style.bottom = '-25px';
      if (pos.includes('right')) imgEl.style.right = '20px';
      else imgEl.style.left = '8px';
      pg.appendChild(imgEl);
    } else {
      // Top images: float with shape-outside polygon for text wrapping
      imgEl.style.float = pos.includes('right') ? 'right' : 'left';
      imgEl.style.position = 'relative';
      imgEl.style.transform = 'scaleX(-1)';
      imgEl.style.shapeMargin = '5px';
      imgEl.style.margin = pos.includes('right') ? '-25px -20px 5px 8px' : '-25px 8px 5px -20px';
      // Compute polygon from alpha channel once image loads
      const onImgReady = function() {
        try {
          const poly = computeShapePolygon(imgEl, true);
          imgEl.style.shapeOutside = poly;
        } catch(e) {
          // Fallback: no shape wrapping, just rectangular float
        }
      };
      if (imgEl.complete && imgEl.naturalWidth) onImgReady();
      else imgEl.onload = onImgReady;
      // Insert at the top of content
      pg.insertBefore(imgEl, pg.firstChild);
    }

    // Position parent notes to the left of the image
    pg.querySelectorAll('.pn-note').forEach(note => {
      note.style.position = 'absolute';
      note.style.bottom = '120px';
      note.style.left = '30px';
      note.style.width = '40%';
      note.style.margin = '0';
    });
  }

  // Remove illustration notes from pages that have actual images
  if (section.bg || section.img || section.type === 'cover' || section.type === 'dedication') {
    pg.querySelectorAll('.il').forEach(el => el.remove());
  }

  return pg;
}

function buildFooter(pg) {
  const footer = document.createElement('div');
  footer.className = 'page-footer';
  pg.querySelectorAll('.il').forEach(il => {
    const d = document.createElement('div');
    d.className = 'il-note';
    d.textContent = '\u{1F3A8} ' + il.textContent.trim();
    footer.appendChild(d);
  });
  return footer;
}

function createSpreadBreak() {
  const divider = document.createElement('div');
  divider.className = 'spread-break';
  divider.innerHTML = '<span class="spread-break-dot"></span>';
  return divider;
}

function createSpread(className) {
  const spread = document.createElement('div');
  spread.className = 'spread' + (className ? ' ' + className : '');
  return spread;
}

function createColumn(className) {
  const col = document.createElement('div');
  col.className = 'spread-column' + (className ? ' ' + className : '');
  return col;
}

// --- Main render ---

async function render() {
  const book = document.getElementById('book');
  book.innerHTML = '';

  const sections = await loadContentFiles();

  // Build all pages
  const allPages = sections.map(section => ({
    pg: buildPage(section),
    num: section.page,
    type: section.type,
    bg: section.bg
  }));

  // Arrange into spreads: page 1 alone, then pairs
  let i = 0;
  let firstSpread = true;

  while (i < allPages.length) {
    if (!firstSpread) book.appendChild(createSpreadBreak());
    firstSpread = false;

    if (i === 0) {
      const spread = createSpread('single');
      const col = createColumn();
      col.appendChild(allPages[0].pg);
      col.appendChild(buildFooter(allPages[0].pg));
      spread.appendChild(col);
      book.appendChild(spread);
      i = 1;
    } else if (i + 1 < allPages.length) {
      const spread = createSpread();

      const leftCol = createColumn('left-page');
      leftCol.appendChild(allPages[i].pg);
      leftCol.appendChild(buildFooter(allPages[i].pg));

      const spine = document.createElement('div');
      spine.className = 'spine';

      const rightCol = createColumn('right-page');
      rightCol.appendChild(allPages[i + 1].pg);
      rightCol.appendChild(buildFooter(allPages[i + 1].pg));

      spread.appendChild(leftCol);
      spread.appendChild(spine);
      spread.appendChild(rightCol);
      book.appendChild(spread);
      i += 2;
    } else {
      const spread = createSpread('single');
      const col = createColumn();
      col.appendChild(allPages[i].pg);
      col.appendChild(buildFooter(allPages[i].pg));
      spread.appendChild(col);
      book.appendChild(spread);
      i++;
    }
  }

  // Add clouds now that pages are in the DOM and have layout
  allPages.forEach(p => {
    if (p.type !== 'cover' && p.type !== 'dedication' && !p.bg) {
      addClouds(p.pg, p.num);
    }
  });

  // Auto-fit: shrink text on overflowing pages
  setTimeout(autoFitPages, 100);
}

function autoFitPages() {
  document.querySelectorAll('.pg').forEach(pg => {
    if (pg.classList.contains('cover') || pg.classList.contains('dedication') || pg.classList.contains('has-overlay-img')) return;

    const maxH = pg.clientHeight;
    let fontSize = 10.5;
    const minFontSize = 7;
    const step = 0.25;

    pg.style.fontSize = fontSize + 'px';

    while (pg.scrollHeight > maxH && fontSize > minFontSize) {
      fontSize -= step;
      pg.style.fontSize = fontSize + 'px';
      const lh = 1.35 + (fontSize - minFontSize) / (10.5 - minFontSize) * 0.2;
      pg.style.lineHeight = lh.toFixed(2);

      const pMargin = Math.max(2, Math.round((fontSize - minFontSize) / (10.5 - minFontSize) * 7));
      pg.querySelectorAll('p').forEach(p => p.style.marginBottom = pMargin + 'px');

      pg.querySelectorAll('.pn-note').forEach(n => {
        n.style.fontSize = Math.max(6.5, fontSize - 1.5) + 'px';
        n.style.padding = '4px 6px';
        n.style.margin = Math.max(3, pMargin) + 'px 0';
      });
    }
  });
}

render();
