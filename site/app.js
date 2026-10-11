(function () {
  'use strict';

  const data = window.STIHI;
  const poems = data.poems;
  const sections = data.sections.map((name, index) => ({ name, index, poems: [] }));
  poems.forEach((p, i) => {
    p.index = i;
    p.title = p.title || '* * *';
    p.haystack = normalize(p.title + '\n' + p.text);
    sections[p.s].poems.push(p);
  });
  const byId = new Map(poems.map(p => [p.id, p]));

  const root = document.documentElement;
  const main = document.getElementById('main');
  const sidebar = document.getElementById('sidebar');
  const search = document.getElementById('search');
  const bookCount = document.getElementById('bookCount');

  const BOOK_KEY = 'stihi.book';
  const SETTINGS_KEY = 'stihi.bookSettings';
  let book = loadBook();

  function normalize(s) {
    return s.toLowerCase().replace(/ё/g, 'е');
  }

  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value === false || value == null) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (typeof value === 'function') node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children) if (child != null) node.append(child);
    return node;
  }

  function plural(n, forms) {
    const m10 = n % 10, m100 = n % 100;
    const form = m10 === 1 && m100 !== 11 ? 0 : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 1 : 2;
    return n + ' ' + forms[form];
  }
  const poemsWord = n => plural(n, ['стихотворение', 'стихотворения', 'стихотворений']);

  // ---- Book selection ----

  function loadBook() {
    try {
      return (JSON.parse(localStorage.getItem(BOOK_KEY)) || []).filter(id => byId.has(id));
    } catch (e) {
      return [];
    }
  }

  function saveBook() {
    localStorage.setItem(BOOK_KEY, JSON.stringify(book));
    updateBookMarks();
  }

  const inBook = id => book.includes(id);

  function setInBook(ids, include) {
    const set = new Set(ids);
    book = book.filter(id => !set.has(id));
    if (include) book.push(...ids);
    saveBook();
  }

  function updateBookMarks() {
    bookCount.textContent = book.length ? book.length : '';
    for (const link of sidebar.querySelectorAll('a[data-id]')) {
      link.classList.toggle('in-book', inBook(link.dataset.id));
    }
  }

  function loadSettings() {
    const defaults = {
      title: 'Стихотворения',
      author: data.author,
      about: data.author + '\n\nСтраница автора на Стихи.ру:\n' + data.authorUrl.replace(/^https?:\/\//, ''),
      photo: !!data.photo,
      newPagePerPoem: true,
      toc: true,
    };
    try {
      return Object.assign(defaults, JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {});
    } catch (e) {
      return defaults;
    }
  }

  function saveSettings(settings) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }

  function bookToggle(p, compact) {
    const on = inBook(p.id);
    return el('button', {
      class: 'book-toggle' + (on ? ' on' : '') + (compact ? ' compact' : ''),
      title: on ? 'Убрать из книги' : 'Добавить в книгу',
      onclick: e => {
        e.preventDefault();
        setInBook([p.id], !inBook(p.id));
        refresh();
      },
    }, compact ? (on ? '✓' : '+') : (on ? '✓ В книге' : '+ В книгу'));
  }

  // ---- Views ----

  function buildSidebar() {
    for (const sec of sections) {
      const list = el('ul', { class: 'toc' }, ...sec.poems.map(p =>
        el('li', {}, el('a', { href: '#/p/' + p.id, 'data-id': p.id, text: p.title }))));
      sidebar.append(el('details', { 'data-section': sec.index },
        el('summary', {}, el('span', { text: sec.name }), el('span', { class: 'count', text: sec.poems.length })),
        list));
    }
  }

  function openSection(index) {
    const details = sidebar.querySelector(`details[data-section="${index}"]`);
    if (details) details.open = true;
  }

  function markActive(id) {
    const prev = sidebar.querySelector('a.active');
    if (prev) prev.classList.remove('active');
    const link = id && sidebar.querySelector(`a[data-id="${id}"]`);
    if (link) {
      link.classList.add('active');
      link.scrollIntoView({ block: 'nearest' });
    }
  }

  function poemList(list, query) {
    return el('ul', { class: 'poem-list' }, ...list.map(p => el('li', {},
      el('div', { class: 'poem-row' },
        el('a', { href: '#/p/' + p.id },
          el('span', { class: 'num', text: p.id }),
          el('span', { class: 'title', text: p.title })),
        bookToggle(p, true)),
      query ? snippet(p, query) : null)));
  }

  function snippet(p, query) {
    const source = p.title + '\n' + p.text;
    const at = p.haystack.indexOf(query);
    const start = source.lastIndexOf('\n', at) + 1;
    let end = source.indexOf('\n', at + query.length);
    if (end < 0) end = source.length;
    return el('div', { class: 'snippet' },
      source.slice(start, at),
      el('mark', { text: source.slice(at, at + query.length) }),
      source.slice(at + query.length, end));
  }

  function setView(title, ...nodes) {
    document.title = title;
    main.replaceChildren(...nodes.filter(Boolean));
    window.scrollTo(0, 0);
  }

  function showHome() {
    markActive(null);
    const last = byId.get(localStorage.getItem('stihi.last'));
    setView(data.author + ' — стихи',
      el('h1', { class: 'home-title', text: data.author }),
      el('p', { class: 'muted', text: poemsWord(poems.length) + ' в ' + sections.length + ' разделах' }),
      last ? el('p', { class: 'continue' }, 'Продолжить чтение: ',
        el('a', { href: '#/p/' + last.id, text: last.title })) : null,
      el('div', { class: 'cards' }, ...sections.map(sec =>
        el('a', { class: 'card', href: '#/s/' + sec.index },
          el('span', { class: 'card-title', text: sec.name }),
          el('span', { class: 'muted', text: poemsWord(sec.poems.length) })))));
  }

  function showSection(sec) {
    markActive(null);
    openSection(sec.index);
    const ids = sec.poems.map(p => p.id);
    const all = ids.every(inBook);
    setView(sec.name + ' — ' + data.author,
      el('p', { class: 'crumbs' }, el('a', { href: '#/', text: 'Все разделы' })),
      el('h1', { text: sec.name }),
      el('div', { class: 'section-head' },
        el('span', { class: 'muted', text: poemsWord(sec.poems.length) }),
        el('button', {
          class: 'book-toggle' + (all ? ' on' : ''),
          onclick: () => {
            setInBook(ids, !all);
            refresh();
          },
        }, all ? '✓ Весь раздел в книге' : '+ Весь раздел в книгу')),
      poemList(sec.poems));
  }

  function showPoem(p) {
    const sec = sections[p.s];
    const prev = poems[p.index - 1];
    const next = poems[p.index + 1];
    const pagerLink = (target, label, cls) => target
      ? el('a', { href: '#/p/' + target.id, class: cls }, el('small', { text: label }), el('span', { text: target.title }))
      : el('span');

    setView(p.title + ' — ' + data.author,
      el('article', { class: 'poem' },
        el('p', { class: 'crumbs' },
          el('a', { href: '#/s/' + sec.index, text: sec.name }),
          el('span', { class: 'num', text: '№ ' + p.id })),
        el('h1', { text: p.title }),
        el('div', { class: 'poem-text', text: p.text }),
        el('div', { class: 'poem-foot' },
          el('p', { class: 'meta' },
            p.info + ' · ',
            el('a', { href: p.url, target: '_blank', rel: 'noopener', text: 'на Стихи.ру' })),
          bookToggle(p))),
      el('nav', { class: 'pager' },
        pagerLink(prev, '← Предыдущее', 'prev'),
        pagerLink(next, 'Следующее →', 'next')));

    openSection(p.s);
    markActive(p.id);
    localStorage.setItem('stihi.last', p.id);
  }

  function showSearch(raw) {
    markActive(null);
    const query = normalize(raw.trim());
    const found = query ? poems.filter(p => p.haystack.includes(query)) : [];
    setView('Поиск: ' + raw,
      el('h1', { text: 'Поиск: «' + raw.trim() + '»' }),
      el('p', { class: 'muted', text: found.length ? 'Найдено ' + poemsWord(found.length) : 'Ничего не найдено' }),
      poemList(found, query));
  }

  // ---- Book view ----

  const dateKey = p => {
    const m = p.info.match(/(\d\d)\.(\d\d)\.(\d{4})/);
    return m ? m[3] + m[2] + m[1] : '';
  };

  const SORTS = [
    ['Как на сайте', list => list.sort((a, b) => a.index - b.index)],
    ['По названию', list => list.sort((a, b) => a.title.localeCompare(b.title, 'ru'))],
    ['По дате', list => list.sort((a, b) => dateKey(a).localeCompare(dateKey(b)) || a.index - b.index)],
    ['Обратный порядок', list => list.reverse()],
  ];

  function moveInBook(from, to) {
    if (to < 0 || to >= book.length || from === to) return;
    book.splice(to, 0, book.splice(from, 1)[0]);
    saveBook();
    refresh();
  }

  function docxOptions(settings) {
    return {
      title: settings.title.trim() || 'Стихотворения',
      author: settings.author.trim(),
      about: settings.about,
      photo: settings.photo ? data.photo : null,
      newPagePerPoem: settings.newPagePerPoem,
      toc: settings.toc,
    };
  }

  function downloadBook(settings) {
    const opts = docxOptions(settings);
    const blob = window.Docx.build(book.map(id => byId.get(id)), opts);
    const name = (opts.author + ' — ' + opts.title).replace(/[\\/:*?"<>|]/g, '_') + '.docx';
    const link = el('a', { href: URL.createObjectURL(blob), download: name });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 10000);
  }

  function showBook() {
    markActive(null);
    const settings = loadSettings();
    const list = book.map(id => byId.get(id));
    const stats = el('p', { class: 'book-stats' });

    function updateStats() {
      if (!list.length) {
        stats.textContent = 'Книга пока пуста. Откройте стихотворение или раздел и нажмите «+ В книгу».';
        return;
      }
      const lay = window.Docx.layout(list, docxOptions(settings));
      const sheets = lay.total / 4;
      stats.replaceChildren(...[
        el('b', { text: poemsWord(list.length) }),
        ' · ' + plural(lay.total, ['страница', 'страницы', 'страниц']) + ' А5 · ' +
        plural(sheets, ['лист', 'листа', 'листов']) + ' А4',
        sheets > 12 ? el('span', { class: 'warn', text: ' — для скрепки многовато, обычно сшивают до 10–12 листов' }) : null,
      ].filter(Boolean));
    }

    const field = (label, input) => el('label', { class: 'field' }, el('span', { text: label }), input);
    const textInput = (key, tag) => {
      const input = el(tag || 'input', tag ? { rows: 5, text: settings[key] } : { type: 'text', value: settings[key] });
      input.addEventListener('input', () => {
        settings[key] = input.value;
        saveSettings(settings);
      });
      return input;
    };
    const checkbox = (key, label, disabled) => {
      const input = el('input', { type: 'checkbox', checked: settings[key] && !disabled, disabled: !!disabled });
      input.addEventListener('change', () => {
        settings[key] = input.checked;
        saveSettings(settings);
        updateStats();
      });
      return el('label', { class: 'check' }, input, ' ' + label);
    };

    let dragFrom = null;
    const listEl = el('ol', { class: 'book-list' }, ...list.map((p, i) => el('li', { draggable: 'true', 'data-pos': i },
      el('span', { class: 'handle', title: 'Перетащите, чтобы поменять порядок', text: '⋮⋮' }),
      el('span', { class: 'num', text: i + 1 }),
      el('div', { class: 'book-item' },
        el('a', { href: '#/p/' + p.id, text: p.title }),
        el('small', { class: 'muted', text: sections[p.s].name + ' · ' + p.info })),
      el('button', { class: 'icon-btn', title: 'Выше', disabled: i === 0, onclick: () => moveInBook(i, i - 1) }, '↑'),
      el('button', { class: 'icon-btn', title: 'Ниже', disabled: i === list.length - 1, onclick: () => moveInBook(i, i + 1) }, '↓'),
      el('button', {
        class: 'icon-btn',
        title: 'Убрать из книги',
        onclick: () => {
          setInBook([p.id], false);
          refresh();
        },
      }, '✕'))));

    const clearDropMarks = () => listEl.querySelectorAll('.drop-target, .dragging')
      .forEach(li => li.classList.remove('drop-target', 'dragging'));
    listEl.addEventListener('dragstart', e => {
      const li = e.target.closest('li');
      if (!li) return;
      dragFrom = +li.dataset.pos;
      li.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', li.dataset.pos);
    });
    listEl.addEventListener('dragover', e => {
      const li = e.target.closest('li');
      if (dragFrom === null || !li) return;
      e.preventDefault();
      listEl.querySelectorAll('.drop-target').forEach(x => x.classList.remove('drop-target'));
      li.classList.add('drop-target');
    });
    listEl.addEventListener('drop', e => {
      const li = e.target.closest('li');
      if (dragFrom === null || !li) return;
      e.preventDefault();
      const from = dragFrom;
      dragFrom = null;
      moveInBook(from, +li.dataset.pos);
    });
    listEl.addEventListener('dragend', () => {
      dragFrom = null;
      clearDropMarks();
    });

    setView('Книга — ' + data.author,
      el('h1', { text: 'Книжка для печати' }),
      stats,
      list.length ? el('div', { class: 'book-toolbar' },
        el('span', { class: 'muted', text: 'Сортировать:' }),
        ...SORTS.map(([label, sort]) => el('button', {
          class: 'chip',
          onclick: () => {
            book = sort(book.map(id => byId.get(id))).map(p => p.id);
            saveBook();
            refresh();
          },
        }, label))) : null,
      list.length ? listEl : null,
      el('section', { class: 'book-settings' },
        el('h2', { text: 'Оформление' }),
        field('Название на обложке', textInput('title')),
        field('Автор на обложке', textInput('author')),
        field('Последняя страница — об авторе', textInput('about', 'textarea')),
        checkbox('photo', 'Фото автора на последней странице', !data.photo),
        checkbox('newPagePerPoem', 'Каждое стихотворение с новой страницы'),
        checkbox('toc', 'Содержание с номерами страниц')),
      el('div', { class: 'book-actions' },
        el('button', { class: 'primary', disabled: !list.length, onclick: () => downloadBook(settings) }, 'Скачать Word (.docx)'),
        list.length ? el('button', {
          class: 'secondary',
          onclick: () => {
            if (confirm('Убрать все стихотворения из книги?')) {
              setInBook(book.slice(), false);
              refresh();
            }
          },
        }, 'Очистить список') : null),
      el('details', { class: 'help', open: true },
        el('summary', { text: 'Как напечатать книжку' }),
        el('ol', {},
          el('li', { text: 'Откройте скачанный файл в Microsoft Word. Страницы уже настроены как брошюра: каждая страница — половина листа А4.' }),
          el('li', { text: 'Файл → Печать → «Двусторонняя печать», переворачивать относительно короткого края. Если принтер не умеет печатать с двух сторон — выберите «Печать вручную на обеих сторонах».' }),
          el('li', { text: 'Сложите стопку листов пополам и скрепите степлером по сгибу.' })),
        el('p', { class: 'muted', text: 'Word сам расставит страницы по листам в нужном порядке. Число страниц уже кратно четырём, поэтому страница об авторе окажется на задней обложке.' })));

    updateStats();
  }

  // ---- Routing ----

  function route() {
    const hash = decodeURIComponent(location.hash.slice(1)) || '/';
    let m;
    if ((m = hash.match(/^\/search\/(.*)$/s))) {
      if (search.value !== m[1]) search.value = m[1];
      showSearch(m[1]);
    } else {
      search.value = '';
      if ((m = hash.match(/^\/p\/(\d+)$/)) && byId.has(m[1])) showPoem(byId.get(m[1]));
      else if ((m = hash.match(/^\/s\/(\d+)$/)) && sections[+m[1]]) showSection(sections[+m[1]]);
      else if (hash === '/book') showBook();
      else showHome();
    }
    document.body.classList.remove('menu-open');
  }

  function refresh() {
    const y = window.scrollY;
    route();
    window.scrollTo(0, y);
  }

  search.addEventListener('input', () => {
    const value = search.value;
    if (!value.trim()) {
      location.hash = '#/';
      return;
    }
    const target = '#/search/' + encodeURIComponent(value);
    if (location.hash.startsWith('#/search/')) {
      history.replaceState(null, '', target);
      route();
    } else {
      location.hash = target;
    }
  });

  document.getElementById('randomBtn').addEventListener('click', () => {
    location.hash = '#/p/' + poems[Math.floor(Math.random() * poems.length)].id;
  });

  function changeSize(delta) {
    const current = parseFloat(getComputedStyle(root).getPropertyValue('--poem-size')) || 1.2;
    const size = Math.min(2.2, Math.max(0.9, Math.round((current + delta) * 10) / 10));
    root.style.setProperty('--poem-size', size + 'rem');
    localStorage.setItem('stihi.size', size);
  }
  document.getElementById('smallerBtn').addEventListener('click', () => changeSize(-0.1));
  document.getElementById('largerBtn').addEventListener('click', () => changeSize(0.1));

  document.getElementById('themeBtn').addEventListener('click', () => {
    const dark = root.getAttribute('data-theme')
      ? root.getAttribute('data-theme') === 'dark'
      : matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = dark ? 'light' : 'dark';
    root.setAttribute('data-theme', theme);
    localStorage.setItem('stihi.theme', theme);
  });

  document.getElementById('menuBtn').addEventListener('click', () => document.body.classList.toggle('menu-open'));
  document.getElementById('backdrop').addEventListener('click', () => document.body.classList.remove('menu-open'));

  document.addEventListener('keydown', e => {
    if (e.target.closest('input, textarea') || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === '/') {
      e.preventDefault();
      search.focus();
      return;
    }
    const m = location.hash.match(/^#\/p\/(\d+)$/);
    const current = m && byId.get(m[1]);
    if (!current) return;
    const target = e.key === 'ArrowLeft' ? poems[current.index - 1]
      : e.key === 'ArrowRight' ? poems[current.index + 1] : null;
    if (target) location.hash = '#/p/' + target.id;
  });

  document.getElementById('brand').textContent = data.author;
  buildSidebar();
  updateBookMarks();
  window.addEventListener('hashchange', route);
  route();
})();
