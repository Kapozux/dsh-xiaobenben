/**
 * 涉及健康、感情、成绩、家庭的内容：卡片上默认隐藏，用户手动打开才显示；默认也不进发给模型的抽样。
 * 只是关键词判断，宁可多藏。词表可以在插件配置里加（Config.sensitiveExtra）。
 */

export const SENSITIVE_WORDS = {
  健康: ['病', '医院', '医生', '看诊', '吃药', '药物', '处方', '抑郁', '焦虑', '失眠', '心理', '咨询师', '确诊', '症状', '手术', '体检', '怀孕', 'ADHD', '多动', '自闭', '自残', '自杀', '住院', '诊断', 'therapy', 'therapist', 'depress', 'anxiety', 'diagnos'],
  感情: ['恋爱', '男朋友', '女朋友', '男友', '女友', '前任', '分手', '表白', '暗恋', '喜欢的人', '感情', '约会', '对象', '复合', '失恋', '喜欢我', '喜欢你', '喜欢她', '喜欢他', '喜欢过', '追她', '追他', '暧昧', '暧昧', '拉黑', '删我', '相亲', '结婚', 'crush', 'girlfriend', 'boyfriend', 'breakup', 'dating'],
  成绩: ['成绩', '分数', '考试', '考了', '挂科', '及格', '排名', 'GPA', '绩点', '预估分', '期末', '期中', '模考', '高考', 'predicted grade', 'SAT', 'ACT', 'IELTS', 'TOEFL', '雅思', '托福'],
  家庭: ['爸', '妈', '父母', '家里', '家人', '爷爷', '奶奶', '外公', '外婆', '离婚', '吵架', '哥哥', '姐姐', '弟弟', '妹妹', '亲戚', 'my mom', 'my dad', 'my parents'],
}

/**
 * @param {string} text
 * @param {Record<string, string[]>} [extra] 用户加的词，按类合并
 * @returns {string[]} 命中的类别，没命中是空数组
 */
export function sensitiveCats(text, extra = {}) {
  const lower = text.toLowerCase()
  const cats = []
  for (const [cat, words] of Object.entries(SENSITIVE_WORDS)) {
    const all = [...words, ...(extra[cat] || [])]
    if (all.some(w => lower.includes(w.toLowerCase()))) cats.push(cat)
  }
  for (const [cat, words] of Object.entries(extra)) {
    if (!SENSITIVE_WORDS[cat] && words.some(w => lower.includes(w.toLowerCase()))) cats.push(cat)
  }
  return cats
}
