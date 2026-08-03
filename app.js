/* ==========================================================
   KENZAI RELEASE — Anime site · shared JS
   AniList GraphQL client + pagination + adult filter + modal
   ========================================================== */
(function(){
  'use strict';

  const ANILIST_URL = 'https://graphql.anilist.co';
  const ADULT_KEY   = 'kenzai_adult_enabled';

  // ============================================================
  // Season helpers
  // ============================================================
  function currentSeason(date){
    const m = date.getMonth(); // 0..11
    if (m === 11 || m <= 1) return 'WINTER';
    if (m <= 4) return 'SPRING';
    if (m <= 7) return 'SUMMER';
    return 'FALL';
  }
  function currentYear(date){
    const m = date.getMonth();
    return (m === 11) ? date.getFullYear() + 1 : date.getFullYear();
  }
  function seasonLabel(s){
    return s.charAt(0) + s.slice(1).toLowerCase();
  }
  function seasonFr(s){
    return {WINTER:'Hiver', SPRING:'Printemps', SUMMER:'Été', FALL:'Automne'}[s] || s;
  }

  // ============================================================
  // Adult filter — excludes status==ADULT or Hentai genre
  // ============================================================
  function adultEnabled(){
    try { return localStorage.getItem(ADULT_KEY) === '1'; }
    catch(e){ return false; }
  }
  function setAdult(v){
    try { localStorage.setItem(ADULT_KEY, v ? '1' : '0'); }
    catch(e){}
  }
  function isAdultItem(it){
    if(!it) return false;
    if(it.isAdult === true) return true;
    if(it.status && String(it.status).toUpperCase() === 'ADULT') return true;
    if(it.isAdultStatus && String(it.isAdultStatus).toUpperCase() === 'ADULT') return true;
    const g = it.genres || [];
    for (const x of g){
      if (x && String(x).toLowerCase().includes('hentai')) return true;
    }
    return false;
  }
  function applyAdultFilter(items){
    if (adultEnabled()) return items || [];
    return (items || []).filter(it => !isAdultItem(it));
  }

  function bindAdultToggle(){
    const boxes = document.querySelectorAll('.adult-toggle input[type="checkbox"]');
    boxes.forEach(box => {
      box.checked = adultEnabled();
      box.addEventListener('change', () => {
        setAdult(box.checked);
        // Re-render current page state without full reload
        document.dispatchEvent(new CustomEvent('kenzai:adult-changed', {detail:{enabled:box.checked}}));
      });
    });
  }

  // ============================================================
  // AniList fetch (with timeout)
  // ============================================================
  function fetchAniList(query, variables, timeoutMs){
    return new Promise((resolve, reject) => {
      const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      const t = setTimeout(() => { if(ctrl) ctrl.abort(); reject(new Error('timeout')); }, timeoutMs || 8000);
      fetch(ANILIST_URL, {
        method:'POST',
        headers:{'Content-Type':'application/json','Accept':'application/json'},
        body: JSON.stringify({query, variables}),
        signal: ctrl ? ctrl.signal : undefined
      })
      .then(r => { clearTimeout(t); if(!r.ok) throw new Error('http '+r.status); return r.json(); })
      .then(j => resolve(j && j.data))
      .catch(e => { clearTimeout(t); reject(e); });
    });
  }

  // ============================================================
  // Normalize an AniList media entry
  // ============================================================
  function norm(m){
    if(!m) return null;
    const airingAt = (m.nextAiringEpisode && m.nextAiringEpisode.airingAt) || null;
    const sd = m.startDate || null;
    const startDate = sd ? {year:sd.year, month:sd.month, day:sd.day} : null;
    return {
      id: m.id,
      title: (m.title && (m.title.romaji || m.title.english || m.title.native)) || 'Untitled',
      cover: (m.coverImage && (m.coverImage.extraLarge || m.coverImage.large || m.coverImage.medium)) || '',
      score: m.averageScore || 0,
      genres: m.genres || [],
      isAdult: !!m.isAdult,
      status: m.status || null,
      description: (m.description || '').replace(/<br\s*\/?>/gi,'\n').replace(/<[^>]+>/g,'').trim(),
      startDate: startDate,
      relations: (m.relations && m.relations.edges) || [],
      airingAt: airingAt
    };
  }

  // ============================================================
  // Paginated AniList Page query — loops until hasNextPage=false
  // ============================================================
  async function fetchAllPages(query, variables, perPage){
    perPage = perPage || 50;
    variables = Object.assign({perPage: perPage}, variables || {});
    let page = 1;
    let all = [];
    let safety = 0;
    while (safety++ < 20){
      variables.page = page;
      const data = await fetchAniList(query, variables, 12000);
      const media = (((data || {}).Page || {}).media) || [];
      all = all.concat(media);
      const pi = (((data || {}).Page || {}).pageInfo) || {};
      if (!pi.hasNextPage) break;
      page = (pi.currentPage || page) + 1;
    }
    return all;
  }

  // ============================================================
  // GraphQL queries (always Page for pagination)
  // ============================================================
  const Q_CALENDAR = `query($season:MediaSeason,$year:Int,$perPage:Int,$page:Int){
    Page(perPage:$perPage, page:$page){
      pageInfo{ hasNextPage currentPage }
      media(season:$season, seasonYear:$year, type:ANIME, sort:START_DATE){
        id
        title{ romaji english native }
        coverImage{ large extraLarge medium color }
        averageScore
        genres
        isAdult status
        description(asHtml:false)
        startDate{ year month day }
        nextAiringEpisode{ airingAt episode }
      }
    }
  }`;

  const Q_SEASON = `query($season:MediaSeason,$year:Int,$perPage:Int,$page:Int){
    Page(perPage:$perPage, page:$page){
      pageInfo{ hasNextPage currentPage }
      media(season:$season, seasonYear:$year, type:ANIME, sort:START_DATE){
        id
        title{ romaji english native }
        coverImage{ large extraLarge medium color }
        averageScore
        genres
        isAdult status
        description(asHtml:false)
        startDate{ year month day }
        relations{ edges{ relationType node{ id } } }
      }
    }
  }`;

  const Q_UPCOMING = `query($season:MediaSeason,$year:Int,$perPage:Int,$page:Int){
    Page(perPage:$perPage, page:$page){
      pageInfo{ hasNextPage currentPage }
      media(season:$season, seasonYear:$year, type:ANIME, sort:START_DATE){
        id
        title{ romaji english native }
        coverImage{ large extraLarge medium color }
        averageScore
        genres
        isAdult status
        description(asHtml:false)
        startDate{ year month day }
      }
    }
  }`;

  // ============================================================
  // Format helpers
  // ============================================================
  function pad2(n){ return (n<10?'0':'') + n; }
  function formatDateFR(d){
    if(!d) return '—';
    if(d.year && d.month && d.day) return pad2(d.day)+'/'+pad2(d.month)+'/'+d.year;
    if(d.year && d.month) return pad2(d.month)+'/'+d.year;
    if(d.year) return String(d.year);
    return '—';
  }
  function formatTimeFR(at){
    if(!at) return '—';
    const dt = new Date(at * 1000);
    const hh = pad2(dt.getHours());
    const mm = pad2(dt.getMinutes());
    return hh + ':' + mm;
  }
  function formatDateLongFR(at){
    if(!at) return '—';
    const dt = new Date(at * 1000);
    const jours = ['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'];
    const mois = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
    return jours[dt.getDay()] + ' ' + pad2(dt.getDate()) + ' ' + mois[dt.getMonth()] + ' ' + dt.getFullYear();
  }
  function dayIndexFromAiringAt(at){
    if(!at) return null;
    const d = new Date(at*1000);
    return d.getDay(); // 0=Sun..6=Sat
  }

  // ============================================================
  // Local fallback data (Summer 2026 demo)
  // ============================================================
  function futureAt(dayOfWeek, hour){
    const now = new Date();
    const d = new Date(now.getTime());
    const diff = (dayOfWeek - d.getDay() + 7) % 7;
    d.setDate(d.getDate() + diff);
    d.setHours(hour, 0, 0, 0);
    if (d < now) d.setDate(d.getDate() + 7);
    return Math.floor(d.getTime()/1000);
  }

  const FALLBACK_SUMMER_2026 = [
    {title:'Demon Slayer: Kimetsu no Yaiba — Infinity Castle', cover:'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/187349-lP5M5hBwYYvH.jpg', score:87, genres:['Action','Fantasy','Supernatural'], isAdult:false, airingAt:futureAt(1,22)},
    {title:'Jujutsu Kaisen Saison 3', cover:'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/113415-pCQzOyKj1yPM.jpg', score:84, genres:['Action','Supernatural'], isAdult:false, airingAt:futureAt(6,23)},
    {title:'Frieren: Beyond Journey\'s End — Saison 2', cover:'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/154587-OCzZSq3YJEPw.jpg', score:91, genres:['Adventure','Drama','Fantasy'], isAdult:false, airingAt:futureAt(5,21)},
    {title:'Solo Leveling Saison 2', cover:'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/151807-1lIV7Hh3hEHJ.jpg', score:81, genres:['Action','Fantasy'], isAdult:false, airingAt:futureAt(3,22)},
    {title:'Spy x Family Saison 3', cover:'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/139516-1lIV7Hh3hEHJ.jpg', score:83, genres:['Action','Comedy'], isAdult:false, airingAt:futureAt(2,20)},
    {title:'Oshi no Ko Saison 3', cover:'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/166629-1lIV7Hh3hEHJ.jpg', score:80, genres:['Drama'], isAdult:false, airingAt:futureAt(4,22)},
    {title:'Dan Da Dan', cover:'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/171018-1lIV7Hh3hEHJ.jpg', score:79, genres:['Action','Comedy','Supernatural'], isAdult:false, airingAt:futureAt(0,23)},
    {title:'Witch Hat Atelier', cover:'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/167140-1lIV7Hh3hEHJ.jpg', score:78, genres:['Fantasy'], isAdult:false, airingAt:futureAt(6,21)},
    {title:'My Hero Academia: Final', cover:'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/172450-1lIV7Hh3hEHJ.jpg', score:74, genres:['Action'], isAdult:false, airingAt:futureAt(2,18)},
    {title:'Made in Abyss: Mezonaru-hen', cover:'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/170942-1lIV7Hh3hEHJ.jpg', score:85, genres:['Adventure','Fantasy'], isAdult:false, airingAt:futureAt(5,22)},
    {title:'Kagurabachi', cover:'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/174095-1lIV7Hh3hEHJ.jpg', score:76, genres:['Action'], isAdult:false, airingAt:futureAt(1,21)},
    {title:'Apothecary Diaries Saison 2', cover:'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/153924-1lIV7Hh3hEHJ.jpg', score:82, genres:['Drama','Mystery'], isAdult:false, airingAt:futureAt(3,21)},
    {title:'Hentai Sample (caché)', cover:'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/x.jpg', score:60, genres:['Hentai'], isAdult:true, status:'ADULT', airingAt:futureAt(0,18)},
    {title:'Made in Abyss (Suites)', cover:'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/170942-1lIV7Hh3hEHJ.jpg', score:85, genres:['Adventure','Fantasy'], isAdult:false, relations:[{relationType:'PREQUEL',node:{id:1}}], airingAt:futureAt(4,21)},
  ];

  const FALLBACK_UPCOMING = [
    {title:'Bleach: Thousand-Year Blood War — Part 3', cover:'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/168811-1lIV7Hh3hEHJ.jpg', score:88, genres:['Action','Supernatural'], isAdult:false, startDate:{year:2026,month:10,day:5}},
    {title:'Vinland Saga Saison 3', cover:'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/152629-1lIV7Hh3hEHJ.jpg', score:86, genres:['Action','Adventure','Drama'], isAdult:false, startDate:{year:2027,month:1,day:14}},
    {title:'Berserk of Gluttony', cover:'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/153288-1lIV7Hh3hEHJ.jpg', score:70, genres:['Action','Fantasy'], isAdult:false, startDate:{year:2027,month:4,day:7}},
    {title:'Chainsaw Man Saison 2', cover:'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/163134-1lIV7Hh3hEHJ.jpg', score:80, genres:['Action','Supernatural'], isAdult:false, startDate:{year:2027,month:7,day:12}},
    {title:'Hell\'s Paradise Saison 2', cover:'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/152983-1lIV7Hh3hEHJ.jpg', score:78, genres:['Action','Adventure'], isAdult:false, startDate:{year:2027,month:10,day:1}},
    {title:'Kaiju No. 8 Saison 2', cover:'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/166144-1lIV7Hh3hEHJ.jpg', score:77, genres:['Action','Sci-Fi'], isAdult:false, startDate:{year:2028,month:1,day:9}},
  ];

  // ============================================================
  // DOM helpers
  // ============================================================
  function el(tag, attrs, ...kids){
    const e = document.createElement(tag);
    if (attrs) for (const k in attrs){
      if (k === 'class') e.className = attrs[k];
      else if (k === 'html') e.innerHTML = attrs[k];
      else if (k === 'text') e.textContent = attrs[k];
      else if (k === 'style' && typeof attrs[k] === 'object') Object.assign(e.style, attrs[k]);
      else if (k === 'on' && typeof attrs[k] === 'object'){
        for (const ev in attrs[k]) e.addEventListener(ev, attrs[k][ev]);
      }
      else e.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(c => {
      if (c == null) return;
      if (typeof c === 'string' || typeof c === 'number') e.appendChild(document.createTextNode(c));
      else e.appendChild(c);
    });
    return e;
  }
  function showLoading(target, msg){
    target.innerHTML = '';
    target.appendChild(el('div', {class:'status'},
      el('div', {class:'spinner'}),
      msg || 'Chargement des animés…'
    ));
  }
  function showEmpty(target, msg){
    target.innerHTML = '';
    target.appendChild(el('div', {class:'empty'}, msg || 'Aucun animé trouvé.'));
  }

  // ============================================================
  // Card render (clickable -> opens modal)
  // ============================================================
  function renderCard(item){
    const cover = item.cover || '';
    const card = el('article', {class:'card', 'data-id':item.id || ''});
    const cv = el('div', {class:'cover'});
    if (cover) cv.style.backgroundImage = "url('"+cover.replace(/'/g,"\\'")+"')";
    if (item.score) cv.appendChild(el('div', {class:'score'}, Math.round(item.score) + '%'));
    if (isAdultItem(item)) cv.appendChild(el('div', {class:'badge-adult'}, '+18'));
    card.appendChild(cv);

    const body = el('div', {class:'body'});
    body.appendChild(el('h3', {class:'title', text: item.title}));

    const meta = el('div', {class:'meta'});
    if (item.airingAt){
      const dt = new Date(item.airingAt*1000);
      const jours = ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'];
      meta.appendChild(el('div', {class:'row'},
        el('span', {class:'ic'}, '◷'),
        jours[dt.getDay()] + ' ' + formatTimeFR(item.airingAt)
      ));
    } else if (item.startDate && item.startDate.year){
      meta.appendChild(el('div', {class:'row'},
        el('span', {class:'ic'}, '◷'),
        formatDateFR(item.startDate)
      ));
    }
    body.appendChild(meta);

    const g = el('div', {class:'genres'});
    (item.genres || []).slice(0,3).forEach(t => g.appendChild(el('span', {text:t})));
    body.appendChild(g);
    card.appendChild(body);

    // Click handler — open modal with full details
    card.addEventListener('click', () => openModal(item));
    return card;
  }

  // ============================================================
  // MODAL — affiche 5+ infos complètes (heure, date, synopsis, note, image)
  // ============================================================
  let modalHost = null;
  function ensureModal(){
    if (modalHost) return modalHost;
    const back = el('div', {class:'modal-backdrop', id:'kenzaiModal'});
    const m = el('div', {class:'modal', role:'dialog', 'aria-modal':'true'});
    back.appendChild(m);

    // Close on backdrop click
    back.addEventListener('click', (e) => {
      if (e.target === back) closeModal();
    });
    // Close on ESC
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && back.classList.contains('open')) closeModal();
    });

    document.body.appendChild(back);
    modalHost = {back, m};
    return modalHost;
  }
  function closeModal(){
    if (!modalHost) return;
    modalHost.back.classList.remove('open');
    document.body.style.overflow = '';
  }
  function openModal(item){
    const {back, m} = ensureModal();
    m.innerHTML = '';

    const grid = el('div', {class:'modal-grid'});

    // Cover (poster) — 5e info demandée : image
    const cover = el('div', {class:'modal-cover'});
    if (item.cover) cover.style.backgroundImage = "url('"+item.cover.replace(/'/g,"\\'")+"')";
    grid.appendChild(cover);

    // Body
    const body = el('div', {class:'modal-body'});
    body.style.position = 'relative';

    // Close X button
    const x = el('button', {class:'modal-close-x', 'aria-label':'Fermer'}, '✕');
    x.addEventListener('click', closeModal);
    body.appendChild(x);

    // Title
    body.appendChild(el('h2', {class:'modal-title', text: item.title}));

    // Info grid: 5 infos critiques
    const info = el('div', {class:'modal-info'});

    // 1) Heure de diffusion (formatée)
    info.appendChild(el('div', {class:'item time'},
      el('div', {class:'lbl', text:'Heure de diffusion'}),
      el('div', {class:'val', text: item.airingAt ? formatTimeFR(item.airingAt) : '—'})
    ));
    // 2) Date de sortie (JJ/MM/AAAA)
    info.appendChild(el('div', {class:'item date'},
      el('div', {class:'lbl', text:'Date de sortie'}),
      el('div', {class:'val', text: item.startDate ? formatDateFR(item.startDate) : '—'})
    ));
    // 3) Date longue (jour complet) — bonus
    info.appendChild(el('div', {class:'item'},
      el('div', {class:'lbl', text:'Jour complet'}),
      el('div', {class:'val', text: item.airingAt ? formatDateLongFR(item.airingAt) : (item.startDate ? formatDateFR(item.startDate) : '—')})
    ));
    // 4) Note/score en %
    info.appendChild(el('div', {class:'item score'},
      el('div', {class:'lbl', text:'Note'}),
      el('div', {class:'val', text: item.score ? (Math.round(item.score) + '%') : '—'})
    ));
    body.appendChild(info);

    // Genres
    if (item.genres && item.genres.length){
      const gWrap = el('div', {class:'modal-genres'});
      item.genres.forEach(g => gWrap.appendChild(el('span', {text:g})));
      body.appendChild(gWrap);
    }

    // 5) Synopsis complet
    const syn = el('div', {class:'modal-synopsis'},
      el('span', {class:'lbl', text:'Synopsis'}),
      el('div', {text: item.description || 'Aucun synopsis disponible pour cet animé.'})
    );
    body.appendChild(syn);

    // Actions — bouton fermer
    const actions = el('div', {class:'modal-actions'},
      el('button', {class:'btn btn-ghost', on:{click:closeModal}}, 'Fermer')
    );
    body.appendChild(actions);

    grid.appendChild(body);
    m.appendChild(grid);
    back.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  // ============================================================
  // Exposed API
  // ============================================================
  window.Kenzai = {
    ANILIST_URL, ADULT_KEY,
    currentSeason, currentYear, seasonLabel, seasonFr,
    adultEnabled, setAdult, isAdultItem, applyAdultFilter, bindAdultToggle,
    fetchAniList, fetchAllPages, norm,
    Q_CALENDAR, Q_SEASON, Q_UPCOMING,
    FALLBACK_SUMMER_2026, FALLBACK_UPCOMING,
    futureAt, dayIndexFromAiringAt,
    formatDateFR, formatTimeFR, formatDateLongFR,
    renderCard, openModal, closeModal,
    showLoading, showEmpty, el
  };
})();
