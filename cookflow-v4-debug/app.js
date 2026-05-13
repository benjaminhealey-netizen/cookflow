/* ============================================================
   CookFlow v4 — app.js
   Multi-image carousel, haptics, iOS polish, spring animations
   ============================================================ */

// ==================== STATE ====================
const state = {
  activeFilters: new Set(),
  feedRecipes: [],
  feedIndex: 0,
  feedLoading: false,
  currentRecipe: null,
  cookStep: 0,
  _cookSlides: [],
  cameraStream: null,
  cameraFacing: 'environment',
  detectedIngredients: [],
  _currentPrompt: '',
  cookHistory: [],
  theme: 'dark',
  // Per-card carousel state: { index, images, loaded }
  _carousels: {},
};

const FOOD_EMOJIS = ['🍝','🍜','🥘','🍲','🥗','🍱','🌮','🥙','🍛','🫕','🥩','🍗','🫔','🥞','🧆','🍳','🥚','🌯','🍚','🫛','🍠','🧁','🥣','🍤','🥓','🍣','🥑','🧀','🌽','🥦','🍕','🥪','🌶️','🧄','🧅'];

const BG_COLORS = [
  'linear-gradient(135deg,#1a0800,#2d1000)',
  'linear-gradient(135deg,#001a08,#002810)',
  'linear-gradient(135deg,#080818,#10102a)',
  'linear-gradient(135deg,#1a0008,#2a0010)',
  'linear-gradient(135deg,#0a1800,#122500)',
  'linear-gradient(135deg,#180e00,#2a1800)',
  'linear-gradient(135deg,#001218,#002028)',
  'linear-gradient(135deg,#160016,#260026)',
];

// ==================== HAPTICS ====================
function haptic(style = 'light') {
  if (window.navigator?.vibrate) {
    const durations = { light: 8, medium: 18, heavy: 32, success: [10, 50, 10] };
    navigator.vibrate(durations[style] || 8);
  }
  // iOS haptic feedback via AudioContext (silent but triggers taptic)
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0, ctx.currentTime);
    osc.start();
    osc.stop(ctx.currentTime + 0.001);
  } catch(e) {}
}

// ==================== IMAGE SYSTEM ====================
// Build 4 varied search queries for a recipe title
function buildImageQueries(title) {
  const clean = title.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
  const words = clean.split(' ').filter(w => w.length > 2);
  const core = words.slice(0, 3).join(' ');
  const short = words.slice(0, 2).join(' ');

  return [
    `${clean} food photography`,
    `${core} dish recipe`,
    `${short} meal plated`,
    `${core} food`,
  ];
}

// Use Unsplash source API - free, no key, varies per query
function unsplashUrl(query, w = 800, h = 1000) {
  return `https://source.unsplash.com/${w}x${h}/?${encodeURIComponent(query)}`;
}

// Load 4 images for a card, update carousel as each loads
async function loadCardImages(recipe, cardIndex) {
  const queries = buildImageQueries(recipe.title);

  // If spoonacular gave us an image, use it as the first option
  const primaryUrl = recipe.imageUrl || null;

  state._carousels[cardIndex] = {
    index: 0,
    images: [],
    loaded: 0,
  };

  const slots = primaryUrl
    ? [primaryUrl, ...queries.slice(0, 3).map(q => unsplashUrl(q))]
    : queries.map(q => unsplashUrl(q));

  // Load all 4 in parallel
  const loadPromises = slots.map((url, i) => new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    const timeout = setTimeout(() => {
      resolve({ url: null, index: i, ok: false });
    }, 8000); // 8s timeout per image

    img.onload = () => {
      clearTimeout(timeout);
      // Filter out tiny/error images (Unsplash returns 1x1 for no results)
      if (img.naturalWidth < 50 || img.naturalHeight < 50) {
        resolve({ url: null, index: i, ok: false });
        return;
      }
      resolve({ url, index: i, ok: true });
    };
    img.onerror = () => {
      clearTimeout(timeout);
      resolve({ url: null, index: i, ok: false });
    };
    img.src = url;
  }));

  // As each image loads, add it to the carousel
  const results = await Promise.all(loadPromises);
  const goodImages = results.filter(r => r.ok).map(r => r.url);

  if (goodImages.length > 0) {
    state._carousels[cardIndex].images = goodImages;
    updateCarousel(cardIndex, 0, true);

    // Hide emoji fallback
    const emojiEl = document.getElementById(`emoji-${cardIndex}`);
    if (emojiEl) {
      emojiEl.classList.add('hide');
    }
  }
}

function updateCarousel(cardIndex, imgIndex, initial = false) {
  const carousel = state._carousels[cardIndex];
  if (!carousel || !carousel.images.length) return;

  const track = document.getElementById(`track-${cardIndex}`);
  const dotsWrap = document.getElementById(`cdots-${cardIndex}`);
  if (!track) return;

  // Rebuild slides if needed
  const slides = track.querySelectorAll('.carousel-slide');

  if (slides.length !== carousel.images.length) {
    track.innerHTML = '';
    carousel.images.forEach((url, i) => {
      const slide = document.createElement('div');
      slide.className = 'carousel-slide loaded';
      slide.style.backgroundImage = `url(${url})`;
      track.appendChild(slide);
    });
    track.style.width = `${carousel.images.length * 100}%`;
    track.querySelectorAll('.carousel-slide').forEach(s => s.style.width = `${100 / carousel.images.length}%`);
  }

  // Update dots
  if (dotsWrap && carousel.images.length > 1) {
    dotsWrap.innerHTML = carousel.images.map((_, i) =>
      `<div class="carousel-dot ${i === imgIndex ? 'active' : ''}"></div>`
    ).join('');
    dotsWrap.style.display = 'flex';
  }

  // Slide track
  const pct = imgIndex * (100 / carousel.images.length);
  track.style.transition = initial ? 'none' : 'transform 0.36s cubic-bezier(0.4,0,0.2,1)';
  track.style.transform = `translateX(-${pct}%)`;

  carousel.index = imgIndex;
}

function carouselPrev(cardIndex) {
  const c = state._carousels[cardIndex];
  if (!c || c.images.length <= 1) return;
  haptic('light');
  const newIdx = (c.index - 1 + c.images.length) % c.images.length;
  updateCarousel(cardIndex, newIdx);
}

function carouselNext(cardIndex) {
  const c = state._carousels[cardIndex];
  if (!c || c.images.length <= 1) return;
  haptic('light');
  const newIdx = (c.index + 1) % c.images.length;
  updateCarousel(cardIndex, newIdx);
}

// ==================== INIT ====================
document.addEventListener('DOMContentLoaded', () => {
  loadTheme();
  loadCookHistory();
  restoreFilters();
  bindHomeEvents();
  bindFeedEvents();
  bindCookEvents();
  bindSheetEvents();
  bindPantryEvents();
  bindFridgeEvents();
  bindIngredientConfirmEvents();

  // Preload feed immediately
  const initialPrompts = [
    'popular dinner recipes', 'best lunch ideas', 'easy weeknight meals',
    'healthy bowls and salads', 'comfort food classics', 'international cuisine',
    'quick 20 minute dinners', 'high protein meals', 'mediterranean cuisine',
    'pasta dishes', 'asian fusion recipes', 'vegetable dishes',
    'one pan meals', 'grilled fish and seafood', 'chicken recipes',
  ];
  const p = initialPrompts[Math.floor(Math.random() * initialPrompts.length)];
  state._currentPrompt = p;
  loadRecipeBatch(p, 3);
});

// ==================== THEME ====================
function loadTheme() {
  const saved = localStorage.getItem('cf4_theme') || 'dark';
  applyTheme(saved);
}
function applyTheme(theme) {
  state.theme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  const metaTheme = document.getElementById('meta-theme-color');
  if (metaTheme) metaTheme.content = theme === 'dark' ? '#0a0a0a' : '#f2f2f7';
  localStorage.setItem('cf4_theme', theme);
}

// ==================== COOK HISTORY ====================
function loadCookHistory() {
  try { state.cookHistory = JSON.parse(localStorage.getItem('cf4_history') || '[]'); }
  catch { state.cookHistory = []; }
}
function addToHistory(recipe) {
  state.cookHistory = state.cookHistory.filter(t => t !== recipe.title);
  state.cookHistory.unshift(recipe.title);
  if (state.cookHistory.length > 30) state.cookHistory = state.cookHistory.slice(0, 30);
  localStorage.setItem('cf4_history', JSON.stringify(state.cookHistory));
}
function buildPersonalizedPrompt(prompt) {
  if (state.cookHistory.length < 3) return prompt;
  const recent = state.cookHistory.slice(0, 5).join(', ');
  return `${prompt}. The user has enjoyed: ${recent}. Suggest something in a similar style but with variety — do not repeat those exact dishes.`;
}

// ==================== SCREEN ====================
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(`screen-${name}`);
  if (el) el.classList.add('active');
}

// ==================== HOME ====================
function bindHomeEvents() {
  document.getElementById('theme-toggle-btn').addEventListener('click', () => {
    haptic('medium');
    applyTheme(state.theme === 'dark' ? 'light' : 'dark');
  });

  document.getElementById('search-go-btn').addEventListener('click', () => {
    const q = document.getElementById('main-search').value.trim();
    if (!q) { showToast('Type something first!'); return; }
    haptic('medium');
    startFeedWithPrompt(q);
  });
  document.getElementById('main-search').addEventListener('keydown', e => {
    if (e.key === 'Enter') { document.getElementById('search-go-btn').click(); }
  });

  document.getElementById('back-to-feed-btn').addEventListener('click', () => {
    haptic('light');
    showScreen('feed');
  });

  document.querySelectorAll('.qcat:not(.pantry-qcat)').forEach(btn => {
    btn.addEventListener('click', () => {
      haptic('medium');
      startFeedWithPrompt(btn.dataset.prompt);
    });
  });

  document.getElementById('pantry-mode-btn').addEventListener('click', () => {
    haptic('light');
    showScreen('pantry');
  });
  document.getElementById('saved-btn').addEventListener('click', () => {
    haptic('light');
    renderSavedScreen();
    showScreen('saved');
  });
  document.getElementById('fridge-scan-btn').addEventListener('click', () => {
    haptic('medium');
    openFridgeScan();
  });

  document.querySelectorAll('#filters-grid .filter-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      haptic('light');
      const f = pill.dataset.filter;
      if (state.activeFilters.has(f)) { state.activeFilters.delete(f); pill.classList.remove('active'); }
      else { state.activeFilters.add(f); pill.classList.add('active'); }
      saveFilters();
    });
  });

  document.querySelectorAll('[data-back]').forEach(el => {
    el.addEventListener('click', () => { haptic('light'); showScreen(el.dataset.back); });
  });
}

// ==================== FEED ====================
async function startFeedWithPrompt(prompt) {
  state.feedRecipes = [];
  state.feedIndex = 0;
  state.feedLoading = false;
  state._carousels = {};
  state._currentPrompt = prompt;
  showScreen('feed');
  renderFeedContainer();
  document.getElementById('feed-loading').classList.remove('hidden');
  const hint = document.getElementById('swipe-hint');
  if (hint) hint.style.display = 'flex';
  await loadRecipeBatch(prompt, 3);
}

async function loadRecipeBatch(prompt, count = 3) {
  if (state.feedLoading) return;
  state.feedLoading = true;
  try {
    const pPrompt = buildPersonalizedPrompt(prompt);
    const filters = Array.from(state.activeFilters);

    let res;
    try {
      res = await fetch('/api/searchRecipes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: pPrompt, filters, count }),
      });
    } catch (netErr) {
      throw new Error(`Network error — are you online? (${netErr.message})`);
    }

    if (res.status === 404) {
      throw new Error('Functions not found (404). Check Cloudflare Pages build settings — build command must be blank, output directory must be /');
    }
    if (res.status === 500) {
      const body = await res.text().catch(() => '');
      throw new Error(`Server error: ${body || 'check environment variables in Cloudflare dashboard'}`);
    }
    if (!res.ok) {
      throw new Error(`API returned ${res.status}`);
    }

    const data = await res.json();
    if (!data.recipes?.length) throw new Error('No recipes returned');

    const existing = new Set(state.feedRecipes.map(r => r.title));
    let ci = state.feedRecipes.length;

    data.recipes.forEach(r => {
      if (existing.has(r.title)) return;
      existing.add(r.title);
      r.emoji = r.emoji || randomEmoji();
      r.bgColor = BG_COLORS[ci % BG_COLORS.length];
      r._prompt = prompt;
      r._source = data.source;
      ci++;
      state.feedRecipes.push(r);
    });

    document.getElementById('feed-loading').classList.add('hidden');
    renderFeedCards();
  } catch (err) {
    console.error('loadRecipeBatch error:', err);
    document.getElementById('feed-loading').classList.add('hidden');
    showToast(err.message || 'Could not load recipes.');
  } finally {
    state.feedLoading = false;
  }
}

function renderFeedContainer() {
  document.getElementById('feed-container').innerHTML = '';
}

function renderFeedCards() {
  const container = document.getElementById('feed-container');
  container.innerHTML = '';
  state.feedRecipes.forEach((r, i) => container.appendChild(createFeedCard(r, i)));
  updateFeedPositions();
}

function createFeedCard(recipe, index) {
  const saved = isRecipeSaved(recipe);
  const tagsHtml = (recipe.dietaryTags || []).slice(0, 3)
    .map(t => `<span class="dietary-tag">${t}</span>`).join('');
  const aiBadge = recipe._source !== 'spoonacular'
    ? `<span class="source-badge">✨ AI Generated</span>` : '';

  const div = document.createElement('div');
  div.className = 'recipe-card-full';
  div.dataset.index = index;
  div.innerHTML = `
    <div class="card-img-carousel">
      <div class="carousel-track" id="track-${index}">
        <div class="carousel-slide" style="background:${recipe.bgColor}"></div>
      </div>
      <div class="carousel-dots" id="cdots-${index}" style="display:none"></div>
      <div class="carousel-tap-prev" id="cprev-${index}"></div>
      <div class="carousel-tap-next" id="cnext-${index}"></div>
    </div>
    <div class="card-emoji-fallback" id="emoji-${index}">${recipe.emoji}</div>
    <div class="card-gradient"></div>
    <div class="card-content">
      <div class="card-top-meta">
        ${aiBadge}
        ${tagsHtml}
      </div>
      <div class="card-title">${recipe.title}</div>
      <div class="card-desc">${recipe.description}</div>
      <div class="card-actions">
        <button class="cook-this-btn">Cook This →</button>
        <button class="card-action-btn nutrition-btn" title="Nutrition">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2a9 9 0 0 1 9 9c0 5-9 13-9 13S3 16 3 11a9 9 0 0 1 9-9z"/><circle cx="12" cy="11" r="3"/></svg>
        </button>
        <button class="card-action-btn print-btn" title="Print">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
        </button>
        <button class="card-action-btn remix-btn" title="Remix">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
        </button>
        <button class="card-action-btn save-btn ${saved ? 'saved-active' : ''}" title="Save">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="${saved ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
        </button>
      </div>
    </div>`;

  // Carousel taps
  div.querySelector(`#cprev-${index}`).addEventListener('click', e => { e.stopPropagation(); carouselPrev(index); });
  div.querySelector(`#cnext-${index}`).addEventListener('click', e => { e.stopPropagation(); carouselNext(index); });

  div.querySelector('.cook-this-btn').addEventListener('click', e => { e.stopPropagation(); haptic('medium'); state.currentRecipe = state.feedRecipes[index]; startCookMode(); });
  div.querySelector('.nutrition-btn').addEventListener('click', e => { e.stopPropagation(); haptic('light'); openNutritionSheet(state.feedRecipes[index]); });
  div.querySelector('.print-btn').addEventListener('click', e => { e.stopPropagation(); haptic('light'); printRecipe(state.feedRecipes[index]); });
  div.querySelector('.remix-btn').addEventListener('click', e => { e.stopPropagation(); haptic('light'); state.currentRecipe = state.feedRecipes[index]; openRemixSheet(); });
  div.querySelector('.save-btn').addEventListener('click', e => { e.stopPropagation(); haptic('medium'); toggleSaveRecipe(state.feedRecipes[index]); renderFeedCards(); });

  // Load images after a short delay so card renders first
  setTimeout(() => loadCardImages(recipe, index), 150);

  return div;
}

function updateFeedPositions() {
  document.querySelectorAll('.recipe-card-full').forEach(card => {
    const i = parseInt(card.dataset.index);
    card.classList.remove('above', 'current', 'below', 'dragging');
    if (i < state.feedIndex) card.classList.add('above');
    else if (i === state.feedIndex) card.classList.add('current');
    else card.classList.add('below');
  });
}

// ==================== FEED SWIPE ====================
function bindFeedEvents() {
  const container = document.getElementById('feed-container');
  let startY = 0, startX = 0, currentY = 0, currentX = 0, direction = null;

  container.addEventListener('touchstart', e => {
    startY = e.touches[0].clientY;
    startX = e.touches[0].clientX;
    currentY = startY;
    currentX = startX;
    direction = null;
  }, { passive: true });

  container.addEventListener('touchmove', e => {
    currentY = e.touches[0].clientY;
    currentX = e.touches[0].clientX;
    const dy = currentY - startY;
    const dx = currentX - startX;

    // Lock direction on first significant move
    if (!direction && (Math.abs(dy) > 8 || Math.abs(dx) > 8)) {
      direction = Math.abs(dy) > Math.abs(dx) ? 'vertical' : 'horizontal';
    }

    if (direction === 'vertical') {
      const card = document.querySelector('.recipe-card-full.current');
      if (card) {
        card.classList.add('dragging');
        const resistance = Math.abs(dy) > 80 ? 0.25 : 0.45;
        card.style.transform = `translateY(${dy * resistance}px)`;
      }
    }
  }, { passive: true });

  container.addEventListener('touchend', () => {
    const dy = currentY - startY;
    const dx = currentX - startX;

    document.querySelectorAll('.recipe-card-full').forEach(c => {
      c.classList.remove('dragging');
      c.style.transform = '';
    });

    if (direction === 'vertical') {
      if (dy < -55) { haptic('light'); feedNext(); }
      else if (dy > 55) { haptic('light'); feedPrev(); }
    }
    direction = null;
  });

  document.getElementById('feed-home-btn').addEventListener('click', () => { haptic('light'); showScreen('home'); });
  document.getElementById('feed-filter-btn').addEventListener('click', () => { haptic('light'); openFilterSheet(); });
}

function feedNext() {
  const total = state.feedRecipes.length;
  if (state.feedIndex >= total - 1) {
    loadRecipeBatch(state._currentPrompt, 3).then(() => {
      if (state.feedRecipes.length > total) { state.feedIndex++; updateFeedPositions(); }
    });
    return;
  }
  state.feedIndex++;
  updateFeedPositions();
  if (total - 1 - state.feedIndex <= 2) loadRecipeBatch(state._currentPrompt, 3);
}

function feedPrev() {
  if (state.feedIndex > 0) { state.feedIndex--; updateFeedPositions(); }
}

// ==================== COOK MODE ====================
function startCookMode() {
  if (!state.currentRecipe) return;
  state.cookStep = 0;
  addToHistory(state.currentRecipe);

  const recipe = state.currentRecipe;
  const container = document.getElementById('cook-container');
  container.innerHTML = '';

  // Blurred background from carousel image
  const cookBg = document.getElementById('cook-bg-blur');
  const carousel = state._carousels[state.feedIndex];
  if (cookBg && carousel?.images?.length) {
    cookBg.style.backgroundImage = `url(${carousel.images[0]})`;
  } else if (cookBg) {
    cookBg.style.background = recipe.bgColor;
  }

  document.getElementById('cook-recipe-label').textContent = recipe.title;

  const slides = [
    { type: 'intro', ingredients: recipe.ingredients },
    ...recipe.steps.map((text, i) => ({ type: 'step', num: i + 1, text })),
    { type: 'done' },
  ];
  state._cookSlides = slides;
  slides.forEach((slide, i) => container.appendChild(createCookSlide(slide, i, slides.length)));

  renderCookDots(slides.length);
  updateCookPositions();

  document.getElementById('sheet-ingredients-list').innerHTML =
    recipe.ingredients.map(ing => `<li>${ing}</li>`).join('');

  showScreen('cook');
}

function createCookSlide(slide, index, total) {
  const div = document.createElement('div');
  div.className = 'cook-slide';
  div.dataset.index = index;

  if (slide.type === 'intro') {
    div.classList.add('cook-intro-slide');
    div.innerHTML = `
      <div class="cook-step-num-bg">00</div>
      <div class="cook-step-label">Ready to cook</div>
      <div class="cook-step-text">Gather your ingredients.</div>
      <ul class="cook-intro-list">${slide.ingredients.map(i => `<li>${i}</li>`).join('')}</ul>`;
  } else if (slide.type === 'done') {
    div.innerHTML = `
      <div class="cook-done-check">🎉</div>
      <div class="cook-step-label">Complete</div>
      <div class="cook-step-text" style="font-size:1.5rem;font-style:normal;font-weight:700">You're done! Enjoy your meal.</div>`;
  } else {
    div.innerHTML = `
      <div class="cook-step-num-bg">${String(slide.num).padStart(2, '0')}</div>
      <div class="cook-step-label">Step ${slide.num} of ${total - 2}</div>
      <div class="cook-step-text">${fixSpacing(slide.text)}</div>`;
  }
  return div;
}

function renderCookDots(total) {
  document.getElementById('cook-progress-dots').innerHTML =
    Array.from({ length: Math.min(total, 10) }, (_, i) =>
      `<div class="cpd" data-dot="${i}"></div>`).join('');
}

function updateCookPositions() {
  document.querySelectorAll('.cook-slide').forEach(s => {
    const i = parseInt(s.dataset.index);
    s.classList.remove('above', 'current', 'below', 'dragging');
    s.style.transform = '';
    if (i < state.cookStep) s.classList.add('above');
    else if (i === state.cookStep) s.classList.add('current');
    else s.classList.add('below');
  });
  document.querySelectorAll('.cpd').forEach((dot, i) => {
    dot.classList.remove('active', 'done');
    if (i === state.cookStep) dot.classList.add('active');
    else if (i < state.cookStep) dot.classList.add('done');
  });
  document.getElementById('cook-step-indicator').textContent =
    `${state.cookStep + 1} / ${state._cookSlides.length}`;
}

function bindCookEvents() {
  const container = document.getElementById('cook-container');
  let startY = 0, currentY = 0;

  container.addEventListener('touchstart', e => {
    startY = e.touches[0].clientY; currentY = startY;
  }, { passive: true });

  container.addEventListener('touchmove', e => {
    currentY = e.touches[0].clientY;
    const slide = document.querySelector('.cook-slide.current');
    if (slide) {
      slide.classList.add('dragging');
      slide.style.transform = `translateY(${(currentY - startY) * 0.32}px)`;
    }
  }, { passive: true });

  container.addEventListener('touchend', () => {
    const dy = currentY - startY;
    document.querySelectorAll('.cook-slide').forEach(s => { s.classList.remove('dragging'); s.style.transform = ''; });
    if (dy < -55) { haptic('light'); cookAdvance(); }
    else if (dy > 55) { haptic('light'); cookRetreat(); }
  });

  document.getElementById('cook-exit-btn').addEventListener('click', () => { haptic('light'); showScreen('feed'); });
  document.getElementById('cook-ingredients-peek').addEventListener('click', () => { haptic('light'); openSheet('ingredients-sheet'); });
}

function cookAdvance() {
  if (state.cookStep < state._cookSlides.length - 1) { state.cookStep++; updateCookPositions(); }
}
function cookRetreat() {
  if (state.cookStep > 0) { state.cookStep--; updateCookPositions(); }
}

// ==================== REMIX ====================
async function remixRecipe(modification) {
  if (!state.currentRecipe) return;
  closeAllSheets();
  showToast('Remixing...');
  try {
    const filters = Array.from(state.activeFilters);
    const prompt = `Take the recipe "${state.currentRecipe.title}" and ${modification}. Keep the same general dish concept.`;
    const res = await fetch('/api/searchRecipes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, filters, count: 1 }),
    });
    if (!res.ok) throw new Error('failed');
    const data = await res.json();
    const recipe = data.recipes?.[0];
    if (!recipe) throw new Error('empty');
    recipe.emoji = randomEmoji();
    recipe.bgColor = BG_COLORS[Math.floor(Math.random() * BG_COLORS.length)];
    recipe._prompt = state.currentRecipe._prompt;
    recipe._source = data.source;
    state.feedRecipes[state.feedIndex] = recipe;
    state.currentRecipe = recipe;
    delete state._carousels[state.feedIndex];
    renderFeedCards();
    showToast('Remixed! ✓');
    haptic('success');
  } catch (err) { console.error(err); showToast('Remix failed. Try again!'); }
}

// ==================== NUTRITION ====================
function openNutritionSheet(recipe) {
  if (!recipe) return;
  const n = recipe.nutrition || estimateNutrition(recipe);
  document.getElementById('nutrition-grid').innerHTML = [
    { label: 'Calories', value: n.calories, unit: 'kcal' },
    { label: 'Protein', value: n.protein, unit: 'g' },
    { label: 'Carbs', value: n.carbs, unit: 'g' },
    { label: 'Fat', value: n.fat, unit: 'g' },
  ].map(x => `<div class="nutrition-item"><div class="nutrition-value">${x.value}</div><div class="nutrition-unit">${x.unit}</div><div class="nutrition-label">${x.label}</div></div>`).join('');

  const total = n.protein + n.carbs + n.fat;
  document.getElementById('nutrition-breakdown').innerHTML = [
    { label: 'Carbs', value: n.carbs, unit: 'g', cls: 'bar-carbs', pct: Math.round(n.carbs / total * 100) },
    { label: 'Protein', value: n.protein, unit: 'g', cls: 'bar-protein', pct: Math.round(n.protein / total * 100) },
    { label: 'Fat', value: n.fat, unit: 'g', cls: 'bar-fat', pct: Math.round(n.fat / total * 100) },
    { label: 'Fiber', value: n.fiber || 5, unit: 'g', cls: 'bar-fiber', pct: 28 },
  ].map(row => `<div class="nutrition-bar-row"><div class="nutrition-bar-label"><span>${row.label}</span><span>${row.value}${row.unit}</span></div><div class="nutrition-bar-track"><div class="nutrition-bar-fill ${row.cls}" style="width:${row.pct}%"></div></div></div>`).join('');

  openSheet('nutrition-sheet');
}

function estimateNutrition(recipe) {
  const tags = (recipe.dietaryTags || []).join(' ').toLowerCase();
  const ings = (recipe.ingredients || []).join(' ').toLowerCase();
  let cal = 480, pro = 28, carb = 52, fat = 18, fib = 5;
  if (tags.includes('vegan') || tags.includes('vegetarian')) { cal -= 70; pro -= 8; fat -= 3; }
  if (tags.includes('low-carb')) { carb = Math.round(carb * 0.3); cal -= 120; }
  if (ings.includes('chicken') || ings.includes('turkey')) { pro += 10; }
  if (ings.includes('beef') || ings.includes('pork') || ings.includes('lamb')) { pro += 7; fat += 8; cal += 80; }
  if (ings.includes('pasta') || ings.includes('rice') || ings.includes('noodle')) { carb += 22; cal += 90; }
  if (ings.includes('cream') || ings.includes('butter') || ings.includes('cheese')) { fat += 12; cal += 100; }
  if (ings.includes('fish') || ings.includes('salmon') || ings.includes('tuna')) { pro += 12; fat -= 3; }
  return { calories: Math.max(180, cal), protein: Math.max(4, pro), carbs: Math.max(4, carb), fat: Math.max(3, fat), fiber: fib };
}

// ==================== PRINT ====================
function fixSpacing(text) {
  return (text || '')
    .replace(/\.([A-Za-z])/g, '. $1')
    .replace(/,([^ ])/g, ', $1')
    .replace(/:([^ \n])/g, ': $1');
}

function printRecipe(recipe) {
  const n = recipe.nutrition || estimateNutrition(recipe);
  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html><html><head><title>${recipe.title}</title><meta charset="UTF-8"/>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Georgia,serif;max-width:680px;margin:0 auto;padding:0 24px 40px;color:#1a1a1a;line-height:1.7}
    .top-bar{display:flex;align-items:center;justify-content:space-between;padding:18px 0 14px;border-bottom:1px solid #eee;margin-bottom:24px}
    .close-btn,.print-btn{border-radius:8px;padding:8px 16px;font-size:.83rem;cursor:pointer;font-family:sans-serif;border:1px solid #ddd;background:#f5f5f5;color:#333;text-decoration:none;display:inline-block}
    .print-btn{background:#ff5722;border-color:#ff5722;color:white}
    .header{border-bottom:3px solid #ff5722;padding-bottom:20px;margin-bottom:22px}
    .header-top{display:flex;align-items:center;gap:14px;margin-bottom:10px}
    .emoji{font-size:2.6rem}
    h1{font-size:1.7rem;font-weight:700;letter-spacing:-0.02em;line-height:1.2}
    .desc{color:#555;font-style:italic;margin-top:6px}
    .tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
    .tag{background:#fff3f0;border:1px solid #ff5722;border-radius:100px;padding:2px 10px;font-size:.68rem;color:#ff5722;font-family:sans-serif;font-weight:600}
    .nut-row{display:flex;gap:9px;margin:18px 0;flex-wrap:wrap}
    .nut-box{background:#fff8f6;border:1px solid #ffd0c0;border-radius:11px;padding:10px 14px;text-align:center;flex:1;min-width:58px}
    .nut-val{font-size:1.35rem;font-weight:800;color:#ff5722;font-family:sans-serif;line-height:1}
    .nut-u{font-size:.6rem;color:#aaa;font-family:sans-serif}
    .nut-l{font-size:.67rem;font-weight:600;color:#666;text-transform:uppercase;letter-spacing:.05em;font-family:sans-serif;margin-top:3px}
    h2{font-size:.85rem;text-transform:uppercase;letter-spacing:.1em;color:#ff5722;margin:22px 0 11px;font-family:sans-serif;font-weight:700}
    ul.ings{list-style:none}
    ul.ings li{padding:7px 0;border-bottom:1px solid #f0f0f0;font-size:.92rem}
    ul.ings li::before{content:'• ';color:#ff5722;font-weight:700}
    ol.steps{list-style:none}
    ol.steps li{display:flex;gap:13px;padding:10px 0;border-bottom:1px solid #f0f0f0;font-size:.92rem;line-height:1.65}
    .sn{background:#ff5722;color:white;width:24px;height:24px;min-width:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:.68rem;font-weight:700;font-family:sans-serif;margin-top:2px}
    .notes li{padding:8px 11px;background:#fff8f6;border-left:3px solid #ff5722;margin-bottom:7px;font-size:.88rem;color:#555;list-style:none;border-radius:0 6px 6px 0}
    .footer{margin-top:32px;padding-top:13px;border-top:1px solid #eee;font-size:.68rem;color:#bbb;font-family:sans-serif}
    @media print{.top-bar{display:none}body{margin:10px}}
  </style></head><body>
  <div class="top-bar">
    <a class="close-btn" onclick="window.close();return false;" href="#">← Close</a>
    <button class="print-btn" onclick="window.print()">Print / Save PDF</button>
  </div>
  <div class="header">
    <div class="header-top"><span class="emoji">${recipe.emoji || '🍽️'}</span><h1>${recipe.title}</h1></div>
    <p class="desc">${fixSpacing(recipe.description)}</p>
    ${recipe.dietaryTags?.length ? `<div class="tags">${recipe.dietaryTags.map(t => `<span class="tag">${t}</span>`).join('')}</div>` : ''}
  </div>
  <div class="nut-row">
    <div class="nut-box"><div class="nut-val">${n.calories}</div><div class="nut-u">kcal</div><div class="nut-l">Calories</div></div>
    <div class="nut-box"><div class="nut-val">${n.protein}</div><div class="nut-u">g</div><div class="nut-l">Protein</div></div>
    <div class="nut-box"><div class="nut-val">${n.carbs}</div><div class="nut-u">g</div><div class="nut-l">Carbs</div></div>
    <div class="nut-box"><div class="nut-val">${n.fat}</div><div class="nut-u">g</div><div class="nut-l">Fat</div></div>
  </div>
  <h2>Ingredients</h2>
  <ul class="ings">${recipe.ingredients.map(i => `<li>${fixSpacing(i)}</li>`).join('')}</ul>
  <h2>Instructions</h2>
  <ol class="steps">${recipe.steps.map((s, i) => `<li><span class="sn">${i + 1}</span><span>${fixSpacing(s)}</span></li>`).join('')}</ol>
  ${recipe.notes?.length ? `<h2>Notes</h2><ul class="notes">${recipe.notes.map(n => `<li>${fixSpacing(n)}</li>`).join('')}</ul>` : ''}
  <div class="footer">Printed from CookFlow &nbsp;·&nbsp; Nutrition estimates per serving</div>
  </body></html>`);
  win.document.close();
}

// ==================== PANTRY ====================
function bindPantryEvents() {
  document.getElementById('pantry-go-btn').addEventListener('click', () => {
    const text = document.getElementById('pantry-textarea').value.trim();
    if (!text) { showToast('Add some ingredients first!'); return; }
    haptic('medium');
    startFeedWithPrompt(`recipes using these ingredients: ${text}`);
  });
}

// ==================== FRIDGE SCAN ====================
function bindFridgeEvents() {
  document.getElementById('fridge-close-btn').addEventListener('click', () => { stopCamera(); showScreen('home'); });
  document.getElementById('cam-flip-btn').addEventListener('click', () => {
    haptic('light');
    state.cameraFacing = state.cameraFacing === 'environment' ? 'user' : 'environment';
    stopCamera(); startCamera();
  });
  document.getElementById('shutter-btn').addEventListener('click', () => { haptic('heavy'); capturePhoto(); });
}

async function openFridgeScan() { showScreen('fridge'); await startCamera(); }

async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: state.cameraFacing, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false,
    });
    state.cameraStream = stream;
    document.getElementById('camera-video').srcObject = stream;
  } catch (err) { console.error(err); showToast('Camera access denied.'); showScreen('home'); }
}

function stopCamera() {
  if (state.cameraStream) { state.cameraStream.getTracks().forEach(t => t.stop()); state.cameraStream = null; }
  document.getElementById('camera-video').srcObject = null;
}

async function capturePhoto() {
  const video = document.getElementById('camera-video');
  const canvas = document.getElementById('camera-canvas');
  canvas.width = video.videoWidth || 640; canvas.height = video.videoHeight || 480;
  canvas.getContext('2d').drawImage(video, 0, 0);
  const base64 = canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
  document.getElementById('scan-overlay').classList.remove('hidden');
  try {
    const res = await fetch('/api/scanFridge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: base64 }) });
    if (!res.ok) throw new Error(`${res.status}`);
    const data = await res.json();
    if (!data.ingredients?.length) { showToast('No ingredients detected. Try a clearer photo!'); return; }
    state.detectedIngredients = [...data.ingredients];
    stopCamera();
    renderIngredientConfirm(data.ingredients);
    showScreen('ingredients-confirm');
    haptic('success');
  } catch (err) { console.error(err); showToast('Scan failed. Try again!'); }
  finally { document.getElementById('scan-overlay').classList.add('hidden'); }
}

// ==================== INGREDIENT CONFIRM ====================
function renderIngredientConfirm(ingredients) {
  document.getElementById('ingredient-chips-wrap').innerHTML = '';
  ingredients.forEach(ing => addIngredientChip(ing));
}

function addIngredientChip(ing) {
  const wrap = document.getElementById('ingredient-chips-wrap');
  const chip = document.createElement('div');
  chip.className = 'ingredient-chip';
  chip.innerHTML = `<span>${ing}</span><span class="chip-x">✕</span>`;
  chip.addEventListener('click', () => {
    haptic('light');
    const idx = state.detectedIngredients.indexOf(ing);
    if (idx > -1) state.detectedIngredients.splice(idx, 1);
    chip.remove();
  });
  wrap.appendChild(chip);
}

function bindIngredientConfirmEvents() {
  document.getElementById('add-ingredient-btn').addEventListener('click', () => {
    const input = document.getElementById('add-ingredient-input');
    const val = input.value.trim(); if (!val) return;
    haptic('light');
    state.detectedIngredients.push(val); addIngredientChip(val); input.value = '';
  });
  document.getElementById('add-ingredient-input').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('add-ingredient-btn').click(); });
  document.getElementById('confirm-generate-btn').addEventListener('click', () => {
    const ings = state.detectedIngredients;
    if (!ings.length) { showToast('Add at least one ingredient!'); return; }
    haptic('medium');
    startFeedWithPrompt(`recipes using these ingredients: ${ings.join(', ')}`);
  });
}

// ==================== SAVED ====================
function getSavedRecipes() { try { return JSON.parse(localStorage.getItem('cf4_saved') || '[]'); } catch { return []; } }
function isRecipeSaved(recipe) { return getSavedRecipes().some(r => r.title === recipe.title); }
function toggleSaveRecipe(recipe) {
  const saved = getSavedRecipes();
  const idx = saved.findIndex(r => r.title === recipe.title);
  if (idx > -1) { saved.splice(idx, 1); showToast('Removed.'); }
  else { saved.unshift({ ...recipe, savedAt: Date.now() }); showToast('Saved ✓'); }
  localStorage.setItem('cf4_saved', JSON.stringify(saved));
}

function renderSavedScreen() {
  const saved = getSavedRecipes();
  const list = document.getElementById('saved-list');
  const empty = document.getElementById('saved-empty');
  list.innerHTML = '';
  if (!saved.length) { empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');
  saved.forEach(recipe => {
    const card = document.createElement('div');
    card.className = 'saved-card';
    card.innerHTML = `
      <div class="saved-card-emoji">${recipe.emoji || '🍽️'}</div>
      <div class="saved-card-info">
        <div class="saved-card-title">${recipe.title}</div>
        <div class="saved-card-desc">${recipe.description}</div>
      </div>
      <div class="saved-card-btns">
        <button class="saved-card-btn print-s" title="Print"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg></button>
        <button class="saved-card-btn del-s" title="Remove"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      </div>`;
    card.querySelector('.del-s').addEventListener('click', e => { e.stopPropagation(); haptic('light'); toggleSaveRecipe(recipe); renderSavedScreen(); });
    card.querySelector('.print-s').addEventListener('click', e => { e.stopPropagation(); haptic('light'); printRecipe(recipe); });
    card.addEventListener('click', () => {
      haptic('medium');
      state.feedRecipes = [{ ...recipe, bgColor: recipe.bgColor || BG_COLORS[0] }];
      state.feedIndex = 0; showScreen('feed'); renderFeedCards();
    });
    list.appendChild(card);
  });
}

// ==================== SHEETS ====================
function openSheet(id) { document.getElementById(id).classList.remove('hidden'); document.getElementById('sheet-backdrop').classList.remove('hidden'); }
function closeAllSheets() { document.querySelectorAll('.bottom-sheet').forEach(s => s.classList.add('hidden')); document.getElementById('sheet-backdrop').classList.add('hidden'); }
function openRemixSheet() { openSheet('remix-sheet'); }

function openFilterSheet() {
  const grid = document.getElementById('sheet-filters-grid');
  grid.innerHTML = '';
  const FILTERS = ['vegetarian','vegan','gluten-free','dairy-free','nut-free','shellfish-free','low-carb','halal','kosher'];
  const LABELS = { 'vegetarian': 'Vegetarian', 'vegan': 'Vegan', 'gluten-free': 'Gluten-Free', 'dairy-free': 'Dairy-Free', 'nut-free': 'Nut-Free', 'shellfish-free': 'Shellfish-Free', 'low-carb': 'Low-Carb', 'halal': 'Halal', 'kosher': 'Kosher' };
  FILTERS.forEach(f => {
    const pill = document.createElement('button');
    pill.className = 'filter-pill' + (state.activeFilters.has(f) ? ' active' : '');
    pill.textContent = LABELS[f];
    pill.addEventListener('click', () => {
      haptic('light');
      if (state.activeFilters.has(f)) { state.activeFilters.delete(f); pill.classList.remove('active'); }
      else { state.activeFilters.add(f); pill.classList.add('active'); }
      saveFilters(); syncHomeFilterPills();
    });
    grid.appendChild(pill);
  });
  openSheet('filter-sheet');
}

function bindSheetEvents() {
  document.getElementById('sheet-backdrop').addEventListener('click', () => { haptic('light'); closeAllSheets(); });
  document.getElementById('sheet-close-btn').addEventListener('click', closeAllSheets);
  document.getElementById('nutrition-close-btn').addEventListener('click', closeAllSheets);
  document.getElementById('remix-close-btn').addEventListener('click', closeAllSheets);
  document.querySelectorAll('.remix-chip').forEach(chip => chip.addEventListener('click', () => { haptic('medium'); remixRecipe(chip.dataset.mod); }));
  document.getElementById('remix-custom-go').addEventListener('click', () => {
    const val = document.getElementById('remix-custom-input').value.trim();
    if (val) { haptic('medium'); remixRecipe(val); }
  });
  document.getElementById('remix-custom-input').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('remix-custom-go').click(); });
  document.getElementById('filter-apply-btn').addEventListener('click', () => {
    haptic('medium'); closeAllSheets();
    if (document.getElementById('screen-feed').classList.contains('active') && state._currentPrompt) startFeedWithPrompt(state._currentPrompt);
    showToast('Filters applied!');
  });
}

// ==================== FILTERS ====================
function saveFilters() { localStorage.setItem('cf4_filters', JSON.stringify([...state.activeFilters])); syncHomeFilterPills(); }
function restoreFilters() { try { JSON.parse(localStorage.getItem('cf4_filters') || '[]').forEach(f => state.activeFilters.add(f)); syncHomeFilterPills(); } catch {} }
function syncHomeFilterPills() { document.querySelectorAll('#filters-grid .filter-pill').forEach(p => p.classList.toggle('active', state.activeFilters.has(p.dataset.filter))); }

// ==================== TOAST ====================
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.remove('hidden'); t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.classList.add('hidden'), 300); }, 2600);
}

// ==================== UTILS ====================
function randomEmoji() { return FOOD_EMOJIS[Math.floor(Math.random() * FOOD_EMOJIS.length)]; }
