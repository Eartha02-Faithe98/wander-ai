/**
 * Gemini API 整合模組
 * 使用 REST API 直接呼叫（避免前端 SDK 打包問題）
 * 模型：優先使用 gemini-2.5-flash（穩定版），失敗則回退至 gemini-2.5-flash-lite
 * 結構化輸出：application/json + responseJsonSchema
 */

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
// 模型優先順序：穩定版 > Lite 版
const MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];

/**
 * 推薦資料的 JSON Schema
 * 定義回傳結構：景點、美食、住宿、交通各 10 項
 */
const RECOMMENDATION_SCHEMA = {
  type: 'object',
  properties: {
    destination_name: { type: 'string' },
    destination_country: { type: 'string' },
    best_season: { type: 'string' },
    suggested_days: { type: 'string' },
    currency: { type: 'string' },
    budget_range_twd: { type: 'string' },
    daily_budget_twd: { type: 'string' },
    budget_accommodation: { type: 'string' },
    budget_meals: { type: 'string' },
    budget_transportation: { type: 'string' },
    budget_activities: { type: 'string' },
    travel_tips: {
      type: 'array',
      items: { type: 'string' },
    },
    attractions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          rating: { type: 'string' },
          review_count: { type: 'string' },
          category: { type: 'string' },
          description: { type: 'string' },
          price_range: { type: 'string' },
          google_maps_query: { type: 'string' },
        },
        required: ['name', 'rating', 'review_count', 'category', 'description', 'price_range', 'google_maps_query'],
      },
    },
    restaurants: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          rating: { type: 'string' },
          review_count: { type: 'string' },
          category: { type: 'string' },
          description: { type: 'string' },
          price_range: { type: 'string' },
          google_maps_query: { type: 'string' },
        },
        required: ['name', 'rating', 'review_count', 'category', 'description', 'price_range', 'google_maps_query'],
      },
    },
    accommodations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          rating: { type: 'string' },
          review_count: { type: 'string' },
          category: { type: 'string' },
          description: { type: 'string' },
          price_range: { type: 'string' },
          google_maps_query: { type: 'string' },
        },
        required: ['name', 'rating', 'review_count', 'category', 'description', 'price_range', 'google_maps_query'],
      },
    },
    transportation: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          rating: { type: 'string' },
          review_count: { type: 'string' },
          category: { type: 'string' },
          description: { type: 'string' },
          price_range: { type: 'string' },
          google_maps_query: { type: 'string' },
        },
        required: ['name', 'rating', 'review_count', 'category', 'description', 'price_range', 'google_maps_query'],
      },
    },
  },
  required: [
    'destination_name', 'destination_country', 'best_season', 'suggested_days',
    'currency', 'budget_range_twd', 'daily_budget_twd',
    'budget_accommodation', 'budget_meals', 'budget_transportation', 'budget_activities',
    'travel_tips', 'attractions', 'restaurants', 'accommodations', 'transportation',
  ],
};

/**
 * 呼叫 Gemini API 取得旅遊推薦
 * @param {string} destination - 使用者輸入的目的地
 * @param {string} apiKey - Gemini API Key
 * @returns {Promise<object>} 推薦資料 JSON
 */
export async function getRecommendations(destination, apiKey) {
  // 基本的 API Key 格式檢查
  if (!apiKey || apiKey.length < 10) {
    throw new Error('API Key 格式不正確。請到 https://aistudio.google.com/apikey 取得有效的 Gemini API Key（通常以 AIzaSy 開頭）。');
  }

  const prompt = `你是一位專業的旅遊顧問。使用者想去「${destination}」旅遊。

請為使用者提供完整的旅遊推薦，包含以下四大類別，每個類別至少推薦 10 個項目，並按照推薦程度由高到低排序：

1. **景點推薦**：包含知名景點、秘境、文化體驗等
2. **美食推薦**：包含當地特色餐廳、街頭小吃、米其林推薦等
3. **住宿推薦**：包含各種價位的飯店、民宿、青年旅館等
4. **交通推薦**：包含當地各種交通方式（如地鐵、公車、計程車、租車、步行等）

每個推薦項目請附上：
- Google 星星評分（1-5 分）和估計評論數量
- 費用/價格範圍
- 詳細的推薦理由

另外，請提供：
- 最佳旅遊季節
- 建議停留天數
- 預估旅費（以新台幣計算）
- 至少 5 個旅遊小撇步（天氣、文化禮儀、安全注意事項、匯率、簽證等）

請確保推薦的都是真實存在的地方和餐廳，提供準確的 Google Maps 搜尋關鍵字。
所有內容請使用繁體中文回覆。`;

  const body = {
    contents: [
      {
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      responseJsonSchema: RECOMMENDATION_SCHEMA,
      temperature: 0.7,
    },
  };

  // 依序嘗試不同模型（回退機制）
  let lastError = null;
  for (const model of MODELS) {
    try {
      const url = `${API_BASE}/models/${model}:generateContent?key=${apiKey}`;

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData?.error?.message || `HTTP ${response.status}`;

        // API Key 相關錯誤不需要嘗試其他模型
        if (response.status === 400 && (errorMessage.includes('API_KEY') || errorMessage.includes('API key'))) {
          throw new Error('API Key 無效。請確認你的 Gemini API Key 是否正確（通常以 AIzaSy 開頭）。\n\n前往取得：https://aistudio.google.com/apikey');
        }
        if (response.status === 403) {
          throw new Error('API Key 權限不足，請確認已啟用 Generative Language API。\n\n前往取得正確的 Key：https://aistudio.google.com/apikey');
        }
        if (response.status === 429) {
          throw new Error('已超過免費額度的請求限制，請稍後再試（約 1 分鐘後）。');
        }

        // 其他錯誤（如模型不存在），嘗試下一個模型
        console.warn(`模型 ${model} 失敗：`, errorMessage);
        lastError = new Error('AI 服務暫時無法使用，正在嘗試備用模型...');
        continue;
      }

      const data = await response.json();

      // 從回應中提取文字內容
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        lastError = new Error(`模型 ${model} 未回傳有效資料`);
        continue;
      }

      // 解析 JSON
      const recommendations = JSON.parse(text);
      console.log(`成功使用模型: ${model}`);
      return recommendations;

    } catch (error) {
      // 如果是已知的 API Key 錯誤，直接拋出
      if (error.message.includes('API Key') || error.message.includes('權限') || error.message.includes('額度')) {
        throw error;
      }
      lastError = error;
      console.warn(`模型 ${model} 發生錯誤:`, error.message);
    }
  }

  // 所有模型都失敗
  throw lastError || new Error('所有 AI 模型都無法使用，請稍後再試。');
}
