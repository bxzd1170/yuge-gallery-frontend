/**
 * 批量给图库灌数据：下载网络图片 → 上传到公共图库 / 团队空间 → 补分类、标签、简介。
 *
 * 约束（来自后端实现，不是猜的）：
 *   · /picture/upload/url：HEAD 必须 200，Content-Type ∈ {jpeg,jpg,png,webp}，Content-Length ≤ 2MB，
 *     之后后端自己下载并转存到 COS（会转成 webp）。
 *   · 上传人决定审核状态：管理员直接过审，普通用户 reviewStatus=0，需要管理员再 review 一次。
 *   · /picture/edit 需要 PICTURE_EDIT（上传者本人即可）；非管理员编辑会重置为待审核。
 *   · 团队空间只有空间成员能上传（系统管理员不是成员也 40101）。
 */
const BASE = 'http://localhost:8123/api'
const OUT = 'C:/Users/Lenovo/AppData/Local/Temp/wb-compare/'
const fs = await import('node:fs')

const SPACES = {
  design: '2111691704976891905',   // 设计协作组
  ops: '2111691705039806466',      // 运营素材库
  product: '2111691705106915329',  // 产品原型组
}

const TAGS = ['热门', '搞笑', '生活', '高清', '艺术', '校园', '背景', '简历', '创意']
const CATS = ['模板', '电商', '表情包', '素材', '海报']

const CONCURRENCY = 4
const logLines = []
function log(s) {
  const line = `${new Date().toISOString().slice(11, 19)}  ${s}`
  logLines.push(line)
  console.log(line)
  fs.writeFileSync(OUT + 'seed-log.txt', logLines.join('\n'))
}

async function login(acc, pw) {
  const r = await fetch(`${BASE}/user/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userAccount: acc, userPassword: pw }),
  })
  const j = await r.json()
  if (j.code !== 0) throw new Error(`${acc} 登录失败: ${j.message}`)
  const cookies = r.headers.getSetCookie ? r.headers.getSetCookie() : []
  const cookie = cookies.map((c) => c.split(';')[0]).join('; ')
  if (!cookie) throw new Error(`${acc} 没拿到 cookie`)
  return { acc, cookie, id: j.data.id }
}

async function api(sess, path, body) {
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: sess.cookie },
    body: JSON.stringify(body),
  })
  return r.json()
}

async function retry(fn, times = 3, delay = 800) {
  let last
  for (let i = 0; i < times; i++) {
    try {
      return await fn()
    } catch (e) {
      last = e
      await new Promise((r) => setTimeout(r, delay * (i + 1)))
    }
  }
  throw last
}

async function pool(items, n, fn) {
  let idx = 0
  const workers = Array.from({ length: n }, async () => {
    while (idx < items.length) {
      const i = idx++
      await fn(items[i], i)
    }
  })
  await Promise.all(workers)
}

/* ---------- 1. 素材源 ---------- */

// 必应每日壁纸：8 张，带真实中文说明，标签按关键词映射
async function bingItems() {
  const r = await fetch('https://cn.bing.com/HPImageArchive.aspx?format=js&idx=0&n=8&mkt=zh-CN', {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  })
  const j = await r.json()
  return (j.images || []).map((im, i) => {
    const desc = (im.copyright || '').split('(©')[0].trim()
    const key = desc.split('，')[0].trim()
    let tags = ['高清', '背景']
    let cat = '素材'
    const s = desc
    if (/城堡|山|湖|岛|森林|峡|公园|峰|冰川|沙漠/.test(s)) { tags = ['背景', '高清']; cat = '素材' }
    else if (/化石|艺术|画|雕塑|博物|古籍|彩绘/.test(s)) { tags = ['艺术', '创意']; cat = '海报'
    } else if (/城|桥|广场|建筑|街|宫|塔/.test(s)) { tags = ['创意', '高清']; cat = '模板' }
    else if (/鸟|猫|狗|熊|鲸|鹿|狐|企鹅|动物/.test(s)) { tags = ['生活', '搞笑']; cat = '表情包' }
    return {
      url: `https://cn.bing.com${im.url}&w=1024&h=768`,
      name: `${key.slice(0, 40)} · ${String(i + 1).padStart(2, '0')}`,
      tags,
      category: cat,
      introduction: `必应每日壁纸 · ${desc}`,
      src: 'bing',
    }
  })
}

// Lorem Picsum：稳定的 1024×768 真实照片，数量管够
async function picsumItems(count) {
  const ids = []
  for (let page = 1; ids.length < count + 20; page++) {
    const r = await fetch(`https://picsum.photos/v2/list?page=${page}&limit=100`)
    const arr = await r.json()
    if (!Array.isArray(arr) || !arr.length) break
    for (const it of arr) ids.push(it)
    if (page > 5) break
  }
  return ids.slice(0, count).map((it, i) => ({
    url: `https://picsum.photos/id/${it.id}/1024/768`,
    name: `摄影素材 ${String(i + 1).padStart(3, '0')}`,
    // 演示数据：picsum 不提供内容标签，这里按序轮转铺满词表，保证每个 tag/分类都有图可筛
    tags: [TAGS[i % TAGS.length], TAGS[(i * 4 + 3) % TAGS.length]].filter((v, k, a) => a.indexOf(v) === k),
    category: CATS[i % CATS.length],
    introduction: `示例图片 · 图源 Unsplash（经 Lorem Picsum 分发）· 摄影 ${it.author}`,
    src: 'picsum',
  }))
}

/* ---------- 2. 任务编排 ---------- */

const PUBLIC_COUNT = 140
const PER_SPACE = 20

function buildTasks(bing, picsum) {
  const tasks = []
  // 公共图库：8 张必应 + 132 张 picsum
  for (const it of bing) tasks.push({ ...it, owner: 'lisi', spaceId: null })
  for (const it of picsum.slice(0, PUBLIC_COUNT - bing.length)) tasks.push({ ...it, owner: 'lisi', spaceId: null })

  const rest = picsum.slice(PUBLIC_COUNT - bing.length)
  const plan = [
    { key: 'design', owner: 'designer01', from: 0 },
    { key: 'ops', owner: 'operator01', from: PER_SPACE },
    { key: 'product', owner: 'product01', from: PER_SPACE * 2 },
  ]
  for (const p of plan) {
    for (const it of rest.slice(p.from, p.from + PER_SPACE)) {
      tasks.push({ ...it, owner: p.owner, spaceId: SPACES[p.key] })
    }
  }
  return tasks
}

async function main() {
  log('=== 准备素材 ===')
  const bing = await bingItems()
  log(`必应 ${bing.length} 张`)
  const total = 200
  const picsum = await picsumItems(total - bing.length)
  log(`picsum ${picsum.length} 张`)

  const tasks = buildTasks(bing, picsum)
  log(`任务总数 ${tasks.length}（公共 ${tasks.filter((t) => !t.spaceId).length}，团队 ${tasks.filter((t) => t.spaceId).length}）`)

  const sessions = {}
  for (const [acc, pw] of [['lisi', '12345678'], ['designer01', '12345678'], ['operator01', '12345678'], ['product01', '12345678']]) {
    sessions[acc] = await login(acc, pw)
  }
  log('登录完成：' + Object.keys(sessions).join(' / '))

  const created = []   // { id, spaceId, owner }
  const failed = []
  let done = 0

  await pool(tasks, CONCURRENCY, async (t) => {
    const sess = sessions[t.owner]
    try {
      const up = await retry(() => api(sess, '/picture/upload/url', {
        fileUrl: t.url,
        picName: t.name,
        ...(t.spaceId ? { spaceId: t.spaceId } : {}),
      }), 2)
      if (up.code !== 0 || !up.data?.id) throw new Error(up.message || '上传失败')
      const id = up.data.id
      // 补分类/标签/简介（上传接口不接受这些字段）
      const ed = await retry(() => api(sess, '/picture/edit', {
        id,
        category: t.category,
        tags: t.tags,
        introduction: t.introduction,
      }), 2)
      if (ed.code !== 0) throw new Error('编辑失败: ' + ed.message)
      created.push({ id, spaceId: t.spaceId, owner: t.owner })
      done++
      if (done % 10 === 0) log(`进度 ${done}/${tasks.length}`)
    } catch (e) {
      failed.push({ name: t.name, url: t.url, err: String(e.message || e) })
      log(`失败 ${t.name}: ${e.message || e}`)
    }
  })

  log(`上传完成：成功 ${created.length}，失败 ${failed.length}`)

  // 团队空间的图由普通用户上传 → reviewStatus=0，需要管理员过审
  const needReview = created.filter((c) => c.spaceId)
  if (needReview.length) {
    let ok = 0
    for (const c of needReview) {
      const r = await retry(() => api(sessions.lisi, '/picture/review', { id: c.id, reviewStatus: 1 }), 2).catch(() => null)
      if (r && r.code === 0) ok++
    }
    log(`团队空间过审：${ok}/${needReview.length}`)
  }

  fs.writeFileSync(OUT + 'seed-result.json', JSON.stringify({ created, failed }, null, 1))
  log('=== 全部结束 ===')
}

await main()
