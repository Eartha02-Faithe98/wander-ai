/**
 * localStorage 工具模組
 * 管理搜尋歷史和使用者偏好設定
 */

const KEYS = {
  SEARCH_HISTORY: 'wanderai_search_history',
  THEME: 'wanderai_theme',
  API_KEY: 'wanderai_api_key',
};

const MAX_HISTORY = 10;

/**
 * 取得搜尋歷史
 * @returns {string[]}
 */
export function getSearchHistory() {
  try {
    const data = localStorage.getItem(KEYS.SEARCH_HISTORY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

/**
 * 新增搜尋歷史
 * @param {string} destination
 */
export function addSearchHistory(destination) {
  const trimmed = destination.trim();
  if (!trimmed) return;

  const history = getSearchHistory();
  // 移除重複項目
  const filtered = history.filter(
    (item) => item.toLowerCase() !== trimmed.toLowerCase()
  );
  // 新增到最前面
  filtered.unshift(trimmed);
  // 限制數量
  const limited = filtered.slice(0, MAX_HISTORY);

  localStorage.setItem(KEYS.SEARCH_HISTORY, JSON.stringify(limited));
}

/**
 * 清除搜尋歷史
 */
export function clearSearchHistory() {
  localStorage.removeItem(KEYS.SEARCH_HISTORY);
}

/**
 * 取得主題偏好
 * @returns {'light'|'dark'}
 */
export function getTheme() {
  const saved = localStorage.getItem(KEYS.THEME);
  if (saved) return saved;

  // 偵測系統偏好
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

/**
 * 設定主題
 * @param {'light'|'dark'} theme
 */
export function setTheme(theme) {
  localStorage.setItem(KEYS.THEME, theme);
  document.documentElement.setAttribute('data-theme', theme);
}

/**
 * 切換主題
 * @returns {'light'|'dark'} 切換後的主題
 */
export function toggleTheme() {
  const current = getTheme();
  const next = current === 'dark' ? 'light' : 'dark';
  setTheme(next);
  return next;
}

/**
 * 取得 API Key
 * @returns {string|null}
 */
export function getApiKey() {
  return localStorage.getItem(KEYS.API_KEY);
}

/**
 * 儲存 API Key
 * @param {string} key
 */
export function saveApiKey(key) {
  localStorage.setItem(KEYS.API_KEY, key.trim());
}

/**
 * 移除 API Key
 */
export function removeApiKey() {
  localStorage.removeItem(KEYS.API_KEY);
}
