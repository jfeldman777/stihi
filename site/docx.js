(function () {
  'use strict';

  // A4 landscape sheet; Word's "book fold" mode splits it into two A5 pages and imposes them on print.
  const SHEET_W = 16838, SHEET_H = 11906;
  const MARGIN = { top: 850, bottom: 1020, side: 964, footer: 454 };
  const TEXT_W = SHEET_W / 2 - 2 * MARGIN.side;

  // Word paginates on its own, so this estimate must be pessimistic: every planned page has to fit
  // into the real A5 text area (~501pt high, ~324pt wide), or contents page numbers and padding drift.
  const LINE = 14, TITLE_LINE = 19, TITLE_AFTER = 14, POEM_GAP = 28, PAGE_H = 478;
  const CPL = 56, CPL_TITLE = 36, CPL_TOC = 48, PROSE_MIN = 100, PROSE_INDENT = 4;
  const FIRST_POEM_PAGE = 3;

  const isProse = line => line.length >= PROSE_MIN;
  const lineH = (text, indent) => Math.max(1, Math.ceil((text.length + (indent ? PROSE_INDENT : 0)) / CPL)) * LINE;
  const titleH = title => Math.max(1, Math.ceil(title.length / CPL_TITLE)) * TITLE_LINE + TITLE_AFTER;
  const stanzaH = stanza => stanza.reduce((sum, line) => sum + lineH(line, isProse(line)), 0);

  function stanzas(text) {
    const result = [];
    let current = [];
    for (const raw of text.replace(/\t/g, '    ').split('\n')) {
      const line = raw.replace(/\s+$/, '');
      if (line.trim()) current.push(line);
      else if (current.length) {
        result.push(current);
        current = [];
      }
    }
    if (current.length) result.push(current);
    return result;
  }

  function layout(poems, opts) {
    const pages = [];
    const startPages = [];
    let page = null;
    let used = 0;
    const newPage = () => {
      page = [];
      pages.push(page);
      used = 0;
    };
    const room = () => PAGE_H - used;
    const add = (block, h) => {
      page.push(block);
      used += h;
    };

    function addLine(text) {
      const prose = isProse(text);
      let rest = text;
      let cont = false;
      while (rest) {
        const h = lineH(rest, prose && !cont);
        if (h <= room()) {
          add({ type: 'line', text: rest, prose, cont }, h);
          return;
        }
        if (prose && room() >= 3 * LINE) {
          const fit = Math.floor(room() / LINE) * CPL - PROSE_INDENT;
          let cut = rest.lastIndexOf(' ', fit);
          if (cut <= 0) cut = fit;
          const piece = rest.slice(0, cut);
          add({ type: 'line', text: piece, prose, cont }, lineH(piece, !cont));
          rest = rest.slice(cut).trimStart();
          cont = true;
        }
        newPage();
      }
    }

    for (const poem of poems) {
      const body = stanzas(poem.text);
      const tH = titleH(poem.title);
      const bodyH = body.reduce((sum, st, i) => sum + (i ? LINE : 0) + stanzaH(st), 0);

      if (!page || (page.length && (opts.newPagePerPoem || POEM_GAP + tH + bodyH > room()))) newPage();

      const gap = page.length > 0;
      add({ type: 'title', text: poem.title, gap }, (gap ? POEM_GAP : 0) + tH);
      startPages.push(pages.length - 1);

      body.forEach((stanza, i) => {
        const sep = i > 0 ? LINE : 0;
        const h = stanzaH(stanza);
        if (sep + h <= room()) {
          if (sep) add({ type: 'empty' }, LINE);
          stanza.forEach(line => add({ type: 'line', text: line, prose: isProse(line), cont: false }, lineH(line, isProse(line))));
        } else if (h <= PAGE_H) {
          newPage();
          stanza.forEach(line => add({ type: 'line', text: line, prose: isProse(line), cont: false }, lineH(line, isProse(line))));
        } else {
          if (sep && page.length && 2 * LINE <= room()) add({ type: 'empty' }, LINE);
          stanza.forEach(addLine);
        }
      });
    }

    if (opts.toc && poems.length) {
      newPage();
      add({ type: 'title', text: 'Содержание', gap: false }, titleH('Содержание'));
      poems.forEach((poem, i) => {
        const h = Math.max(1, Math.ceil((poem.title.length + 8) / CPL_TOC)) * LINE;
        if (h > room()) newPage();
        add({ type: 'toc', text: poem.title, page: FIRST_POEM_PAGE + startPages[i] }, h);
      });
    }

    const pad = (4 - (FIRST_POEM_PAGE + pages.length) % 4) % 4;
    return { pages, pad, total: FIRST_POEM_PAGE + pages.length + pad };
  }

  // ---- WordprocessingML ----

  const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

  const esc = s => String(s)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function run(text, props) {
    props = props || {};
    let rPr = '';
    if (props.b) rPr += '<w:b/><w:bCs/>';
    if (props.sz) rPr += `<w:sz w:val="${props.sz}"/><w:szCs w:val="${props.sz}"/>`;
    return `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
  }

  const spacing = (before, after, line, rule) =>
    `<w:spacing w:before="${before}" w:after="${after}" w:line="${line}" w:lineRule="${rule}"/>`;

  function para(o) {
    let pPr = '';
    if (o.style) pPr += `<w:pStyle w:val="${o.style}"/>`;
    if (o.pageBreak) pPr += '<w:pageBreakBefore/>';
    if (o.tabs) pPr += o.tabs;
    if (o.spacing) pPr += o.spacing;
    if (o.ind) pPr += o.ind;
    if (o.jc) pPr += `<w:jc w:val="${o.jc}"/>`;
    if (o.sectPr) pPr += o.sectPr;
    return `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${o.runs || ''}</w:p>`;
  }

  const BOOKLET_PAGE = { w: SHEET_W, h: SHEET_H, landscape: true, ...MARGIN };
  const FEED_PAGE = { w: 11906, h: 16838, landscape: false, top: 1134, bottom: 1134, side: 1247, footer: 567 };

  function sectPr(footerId, vAlign, page) {
    page = page || BOOKLET_PAGE;
    return '<w:sectPr>' +
      `<w:footerReference w:type="default" r:id="${footerId}"/>` +
      '<w:type w:val="nextPage"/>' +
      `<w:pgSz w:w="${page.w}" w:h="${page.h}"${page.landscape ? ' w:orient="landscape"' : ''}/>` +
      `<w:pgMar w:top="${page.top}" w:right="${page.side}" w:bottom="${page.bottom}" w:left="${page.side}" ` +
      `w:header="${page.footer}" w:footer="${page.footer}" w:gutter="0"/>` +
      '<w:cols w:space="708"/>' +
      (vAlign ? `<w:vAlign w:val="${vAlign}"/>` : '') +
      '</w:sectPr>';
  }

  function imageRun(photo) {
    const cx = 1440000;
    const cy = Math.round(cx * photo.height / photo.width);
    return '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
      `<wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="1" name="author"/>` +
      '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
      '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      '<pic:nvPicPr><pic:cNvPr id="1" name="author.jpg"/><pic:cNvPicPr/></pic:nvPicPr>' +
      '<pic:blipFill><a:blip r:embed="rIdPhoto"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
      `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
      '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
      '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
  }

  function documentXml(lay, opts) {
    const out = [];
    const autoSpacing = (before, after) => spacing(before, after, 240, 'auto');

    out.push(para({ jc: 'center', spacing: autoSpacing(0, 0), runs: run(opts.author, { sz: 32 }) }));
    out.push(para({ jc: 'center', spacing: autoSpacing(480, 0), runs: run(opts.title, { b: true, sz: 48 }) }));
    out.push(para({ pageBreak: true, sectPr: sectPr('rIdFooterEmpty', 'center') }));

    const body = [];
    lay.pages.forEach((page, k) => page.forEach((block, j) => {
      const pageBreak = k > 0 && j === 0;
      if (block.type === 'title') {
        body.push({
          style: 'Heading1',
          pageBreak,
          spacing: block.gap ? spacing(POEM_GAP * 20, TITLE_AFTER * 20, TITLE_LINE * 20, 'exact') : '',
          runs: run(block.text),
        });
      } else if (block.type === 'line') {
        body.push({
          pageBreak,
          jc: block.prose ? 'both' : '',
          ind: block.prose && !block.cont ? '<w:ind w:firstLine="284"/>' : '',
          runs: run(block.text),
        });
      } else if (block.type === 'toc') {
        body.push({
          pageBreak,
          tabs: `<w:tabs><w:tab w:val="right" w:leader="dot" w:pos="${TEXT_W}"/></w:tabs>`,
          runs: run(block.text) + '<w:r><w:tab/></w:r>' + run(String(block.page)),
        });
      } else {
        body.push({ pageBreak });
      }
    }));
    body[body.length - 1].sectPr = sectPr('rIdFooterPage');
    body.forEach(o => out.push(para(o)));

    for (let i = 0; i < lay.pad; i++) out.push(para({ pageBreak: i > 0 }));
    const back = [];
    if (opts.photo) back.push({ jc: 'center', spacing: autoSpacing(0, 360), runs: imageRun(opts.photo) });
    for (const line of opts.about.replace(/\r/g, '').split('\n')) {
      back.push({ jc: 'center', spacing: autoSpacing(0, 0), runs: line ? run(line) : '' });
    }
    if (!back.length) back.push({});
    back[0].pageBreak = lay.pad > 0;
    back.forEach(o => out.push(para(o)));

    return wrapDocument(out.join('') + sectPr('rIdFooterEmpty', 'center'));
  }

  function feedDocumentXml(poems, opts) {
    const out = [];
    out.push(para({ jc: 'center', spacing: spacing(0, 0, 240, 'auto'), runs: run(opts.author, { sz: 28 }) }));
    out.push(para({ jc: 'center', spacing: spacing(120, 240, 240, 'auto'), runs: run(opts.title, { b: true, sz: 40 }) }));

    for (const poem of poems) {
      out.push(para({ style: 'Heading1', runs: run(poem.title) }));
      for (const raw of poem.text.replace(/\t/g, '    ').split('\n')) {
        const line = raw.replace(/\s+$/, '');
        const prose = isProse(line);
        out.push(para({
          jc: prose ? 'both' : '',
          ind: prose ? '<w:ind w:firstLine="284"/>' : '',
          runs: line ? run(line) : '',
        }));
      }
      out.push(para({ style: 'PoemInfo', runs: run(poem.info) }));
    }

    const about = opts.about.replace(/\r/g, '').trim();
    if (opts.photo || about) {
      out.push(para({ jc: 'center', spacing: spacing(720, 240, 240, 'auto'), runs: run('* * *') }));
      if (opts.photo) out.push(para({ jc: 'center', spacing: spacing(0, 240, 240, 'auto'), runs: imageRun(opts.photo) }));
      for (const line of about.split('\n')) {
        out.push(para({ jc: 'center', runs: line ? run(line) : '' }));
      }
    }

    return wrapDocument(out.join('') + sectPr('rIdFooterPage', '', FEED_PAGE));
  }

  const wrapDocument = body => XML_HEAD +
    `<w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}" ` +
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">' +
    '<w:body>' + body + '</w:body></w:document>';

  function stylesXml(feed) {
    const defaults = feed
      ? spacing(0, 0, 276, 'auto')
      : `<w:widowControl w:val="0"/>${spacing(0, 0, LINE * 20, 'exact')}`;
    const heading = feed
      ? '<w:keepNext/>' + spacing(600, 200, 240, 'auto')
      : spacing(0, TITLE_AFTER * 20, TITLE_LINE * 20, 'exact');
    return XML_HEAD +
      `<w:styles xmlns:w="${W_NS}">` +
      '<w:docDefaults><w:rPrDefault><w:rPr>' +
      '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Times New Roman" w:cs="Times New Roman"/>' +
      `<w:sz w:val="${feed ? 24 : 22}"/><w:szCs w:val="${feed ? 24 : 22}"/>` +
      '<w:lang w:val="ru-RU" w:eastAsia="ru-RU" w:bidi="ar-SA"/>' +
      `</w:rPr></w:rPrDefault><w:pPrDefault><w:pPr>${defaults}</w:pPr></w:pPrDefault></w:docDefaults>` +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/>' +
      `<w:next w:val="Normal"/><w:qFormat/><w:pPr>${heading}<w:outlineLvl w:val="0"/></w:pPr>` +
      '<w:rPr><w:b/><w:bCs/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:customStyle="1" w:styleId="PoemInfo"><w:name w:val="Poem info"/><w:basedOn w:val="Normal"/>' +
      `<w:pPr>${spacing(160, 0, 240, 'auto')}</w:pPr>` +
      '<w:rPr><w:i/><w:iCs/><w:color w:val="808080"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/>' +
      '<w:pPr><w:jc w:val="center"/></w:pPr><w:rPr><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style>' +
      '</w:styles>';
  }

  const settingsXml = bookFold => XML_HEAD +
    `<w:settings xmlns:w="${W_NS}">` +
    `<w:defaultTabStop w:val="708"/>${bookFold ? '<w:bookFoldPrinting/>' : ''}<w:characterSpacingControl w:val="doNotCompress"/>` +
    '<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>' +
    '</w:settings>';

  const footerXml = withPageNumber => XML_HEAD +
    `<w:ftr xmlns:w="${W_NS}" xmlns:r="${R_NS}"><w:p><w:pPr><w:pStyle w:val="Footer"/></w:pPr>` +
    (withPageNumber
      ? '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>' +
        '<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>'
      : '') +
    '</w:p></w:ftr>';

  const coreXml = opts => XML_HEAD +
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
    'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    `<dc:title>${esc(opts.title)}</dc:title><dc:creator>${esc(opts.author)}</dc:creator></cp:coreProperties>`;

  const contentTypesXml = () => XML_HEAD +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Default Extension="jpg" ContentType="image/jpeg"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
    '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' +
    '<Override PartName="/word/footer2.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    '</Types>';

  const rootRelsXml = () => XML_HEAD +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
    '</Relationships>';

  const documentRelsXml = withPhoto => XML_HEAD +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '<Relationship Id="rIdSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>' +
    '<Relationship Id="rIdFooterPage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>' +
    '<Relationship Id="rIdFooterEmpty" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer2.xml"/>' +
    (withPhoto ? '<Relationship Id="rIdPhoto" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/author.jpg"/>' : '') +
    '</Relationships>';

  // ---- ZIP (stored, no compression) ----

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function zip(files) {
    const encoder = new TextEncoder();
    const parts = [];
    const central = [];
    let offset = 0;
    for (const file of files) {
      const name = encoder.encode(file.name);
      const data = typeof file.data === 'string' ? encoder.encode(file.data) : file.data;
      const crc = crc32(data);

      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true);
      local.setUint16(12, 0x21, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true);
      local.setUint32(22, data.length, true);
      local.setUint16(26, name.length, true);
      parts.push(new Uint8Array(local.buffer), name, data);

      const entry = new DataView(new ArrayBuffer(46));
      entry.setUint32(0, 0x02014b50, true);
      entry.setUint16(4, 20, true);
      entry.setUint16(6, 20, true);
      entry.setUint16(8, 0x0800, true);
      entry.setUint16(14, 0x21, true);
      entry.setUint32(16, crc, true);
      entry.setUint32(20, data.length, true);
      entry.setUint32(24, data.length, true);
      entry.setUint16(28, name.length, true);
      entry.setUint32(42, offset, true);
      central.push(new Uint8Array(entry.buffer), name);

      offset += 30 + name.length + data.length;
    }
    const centralSize = central.reduce((sum, part) => sum + part.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
  }

  function pack(opts, document, feed) {
    const files = [
      { name: '[Content_Types].xml', data: contentTypesXml() },
      { name: '_rels/.rels', data: rootRelsXml() },
      { name: 'docProps/core.xml', data: coreXml(opts) },
      { name: 'word/document.xml', data: document },
      { name: 'word/_rels/document.xml.rels', data: documentRelsXml(!!opts.photo) },
      { name: 'word/styles.xml', data: stylesXml(feed) },
      { name: 'word/settings.xml', data: settingsXml(!feed) },
      { name: 'word/footer1.xml', data: footerXml(true) },
      { name: 'word/footer2.xml', data: footerXml(false) },
    ];
    if (opts.photo) {
      files.push({ name: 'word/media/author.jpg', data: Uint8Array.from(atob(opts.photo.base64), c => c.charCodeAt(0)) });
    }
    return zip(files);
  }

  // opts: { title, author, about, photo: {width, height, base64} | null, newPagePerPoem, toc }
  const buildBooklet = (poems, opts) => pack(opts, documentXml(layout(poems, opts), opts), false);
  const buildFeed = (poems, opts) => pack(opts, feedDocumentXml(poems, opts), true);

  window.Docx = { layout, buildBooklet, buildFeed };
})();
