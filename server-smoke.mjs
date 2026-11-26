// 服务端接口冒烟测试
const BASE = process.argv[2] || process.env.BASE || 'http://127.0.0.1:45999';
let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (extra ? '  → ' + extra : '')); }
};

async function get(path, asText = false) {
  const r = await fetch(BASE + path);
  const ct = r.headers.get('content-type') || '';
  const body = asText || !ct.includes('json') ? await r.text() : await r.json();
  return { status: r.status, ct, body };
}

(async () => {
  console.log('\n=== 服务端冒烟 ===\n');

  // 首页
  const idx = await get('/', true);
  ok(idx.status === 200, 'GET / 返回 200', idx.status);
  ok(idx.body.includes('我的书架'), '首页含标题');
  ok(idx.body.includes('/api/shelf'), '首页引用了 API');

  // 书架
  const sh = await get('/api/shelf');
  ok(sh.status === 200, 'GET /api/shelf 返回 200', sh.status);
  ok(Array.isArray(sh.body.books), 'books 是数组');
  ok(sh.body.books.length > 0, '书架非空', sh.body.books.length);
  const b0 = sh.body.books[0];
  ok(!!b0.bookId && !!b0.title, '书有 bookId 与 title');
  ok(typeof b0.downloaded === 'number', 'downloaded 是数字');
  ok(typeof b0.autoUpdate === 'boolean', 'autoUpdate 是布尔值');
  ok(typeof b0.coverUrl === 'string' && b0.coverUrl.startsWith('/cover/'), 'coverUrl 指向本地路由', b0.coverUrl);

  // 封面
  const cv = await fetch(BASE + b0.coverUrl);
  ok(cv.status === 200, 'GET 封面返回 200', cv.status);
  ok((cv.headers.get('content-type') || '').includes('image/jpeg'), '封面是 jpeg');
  const cbuf = Buffer.from(await cv.arrayBuffer());
  ok(cbuf.length > 1000 && cbuf[0] === 0xFF && cbuf[1] === 0xD8, '封面是有效 JPEG', cbuf.length + 'B');

  // 阅读器
  const rd = await fetch(BASE + '/reader/' + b0.bookId);
  const rtext = await rd.text();
  ok(rd.status === 200, 'GET 阅读器返回 200', rd.status);
  ok(rtext.includes('__BOOK_DATA__') === false, '阅读器数据已注入');
  ok(rtext.length > 10000, '阅读器有内容', rtext.length + 'B');

  // 书籍详情
  const bk = await get('/api/book?id=' + b0.bookId);
  ok(bk.status === 200, 'GET /api/book 返回 200', bk.status);
  ok(Array.isArray(bk.body.chapters) && bk.body.chapters.length === b0.chapters, '章节数一致');
  ok(bk.body.chapters.every(c => 'has' in c), '每章带 has 标记');

  // 404
  const nf = await get('/api/nope');
  ok(nf.status === 404, '未知 API 返回 404', nf.status);
  const badid = await fetch(BASE + '/reader/abc');
  ok(badid.status === 400, '非法 id 返回 400', badid.status);

  // 自动追更开关
  const toggled = await fetch(BASE + '/api/toggle', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bookId: b0.bookId, autoUpdate: false }),
  });
  ok(toggled.status === 200, 'POST /api/toggle 返回 200', toggled.status);
  const sh2 = await get('/api/shelf');
  const b0b = sh2.body.books.find(b => b.bookId === b0.bookId);
  ok(b0b.autoUpdate === false, '开关已落盘（关闭）');
  // 还原
  await fetch(BASE + '/api/toggle', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bookId: b0.bookId, autoUpdate: true }),
  });
  const sh3 = await get('/api/shelf');
  ok(sh3.body.books.find(b => b.bookId === b0.bookId).autoUpdate === true, '开关已还原（开启）');

  // SSE
  const sseOK = await new Promise(resolve => {
    const ctl = new AbortController();
    const t = setTimeout(() => { ctl.abort(); resolve(false); }, 3000);
    fetch(BASE + '/api/events', { signal: ctl.signal })
      .then(r => {
        const reader = r.body.getReader();
        return reader.read().then(({ value }) => {
          clearTimeout(t); ctl.abort();
          resolve(Buffer.from(value).toString().includes('event: hello'));
        });
      })
      .catch(() => { clearTimeout(t); resolve(false); });
  });
  ok(sseOK, 'SSE 端点推送 hello 事件');

  console.log(`\n通过 ${pass}  失败 ${fail}`);
  console.log(fail === 0 ? 'ALL_PASS' : 'HAS_FAIL');
  process.exit(fail === 0 ? 0 : 1);
})();