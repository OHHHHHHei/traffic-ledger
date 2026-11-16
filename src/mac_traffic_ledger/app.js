'use strict';
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let view = 'overview', selected = '', page = 0, generation = 0, request = null, paginationRange = null;
const recentResults = new Map();
let theme = 'system';
try { theme = localStorage.getItem('ledger-theme') || 'system'; } catch (_) {}
function applyTheme() {
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  $('theme').textContent = '主题：' + ({system:'系统',light:'浅色',dark:'深色'}[theme] || '系统');
}
applyTheme();
$('theme').onclick = () => {theme = ({system:'light',light:'dark',dark:'system'})[theme] || 'system';try {localStorage.setItem('ledger-theme', theme);} catch (_) {}applyTheme();};
function bytes(n) {
  const mb = (Number(n) || 0) / 1000000;
  return (mb > 0 && mb < 0.01 ? '＜0.01' : mb.toFixed(2)) + ' MB';
}

function date(n) {return new Date(n * 1000).toLocaleString('zh-CN', {hour12:false});}
function shortDate(n, seconds = false) {return new Date(n * 1000).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',second:seconds?'2-digit':undefined,hour12:false});}
function params(reuseRanking = false) {
  const now = new Date(); let start = new Date(now), end = now, r = $('range').value;
  if (r === 'today') start.setHours(0,0,0,0);
  else if (r === 'month') {start.setDate(1);start.setHours(0,0,0,0);}
  else if (r === 'hour') start = new Date(+now - 3600000);
  else if (r === 'custom') {start = new Date($('from').value + 'T00:00:00');end = new Date($('to').value + 'T23:59:59');}
  else start = new Date(+now - Number(r) * 86400000);
  if (!Number.isFinite(+start) || !Number.isFinite(+end) || start > end) throw Error('请选择有效的起止日期。');
  if (view === 'connections') {
    if (!paginationRange) paginationRange = [start, end];
    [start, end] = paginationRange;
  }
  return new URLSearchParams({start:+start/1000,end:+end/1000,route:$('route').value,search:$('search').value,view,page,...(selected ? {process:selected} : {}),...(view === 'connections' && reuseRanking ? {reuse_ranking:1} : {})});
}
function table(headers, rows) {
  return rows.length ? '<table><thead><tr>' + headers.map(x=>'<th>'+x+'</th>').join('') + '</tr></thead><tbody>' + rows.join('') + '</tbody></table>' : '<p class="empty">这个范围暂无记录。试试其他日期或筛选条件。</p>';
}
function cells(values) {return '<tr>'+values.map(v=>'<td>'+v+'</td>').join('')+'</tr>';}
function updateState(d) {
  const s = d.status, live = s.state === 'recording' && Date.now()/1000 - s.last_success < 15;
  $('status').textContent = live ? '采集中' : '采集暂不可用';
  $('status').className = 'status' + (live ? '' : ' warning');
  $('saved').textContent = s.last_committed ? '最近保存 '+shortDate(s.last_committed)+' · 每秒采样' : '每秒采样 · 最多 10 秒保存一次';
  if (d.meta) $('scope').textContent = '自 '+date(Number(d.meta.created))+' 开始 · 明细 30 天 / 每日汇总长期保留';
  if (s.error) {$('error').textContent = '采集器：'+s.error;$('error').classList.remove('hidden');}
}
function setView(next) {
  view = next;page = 0;paginationRange = null;
  if (view === 'daily') selected = '';
  document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-current', b.dataset.view === view ? 'page' : 'false'));
  $('overview').classList.toggle('hidden', view !== 'overview');
  $('connectionView').classList.toggle('hidden', view !== 'connections');
  $('dailyView').classList.toggle('hidden', view !== 'daily');
  $('export').classList.toggle('hidden', view === 'overview');
  $('export').textContent = view === 'daily' ? '导出筛选账单 CSV' : '导出本页 CSV';
  $('search').placeholder = view === 'daily' ? '搜索进程名称或路径…' : '搜索进程、域名或 IP…';
  updateSelection();refresh();
}
function updateSelection() {
  $('filter').classList.toggle('hidden', !selected);
  $('selectedName').textContent = selected ? '进程 / '+JSON.parse(selected)[0] : '';
}
const chart = $('chart'), trendTooltip = $('trendTooltip');
let trendBins = [], activeBin = -1;
function showTrendBin(index) {
  const bin = trendBins[index];
  chart.children[activeBin]?.classList.remove('is-active');
  activeBin = bin ? index : -1;
  if (!bin) {
    trendTooltip.hidden = true;
    return;
  }
  const bar = chart.children[index];
  bar.classList.add('is-active');
  const end = shortDate(bin.end, bin.end % 60 !== 0);
  $('trendInterval').textContent = shortDate(bin.start)+' 至 '+end;
  $('trendTotal').textContent = '合计 '+bytes(bin.up + bin.down);
  $('trendBreakdown').textContent = '上传 '+bytes(bin.up)+' · 下载 '+bytes(bin.down);
  trendTooltip.hidden = false;
  const panel = $('trendPanel').getBoundingClientRect(), rect = bar.getBoundingClientRect();
  const width = trendTooltip.offsetWidth;
  const left = rect.left - panel.left + (rect.width - width) / 2;
  trendTooltip.style.left = Math.max(0, Math.min(left, panel.width - width))+'px';
  trendTooltip.style.top = (rect.top - panel.top - 6)+'px';
}
chart.addEventListener('pointerover', e=>{
  const index = Number(e.target.dataset.bin);
  if (Number.isInteger(index) && index !== activeBin) showTrendBin(index);
});
chart.addEventListener('pointerleave', ()=>showTrendBin(-1));
chart.addEventListener('blur', ()=>showTrendBin(-1));
chart.addEventListener('keydown', e=>{
  if (e.key === 'Escape') showTrendBin(-1);
  else if (trendBins.length && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    e.preventDefault();
    const index = activeBin < 0 ? trendBins.length-1 : activeBin + (e.key === 'ArrowLeft' ? -1 : 1);
    showTrendBin(Math.max(0, Math.min(index, trendBins.length-1)));
  }
});
function renderOverview(d) {
  const s = d.summary;
  $('total').textContent = bytes(s.up+s.down);$('up').textContent = bytes(s.up);$('down').textContent = bytes(s.down);
  $('processCount').textContent = d.processes.length+' 个进程';
  $('processes').innerHTML = table(['进程','上传','下载','合计'], d.processes.map((r,i)=>
    '<tr><td><button class="process-link" data-process="'+i+'" aria-label="查看 '+esc(r.process)+' 的流量"><span class="process-name">'+esc(r.process)+'</span><span class="path" title="'+esc(r.path)+'">'+esc(r.path || '路径未识别')+'</span></button></td><td class="num">'+bytes(r.up)+'</td><td class="num">'+bytes(r.down)+'</td><td class="num total-cell">'+bytes(r.up+r.down)+'</td></tr>'
  ));
  $('processes').querySelectorAll('[data-process]').forEach(b=>b.onclick=()=>{
    const r=d.processes[Number(b.dataset.process)];selected=JSON.stringify([r.process,r.path]);updateSelection();refresh();
  });
  $('hosts').innerHTML = table(['访问目标 / 出口','上传','下载'], d.hosts.map(r=>'<tr><td class="domain">'+esc(r.host)+'<span class="path" title="'+esc(r.node)+'">'+esc(r.route)+' · '+esc(r.node)+'</span></td><td class="num">'+bytes(r.up)+'</td><td class="num">'+bytes(r.down)+'</td></tr>'));
  // Keep chronological spacing even when no connections transferred data in a bucket.
  const points = new Map(d.trend.map(r=>[r.bucket,r]));
  const first = Math.floor(d.range[0]/d.trend_step)*d.trend_step, last = Math.min(d.range[1],Math.floor(Date.now()/1000));
  const previousBin = trendBins[activeBin];
  const bins=[];
  for(let bucket=first;bucket<last&&bins.length<122;bucket+=d.trend_step) {
    const point = points.get(bucket) || {up:0,down:0};
    bins.push({start:Math.max(bucket,d.range[0]),end:Math.min(last,bucket+d.trend_step),up:point.up,down:point.down});
  }
  // Each bucket occupies 6px plus a 2px gap; leave unused space on the left.
  $('trendPlot').style.setProperty('--trend-width', Math.max(6,bins.length*8-2)+'px');
  $('chartStart').classList.toggle('hidden',bins.length<24);
  const peak=Math.max(1,...bins.map(r=>r.up+r.down));
  trendBins = bins;
  chart.innerHTML=bins.map((r,i)=>'<span data-bin="'+i+'" style="--bar-height:'+(r.up+r.down ? Math.max(2,(r.up+r.down)/peak*100):1)+'%;--bar-opacity:'+(r.up+r.down?'.8':'.12')+'"></span>').join('');
  if (previousBin) showTrendBin(bins.findIndex(r=>r.start===previousBin.start));
  $('trendUnit').textContent='每 '+Math.round(d.trend_step/60)+' 分钟合计 · 悬停查看';
  $('chartStart').textContent=shortDate(d.range[0]);$('chartEnd').textContent=shortDate(last);
  $('quality').textContent=(s.up+s.down ? ((1-s.unknown/(s.up+s.down))*100).toFixed(2)+'% 已识别':'尚无流量')+' · 未知 '+bytes(s.unknown);
  $('health').textContent='全部路由计数增量 '+bytes(d.health.core)+'；逐次未归属差额估计 '+bytes(d.health.missed)+'；超过 5 秒的采样间隔 '+d.health.gaps+' 次。';
}
function renderConnections(d) {
  $('connectionCount').textContent=d.count+' 条记录';
  $('connections').innerHTML=table(['进程 / PID','目标','路由 / 节点','上传','下载','连接详情'],d.connections.map(r=>{
    const facts=[['完整路径',r.path||'未识别'],['识别方式',r.attribution],['协议',r.network],['源地址',r.source+':'+r.sport],['目标 IP',r.ip],['规则',r.rule],['代理链',r.chain],['连接开始',r.started],['首次观察',date(r.first_seen)],['最后观察',date(r.last_seen)],['状态',r.active?'最后快照中活跃':'已结束或暂未观察到'],['连接 ID',r.id]];
    return cells([esc(r.process)+'<span class="path">PID '+r.pid+'</span>', '<span class="domain">'+esc(r.host||r.ip)+':'+esc(r.dport)+'</span>',esc(r.route)+'<span class="path" title="'+esc(r.node)+'">'+esc(r.node)+'</span>',bytes(r.up),bytes(r.down),'<details class="connection-details"><summary>详情</summary><dl>'+facts.map(([k,v])=>'<dt>'+esc(k)+'</dt><dd>'+esc(v)+'</dd>').join('')+'</dl></details>']);
  }));
  $('pageLabel').textContent='第 '+(d.page+1)+' / '+Math.max(1,Math.ceil(d.count/d.page_size))+' 页 · 每页 '+d.page_size+' 条'+(d.ranked_at ? ' · 排序于 '+shortDate(d.ranked_at) : '');
  $('prev').disabled=page===0;$('next').disabled=(page+1)*d.page_size>=d.count;
}
function renderDaily(d) {
  $('dailyTotal').textContent=bytes(d.rows.reduce((s,r)=>s+r.up+r.down,0));
  $('daily').innerHTML=table(['日期','进程 / 路径','路由','上传','下载','合计'],d.rows.map(r=>cells([esc(r.day),esc(r.process)+'<span class="path" title="'+esc(r.path)+'">'+esc(r.path)+'</span>',esc(r.route),bytes(r.up),bytes(r.down),bytes(r.up+r.down)])));
}
let refreshTimer = null;
function renderResult(data) {
  if(view==='overview')renderOverview(data);else if(view==='connections')renderConnections(data);else renderDaily(data);
}
function recentKey(query) {
  const range = $('range').value;
  return JSON.stringify([
    view, page, query.get('route'), query.get('search'), selected, range,
    range === 'custom' ? [$('from').value, $('to').value] : new Date().toDateString()
  ]);
}
async function refresh(showLoading = true, reuseRanking = false) {
  clearTimeout(refreshTimer);
  const ticket=++generation;if(request) request.abort();request=new AbortController();
  const loading = $('loading');
  loading.classList.toggle('hidden', !showLoading);
  if (showLoading) loading.textContent = '正在读取所选时段，完成后更新下方数据…';
  let delay = 10000;
  try {
    const query = params(reuseRanking);
    const longRange = Number(query.get('end')) - Number(query.get('start')) > 86400;
    if (longRange) delay = 60000;
    const key = longRange && view !== 'daily' ? recentKey(query) : null;
    const cached = key && recentResults.get(key);
    if (showLoading && cached && Date.now() - cached.at < 300000) {
      renderResult(cached.data);
      loading.textContent = '正在更新 · 当前显示 '+shortDate(cached.at/1000)+' 读取的数据';
    }
    const response=await fetch('/api/data?'+query,{signal:request.signal});
    if(!response.ok) throw Error('读取失败（'+response.status+'），请稍后重试。');
    const d=await response.json();if(ticket!==generation)return;
    $('error').classList.add('hidden');updateState(d);
    renderResult(d);
    if (key) {
      recentResults.delete(key);
      recentResults.set(key, {data:d, at:d.ranked_at ? d.ranked_at*1000 : Date.now()});
      if (recentResults.size > 8) recentResults.delete(recentResults.keys().next().value);
    }
  } catch(e) {
    if(e.name==='AbortError'||ticket!==generation)return;
    $('error').textContent=e.message;$('error').classList.remove('hidden');
  } finally {
    if (ticket === generation) {
      request = null;
      $('loading').classList.add('hidden');
      if (!document.hidden && view === 'overview') {
        refreshTimer = setTimeout(() => refresh(false), delay);
      }
    }
  }
}
function resetFilters() {page=0;paginationRange=null;refresh();}
for(const id of ['range','route','from','to']) $(id).onchange=()=>{
  $('from').classList.toggle('hidden',$('range').value!=='custom');$('to').classList.toggle('hidden',$('range').value!=='custom');resetFilters();
};
let debounce;$('search').oninput=()=>{clearTimeout(debounce);debounce=setTimeout(resetFilters,250);};
$('clear').onclick=()=>{selected='';updateSelection();resetFilters();};
$('refresh').onclick=resetFilters;
$('prev').onclick=()=>{page=Math.max(0,page-1);refresh(true,true);};$('next').onclick=()=>{page++;refresh(true,true);};
$('export').onclick=()=>{try{location.href='/api/export?'+params(true);}catch(e){$('error').textContent=e.message;$('error').classList.remove('hidden');}};
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>setView(b.dataset.view));
const today=new Date();today.setMinutes(today.getMinutes()-today.getTimezoneOffset());$('from').value=$('to').value=today.toISOString().slice(0,10);
document.addEventListener('visibilitychange',()=>{
  if (document.hidden) {
    clearTimeout(refreshTimer);
    if (request) request.abort();
  } else if (view === 'overview') refresh();
});
refresh();
