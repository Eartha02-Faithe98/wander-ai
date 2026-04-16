/**
 * WanderAI — AI 智慧旅遊推薦
 * 主程式入口
 */

import './styles.css';
import { icons, renderStars } from './icons.js';
import {
  getSearchHistory,
  addSearchHistory,
  clearSearchHistory,
  getTheme,
  setTheme,
  toggleTheme,
  getApiKey,
  saveApiKey,
} from './storage.js';
import { getRecommendations } from './gemini.js';

// ============================================
// 全域狀態
// ============================================
let currentPage = 'home'; // 'home' | 'results'
let currentCategory = 'attractions'; // 'attractions' | 'restaurants' | 'accommodations' | 'transportation'
let currentData = null; // 推薦資料
let isLoading = false;

// ============================================
// 安全工具：HTML 跳脫（防止 XSS 注入）
// ============================================
function escapeHtml(str) {
  if (str == null) return '';
  const s = String(str);
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

// ============================================
// Wikipedia 圖片載入（免費、無需 API Key）
// ============================================
const imageCache = new Map();

/**
 * 透過 Wikipedia REST API 精確標題查詢
 * @param {string} title - 英文 Wikipedia 標題
 * @returns {Promise<string|null>}
 */
async function fetchByTitle(title) {
  try {
    const slug = title.replace(/\s+/g, '_');
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(slug)}`;
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (res.ok) {
      const data = await res.json();
      return data?.thumbnail?.source || null;
    }
  } catch { /* 忽略 */ }
  return null;
}

/**
 * 透過 Wikipedia 搜尋 API 模糊查詢
 * @param {string} keyword - 搜尋關鍵字
 * @returns {Promise<string|null>}
 */
async function fetchBySearch(keyword) {
  try {
    const url = `https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(keyword)}&gsrlimit=3&prop=pageimages&piprop=thumbnail&pithumbsize=400&format=json&origin=*`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      const pages = data?.query?.pages;
      if (pages) {
        // 找到第一個有圖片的頁面
        for (const page of Object.values(pages)) {
          if (page?.thumbnail?.source) return page.thumbnail.source;
        }
      }
    }
  } catch { /* 忽略 */ }
  return null;
}

/**
 * 多層搜尋策略取得圖片
 * @param {string} keyword - 主要關鍵字
 * @param {string} [fallbackKeyword] - 備用關鍵字
 * @returns {Promise<string|null>}
 */
async function fetchWikiImage(keyword, fallbackKeyword) {
  if (!keyword && !fallbackKeyword) return null;

  const cacheKey = keyword || fallbackKeyword;
  if (imageCache.has(cacheKey)) return imageCache.get(cacheKey);

  // 策略 1: 精確標題查詢
  let imgUrl = keyword ? await fetchByTitle(keyword) : null;

  // 策略 2: Wikipedia 搜尋（主關鍵字）
  if (!imgUrl && keyword) {
    imgUrl = await fetchBySearch(keyword);
  }

  // 策略 3: 用備用關鍵字搜尋（例如用菜名 + food）
  if (!imgUrl && fallbackKeyword && fallbackKeyword !== keyword) {
    imgUrl = await fetchBySearch(fallbackKeyword);
  }

  // 策略 4: 用主關鍵字 + "food"/"cuisine" 等後綴搜尋
  if (!imgUrl && keyword) {
    imgUrl = await fetchBySearch(`${keyword} food`);
  }

  imageCache.set(cacheKey, imgUrl);
  return imgUrl;
}

/**
 * 非同步載入所有卡片的 Wikipedia 圖片
 */
function loadCardImages() {
  document.querySelectorAll('.rec-card__image[data-keyword]').forEach(async (el) => {
    const keyword = el.dataset.keyword;
    const name = el.dataset.name || '';
    if (!keyword && !name) return;

    const imgUrl = await fetchWikiImage(keyword, name);
    if (imgUrl) {
      const img = new Image();
      img.onload = () => {
        img.className = 'rec-card__real-image';
        img.alt = name;
        el.appendChild(img);
        requestAnimationFrame(() => img.classList.add('rec-card__real-image--loaded'));
      };
      img.src = imgUrl;
    }
  });
}

// ============================================
// 初始化
// ============================================
function init() {
  // 套用主題
  const theme = getTheme();
  setTheme(theme);

  // 渲染首頁
  renderApp();

  // 監聽 hash 變化（用於前後導航）
  window.addEventListener('hashchange', handleHashChange);

  // 檢查初始 hash
  handleHashChange();
}

function handleHashChange() {
  const hash = window.location.hash;
  if (hash.startsWith('#/results/')) {
    const destination = decodeURIComponent(hash.replace('#/results/', ''));
    if (destination && destination !== currentData?.destination_name) {
      navigateToResults(destination);
    }
  } else {
    currentPage = 'home';
    renderApp();
  }
}

// ============================================
// 路由與導航
// ============================================
function navigateToHome() {
  currentPage = 'home';
  currentData = null;
  window.location.hash = '';
  renderApp();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function navigateToResults(destination) {
  const apiKey = getApiKey();
  if (!apiKey) {
    showApiKeyModal(destination);
    return;
  }

  currentPage = 'results';
  isLoading = true;
  renderApp();
  window.scrollTo({ top: 0, behavior: 'smooth' });

  // 儲存搜尋歷史
  addSearchHistory(destination);

  // 更新 URL hash
  window.location.hash = `#/results/${encodeURIComponent(destination)}`;

  try {
    const data = await getRecommendations(destination, apiKey);
    currentData = data;
    isLoading = false;
    renderApp();
  } catch (error) {
    isLoading = false;
    currentPage = 'error';
    renderApp();
    renderError(error.message);
  }
}

// ============================================
// 主要渲染函式
// ============================================
function renderApp() {
  const app = document.getElementById('app');

  if (currentPage === 'home') {
    app.innerHTML = renderNavbar() + renderHomePage() + renderFooter();
    bindHomeEvents();
  } else if (currentPage === 'results' && isLoading) {
    app.innerHTML = renderNavbar() + renderLoadingPage();
    bindNavEvents();
  } else if (currentPage === 'results' && currentData) {
    app.innerHTML = renderNavbar() + renderResultsPage() + renderFooter();
    bindResultsEvents();
  } else if (currentPage === 'error') {
    app.innerHTML = renderNavbar() + '<div id="error-container"></div>';
    bindNavEvents();
  }
}

// ============================================
// 導航列
// ============================================
function renderNavbar() {
  const theme = getTheme();
  const themeIcon = theme === 'dark' ? icons.sun : icons.moon;
  const themeLabel = theme === 'dark' ? '淺色' : '深色';

  return `
    <nav class="navbar" role="navigation" aria-label="主導航">
      <div class="navbar__logo" id="nav-logo" tabindex="0" role="button" aria-label="回到首頁">
        <div class="navbar__logo-icon">W</div>
        <span>WanderAI</span>
      </div>
      <div class="navbar__actions">
        <button class="navbar__btn" id="btn-api-key" aria-label="設定 API Key">
          ${icons.key}
          <span>API Key</span>
        </button>
        <button class="navbar__btn" id="btn-theme" aria-label="切換${themeLabel}模式">
          ${themeIcon}
        </button>
      </div>
    </nav>
  `;
}

function bindNavEvents() {
  document.getElementById('nav-logo')?.addEventListener('click', navigateToHome);
  document.getElementById('nav-logo')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') navigateToHome();
  });
  document.getElementById('btn-theme')?.addEventListener('click', () => {
    toggleTheme();
    renderApp();
  });
  document.getElementById('btn-api-key')?.addEventListener('click', () => {
    showApiKeyModal();
  });
}

// ============================================
// 首頁
// ============================================
function renderHomePage() {
  const history = getSearchHistory();

  const popularDestinations = [
    { name: '東京', flag: '🇯🇵' },
    { name: '巴黎', flag: '🇫🇷' },
    { name: '首爾', flag: '🇰🇷' },
    { name: '曼谷', flag: '🇹🇭' },
    { name: '紐約', flag: '🇺🇸' },
    { name: '峇里島', flag: '🇮🇩' },
    { name: '倫敦', flag: '🇬🇧' },
    { name: '大阪', flag: '🇯🇵' },
  ];

  let historyHtml = '';
  if (history.length > 0) {
    historyHtml = `
      <div class="search-history">
        <div class="search-history__header">
          <span class="search-history__label">最近搜尋</span>
          <button class="search-history__clear" id="btn-clear-history">清除全部</button>
        </div>
        <div class="search-history__list">
          ${history.map((item) => `<button class="search-history__item" data-destination="${item}">${item}</button>`).join('')}
        </div>
      </div>
    `;
  }

  return `
    <section class="hero">
      <div class="hero__bg-orb hero__bg-orb--1"></div>
      <div class="hero__bg-orb hero__bg-orb--2"></div>
      <div class="hero__bg-orb hero__bg-orb--3"></div>

      <div class="hero__badge">
        ${icons.sparkles}
        <span>AI 智慧推薦，探索無限可能</span>
      </div>

      <h1 class="hero__title">
        你的下一趟旅程<br/>
        由 <span class="hero__title-gradient">AI 為你規劃</span>
      </h1>

      <p class="hero__subtitle">
        輸入你想去的地方，AI 會立即為你推薦當地最值得造訪的景點、必吃美食、舒適住宿和便捷交通
      </p>

      <div class="search-box">
        <form class="search-box__wrapper" id="search-form">
          <div class="search-box__icon">${icons.mapPin}</div>
          <input
            type="text"
            class="search-box__input"
            id="search-input"
            placeholder="輸入目的地，例如：東京、巴黎、峇里島..."
            autocomplete="off"
            aria-label="輸入旅遊目的地"
          />
          <button type="submit" class="search-box__submit" id="search-submit">
            <span>探索</span>
            ${icons.arrowRight}
          </button>
        </form>
      </div>

      <div class="popular-destinations">
        <p class="popular-destinations__label">熱門目的地</p>
        <div class="popular-destinations__list">
          ${popularDestinations
            .map(
              (d) => `<button class="popular-destinations__btn" data-destination="${d.name}">
                <span>${d.flag}</span>
                <span>${d.name}</span>
              </button>`
            )
            .join('')}
        </div>
      </div>

      ${historyHtml}
    </section>
  `;
}

function bindHomeEvents() {
  bindNavEvents();

  // 搜尋表單
  document.getElementById('search-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('search-input');
    const value = input?.value.trim();
    if (value) {
      navigateToResults(value);
    }
  });

  // 熱門目的地按鈕
  document.querySelectorAll('.popular-destinations__btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const dest = btn.dataset.destination;
      navigateToResults(dest);
    });
  });

  // 搜尋歷史項目
  document.querySelectorAll('.search-history__item').forEach((item) => {
    item.addEventListener('click', () => {
      navigateToResults(item.dataset.destination);
    });
  });

  // 清除歷史
  document.getElementById('btn-clear-history')?.addEventListener('click', () => {
    clearSearchHistory();
    renderApp();
  });

  // 自動聚焦搜尋框
  setTimeout(() => {
    document.getElementById('search-input')?.focus();
  }, 600);
}

// ============================================
// 載入中頁面
// ============================================
function renderLoadingPage() {
  const skeletonCards = Array(6)
    .fill(0)
    .map(
      () => `
    <div class="skeleton-card">
      <div class="skeleton-card__image skeleton"></div>
      <div class="skeleton-card__body">
        <div class="skeleton-card__title skeleton"></div>
        <div class="skeleton-card__line skeleton-card__line--short skeleton"></div>
        <div class="skeleton-card__line skeleton-card__line--long skeleton"></div>
        <div class="skeleton-card__line skeleton-card__line--medium skeleton"></div>
      </div>
    </div>
  `
    )
    .join('');

  return `
    <div class="results-page">
      <div class="loading-overlay">
        <div class="loading-spinner"></div>
        <p class="loading-text">AI 正在為你搜尋最佳推薦...</p>
        <p class="loading-subtext">這可能需要幾秒鐘，請稍候</p>
      </div>
      <div class="cards-grid" style="opacity: 0.5;">
        ${skeletonCards}
      </div>
    </div>
  `;
}

// ============================================
// 結果頁
// ============================================
function renderResultsPage() {
  if (!currentData) return '';

  const data = currentData;

  // 分類頁籤
  const categories = [
    { key: 'attractions', label: '景點推薦', icon: icons.mapPin },
    { key: 'restaurants', label: '美食推薦', icon: icons.utensils },
    { key: 'accommodations', label: '住宿推薦', icon: icons.bed },
    { key: 'transportation', label: '交通工具', icon: icons.truck },
  ];

  // 取得當前分類的資料
  const items = data[currentCategory] || [];

  return `
    <div class="results-page">
      <!-- 目的地標題 -->
      <header class="results-header">
        <h1 class="results-header__destination">
          探索 <span class="gradient-text">${escapeHtml(data.destination_name)}</span>
        </h1>
        <div class="results-header__meta">
          <span class="results-header__meta-item">${icons.mapPin} ${escapeHtml(data.destination_country)}</span>
          <span class="results-header__meta-item">${icons.calendar} 建議 ${escapeHtml(data.suggested_days)}</span>
          <span class="results-header__meta-item">${icons.clock} 最佳季節：${escapeHtml(data.best_season)}</span>
        </div>
      </header>

      <!-- 旅遊資訊卡片 -->
      <div class="travel-info">
        <!-- 旅遊小撇步 -->
        <div class="info-card">
          <div class="info-card__icon info-card__icon--tips">${icons.info}</div>
          <h3 class="info-card__title">旅遊小撇步</h3>
          <ul class="info-card__list">
            ${(data.travel_tips || []).map((tip) => `<li>${escapeHtml(tip)}</li>`).join('')}
          </ul>
        </div>

        <!-- 預估旅費 -->
        <div class="info-card">
          <div class="info-card__icon info-card__icon--budget">${icons.wallet}</div>
          <h3 class="info-card__title">預估旅費</h3>
          <div class="info-card__content">
            <p style="font-size: 1.2rem; font-weight: 800; color: var(--primary-500); margin-bottom: 8px;">
              ${escapeHtml(data.budget_range_twd) || '資料載入中'}
            </p>
            <p style="margin-bottom: 12px; font-size: 0.82rem;">每日約 ${escapeHtml(data.daily_budget_twd) || '-'}</p>
            <ul class="info-card__list">
              <li>住宿：${escapeHtml(data.budget_accommodation) || '-'} / 晚</li>
              <li>餐飲：${escapeHtml(data.budget_meals) || '-'} / 日</li>
              <li>交通：${escapeHtml(data.budget_transportation) || '-'} / 日</li>
              <li>活動：${escapeHtml(data.budget_activities) || '-'} / 日</li>
            </ul>
          </div>
        </div>

        <!-- 最佳旅遊季節 -->
        <div class="info-card">
          <div class="info-card__icon info-card__icon--season">${icons.calendar}</div>
          <h3 class="info-card__title">旅遊季節建議</h3>
          <div class="info-card__content">
            <p style="font-weight: 600; margin-bottom: 8px;">${escapeHtml(data.best_season)}</p>
            <p>建議停留天數：<strong>${escapeHtml(data.suggested_days)}</strong></p>
            <p style="margin-top: 8px;">當地貨幣：${escapeHtml(data.currency) || '-'}</p>
          </div>
        </div>
      </div>

      <!-- 分類頁籤 -->
      <div class="category-tabs" role="tablist" aria-label="推薦類別">
        ${categories
          .map(
            (cat) => `
          <button
            class="category-tab ${cat.key === currentCategory ? 'category-tab--active' : ''}"
            data-category="${cat.key}"
            role="tab"
            aria-selected="${cat.key === currentCategory}"
            aria-controls="cards-panel"
          >
            ${cat.icon}
            <span>${cat.label}</span>
          </button>
        `
          )
          .join('')}
      </div>

      <!-- 推薦卡片 -->
      <div class="cards-grid" id="cards-panel" role="tabpanel">
        ${items.map((item, index) => renderCard(item, index)).join('')}
      </div>
    </div>
  `;
}

function renderCard(item, index) {
  const rank = index + 1;
  let rankClass = 'rec-card__rank--default';
  if (rank === 1) rankClass = 'rec-card__rank--1';
  else if (rank === 2) rankClass = 'rec-card__rank--2';
  else if (rank === 3) rankClass = 'rec-card__rank--3';

  // 每個分類的 emoji 池（讓每張卡片有不同 emoji）
  const categoryEmojis = {
    attractions: ['🏛️', '⛩️', '🗼', '🏰', '🎡', '🌸', '🌊', '⛰️', '🎭', '🌄'],
    restaurants: ['🍜', '🍣', '🍕', '🥘', '🍱', '☕', '🍰', '🍤', '🥗', '🍲'],
    accommodations: ['🏨', '🏡', '🛏️', '✨', '🌃', '🏢', '🌅', '🌙', '🛋️', '🏠'],
    transportation: ['🚅', '🚇', '🚌', '🚕', '✈️', '🚢', '🚲', '🛵', '🚶', '🗺️'],
  };

  // 每個分類的漸層色系
  const categoryGradients = {
    attractions: [
      ['#667eea', '#764ba2'], ['#f093fb', '#f5576c'], ['#4facfe', '#00f2fe'],
      ['#43e97b', '#38f9d7'], ['#fa709a', '#fee140'], ['#a18cd1', '#fbc2eb'],
      ['#ffecd2', '#fcb69f'], ['#ff9a9e', '#fecfef'], ['#667eea', '#764ba2'],
      ['#89f7fe', '#66a6ff'],
    ],
    restaurants: [
      ['#f97316', '#ef4444'], ['#fbbf24', '#f97316'], ['#ec4899', '#f43f5e'],
      ['#f59e0b', '#d97706'], ['#fb923c', '#e11d48'], ['#a855f7', '#ec4899'],
      ['#facc15', '#fb923c'], ['#f472b6', '#f97316'], ['#ef4444', '#fbbf24'],
      ['#f43f5e', '#fb923c'],
    ],
    accommodations: [
      ['#3b82f6', '#1d4ed8'], ['#6366f1', '#8b5cf6'], ['#0ea5e9', '#06b6d4'],
      ['#2563eb', '#7c3aed'], ['#6d28d9', '#4f46e5'], ['#0284c7', '#0369a1'],
      ['#8b5cf6', '#6366f1'], ['#1e40af', '#3b82f6'], ['#4f46e5', '#7c3aed'],
      ['#0891b2', '#0e7490'],
    ],
    transportation: [
      ['#10b981', '#059669'], ['#14b8a6', '#0d9488'], ['#06b6d4', '#0891b2'],
      ['#22c55e', '#16a34a'], ['#34d399', '#10b981'], ['#2dd4bf', '#14b8a6'],
      ['#059669', '#047857'], ['#0d9488', '#0f766e'], ['#10b981', '#06b6d4'],
      ['#16a34a', '#15803d'],
    ],
  };

  const emojis = categoryEmojis[currentCategory] || categoryEmojis.attractions;
  const gradients = categoryGradients[currentCategory] || categoryGradients.attractions;
  const emoji = emojis[index % emojis.length];
  const [color1, color2] = gradients[index % gradients.length];

  const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.google_maps_query || item.name)}`;

  // rating 和 review_count 現在是字串，需要解析
  const ratingNum = parseFloat(item.rating) || 0;
  const reviewCountNum = parseInt(item.review_count?.replace(/[^0-9]/g, ''), 10) || 0;
  const reviewText =
    reviewCountNum >= 1000
      ? `${(reviewCountNum / 1000).toFixed(1)}K 則評論`
      : reviewCountNum > 0
        ? `${reviewCountNum} 則評論`
        : item.review_count ? `${item.review_count} 則評論` : '- 則評論';

  return `
    <article class="rec-card" style="animation-delay: ${index * 0.05}s">
      <div class="rec-card__rank ${rankClass}">#${rank}</div>
      <div class="rec-card__image" style="background: linear-gradient(135deg, ${color1}, ${color2});" data-keyword="${escapeHtml(item.image_keyword || '')}" data-name="${escapeHtml(item.name)}">
        <div class="rec-card__image-pattern"></div>
        <span class="rec-card__image-emoji">${emoji}</span>
      </div>
      <div class="rec-card__body">
        <h3 class="rec-card__name">
          ${escapeHtml(item.name)}
          <span class="rec-card__category-tag">${escapeHtml(item.category)}</span>
        </h3>
        <div class="rec-card__rating">
          <div class="rec-card__stars">${renderStars(ratingNum)}</div>
          <span class="rec-card__rating-number">${escapeHtml(item.rating)}</span>
          <span class="rec-card__reviews">(${escapeHtml(reviewText)})</span>
        </div>
        <p class="rec-card__description">${escapeHtml(item.description)}</p>
        <div class="rec-card__footer">
          <span class="rec-card__price">${icons.wallet} ${escapeHtml(item.price_range)}</span>
          <a href="${googleMapsUrl}" target="_blank" rel="noopener noreferrer"
             class="rec-card__gmaps" aria-label="在 Google Maps 查看 ${escapeHtml(item.name)}">
            ${icons.externalLink} Maps
          </a>
        </div>
      </div>
    </article>
  `;
}

function bindResultsEvents() {
  bindNavEvents();

  // 分類頁籤切換
  document.querySelectorAll('.category-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      currentCategory = tab.dataset.category;
      renderApp();
    });
  });

  // 非同步載入卡片圖片
  loadCardImages();
}

// ============================================
// 錯誤狀態
// ============================================
function renderError(message) {
  const container = document.getElementById('error-container');
  if (!container) return;

  container.innerHTML = `
    <div class="error-state">
      <div class="error-state__icon">${icons.warning}</div>
      <h2 class="error-state__title">發生錯誤</h2>
      <p class="error-state__message">${escapeHtml(message)}</p>
      <button class="error-state__btn" id="btn-go-home">返回首頁</button>
    </div>
  `;

  document.getElementById('btn-go-home')?.addEventListener('click', navigateToHome);
}

// ============================================
// API Key 設定 Modal
// ============================================
function showApiKeyModal(pendingDestination = null) {
  const existing = getApiKey() || '';

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'api-key-modal';
  overlay.innerHTML = `
    <div class="modal">
      <h2 class="modal__title">設定 Gemini API Key</h2>
      <p class="modal__description">
        請輸入你的 Gemini API Key 以啟用 AI 推薦功能。<br/>
        你可以在 <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">Google AI Studio</a> 免費取得。<br/>
        <br/>
        <small style="color: var(--text-tertiary);">API Key 僅儲存在你的瀏覽器本地，不會傳送到任何第三方伺服器。</small>
      </p>
      <label for="api-key-input" style="display:block; font-size: 0.85rem; font-weight: 600; margin-bottom: 6px; color: var(--text-secondary);">API Key</label>
      <input
        type="password"
        class="modal__input"
        id="api-key-input"
        placeholder="AIzaSy..."
        value="${existing}"
        aria-label="Gemini API Key"
      />
      <div class="modal__actions">
        <button class="modal__btn modal__btn--secondary" id="modal-cancel">取消</button>
        <button class="modal__btn modal__btn--primary" id="modal-save">儲存</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // 聚焦輸入框
  setTimeout(() => document.getElementById('api-key-input')?.focus(), 100);

  // 事件綁定
  document.getElementById('modal-cancel')?.addEventListener('click', () => {
    overlay.remove();
  });

  document.getElementById('modal-save')?.addEventListener('click', () => {
    const key = document.getElementById('api-key-input')?.value.trim();
    if (key) {
      saveApiKey(key);
      overlay.remove();
      // 如果有待搜尋的目的地，繼續搜尋
      if (pendingDestination) {
        navigateToResults(pendingDestination);
      }
    }
  });

  // 按 Enter 儲存
  document.getElementById('api-key-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      document.getElementById('modal-save')?.click();
    }
  });

  // 點擊外層關閉
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      overlay.remove();
    }
  });
}

// ============================================
// 頁尾
// ============================================
function renderFooter() {
  return `
    <footer class="footer">
      <p>WanderAI — Powered by Google Gemini AI</p>
      <p class="footer__disclaimer">
        推薦資料由 AI 生成，星星評分和評論數為參考值，實際數據可能有所差異。<br/>
        請以 Google Maps 上的即時資訊為準。
      </p>
    </footer>
  `;
}

// ============================================
// 啟動應用程式
// ============================================
init();
