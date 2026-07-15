// Book renderer: loads markdown content files and renders the book preview

// --- Page geometry (single source of truth) ---
// The page is 380x380 with CSS padding 28px 30px. The "safe inset" is exactly
// that padding: no image edge may cross it (the one exception is full-bleed).
// Every placement below is expressed against these numbers so art never hangs
// off the page the way the old negative-margin bottom images did.
const PAGE_W = 380;
const PAGE_H = 380;
const SAFE = { top: 28, right: 30, bottom: 28, left: 30 };
const CONTENT_W = PAGE_W - SAFE.left - SAFE.right; // 320px usable width
const SHAPE_MARGIN = 7; // breathing room between wrapped text and the art contour

// Compute a polygon from an image's alpha channel for shape-outside.
// The polygon must trace the edge of the art that FACES the text:
//   - float:left  -> text wraps on the RIGHT, so trace the rightmost opaque
//                    pixel of each row and keep the left side of the box solid.
//   - float:right -> text wraps on the LEFT, so trace the leftmost opaque pixel
//                    and keep the right side of the box solid.
// `flip` mirrors the sampled alpha to match a CSS scaleX(-1) on the element, so
// the contour still lines up with what is actually drawn.
function computeShapePolygon(imgEl, floatSide, flip) {
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
  const step = Math.max(1, Math.floor(h / 40)); // ~40 sample rows for a smooth contour
  const points = [];

  if (floatSide === 'left') {
    // Solid down the left edge, contour traced on the right (facing the text).
    points.push({ x: 0, y: 0 });
    for (let y = 0; y < h; y += step) {
      let rightmost = 0; // transparent row -> collapse to 0 so text flows full width there
      for (let x = w - 1; x >= 0; x--) {
        if (data[(y * w + x) * 4 + 3] > 20) { rightmost = x + 1; break; }
      }
      points.push({ x: (rightmost / w) * 100, y: (y / h) * 100 });
    }
    points.push({ x: 0, y: 100 });
  } else {
    // Solid down the right edge, contour traced on the left (facing the text).
    points.push({ x: 100, y: 0 });
    for (let y = 0; y < h; y += step) {
      let leftmost = w; // transparent row -> collapse to 100 so text flows full width there
      for (let x = 0; x < w; x++) {
        if (data[(y * w + x) * 4 + 3] > 20) { leftmost = x; break; }
      }
      points.push({ x: (leftmost / w) * 100, y: (y / h) * 100 });
    }
    points.push({ x: 100, y: 100 });
  }

  return 'polygon(' + points.map(p => p.x.toFixed(1) + '% ' + p.y.toFixed(1) + '%').join(', ') + ')';
}

const CONTENT_DIR = 'content/';
const COVER_IMG = 'assets/cover.jpg';
const DED_IMG = 'assets/dedication.jpg';

// --- Decorative clouds (soft pink background texture) ---
// Restored from the older renderer, improved: clouds are placed against the
// real rendered geometry of every text block and image on the page, stay inside
// the safe inset, and never sit under content. Fill is a low-opacity pink so
// they read as texture, never as foreground.
const CLOUD_SVGS = [
  '<svg viewBox="0 0 120 50" xmlns="http://www.w3.org/2000/svg"><ellipse cx="35" cy="32" rx="28" ry="16" fill="FILLc"/><ellipse cx="60" cy="26" rx="26" ry="20" fill="FILLc"/><ellipse cx="85" cy="32" rx="24" ry="15" fill="FILLc"/></svg>',
  '<svg viewBox="0 0 100 45" xmlns="http://www.w3.org/2000/svg"><ellipse cx="28" cy="28" rx="22" ry="14" fill="FILLc"/><ellipse cx="50" cy="22" rx="24" ry="18" fill="FILLc"/><ellipse cx="72" cy="28" rx="20" ry="13" fill="FILLc"/></svg>',
  '<svg viewBox="0 0 140 50" xmlns="http://www.w3.org/2000/svg"><ellipse cx="35" cy="32" rx="25" ry="15" fill="FILLc"/><ellipse cx="65" cy="25" rx="28" ry="20" fill="FILLc"/><ellipse cx="95" cy="30" rx="30" ry="16" fill="FILLc"/><ellipse cx="115" cy="34" rx="18" ry="12" fill="FILLc"/></svg>'
];
const CLOUD_FILL = '#F3D7C7';
const CLOUD_OPACITY = 0.5;

// --- Markdown to HTML ---

function markdownToHtml(md, options) {
  const opts = options || {};
  // Strip illustration notes before parsing (they can span lines and merge with content)
  md = md.replace(/\*\[[\s\S]*?\]\*/g, '');

  // Poem mode: preserve each source line as its own centered line of verse.
  // Blank lines become stanza breaks. This keeps poems reading as poems
  // instead of collapsing into one wrapped prose block.
  if (opts.poem) {
    const out = [];
    md.split('\n').forEach(function(raw) {
      const t = raw.trim();
      if (t === '') { out.push('<p class="stanza-gap"></p>'); return; }
      const f = inlineFormat(t);
      // A whole-line bold span (e.g. THE END) becomes an emphasized refrain line.
      if (/^<strong>[\s\S]*<\/strong>$/.test(f) && f.indexOf('<strong>', 1) === -1) {
        out.push('<p class="poem-refrain">' + f + '</p>');
      } else {
        out.push('<p class="poem-line">' + f + '</p>');
      }
    });
    // Collapse leading/trailing/duplicate stanza gaps
    return out.join('')
      .replace(/^(?:<p class="stanza-gap"><\/p>)+/, '')
      .replace(/(?:<p class="stanza-gap"><\/p>)+$/, '')
      .replace(/(?:<p class="stanza-gap"><\/p>){2,}/g, '<p class="stanza-gap"></p>');
  }
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
      img_w_set: meta.img_w !== undefined && meta.img_w !== '', // was img_w explicit?
      img_caption_left: meta.img_caption_left || null,
      img_caption_right: meta.img_caption_right || null,
      img_flip: (meta.img_flip === false || meta.img_flip === 'false') ? false : true,
      chapter_start: (meta.chapter_start === true || meta.chapter_start === 'true') ? true : false,
      title: meta.title || null,
      html: markdownToHtml(body, { hideTBD: hideTBD, poem: pageType === 'poem' })
    };
  }));

  return sections;
}

// --- Page building ---

// Axis-aligned rectangle overlap test with a slack margin.
function rectsOverlap(a, b, margin) {
  return !(a.right + margin < b.left || b.right + margin < a.left ||
           a.bottom + margin < b.top || b.bottom + margin < a.top);
}

// Place 2-3 decorative clouds on a page without ever covering content.
// Exclusion zones are read from the ACTUAL rendered geometry of every text
// block and image, so a cloud can only land in genuinely empty space inside the
// safe inset. Dense pages simply get fewer (or zero) clouds, which is fine:
// they read as background texture, not a required element.
function addClouds(pg, pageNum) {
  // Clear any clouds from a previous layout pass so re-runs don't stack.
  pg.querySelectorAll('.cloud').forEach(c => c.remove());

  const pgRect = pg.getBoundingClientRect();
  if (!pgRect.width) return;
  // Scale factor: on small screens the page is rendered smaller than 380px, so
  // convert measured client rects back into the 380-based coordinate space the
  // placement math (and inline left/top in px) assumes.
  const scale = PAGE_W / pgRect.width;

  const exclusions = [];
  // .img-caption-row is absolutely positioned at top:100% of its .img-wrap, so
  // its bbox sits OUTSIDE the wrap's rect and must be excluded in its own right
  // (otherwise a cloud can land on the caption text, e.g. Goofy/Regular on the
  // stance page). Its getBoundingClientRect still measures correctly.
  pg.querySelectorAll('p, .heading, .pn-note, .pullquote, img, .img-wrap, .img-caption-row').forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    exclusions.push({
      left: (r.left - pgRect.left) * scale,
      top: (r.top - pgRect.top) * scale,
      right: (r.right - pgRect.left) * scale,
      bottom: (r.bottom - pgRect.top) * scale
    });
  });

  // Deterministic per-page RNG so cloud placement is stable across renders.
  let s = pageNum * 9301 + 49297;
  const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };

  const target = 2 + Math.floor(rnd() * 2); // 2 or 3 clouds
  const gap = 8; // keep clouds this far from any text/art and from each other
  const placed = [];
  let tries = 0;

  while (placed.length < target && tries < 80) {
    tries++;
    const svgIdx = Math.floor(rnd() * CLOUD_SVGS.length);
    const vb = CLOUD_SVGS[svgIdx].match(/viewBox="0 0 (\d+) (\d+)"/); // real aspect
    const aspect = vb ? (parseInt(vb[2], 10) / parseInt(vb[1], 10)) : 0.42;
    const w = 58 + Math.floor(rnd() * 42); // 58-100px wide
    const h = w * aspect; // height from the SVG's own aspect so bounds are exact
    // Keep the whole cloud inside the safe inset.
    const xRange = PAGE_W - SAFE.left - SAFE.right - w;
    const yRange = PAGE_H - SAFE.top - SAFE.bottom - h;
    if (xRange <= 0 || yRange <= 0) continue;
    const x = SAFE.left + rnd() * xRange;
    const y = SAFE.top + rnd() * yRange;
    const rect = { left: x, top: y, right: x + w, bottom: y + h };

    if (exclusions.some(ex => rectsOverlap(rect, ex, gap))) continue;
    if (placed.some(p => rectsOverlap(rect, p, gap * 2))) continue;

    placed.push(rect);
    const cloud = document.createElement('div');
    cloud.className = 'cloud';
    cloud.innerHTML = CLOUD_SVGS[svgIdx].replace(/FILLc/g, CLOUD_FILL);
    const svg = cloud.querySelector('svg');
    if (svg) { svg.style.width = '100%'; svg.style.height = 'auto'; svg.style.display = 'block'; }
    cloud.style.position = 'absolute';
    // Percentages so clouds scale/track the page when it renders smaller than
    // 380px (mobile) instead of overflowing in fixed pixels.
    cloud.style.width = (w / PAGE_W * 100).toFixed(2) + '%';
    cloud.style.left = (x / PAGE_W * 100).toFixed(2) + '%';
    cloud.style.top = (y / PAGE_H * 100).toFixed(2) + '%';
    cloud.style.opacity = CLOUD_OPACITY;
    cloud.style.zIndex = '0';
    cloud.style.pointerEvents = 'none';
    pg.appendChild(cloud);
  }
}

// Insert a floated element at the right point in the text flow.
//   - top floats go before the first child, so text wraps from the very top.
//   - mid floats go before the SECOND body paragraph, so the first body
//     paragraph sits full-width above the art and the rest wraps beside it (art
//     in the middle band). Heading paragraphs (CHAPTER X / subtitle) are NOT
//     counted, otherwise the float drops right under the first heading instead
//     of into the true middle band. Falls back to the top if there is no
//     second body paragraph.
function insertFloat(pg, el, isMid) {
  if (isMid) {
    const body = [...pg.querySelectorAll(':scope > p')].filter(p => !p.classList.contains('heading'));
    if (body.length >= 2) { pg.insertBefore(el, body[1]); return; }
  }
  pg.insertBefore(el, pg.firstChild);
}

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

  // Overlay image. One safe-inset rule governs every placement: an image edge
  // never crosses the page padding unless the placement is explicitly full-bleed.
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
    const flip = section.img_flip;
    imgEl.style.objectFit = 'contain';
    imgEl.style.pointerEvents = 'none';

    const pos = section.img_pos || 'bottom-right';
    // Classify the placement. Order matters: full-bleed and bottom-half are
    // checked before the generic "bottom" / "mid" / "top" family. bottom-half is
    // decided first so a large img_w (its band-height percent) can't be
    // misread as a full-bleed trigger.
    const isBottomHalf = pos === 'bottom-half';
    const isFullBleed = !isBottomHalf && (pos === 'full-bleed' || imgW >= 95);
    const isBottom = !isBottomHalf && pos.indexOf('bottom') === 0;
    const isMid = pos.indexOf('mid') === 0;
    const floatSide = pos.indexOf('right') !== -1 ? 'right' : 'left';

    if (isFullBleed) {
      // Edge-to-edge art that fills the whole page; sits behind the text layer.
      pg.classList.add('img-full-bleed');
      imgEl.style.position = 'absolute';
      imgEl.style.top = '0';
      imgEl.style.left = '0';
      imgEl.style.width = '100%';
      imgEl.style.height = '100%';
      imgEl.style.objectFit = 'cover';
      imgEl.style.zIndex = '0';
      if (flip) imgEl.style.transform = 'scaleX(-1)';
      pg.insertBefore(imgEl, pg.firstChild);

    } else if (isBottom || isBottomHalf) {
      // Bottom-anchored art lives INSIDE the safe area (bottom:SAFE.bottom), and
      // an in-flow spacer of matching height reserves room so text stops cleanly
      // above the art instead of the old bleed-past-the-edge trick.
      imgEl.style.position = 'absolute';
      imgEl.style.bottom = SAFE.bottom + 'px';
      imgEl.style.zIndex = '2';
      let bandH;
      if (isBottomHalf) {
        // Fills the bottom band of the page, centered (for chapter openers).
        // img_w tunes the band height as a percent of page height (clamped
        // 30-60); default 48% when img_w is not explicitly set.
        const bandPct = section.img_w_set ? Math.max(30, Math.min(60, imgW)) : 48;
        bandH = Math.round(PAGE_H * bandPct / 100);
        imgEl.style.height = bandH + 'px';
        imgEl.style.width = 'auto';
        imgEl.style.maxWidth = CONTENT_W + 'px';
        imgEl.style.left = '50%';
        imgEl.style.transform = 'translateX(-50%)' + (flip ? ' scaleX(-1)' : '');
      } else {
        // bottom-left / bottom-center / bottom-right, width via img_w (% of the
        // usable content width so it matches the float sizing convention).
        const wpx = Math.min(CONTENT_W, Math.round(CONTENT_W * imgW / 100));
        imgEl.style.width = wpx + 'px';
        imgEl.style.height = 'auto';
        if (pos.indexOf('center') !== -1) {
          imgEl.style.left = '50%';
          imgEl.style.transform = 'translateX(-50%)' + (flip ? ' scaleX(-1)' : '');
        } else if (floatSide === 'right') {
          imgEl.style.right = SAFE.right + 'px';
          if (flip) imgEl.style.transform = 'scaleX(-1)';
        } else {
          imgEl.style.left = SAFE.left + 'px';
          if (flip) imgEl.style.transform = 'scaleX(-1)';
        }
      }
      pg.appendChild(imgEl);

      // In-flow spacer reserves the bottom band so autofit measures the real
      // available text height (page height minus the reserved image band).
      const spacer = document.createElement('div');
      spacer.className = 'img-spacer';
      spacer.style.clear = 'both';
      spacer.style.width = '100%';
      spacer.style.pointerEvents = 'none';
      pg.appendChild(spacer);
      const setBand = function() {
        const bh = isBottomHalf ? bandH : imgEl.offsetHeight;
        spacer.style.height = (bh + 8) + 'px'; // +8px gap between text and art
        scheduleLayout();
      };
      if (isBottomHalf) { setBand(); }
      else if (imgEl.complete && imgEl.naturalWidth) { setBand(); }
      else { imgEl.onload = setBand; }

    } else {
      // Floated art (top-left / top-right / mid-left / mid-right) with an honest
      // alpha-shape wrap on the side that faces the text. Outer margin is 0 so
      // the art sits exactly at the safe inset; shape-margin gives text room.
      const hasCaptions = !!(section.img_caption_left || section.img_caption_right);
      if (flip) imgEl.style.transform = 'scaleX(-1)';
      imgEl.style.zIndex = '2';
      // Float outer edge flush to the safe inset; small inner + bottom gaps.
      const floatMargin = (isMid ? '4px ' : '0 ') +
        (floatSide === 'right' ? '0 8px 6px' : '8px 6px 0');

      if (hasCaptions) {
        // Wrap the image so a caption row can sit under it without disturbing
        // the shape-outside float geometry.
        const wrap = document.createElement('div');
        wrap.className = 'img-wrap';
        wrap.style.float = floatSide;
        wrap.style.width = imgW + '%';
        wrap.style.shapeMargin = SHAPE_MARGIN + 'px';
        wrap.style.margin = floatMargin;

        imgEl.style.width = '100%';
        imgEl.style.height = 'auto';
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
          try { wrap.style.shapeOutside = computeShapePolygon(imgEl, floatSide, flip); }
          catch(e) { /* Fallback: rectangular float */ }
          scheduleLayout();
        };
        if (imgEl.complete && imgEl.naturalWidth) onImgReady();
        else imgEl.onload = onImgReady;

        insertFloat(pg, wrap, isMid);
      } else {
        imgEl.style.float = floatSide;
        imgEl.style.width = imgW + '%';
        imgEl.style.height = 'auto';
        imgEl.style.shapeMargin = SHAPE_MARGIN + 'px';
        imgEl.style.margin = floatMargin;
        const onImgReady = function() {
          try { imgEl.style.shapeOutside = computeShapePolygon(imgEl, floatSide, flip); }
          catch(e) { /* Fallback: rectangular float */ }
          scheduleLayout();
        };
        if (imgEl.complete && imgEl.naturalWidth) onImgReady();
        else imgEl.onload = onImgReady;
        insertFloat(pg, imgEl, isMid);
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

  // Chapter placement. Every chapter already starts at the top of its own
  // fresh page. Forcing each opener onto the LEFT page also injects blank
  // filler pages, which made the back half read as broken and sparse next to
  // the dense, continuous front half. Off by default: chapters flow. Flip to
  // true to restore left-page openers (with blank fillers where needed).
  const FORCE_CHAPTER_LEFT = false;
  const arranged = [];
  allPages.forEach(p => {
    if (FORCE_CHAPTER_LEFT && p.chapter_start && arranged.length % 2 === 1) {
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

  // Register cloud-eligible pages: normal content and bg-less poems. Skip
  // cover/back-cover/spine/dedication/chart pages and anything with full-page
  // background art (bg or full-bleed) so clouds never fight a picture.
  CLOUD_PAGES = allPages.filter(p =>
    p.type !== 'cover' && p.type !== 'back-cover' && p.type !== 'spine' &&
    p.type !== 'dedication' && p.type !== 'chart' && !p.bg &&
    !p.pg.classList.contains('img-full-bleed')
  );

  // First layout pass once pages are in the DOM. Image onload handlers call
  // scheduleLayout() again as art (and its wrap geometry / reserved band)
  // settles, so text fit and cloud placement always reflect the final layout.
  scheduleLayout();
}

// --- Layout scheduling ---
// Text autofit and cloud placement both depend on final geometry, and images
// load asynchronously. A single debounced pass runs both, in order, whenever
// anything that affects layout settles.
let CLOUD_PAGES = [];
let layoutTimer = null;
function scheduleLayout() {
  if (layoutTimer) clearTimeout(layoutTimer);
  layoutTimer = setTimeout(runLayout, 60);
}
function runLayout() {
  autoFitPages();
  // Clouds last: they key off the just-settled text/image geometry.
  CLOUD_PAGES.forEach(p => addClouds(p.pg, p.num));
}

// Re-fit text and re-place clouds after a resize / phone rotation: the page can
// render at a new size/aspect, so the prior text fit and cloud geometry (and
// their exclusion collisions) go stale. scheduleLayout() is already debounced.
window.addEventListener('resize', scheduleLayout);

function autoFitPages() {
  // Poem pages: keep the big Caveat hand, but shrink the whole page's base
  // font until every line of verse fits the fixed page height (long finale
  // poem would otherwise overflow when set line-by-line).
  document.querySelectorAll('.pg.poem-page').forEach(pg => {
    const maxH = pg.clientHeight;
    let fs = 18;
    pg.style.fontSize = fs + 'px';
    while (pg.scrollHeight > maxH && fs > 10.5) {
      fs -= 0.5;
      pg.style.fontSize = fs + 'px';
    }
  });

  document.querySelectorAll('.pg').forEach(pg => {
    if (pg.classList.contains('cover') || pg.classList.contains('back-cover') || pg.classList.contains('spine-page') || pg.classList.contains('dedication') || pg.classList.contains('chart-page') || pg.classList.contains('poem-page') || pg.classList.contains('blank')) return;

    const maxH = pg.clientHeight;
    // Every page starts at the same base and the shrink loop finds the real fit.
    // (Image pages used to start pre-shrunk at 8.5px, which left pages that had
    // room reading sparse with a dead bottom half. Now they fill the space.)
    let fontSize = 10.5;
    // Floor low enough that a dense page (e.g. the first-aid appendix, where an
    // image also reserves float space) still fits rather than clipping.
    const minFontSize = 6;
    const step = 0.25;

    // Bottom-anchored art reserves its band with an in-flow .img-spacer, so the
    // page's scrollHeight already reflects the real available text height. There
    // is no bleed to special-case: we simply shrink until the text (plus the
    // reserved band) fits, exactly like a pure text page.
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
