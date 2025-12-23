// Flashcard v2: multi-deck manager + per-deck app (based on local app)

// ====================================
// State Management
// ====================================
const AppState = {
  decks: {}, // name -> deck array
  currentDeck: null, // deck name
  deckData: null, // current deck data
  navHistory: [],
  hasRoutedOnce: false,
  cardsView: { allCards: [], loadedCount: 0, batchSize: 60, isLoading: false, scrollPosition: 0, activeChapter: null, containerInitialized: false, io: null, pendingCard: null },
  quizState: { questions: [], currentQuestionIndex: 0, answers: [], config: { count: 10, scope: 'all', order: 'random' } }
};

// Storage
function loadDecks() {
  try { const raw = localStorage.getItem('decks'); if (!raw) return {}; const d = JSON.parse(raw); return (typeof d === 'object' && d) ? d : {}; } catch { return {}; }
}
function saveDecks() { try { localStorage.setItem('decks', JSON.stringify(AppState.decks)); } catch {} }

// ====================================
// Router
// ====================================
const Router = {
  parseHash() { const hash = window.location.hash.slice(1) || '/'; const parts = hash.split('/').filter(p => p); return { path: hash, parts }; },
  navigate(path) { const current = window.location.hash.slice(1) || '/'; if (current !== path) AppState.navHistory.push(current); window.location.hash = path; },
  handleRoute() {
    const { parts } = this.parseHash();
    if (parts.length === 0) { renderDeckManager(); showScreen('deckManager'); updateHeader('漢字 — Decks', false); return; }
    const deckName = parts[0];
    if (!AppState.decks[deckName]) { // deck missing -> go manager
      this.navigate('/'); return;
    }
    if (AppState.currentDeck !== deckName) { setCurrentDeck(deckName); }
    // Within deck
    if (parts.length === 1) { renderHome(); showScreen('home'); updateHeader(`${deckName} — Chapitres`, true); }
    else if (parts[1] === 'chapter' && parts[2]) {
      const chapIdx = parseInt(parts[2]);
      if (parts[3] === 'card' && parts[4]) {
        const cardIdx = parseInt(parts[4]);
        AppState.cardsView.pendingCard = { chapterIndex: chapIdx, cardIndex: cardIdx };
        showCardsView(chapIdx);
      } else {
        showCardsView(chapIdx);
      }
    } else if (parts[1] === 'view' && parts[2] === 'all') {
      showCardsView(null);
    } else if (parts[1] === 'quiz') {
      if (parts[2] === 'config') {
        if (parts[3] === 'chapter' && parts[4]) AppState.quizState.config.scope = parseInt(parts[4]); else AppState.quizState.config.scope = 'all';
        showQuizConfig();
      } else if (parts[2] === 'active') {
        showScreen('quiz');
      } else if (parts[2] === 'results') {
        showScreen('quizResults');
      } else { this.navigate(`/${deckName}`); }
    } else {
      this.navigate('/');
    }
    AppState.hasRoutedOnce = true;
  }
};

function setCurrentDeck(name) { AppState.currentDeck = name; AppState.deckData = AppState.decks[name]; }

// ====================================
// Deck Manager
// ====================================
function renderDeckManager() {
  const list = document.getElementById('deckList');
  const names = Object.keys(AppState.decks);
  if (names.length === 0) {
    list.innerHTML = '<div class="search-no-results">Aucun deck. Ajoute-en un ci-dessus.</div>';
  } else {
    list.innerHTML = names.map(n => `
      <div class="chapter-item" data-deck="${n}">
        <h4>${n}</h4>
        <p>${AppState.decks[n].reduce((s,ch)=>s+ch.cards.length,0)} cartes</p>
        <div class="deck-actions">
          <button class="action-btn secondary" data-action="open" data-deck="${n}"><span>Ouvrir</span></button>
          <button class="action-btn secondary" data-action="download" data-deck="${n}"><span>Télécharger (JSON + Widgets)</span></button>
          <button class="action-btn" data-action="delete" data-deck="${n}"><span>Supprimer</span></button>
        </div>
      </div>`).join('');
    list.querySelectorAll('button[data-action="open"]').forEach(btn=> btn.addEventListener('click', ()=> Router.navigate(`/${btn.dataset.deck}`)));
    list.querySelectorAll('button[data-action="download"]').forEach(btn=> btn.addEventListener('click', ()=> downloadDeckPackage(btn.dataset.deck)));
    list.querySelectorAll('button[data-action="delete"]').forEach(btn=> btn.addEventListener('click', ()=> { const dn = btn.dataset.deck; delete AppState.decks[dn]; saveDecks(); renderDeckManager(); }));
  }
  updateHeader('漢字 — Decks', false);
}

function setupDeckManagerHandlers() {
  const addBtn = document.getElementById('addDeckBtn');
  const nameInput = document.getElementById('newDeckName');
  const fileInput = document.getElementById('newDeckFile');
  const apkgInput = document.getElementById('newApkgFile');
  const apkgFrontSelect = document.getElementById('apkgFrontField');
  const apkgBackSelect = document.getElementById('apkgBackField');
  const apkgChapterSelect = document.getElementById('apkgChapterField');
  const importApkgBtn = document.getElementById('importApkgBtn');
  const statusEl = document.getElementById('addDeckStatus');

  function populateApkgFieldSelects(fields){
    const options = (fields && fields.length>0) ? fields : ['Champ 1','Champ 2'];
    const makeOpts = options.map((name,idx)=> `<option value="${idx}">${name}</option>`).join('');
    if (apkgFrontSelect){ apkgFrontSelect.innerHTML = makeOpts; apkgFrontSelect.disabled = false; apkgFrontSelect.selectedIndex = 0; }
    if (apkgBackSelect){ apkgBackSelect.innerHTML = makeOpts; apkgBackSelect.disabled = false; apkgBackSelect.selectedIndex = Math.min(1, options.length-1); }
    if (apkgChapterSelect){ 
      apkgChapterSelect.innerHTML = '<option value="">Default</option>' + makeOpts; 
      apkgChapterSelect.disabled = false; 
      apkgChapterSelect.selectedIndex = 0; 
    }
  }

  // Auto-fill deck name from selected JSON filename
  if (fileInput && nameInput) {
    fileInput.addEventListener('change', () => {
      const file = fileInput.files && fileInput.files[0];
      if (file) {
        const base = file.name.replace(/\.json$/i, '');
        nameInput.value = base;
      }
    });
  }
  if (apkgInput && nameInput) {
    apkgInput.addEventListener('change', async () => {
      const file = apkgInput.files && apkgInput.files[0];
      if (file) {
        const base = file.name.replace(/\.apkg$/i, '');
        if (!nameInput.value) nameInput.value = base;
        if (statusEl){ statusEl.style.color='var(--text-secondary)'; statusEl.textContent='Analyse des champs (.apkg)...'; }
        try {
          const fields = await extractApkgFieldNames(file);
          populateApkgFieldSelects(fields);
          if (statusEl) statusEl.textContent = fields.length>0 ? 'Champs détectés. Choisissez recto/verso puis importez.' : 'Champs non détectés, les deux premiers seront utilisés.';
        } catch(err){
          if (statusEl){ statusEl.style.color='var(--error)'; statusEl.textContent='Impossible de lire les champs de l\'APKG'; }
          console.error('Erreur lecture champs APKG:', err);
          populateApkgFieldSelects([]);
        }
      }
    });
  }
  if (addBtn) addBtn.addEventListener('click', ()=> {
    if(statusEl) statusEl.textContent='';
    const name = (nameInput.value||'').trim();
    const file = fileInput.files && fileInput.files[0];
    if (!name) { statusEl.style.color='var(--error)'; statusEl.textContent='Nom requis'; return; }
    if (!file) { statusEl.style.color='var(--error)'; statusEl.textContent='Fichier JSON requis'; return; }
    const reader = new FileReader();
    reader.onload = ()=> {
      try {
        const deck = JSON.parse(reader.result);
        if (!Array.isArray(deck)) throw new Error('Format invalide');
        for (const ch of deck) { if (typeof ch.chapter !== 'string' || !Array.isArray(ch.cards)) throw new Error('Structure non reconnue'); }
        // Normalize/ensure URL fields to be deck-aware and correctly indexed
        normalizeDeckUrls(deck, name);
        AppState.decks[name] = deck;
        saveDecks();
        statusEl.style.color='var(--success)'; statusEl.textContent='Deck ajouté !';
        nameInput.value=''; fileInput.value='';
        renderDeckManager();
      } catch(e) { statusEl.style.color='var(--error)'; statusEl.textContent='Erreur: '+e.message; }
    };
    reader.onerror = ()=> { statusEl.style.color='var(--error)'; statusEl.textContent='Erreur de lecture du fichier'; };
    reader.readAsText(file);
  });

  if (importApkgBtn) importApkgBtn.addEventListener('click', async ()=>{
    if(statusEl) { statusEl.style.color='var(--text-secondary)'; statusEl.textContent=''; }
    const name = (nameInput.value||'').trim();
    const file = apkgInput && apkgInput.files && apkgInput.files[0];
    if (!name) { statusEl.style.color='var(--error)'; statusEl.textContent='Nom requis'; return; }
    if (!file) { statusEl.style.color='var(--error)'; statusEl.textContent='Fichier .apkg requis'; return; }
    try {
      statusEl.textContent='Import en cours (.apkg → JSON)...';
      const frontIdx = apkgFrontSelect ? parseInt(apkgFrontSelect.value) : 0;
      const backIdx = apkgBackSelect ? parseInt(apkgBackSelect.value) : 1;
      const chapterIdx = (apkgChapterSelect && apkgChapterSelect.value) ? parseInt(apkgChapterSelect.value) : null;
      const deck = await importApkgToDeckJson(file, frontIdx, backIdx, chapterIdx);
      if (!deck || deck.length === 0) {
        statusEl.style.color='var(--error)'; 
        statusEl.textContent='Aucune carte trouvée dans le fichier .apkg';
        return;
      }
      const totalCards = deck.reduce((sum, ch) => sum + (ch.cards ? ch.cards.length : 0), 0);
      normalizeDeckUrls(deck, name);
      AppState.decks[name] = deck;
      saveDecks();
      statusEl.style.color='var(--success)'; 
      statusEl.textContent=`Deck APKG importé ! ${totalCards} cartes, ${deck.length} chapitre(s).`;
      nameInput.value=''; if (apkgInput) apkgInput.value='';
      renderDeckManager();
    } catch(e){
      statusEl.style.color='var(--error)'; 
      statusEl.textContent='Erreur import .apkg: '+ (e && e.message ? e.message : String(e));
      console.error('Erreur import APKG détaillée:', e);
    }
  });
}

// Ensure each card has a valid, deck-scoped url: `/#/{deckName}/chapter/{i}/card/{j}`
function normalizeDeckUrls(deckArray, deckName){
  deckArray.forEach((chapter, i)=>{
    if (!Array.isArray(chapter.cards)) return;
    chapter.cards.forEach((card, j)=>{
      const wanted = `#/${deckName}/chapter/${i}/card/${j}`;
      if (!card || typeof card !== 'object') return;
      if (card.url !== wanted) card.url = wanted;
    });
  });
}

// Trigger a download of the normalized JSON file
function downloadNormalizedDeck(deckArray, deckName){
  try {
    const content = JSON.stringify(deckArray, null, 2);
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${deckName}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
  } catch(e) {
    console.error('Erreur téléchargement JSON:', deckName, e);
  }
}

// Extract available field names from an .apkg (from the first model found)
async function extractApkgFieldNames(file){
  if (typeof JSZip === 'undefined') throw new Error('JSZip introuvable');
  if (typeof initSqlJs === 'undefined') throw new Error('sql.js introuvable');
  const arrayBuf = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuf);
  const dbEntry = zip.file('collection.anki2');
  if (!dbEntry) throw new Error('collection.anki2 manquant');
  const dbBytes = new Uint8Array(await dbEntry.async('arraybuffer'));
  const SQL = await initSqlJs({ locateFile: (fn)=> `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.2/${fn}` });
  const db = new SQL.Database(dbBytes);
  const stmt = db.prepare('SELECT models FROM col LIMIT 1');
  let names = [];
  if (stmt.step()){
    const row = stmt.getAsObject();
    try {
      const models = JSON.parse(row.models || '{}');
      const firstModel = Object.values(models)[0];
      if (firstModel && Array.isArray(firstModel.flds)) {
        names = firstModel.flds.map((f,i)=> f && f.name ? String(f.name) : `Champ ${i+1}`);
      }
    } catch(e){ console.error('Parse models error', e); }
  }
  stmt.free();
  db.close();
  return names;
}

// Build deck JSON from an .apkg file (text-only), using specified field indexes
async function importApkgToDeckJson(file, frontIdx=0, backIdx=1, chapterIdx=null){
  if (typeof JSZip === 'undefined') throw new Error('JSZip introuvable');
  if (typeof initSqlJs === 'undefined') throw new Error('sql.js introuvable');
  const arrayBuf = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuf);
  const dbEntry = zip.file('collection.anki2');
  if (!dbEntry) throw new Error('collection.anki2 manquant');
  const dbBytes = new Uint8Array(await dbEntry.async('arraybuffer'));
  const SQL = await initSqlJs({ locateFile: (fn)=> `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.2/${fn}` });
  const db = new SQL.Database(dbBytes);
  
  function cleanText(str) {
    if (!str) return '';
    str = str.replace(/<img[^>]*>/gi, '');
    str = str.replace(/<audio[^>]*>[\s\S]*?<\/audio>/gi, '');
    str = str.replace(/<video[^>]*>[\s\S]*?<\/video>/gi, '');
    str = str.replace(/\[sound:[^\]]*\]/gi, '');
    str = str.replace(/<[^>]*>/g, '');
    str = str.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
    return str.trim();
  }
  
  const stmt = db.prepare("SELECT n.flds AS flds FROM cards c JOIN notes n ON n.id = c.nid ORDER BY c.id ASC");
  const cards = [];
  while (stmt.step()){
    const row = stmt.getAsObject();
    const parts = String(row.flds || '').split('\u001f').map(cleanText);
    const fi = Number.isFinite(frontIdx) ? frontIdx : 0;
    const bi = Number.isFinite(backIdx) ? backIdx : 1;
    const front = parts[fi] ?? parts[0] ?? '';
    const back = parts[bi] ?? parts[fi] ?? parts[0] ?? '';
    if (front.length === 0 && back.length === 0) continue;
    
    // If chapterIdx is specified, group by chapter field value
    if (chapterIdx !== null && Number.isFinite(chapterIdx)) {
      const chapterValue = parts[chapterIdx] || 'Sans chapitre';
      cards.push({ front, back, chapterValue });
    } else {
      cards.push({ front, back });
    }
  }
  stmt.free();
  db.close();
  
  // If no chapter field, return single chapter
  if (chapterIdx === null || !Number.isFinite(chapterIdx)) {
    return [ { chapter: 'Import APKG', cards: cards.map(c => ({front: c.front, back: c.back})) } ];
  }
  
  // Group cards by chapter
  const chapterMap = new Map();
  cards.forEach(card => {
    const chName = card.chapterValue;
    if (!chapterMap.has(chName)) {
      chapterMap.set(chName, []);
    }
    chapterMap.get(chName).push({ front: card.front, back: card.back });
  });
  
  // Convert to array format
  const chapters = Array.from(chapterMap.entries()).map(([chapterName, chapterCards]) => ({
    chapter: chapterName,
    cards: chapterCards
  }));
  
  return chapters;
}

// Download deck package: JSON + 2 Scriptable widget files
function downloadDeckPackage(deckName) {
  const deck = AppState.decks[deckName];
  if (!deck) return;
  
  // Prepare normalized JSON
  const normalized = JSON.parse(JSON.stringify(deck));
  normalizeDeckUrls(normalized, deckName);
  
  // Prepare all files to download
  const jsonFile = `${deckName}.json`;
  const files = [
    { name: jsonFile, content: JSON.stringify(normalized, null, 2), type: 'application/json' },
    { name: `${deckName}_accueil.js`, content: WIDGET_HOME_TEMPLATE.replace(/__JSON_FILENAME__/g, jsonFile), type: 'application/javascript' },
    { name: `${deckName}_lockscreen.js`, content: WIDGET_LOCK_TEMPLATE.replace(/__JSON_FILENAME__/g, jsonFile), type: 'application/javascript' }
  ];
  
  // Download all files sequentially with delays to avoid browser blocking
  files.forEach((f, index) => {
    setTimeout(() => {
      try {
        const blob = new Blob([f.content], {type: f.type});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = f.name;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
      } catch(e) {
        console.error('Erreur téléchargement:', f.name, e);
      }
    }, 400 * index);
  });
}

// Templates (from your Scriptable widgets), with placeholder __JSON_FILENAME__
const WIDGET_HOME_TEMPLATE = `// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: orange; icon-glyph: magic;
// ================================
// Widget Kanji / Signification
// ================================

const fm = FileManager.iCloud();
const fichierJson = "__JSON_FILENAME__";
const cheminJson = fm.joinPath(fm.documentsDirectory(), fichierJson);

const rawDeck = JSON.parse(fm.readString(cheminJson));

function pickRandomCard(deck) {
  if (!Array.isArray(deck) || deck.length === 0) return null;
  const chapter = deck[Math.floor(Math.random() * deck.length)];
  const cards = (chapter && Array.isArray(chapter.cards)) ? chapter.cards : [];
  if (cards.length === 0) return null;
  return cards[Math.floor(Math.random() * cards.length)];
}

const DEFAULT_URL = "https://kurogomapanpan.github.io/kanji_app/#/";

const mot = pickRandomCard(rawDeck) || { front: "", back: "", url: DEFAULT_URL };

let widget = new ListWidget();

let kanji = widget.addText(mot.back);
kanji.font = Font.boldSystemFont(65);
kanji.centerAlignText();
kanji.minimumScaleFactor = 0.5;

widget.addSpacer(5);

let signification = widget.addText(mot.front);
signification.font = Font.systemFont(15);
signification.minimumScaleFactor = 0.5
signification.centerAlignText();

widget.refreshAfterDate = new Date(Date.now() + 5 * 60 * 1000);

widget.url = (mot && mot.url) ? mot.url : DEFAULT_URL;

Script.setWidget(widget);

Script.complete();
`;

const WIDGET_LOCK_TEMPLATE = `// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-brown; icon-glyph: magic;
// ================================
// Widget Kanji / Signification
// ================================

const fm = FileManager.iCloud();
const fichierJson = "__JSON_FILENAME__";
const cheminJson = fm.joinPath(fm.documentsDirectory(), fichierJson);

const rawDeck = JSON.parse(fm.readString(cheminJson));

function pickRandomCard(deck) {
  if (!Array.isArray(deck) || deck.length === 0) return null;
  const chapter = deck[Math.floor(Math.random() * deck.length)];
  const cards = (chapter && Array.isArray(chapter.cards)) ? chapter.cards : [];
  if (cards.length === 0) return null;
  return cards[Math.floor(Math.random() * cards.length)];
}

const DEFAULT_URL = "https://kurogomapanpan.github.io/kanji_app/#/";

const mot = pickRandomCard(rawDeck) || { front: "", back: "", url: DEFAULT_URL };

let widget = new ListWidget();

let stack = widget.addStack();
stack.layoutHorizontally();
stack.centerAlignContent();

let kanji = stack.addText(mot.back);
kanji.font = Font.boldSystemFont(28);
kanji.centerAlignText();
kanji.minimumScaleFactor = 0.5;

stack.addSpacer(5);

let signification = stack.addText(mot.front);
signification.font = Font.systemFont(16);
signification.centerAlignText();
signification.minimumScaleFactor = 0.5;

widget.url = (mot && mot.url) ? mot.url : DEFAULT_URL;

widget.refreshAfterDate = new Date(Date.now() + 5*60*1000);

if (config.runsInWidget) {
  Script.setWidget(widget);
} else {
  widget.presentMedium();
}

Script.complete();
`;

// ====================================
// UI Rendering inside a deck
// ====================================
function renderHome() {
  const deck = AppState.deckData;
  const totalCards = deck.reduce((sum,ch)=>sum+ch.cards.length,0);
  const home = document.getElementById('homeScreen');
  home.innerHTML = `
    <div class="deck-info">
      <h2>${AppState.currentDeck}</h2>
      <p class="deck-stats">${deck.length} chapitres • ${totalCards} cartes</p>
    </div>
    <div class="action-buttons">
      <button class="action-btn primary" id="viewAllBtn"><span>Voir toutes les cartes</span></button>
      <button class="action-btn secondary" id="quizAllBtn"><span>Quiz complet</span></button>
    </div>
    <div class="search-section">
      <input type="text" id="searchInput" class="search-input" placeholder="Chercher une carte...">
      <button type="button" id="searchClear" class="search-clear" aria-label="Effacer la recherche">×</button>
      <div id="searchResults" class="search-results" style="display:none;"></div>
    </div>
    <div class="section-header"><h3>Chapitres</h3></div>
    <div id="chapterList" class="chapter-list">
      ${deck.map((ch,idx)=>`<div class="chapter-item" data-chapter="${idx}"><h4>${ch.chapter}</h4><p>${ch.cards.length} cartes</p></div>`).join('')}
    </div>`;
  updateHeader(`${AppState.currentDeck} — Chapitres`, true);
  home.querySelectorAll('.chapter-item').forEach(item=> item.addEventListener('click', ()=> Router.navigate(`/${AppState.currentDeck}/chapter/${parseInt(item.dataset.chapter)}`)));
  const viewAllBtn = document.getElementById('viewAllBtn'); if (viewAllBtn) viewAllBtn.addEventListener('click', ()=> Router.navigate(`/${AppState.currentDeck}/view/all`));
  const quizAllBtn = document.getElementById('quizAllBtn'); if (quizAllBtn) quizAllBtn.addEventListener('click', ()=> { AppState.quizState.config.scope='all'; Router.navigate(`/${AppState.currentDeck}/quiz/config`); });
  const searchInput = document.getElementById('searchInput'); const searchResults = document.getElementById('searchResults'); const searchClear = document.getElementById('searchClear');
  if (searchInput) {
    searchInput.addEventListener('input', ()=> {
      const q = searchInput.value.toLowerCase().trim();
      if (!q) { searchResults.style.display='none'; if (searchClear) searchClear.style.display='none'; return; }
      if (searchClear) searchClear.style.display='flex';
      const results = [];
      AppState.deckData.forEach((chapter,chapterIndex)=>{
        chapter.cards.forEach((card,cardIndex)=>{ if (card.front.toLowerCase().includes(q) || card.back.toLowerCase().includes(q)) results.push({chapter,chapterIndex,card,cardIndex}); });
      });
      searchResults.innerHTML = results.length===0 ? '<div class="search-no-results">Aucune carte trouvée</div>' : results.map(r=>`
        <div class="search-result-item" data-chapter="${r.chapterIndex}" data-card="${r.cardIndex}">
          <div class="search-result-kanji">${r.card.back}</div>
          <div class="search-result-text">${r.card.front}</div>
          <div class="search-result-chapter">${r.chapter.chapter}</div>
        </div>`).join('');
      searchResults.style.display='block';
      searchResults.querySelectorAll('.search-result-item').forEach(item=> item.addEventListener('click', ()=> {
        const chapterIdx = parseInt(item.dataset.chapter); const cardIdx = parseInt(item.dataset.card);
        AppState.cardsView.scrollPosition = 0; Router.navigate(`/${AppState.currentDeck}/chapter/${chapterIdx}/card/${cardIdx}`);
      }));
    });
    if (searchClear) searchClear.addEventListener('click', ()=> { searchInput.value=''; searchInput.focus(); searchResults.style.display='none'; searchClear.style.display='none'; });
  }
}

function showCardsView(chapterIndex) {
  const isSame = AppState.cardsView.containerInitialized && AppState.cardsView.activeChapter===chapterIndex; const container = document.getElementById('cardsContainer'); const chapterControls = document.getElementById('chapterControls');
  if (chapterControls) { if (chapterIndex!==null) { const chapter=AppState.deckData[chapterIndex]; if (chapter) { document.getElementById('chapterTitle').textContent=chapter.chapter; document.getElementById('chapterStats').textContent=`${chapter.cards.length} cartes`; chapterControls.style.display='block'; } } else { chapterControls.style.display='none'; } }
  // Bind chapter-level actions when controls are visible
  if (chapterIndex!==null) {
    const viewBtn = document.getElementById('viewChapterBtn');
    const quizBtn = document.getElementById('quizChapterBtn');
    if (viewBtn) viewBtn.onclick = ()=> { /* already in cards view */ };
    if (quizBtn) quizBtn.onclick = ()=> { AppState.quizState.config.scope = chapterIndex; Router.navigate(`/${AppState.currentDeck}/quiz/config/chapter/${chapterIndex}`); };
  }
  if (isSame) { document.getElementById('cardProgress').textContent=`${AppState.cardsView.allCards.length} cartes`; showScreen('cards'); updateHeader(`${AppState.currentDeck} — ${chapterIndex===null?'Toutes les cartes':AppState.deckData[chapterIndex].chapter}`, true); if (AppState.cardsView.scrollPosition) setTimeout(()=>window.scrollTo(0,AppState.cardsView.scrollPosition),0); return; }
  let cards=[], title=''; if (chapterIndex===null) { cards = AppState.deckData.flatMap((chapter,idx)=> chapter.cards.map((_,cardIdx)=>({chapterIndex:idx, cardIndex:cardIdx}))); title='Toutes les cartes'; } else { const chapter = AppState.deckData[chapterIndex]; if (!chapter) { Router.navigate('/'); return; } cards = chapter.cards.map((_,cardIdx)=>({chapterIndex, cardIndex:cardIdx})); title = chapter.chapter; }
  AppState.cardsView.allCards=cards; AppState.cardsView.loadedCount=0; AppState.cardsView.activeChapter=chapterIndex; AppState.cardsView.containerInitialized=true; document.getElementById('cardProgress').textContent=`${cards.length} cartes`; container.innerHTML=''; const sentinel=document.createElement('div'); sentinel.id='scrollSentinel'; sentinel.style.height='1px'; container.appendChild(sentinel); loadMoreCards(); const target=AppState.cardsView.pendingCard; if (target && target.chapterIndex===chapterIndex) { const targetIndex=target.cardIndex; while (AppState.cardsView.loadedCount<=targetIndex && AppState.cardsView.loadedCount<cards.length) { loadMoreCards(); } setTimeout(()=>{ const selector = `.flashcard[data-chapter="${chapterIndex}"][data-card="${targetIndex}"]`; const el=document.querySelector(selector); if (el) el.scrollIntoView({behavior:'smooth', block:'center'}); AppState.cardsView.pendingCard=null; },50); }
  setupInfiniteScroll(); showScreen('cards'); updateHeader(`${AppState.currentDeck} — ${title}`, true);
}

function loadMoreCards(){ if (AppState.cardsView.isLoading) return; const {allCards,loadedCount,batchSize}=AppState.cardsView; if (loadedCount>=allCards.length) return; AppState.cardsView.isLoading=true; const nextBatch=allCards.slice(loadedCount,loadedCount+batchSize); const container=document.getElementById('cardsContainer'); const sentinel=document.getElementById('scrollSentinel'); const fragment=document.createDocumentFragment(); nextBatch.forEach(ref=>{ const card=AppState.deckData[ref.chapterIndex].cards[ref.cardIndex]; const cardDiv=document.createElement('div'); cardDiv.className='flashcard'; cardDiv.dataset.chapter=ref.chapterIndex; cardDiv.dataset.card=ref.cardIndex; const frontDiv=document.createElement('div'); frontDiv.className='flashcard-front'; frontDiv.textContent=card.front; const backDiv=document.createElement('div'); backDiv.className='flashcard-back'; backDiv.textContent=card.back; cardDiv.appendChild(frontDiv); cardDiv.appendChild(backDiv); cardDiv.addEventListener('click',e=>{ e.preventDefault(); const chapterIdx=parseInt(cardDiv.dataset.chapter); const cardIdx=parseInt(cardDiv.dataset.card); AppState.cardsView.scrollPosition=window.pageYOffset; Router.navigate(`/${AppState.currentDeck}/chapter/${chapterIdx}/card/${cardIdx}`); }); fragment.appendChild(cardDiv); }); if (sentinel) container.insertBefore(fragment,sentinel); else container.appendChild(fragment); AppState.cardsView.loadedCount += nextBatch.length; AppState.cardsView.isLoading=false; }

function freeCardsView(){ const container=document.getElementById('cardsContainer'); if (AppState.cardsView.io){ try{ AppState.cardsView.io.disconnect(); }catch{} AppState.cardsView.io=null; } if (container) container.innerHTML=''; AppState.cardsView.allCards=[]; AppState.cardsView.loadedCount=0; AppState.cardsView.activeChapter=null; AppState.cardsView.containerInitialized=false; AppState.cardsView.scrollPosition=0; }

function setupInfiniteScroll(){ if (AppState.cardsView.io){ AppState.cardsView.io.disconnect(); AppState.cardsView.io=null; } const sentinel=document.getElementById('scrollSentinel'); if (!sentinel) return; const io=new IntersectionObserver(entries=>{ for(const entry of entries){ if (entry.isIntersecting) loadMoreCards(); } },{root:null, rootMargin:'600px', threshold:0}); io.observe(sentinel); AppState.cardsView.io=io; }

function showQuizConfig(){ const scope=AppState.quizState.config.scope; let title='Quiz - '; if (scope==='all'){ const total=AppState.deckData.reduce((s,ch)=>s+ch.cards.length,0); title+='Toutes les cartes'; document.getElementById('questionCount').max=total; const quickMaxBtn=document.getElementById('quickMaxBtn'); if (quickMaxBtn) quickMaxBtn.textContent=String(total); } else { const chapter=AppState.deckData[scope]; if (!chapter){ Router.navigate('/'); return; } title+=chapter.chapter; document.getElementById('questionCount').max=chapter.cards.length; const quickMaxBtn=document.getElementById('quickMaxBtn'); if (quickMaxBtn) quickMaxBtn.textContent=String(chapter.cards.length); } document.getElementById('quizConfigTitle').textContent=title; showScreen('quizConfig'); updateHeader(`${AppState.currentDeck} — Configuration`, true); const order=AppState.quizState.config.order; const randomBtn=document.getElementById('orderRandomBtn'); const sequentialBtn=document.getElementById('orderSequentialBtn'); if (randomBtn && sequentialBtn){ randomBtn.classList.toggle('active', order==='random'); sequentialBtn.classList.toggle('active', order==='sequential'); } }

function startQuiz(){
  const inputEl = document.getElementById('questionCount');
  const requested = parseInt(inputEl && inputEl.value ? inputEl.value : AppState.quizState.config.count) || 1;
  const scope=AppState.quizState.config.scope;
  const order=AppState.quizState.config.order;
  let allCards=[];
  if (scope==='all') allCards = AppState.deckData.flatMap(ch=>ch.cards); else allCards = AppState.deckData[scope].cards;
  const count=Math.min(requested, allCards.length || 0);
  let selected=[];
  if (order==='random'){
    const shuffled=[...allCards].sort(()=>Math.random()-0.5);
    selected=shuffled.slice(0, count);
  } else {
    selected=allCards.slice(0, count);
  }
  AppState.quizState.questions=selected;
  AppState.quizState.currentQuestionIndex=0;
  AppState.quizState.answers=[];
  AppState.quizState.config.count = count;
  Router.navigate(`/${AppState.currentDeck}/quiz/active`);
  renderQuizQuestion();
}

function renderQuizQuestion(){ const {questions,currentQuestionIndex,answers}=AppState.quizState; const question=questions[currentQuestionIndex]; if (!question){ Router.navigate(`/${AppState.currentDeck}/quiz/results`); renderQuizResults(); return; } document.getElementById('quizProgress').textContent = `Question ${currentQuestionIndex+1} / ${questions.length}`; const progressPercent = ((currentQuestionIndex)/questions.length)*100; document.getElementById('quizProgressBar').style.width = `${progressPercent}%`; const correctCount = answers.filter(a=>a.correct).length; document.getElementById('quizScore').textContent = `${correctCount} / ${answers.length}`; document.querySelector('.quiz-card-front').textContent = question.front; document.querySelector('.quiz-card-back').textContent = question.back; document.querySelector('.quiz-card-back').style.display='none'; document.getElementById('revealAnswerBtn').style.display='block'; document.getElementById('quizAnswerBtns').style.display='none'; showScreen('quiz'); updateHeader(`${AppState.currentDeck} — Quiz ${currentQuestionIndex+1}/${questions.length}`, true); }

function revealQuizAnswer(){ document.querySelector('.quiz-card-back').style.display='block'; document.getElementById('revealAnswerBtn').style.display='none'; document.getElementById('quizAnswerBtns').style.display='flex'; }
function submitQuizAnswer(isCorrect){ AppState.quizState.answers.push({correct:isCorrect}); AppState.quizState.currentQuestionIndex++; renderQuizQuestion(); }
function renderQuizResults(){ const {answers}=AppState.quizState; const correct=answers.filter(a=>a.correct).length; const incorrect=answers.length-correct; document.getElementById('correctCount').textContent=correct; document.getElementById('incorrectCount').textContent=incorrect; showScreen('quizResults'); updateHeader(`${AppState.currentDeck} — Résultats`, false); }

// ====================================
// UI Helpers
// ====================================
function showScreen(name){ const map={deckManager:'deckManagerScreen', home:'homeScreen', cards:'cardsScreen', quizConfig:'quizConfigScreen', quiz:'quizScreen', quizResults:'quizResultsScreen'}; const ids=Object.values(map); ids.forEach(id=>{ const el=document.getElementById(id); if (el) el.style.display = (id===map[name]) ? 'block' : 'none'; }); if (name!=='cards') freeCardsView(); }
function updateHeader(title, showBack){ document.getElementById('headerTitle').textContent=title; document.getElementById('backBtn').style.display = showBack ? 'block' : 'none'; }

// ====================================
// Event Handlers
// ====================================
function setupEventHandlers(){
  // Back button
  const backBtn=document.getElementById('backBtn'); if (backBtn) backBtn.addEventListener('click', ()=> smartBack());
  function smartBack(){ const overlay=document.getElementById('cardDetailScreen'); if (overlay && overlay.style.display!=='none'){ overlay.style.display='none'; return; }
    const {parts}=Router.parseHash(); let target='/';
    if (parts.length===0){ target='/'; }
    // From deck home (chapters list) → back to deck manager
    else if (parts.length===1){ target='/'; }
    else { const deckName=parts[0]; if (!AppState.decks[deckName]) { target='/'; }
      // From chapter or specific card -> deck home (not deck manager)
      else if (parts[1]==='chapter'){ target=`/${deckName}`; }
      // From view/all -> deck home
      else if (parts[1]==='view' && parts[2]==='all'){ target=`/${deckName}`; }
      // Quiz routes follow previous local-app behavior
      else if (parts[1]==='quiz') {
        if (parts[2]==='results'){
          // Prefer going back to deck home from results for simplicity
          target=`/${deckName}`;
        } else if (parts[2]==='active'){
          const scope=AppState.quizState.config.scope;
          target = (typeof scope==='number') ? `/${deckName}/quiz/config/chapter/${scope}` : `/${deckName}`;
        } else if (parts[2]==='config'){
          if (parts[3]==='chapter' && parts[4]) target = `/${deckName}/chapter/${parts[4]}`; else target = `/${deckName}`;
        } else target=`/${deckName}`;
      } else { target=`/${deckName}`; } }
    Router.navigate(target);
  }
  const backToDecksBtn=document.getElementById('backToDecksBtn'); if (backToDecksBtn) backToDecksBtn.addEventListener('click', ()=> Router.navigate('/'));
  setupDeckManagerHandlers();
  // Quiz controls
  const startQuizBtn=document.getElementById('startQuizBtn'); if (startQuizBtn) startQuizBtn.addEventListener('click', ()=> startQuiz());
  const randomBtn=document.getElementById('orderRandomBtn'); const sequentialBtn=document.getElementById('orderSequentialBtn'); if (randomBtn && sequentialBtn){ const setOrder=(ord)=>{ AppState.quizState.config.order=ord; randomBtn.classList.toggle('active', ord==='random'); sequentialBtn.classList.toggle('active', ord==='sequential'); }; randomBtn.addEventListener('click', ()=> setOrder('random')); sequentialBtn.addEventListener('click', ()=> setOrder('sequential')); }
  const questionInput=document.getElementById('questionCount');
  const quickBtns=document.querySelectorAll('.quick-btn');
  if (questionInput){ questionInput.addEventListener('input', ()=> { const v=parseInt(questionInput.value)||1; AppState.quizState.config.count=v; }); }
  if (quickBtns && questionInput){ quickBtns.forEach(btn=> btn.addEventListener('click', ()=> {
    let val = btn.dataset.value;
    const max = parseInt(questionInput.max || '0') || null;
    let num = val==='max' ? (max || AppState.deckData.reduce((s,ch)=>s+ch.cards.length,0)) : parseInt(val||'0');
    if (!Number.isFinite(num) || num<=0) num = 1;
    if (max) num = Math.min(num, max);
    questionInput.value = num;
    AppState.quizState.config.count = num;
  })); }
  const revealBtn=document.getElementById('revealAnswerBtn'); if (revealBtn) revealBtn.addEventListener('click', ()=> revealQuizAnswer());
  document.querySelectorAll('.answer-btn').forEach(btn=> btn.addEventListener('click', ()=> submitQuizAnswer(btn.dataset.answer==='correct')));
  // Back font size controls (increase / decrease, persisted)
  (function(){
    const increaseBtn = document.getElementById('increaseBackFont');
    const decreaseBtn = document.getElementById('decreaseBackFont');
    const display = document.getElementById('backFontSizeDisplay');
    const LS_KEY = 'flashcardBackFontPx';
    function applyBackFont(px){ px = Math.round(px); const v = px + 'px'; document.documentElement.style.setProperty('--flashcard-back-font', v); if (display) display.textContent = v; try{ localStorage.setItem(LS_KEY, String(px)); }catch{} }
    function changeBackFont(delta){ const cur = parseInt(localStorage.getItem(LS_KEY)) || 28; let next = Math.min(120, Math.max(12, cur + delta)); applyBackFont(next); }
    function initBackFont(){ const stored = parseInt(localStorage.getItem(LS_KEY)); applyBackFont(Number.isFinite(stored) ? stored : 28); }
    if (increaseBtn) increaseBtn.addEventListener('click', ()=> changeBackFont(2));
    if (decreaseBtn) decreaseBtn.addEventListener('click', ()=> changeBackFont(-2));
    initBackFont();
    // Front font controls
    const increaseFrontBtn = document.getElementById('increaseFrontFont');
    const decreaseFrontBtn = document.getElementById('decreaseFrontFont');
    const displayFront = document.getElementById('frontFontSizeDisplay');
    const LS_KEY_F = 'flashcardFrontFontPx';
    function applyFrontFont(px){ px = Math.round(px); const v = px + 'px'; document.documentElement.style.setProperty('--flashcard-front-font', v); if (displayFront) displayFront.textContent = v; try{ localStorage.setItem(LS_KEY_F, String(px)); }catch{} }
    function changeFrontFont(delta){ const cur = parseInt(localStorage.getItem(LS_KEY_F)) || 14; let next = Math.min(72, Math.max(8, cur + delta)); applyFrontFont(next); }
    function initFrontFont(){ const stored = parseInt(localStorage.getItem(LS_KEY_F)); applyFrontFont(Number.isFinite(stored) ? stored : 14); }
    if (increaseFrontBtn) increaseFrontBtn.addEventListener('click', ()=> changeFrontFont(1));
    if (decreaseFrontBtn) decreaseFrontBtn.addEventListener('click', ()=> changeFrontFont(-1));
    initFrontFont();
  })();
  window.addEventListener('hashchange', ()=> Router.handleRoute());
}

// ====================================
// Initialization
// ====================================
function init(){ AppState.decks = loadDecks(); setupEventHandlers(); Router.handleRoute(); const app=document.getElementById('app'); if (app) app.style.display='flex'; }
if (document.readyState==='loading'){ document.addEventListener('DOMContentLoaded', init); } else { init(); }
