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

// --- Markdown to HTML ---

function markdownToHtml(md, options) {
  const opts = options || {};
  // Strip illustration notes before parsing (they can span lines and merge with content)
  md = md.replace(/\*\[[\s\S]*?\]\*/g, '');
  // Strip lines containing only [TBD] placeholders
  if (opts.hideTBD) {
    md = md.split('\n').filter(function(line) {
      return !/\[TBD\]/.test(line);
    }).join('\n');
  }
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

    // Whole paragraph is a single bold span -> render as a heading
    if (formatted.indexOf('<strong>') === 0 && formatted.lastIndexOf('</strong>') === formatted.length - 9 && formatted.indexOf('<strong>', 1) === -1) {
      htmlParts.push('<p class="heading">' + formatted + '</p>');
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
    const pageType = meta.type || null;
    const hideTBD = pageType === 'back-cover' || pageType === 'spine';
    return {
      filename,
      label: meta.label || filename,
      page: meta.page || 0,
      type: pageType,
      bg: meta.bg || null,
      img: meta.img || null,
      img_pos: meta.img_pos || 'bottom-right',
      img_size: meta.img_size || 25,
      img_w: meta.img_w ? parseFloat(meta.img_w) : 65,
      img_caption_left: meta.img_caption_left || null,
      img_caption_right: meta.img_caption_right || null,
      img_flip: (meta.img_flip === false || meta.img_flip === 'false') ? false : true,
      chapter_start: (meta.chapter_start === true || meta.chapter_start === 'true') ? true : false,
      title: meta.title || null,
      html: markdownToHtml(body, { hideTBD: hideTBD })
    };
  }));

  return sections;
}

// --- Page building ---

function buildPage(section) {
  const pg = document.createElement('div');
  pg.className = 'pg';
  const pageNum = section.page;

  if (section.type === 'cover') {
    pg.classList.add('cover');
    pg.style.backgroundImage = 'url(' + COVER_IMG + ')';
    pg.innerHTML = '<div class="cover-text"><h1>THE<br>BIG WOBBLY BOOK<br>OF<br>SKATEBOARDING</h1><div class="sub">A Real, Actual, Legitimate Guide<br>(With Only Moderate Amounts of Silliness)</div></div>';
  } else if (section.type === 'back-cover') {
    pg.classList.add('back-cover');
    pg.style.backgroundImage = 'url(assets/illustrations/99-sunset-bg.jpg)';
    pg.innerHTML = '<div class="back-cover-text">' + section.html + '</div>';
  } else if (section.type === 'spine') {
    pg.classList.add('spine-page');
    pg.innerHTML = '<div class="spine-text">' + section.html + '</div>';
  } else if (section.type === 'dedication') {
    pg.classList.add('dedication');
    pg.style.backgroundImage = 'url(' + DED_IMG + ')';
    pg.innerHTML = '<div class="ded-text">' + section.html + '</div>';
  } else if (section.type === 'chart') {
    pg.classList.add('chart-page');
    const imgSrc = (typeof CONTENT_DATA !== 'undefined' && CONTENT_DATA.images && CONTENT_DATA.images[section.img])
      ? CONTENT_DATA.images[section.img]
      : section.img;
    const titleHtml = section.title ? '<div class="chart-title">' + section.title + '</div>' : '';
    pg.innerHTML = titleHtml + '<div class="chart-img" style="background-image:url(' + imgSrc + ')"></div><div class="chart-caption">' + section.html + '</div>';
    return pg;
  } else {
    pg.innerHTML = section.html;
  }

  // Parent epilogue pages get a softer, dedication-like treatment
  if (section.label && section.label.indexOf('Ch 9') !== -1) {
    pg.classList.add('parent-epilogue');
  }

  if (section.type === 'poem') {
    pg.classList.add('poem-page');
    pg.innerHTML = '<div class="poem-inner">' + section.html + '</div>';
    if (section.bg) pg.classList.add('has-bg-art');
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
    const imgW = section.img_w || 65;
    imgEl.style.width = imgW + '%';
    imgEl.style.height = imgW + '%';
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
      const hasCaptions = !!(section.img_caption_left || section.img_caption_right);
      const flip = section.img_flip;
      if (flip) imgEl.style.transform = 'scaleX(-1)';

      if (hasCaptions) {
        // Wrap the image so a caption row can sit under it without disturbing
        // the shape-outside float geometry (the wrap is sized to the image only;
        // the caption row overflows below via absolute positioning).
        const wrap = document.createElement('div');
        wrap.className = 'img-wrap';
        wrap.style.float = pos.includes('right') ? 'right' : 'left';
        wrap.style.width = imgW + '%';
        wrap.style.shapeMargin = '5px';
        wrap.style.margin = pos.includes('right') ? '-25px -20px 22px 8px' : '-25px 8px 22px -20px';

        imgEl.style.width = '100%';
        imgEl.style.height = '100%';
        imgEl.style.display = 'block';
        wrap.appendChild(imgEl);

        const capRow = document.createElement('div');
        capRow.className = 'img-caption-row';
        const leftCap = document.createElement('div');
        leftCap.className = 'img-caption';
        leftCap.textContent = section.img_caption_left || '';
        const rightCap = document.createElement('div');
        rightCap.className = 'img-caption';
        rightCap.textContent = section.img_caption_right || '';
        capRow.appendChild(leftCap);
        capRow.appendChild(rightCap);
        wrap.appendChild(capRow);

        const onImgReady = function() {
          try {
            const poly = computeShapePolygon(imgEl, flip);
            wrap.style.shapeOutside = poly;
          } catch(e) {
            // Fallback: no shape wrapping, just rectangular float
          }
        };
        if (imgEl.complete && imgEl.naturalWidth) onImgReady();
        else imgEl.onload = onImgReady;

        pg.insertBefore(wrap, pg.firstChild);
      } else {
        imgEl.style.float = pos.includes('right') ? 'right' : 'left';
        imgEl.style.position = 'relative';
        imgEl.style.shapeMargin = '5px';
        imgEl.style.margin = pos.includes('right') ? '-25px -20px 5px 8px' : '-25px 8px 5px -20px';
        // Compute polygon from alpha channel once image loads
        const onImgReady = function() {
          try {
            const poly = computeShapePolygon(imgEl, flip);
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
    }
  }

  // Remove illustration notes from pages that have actual images or special layouts
  if (section.bg || section.img || section.type === 'cover' || section.type === 'dedication' || section.type === 'back-cover' || section.type === 'spine') {
    pg.querySelectorAll('.il').forEach(el => el.remove());
  }

  // Drop cap for first page of content sections
  if (pageNum > 2 && section.type !== 'poem') {
    const firstP = pg.querySelector('p');
    if (firstP && !firstP.querySelector('strong') && firstP.textContent.length > 20) {
      pg.classList.add('has-dropcap');
    }
  }

  return pg;
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

  // Separate cover wrap pages from content pages
  const coverSection = sections.find(s => s.type === 'cover');
  const backCoverSection = sections.find(s => s.type === 'back-cover');
  const spineSection = sections.find(s => s.type === 'spine');
  const contentSections = sections.filter(s => s.type !== 'cover' && s.type !== 'back-cover' && s.type !== 'spine');

  // Build cover wrap: back cover (left) | cover with spine overlay (right)
  if (coverSection && backCoverSection) {
    const wrap = document.createElement('div');
    wrap.className = 'cover-wrap';

    const leftCol = createColumn('left-page');
    const backPg = buildPage(backCoverSection);
    leftCol.appendChild(backPg);

    const rightCol = createColumn('right-page');
    const coverPg = buildPage(coverSection);

    // Add spine as overlay on left edge of cover
    if (spineSection) {
      const spineOverlay = document.createElement('div');
      spineOverlay.className = 'spine-overlay';
      spineOverlay.innerHTML = '<div class="spine-text">' + spineSection.html + '</div>';
      coverPg.appendChild(spineOverlay);
    }

    rightCol.appendChild(coverPg);

    wrap.appendChild(leftCol);
    wrap.appendChild(rightCol);
    book.appendChild(wrap);
  }

  // Build remaining content pages
  const allPages = contentSections.map(section => ({
    pg: buildPage(section),
    num: section.page,
    type: section.type,
    bg: section.bg,
    chapter_start: section.chapter_start
  }));

  // Insert blank filler pages so every chapter opener starts on the LEFT (even index)
  const arranged = [];
  allPages.forEach(p => {
    if (p.chapter_start && arranged.length % 2 === 1) {
      arranged.push({ pg: (function(){ const b = document.createElement('div'); b.className = 'pg blank'; return b; })(), num: 0, type: 'blank', bg: null });
    }
    arranged.push(p);
  });

  // Arrange into spreads: pairs of pages
  let i = 0;

  while (i < arranged.length) {
    if (i + 1 < arranged.length) {
      const spread = createSpread();

      const leftCol = createColumn('left-page');
      leftCol.appendChild(arranged[i].pg);

      const spine = document.createElement('div');
      spine.className = 'spine';

      const rightCol = createColumn('right-page');
      rightCol.appendChild(arranged[i + 1].pg);

      spread.appendChild(leftCol);
      spread.appendChild(spine);
      spread.appendChild(rightCol);
      book.appendChild(spread);
      i += 2;
    } else {
      const spread = createSpread('single');
      const col = createColumn();
      col.appendChild(arranged[i].pg);
      spread.appendChild(col);
      book.appendChild(spread);
      i++;
    }
  }

  // Auto-fit: shrink text on overflowing pages
  setTimeout(autoFitPages, 100);
}

function autoFitPages() {
  document.querySelectorAll('.pg').forEach(pg => {
    if (pg.classList.contains('cover') || pg.classList.contains('back-cover') || pg.classList.contains('spine-page') || pg.classList.contains('dedication') || pg.classList.contains('chart-page') || pg.classList.contains('poem-page') || pg.classList.contains('blank')) return;

    const isOverlay = pg.classList.contains('has-overlay-img');
    const maxH = pg.clientHeight;
    let fontSize = isOverlay ? 8.5 : 10.5;
    const minFontSize = 6.5;
    const step = 0.25;

    pg.style.fontSize = fontSize + 'px';

    while (pg.scrollHeight > maxH && fontSize > minFontSize) {
      const beforeH = pg.scrollHeight;
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

      // Some overflow (e.g. a bottom-position image bleeding past the page
      // edge on purpose) isn't caused by text and won't shrink with font
      // size. Stop as soon as a step stops helping instead of grinding to
      // the floor for no visual benefit.
      if (pg.scrollHeight >= beforeH) break;
    }
  });
}

render();
