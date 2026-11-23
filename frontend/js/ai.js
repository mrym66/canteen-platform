/* ============================================================
 * Mrym College 食堂大数据分析与智能决策平台
 * ai.js —— 校内 AI 服务客户端（走同源 /api/ai 代理）
 * 模型与密钥均在服务端，前端不感知具体供应商
 * ============================================================ */

(function () {
  'use strict';

  const API_URL = '/api/ai';

  const NUTRITIONIST_PROMPT = [
    '你是"Mrym College 智慧食堂"的 AI 营养师，名叫"小橙"。',
    '你的职责：根据学生的口味偏好、忌口、近期食堂消费记录，给出健康饮食建议。',
    '要求：',
    '1. 语气亲切自然，用中文回答；',
    '2. 结合食堂实际有的菜品类型（米饭套餐、面食、麻辣香锅、粥粉面、小吃饮品等）来建议，不要推荐食堂没有的东西；',
    '3. 涉及营养时给出具体的搭配思路（蛋白质/碳水/蔬菜比例、少油少盐等）；',
    '4. 如发现学生近期经常吃辛辣或高油类菜品，要温和提醒均衡饮食；',
    '5. 回答控制在 300 字以内，重点突出，可适当用 emoji。'
  ].join('\n');

  const DECISION_PROMPT = [
    '你是"Mrym College 食堂大数据分析与智能决策平台"的经营决策 AI 顾问。',
    '你会收到一份近 30 天食堂经营数据的 JSON 摘要（营业额趋势、菜品销量榜、食堂对比、评分分布、差评数等）。',
    '请输出一份简明的经营决策建议，包含：',
    '1. 【数据解读】用 2-3 句概括当前经营亮点与隐忧；',
    '2. 【菜品策略】基于销量与评分给出 2-3 条具体动作（如淘汰/上新/调价）；',
    '3. 【运营优化】针对差评集中的问题给出改进措施；',
    '4. 【风险预警】如有评分下滑或销量异常，点出需关注的食堂/窗口。',
    '用中文，markdown 小标题 + 列表，总长 400 字以内，观点要落到具体数据上。'
  ].join('\n');

  async function chat(messages, temperature = 0.8) {
    let res;
    try {
      res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, temperature })
      });
    } catch (e) {
      throw new Error('网络异常，无法连接 AI 服务');
    }
    let data;
    try {
      data = await res.json();
    } catch (e) {
      throw new Error('AI 服务返回异常（HTTP ' + res.status + '）');
    }
    if (!res.ok) {
      const msg = (data && data.error && data.error.message) || ('AI 服务返回 ' + res.status);
      throw new Error(msg);
    }
    if (!data.choices || !data.choices[0]) {
      throw new Error('AI 服务未返回有效结果');
    }
    return data.choices[0].message.content;
  }

  /** 学生端：AI 营养师对话。history: [{role, content}] */
  function nutritionChat(history) {
    const msgs = [{ role: 'system', content: NUTRITIONIST_PROMPT }, ...history.slice(-10)];
    return chat(msgs);
  }

  /** 生成学生个人饮食建议报告（结构化提示词） */
  function dietReport(profile, recentRecords) {
    const dishNames = recentRecords.slice(0, 30).map(r => {
      const d = window.MRYM.dishById(r.dishId);
      return d ? d.name + '(' + d.tastes + ')' : '';
    }).filter(Boolean);
    const tasteCount = {};
    dishNames.forEach(n => {
      const m = n.match(/\((.*?)\)/);
      if (m) tasteCount[m[1]] = (tasteCount[m[1]] || 0) + 1;
    });
    const prompt = [
      '请为以下学生生成一份「本周饮食分析与建议」报告，包含：【整体评价】【口味结构分析】【营养建议】【下周推荐尝试】四个小节，每节 2-3 句话，共 300 字内。',
      '',
      '学生信息：',
      '- 姓名：' + profile.name,
      '- 口味偏好：' + (profile.preferredTastes || '未设置'),
      '- 忌口：' + (profile.allergens || '无'),
      '- 卡余额：' + profile.balance + ' 元',
      '- 近 7 天消费 ' + recentRecords.length + ' 笔',
      '- 近期点过的菜：' + (dishNames.slice(0, 15).join('、') || '暂无') + '',
      '- 口味分布：' + JSON.stringify(tasteCount)
    ].join('\n');
    return chat([{ role: 'user', content: prompt }], 0.6);
  }

  /** 管理员端：经营决策建议 */
  function decisionAdvice(statsSummary) {
    const prompt = '以下是平台统计的近 ' + statsSummary.days + ' 天食堂经营数据 JSON：\n' +
      JSON.stringify({
        总营收: statsSummary.totalRevenue,
        总单量: statsSummary.totalOrders,
        平均评分: statsSummary.avgRating,
        差评数: statsSummary.badReviews,
        餐段分布: statsSummary.slotMap,
        评分分布: statsSummary.rateDist,
        菜品销量榜前十: statsSummary.dishRank.slice(0, 10),
        食堂对比: statsSummary.canteenRank
      }) +
      '\n请按你的系统设定输出经营决策建议。';
    return chat([
      { role: 'system', content: DECISION_PROMPT },
      { role: 'user', content: prompt }
    ], 0.5);
  }

  /** 员工端：针对某道菜的差评，给出改进建议 */
  function dishImprovement(dish, badComments) {
    const prompt = '菜品「' + dish.name + '」（口味：' + dish.tastes + '，主要食材：' + dish.ingredients + '）' +
      '近期收到以下差评：\n' + badComments.map(c => '- ' + c).join('\n') +
      '\n请给出 3 条具体可执行的出品改进建议，每条不超过 40 字。';
    return chat([{ role: 'user', content: prompt }], 0.6);
  }

  window.MRYM_AI = { chat, nutritionChat, dietReport, decisionAdvice, dishImprovement };
})();
