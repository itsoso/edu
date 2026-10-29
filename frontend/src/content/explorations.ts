export type Subject = '生物' | '数学' | '物理' | '化学'

export interface Exploration {
  id: string
  subject: Subject
  title: string
  summary: string
  value: string
  source: string
  url: string
  language: string
  minutes: number
  addedAt: string
  tasks: string[]
  question: string
  options: string[]
  answer: number
  explanation: string
}

// Editorial selections, not a live news feed. Keep source and review date with each entry.
export const explorations: Exploration[] = [
  {
    id: 'oxygen', subject: '生物', title: '跟着一个氧分子，走进身体',
    summary: '从呼吸、肺泡气体交换到血液运输和细胞呼吸，把课本里的几张图连成一条旅程。',
    value: '分清“空气进入肺”和“细胞利用氧”这两件事，建立跨章节的联系。',
    source: 'Techartist', url: 'https://iamtechartist.com/breathing-and-respiration/',
    language: '英文 · 配中文任务', minutes: 12, addedAt: '2026-10-29',
    tasks: ['先预测：吸入的氧气要经过哪些位置，才能到达细胞？', '打开演示，依次观察呼吸、气体交换、循环和细胞呼吸。', '关掉演示，用“肺泡 → 血液 → 组织细胞”讲一遍，并解释每一步发生了什么。'],
    question: '氧气从肺泡进入血液，主要依靠什么过程？',
    options: ['心脏把肺泡中的氧气直接吸入血管', '氧气沿浓度差扩散', '肺泡把氧气转化成二氧化碳'], answer: 1,
    explanation: '肺泡中的氧气浓度高于流经肺泡的血液，氧气通过薄的肺泡壁和毛细血管壁扩散进入血液。心脏推动血液循环，但气体交换依靠扩散。',
  },
  {
    id: 'quadratics', subject: '数学', title: '拖动参数，看懂抛物线',
    summary: '在交互图像中改变二次函数参数，观察开口、顶点和对称轴怎样变化。',
    value: '把公式中的字母和图像变化对应起来，减少只背结论却不会判断的情况。',
    source: '科罗拉多大学 Boulder · PhET', url: 'https://phet.colorado.edu/zh_CN/simulations/graphing-quadratics',
    language: '支持中文', minutes: 10, addedAt: '2026-10-29',
    tasks: ['使用顶点式 y = a(x − h)² + k，先固定 a = 1、k = 0。', '把 h 从 0 改成 2。先猜图像往哪边移动，再观察。', '固定 h、k，将 a 从 1 改成 −1，解释哪些性质改变、哪些不变。'],
    question: 'y = (x − 2)² + 1 的顶点在哪里？',
    options: ['(−2, 1)', '(2, −1)', '(2, 1)'], answer: 2,
    explanation: '当 x = 2 时，平方项取最小值 0，y = 1，所以顶点是 (2, 1)。可以用代入验证，而不只记忆“左加右减”。',
  },
  {
    id: 'circuits', subject: '物理', title: '搭一条电路，让灯泡亮起来',
    summary: '用电池、导线和灯泡搭建电路，对比串联与并联，再用仪表检查自己的预测。',
    value: '把电流路径画清楚，再判断断开一处会影响哪些灯泡。',
    source: '科罗拉多大学 Boulder · PhET', url: 'https://phet.colorado.edu/zh_CN/simulations/circuit-construction-kit-dc',
    language: '支持中文', minutes: 15, addedAt: '2026-10-29',
    tasks: ['在模拟器里搭建两只灯泡串联的闭合电路。', '断开一只灯泡，观察另一只。再搭建两个并联支路，重复操作。', '画出两种电路的电流路径，解释结果。实验只需在模拟器中完成。'],
    question: '两只灯泡分别在两个并联支路上。断开其中一个支路，另一个支路仍与电源闭合，会怎样？',
    options: ['另一只灯泡仍可发光', '两只灯泡一定都熄灭', '电流不再经过电源'], answer: 0,
    explanation: '并联电路有独立的电流路径。只要另一支路和电源仍构成闭合回路，它的灯泡就仍可发光。',
  },
  {
    id: 'equations', subject: '化学', title: '配平方程式：原子一个也不能少',
    summary: '观察反应前后每种原子的数量，用系数配平化学方程式。',
    value: '理解质量守恒如何约束方程式，避免靠修改化学式下标“凑数”。',
    source: '科罗拉多大学 Boulder · PhET', url: 'https://phet.colorado.edu/zh_CN/simulations/balancing-chemical-equations',
    language: '支持中文', minutes: 10, addedAt: '2026-10-29',
    tasks: ['在模拟器中选择生成水的反应，数出两边的氢原子和氧原子。', '只调整化学式前的系数，直到每种原子在两边的数量相等。', '解释为什么可以改变系数，却不能把 H₂O 改成 H₂O₂ 来配平。'],
    question: 'H₂ + O₂ → H₂O 配平后的最简整数系数依次是？',
    options: ['1、1、1', '2、1、2', '1、2、1'], answer: 1,
    explanation: '2H₂ + O₂ → 2H₂O：两边都有 4 个氢原子和 2 个氧原子。改变下标会改变物质本身，配平只能调整系数。',
  },
]
