import { currentInformation, informationInvolves, informationName } from '../rp-core/current-information.js';
import { readStoryDate } from '../rp-core/clock.js';
import { entityName, relationshipName, stateLabels, describeRecord } from '../rp-core/state-view.js';

export function storyDateLabel(value) {
    const date = readStoryDate(value);
    if (!date) return { date: '', year: '', time: '' };
    const weekday = '日一二三四五六'[new Date(date.milliseconds).getUTCDay()];
    return { date: `${date.month} 月 ${date.day} 日`, year: `${date.year} 年`,
        time: `周${weekday}${date.precision === 'minute' ? ` · ${value.slice(11)}` : ''}` };
}

export function planStatusLabel(plan) {
    const status = stateLabels[plan.status] || '状态未定';
    if (!['proposed', 'accepted'].includes(plan.status)) return status;
    const timing = plan.timing;
    const time = timing?.status === 'overdue' ? '已逾期' : timing?.status === 'due' ? '今日到期'
        : timing?.status === 'upcoming' ? timing.remainingDays > 0 ? `还有 ${timing.remainingDays} 天` : '稍后到期' : '';
    return [status, time].filter(Boolean).join(' · ');
}

export function locationTrail(view, id) {
    const path = [], seen = new Set();
    while (id != null && !seen.has(id)) {
        seen.add(id);
        const location = view.locations.find(item => item.id === id);
        if (!location) break;
        path.unshift(location.name || '未命名地点');
        id = location.parent;
    }
    return path.join(' / ');
}

export function relatedFacts(core, view, kind, id, floor = null) {
    return core.facts.filter(fact => {
        if (floor != null && fact.floor > floor) return false;
        const data = fact.data || {};
        if (data.id === id) return true;
        if (kind === 'people') {
            if ([data.from, data.to, data.owner, data.holder].includes(id) || data.participants?.includes(id)) return true;
            const object = [...view.relationships, ...view.plans].find(item => item.id === data.id);
            return object?.from === id || object?.to === id || object?.participants?.includes(id);
        }
        return kind === 'locations' && (data.location === id || data.parent === id);
    }).sort((a, b) => b.sequence - a.sequence);
}

export function selectStoryOverview(view, facts = []) {
    const locationId = view.scene?.location || null;
    const location = view.locations.find(item => item.id === locationId) || null;
    const present = view.people.filter(item => view.scene?.present?.includes(item.id));
    const presentIds = new Set(present.map(item => item.id));
    const changed = new Map();
    for (const fact of facts) {
        const data = fact.data || {};
        if (data.id) changed.set(data.id, Math.max(changed.get(data.id) || 0, fact.sequence || 0));
    }
    const recent = (a, b) => (changed.get(b.id) || 0) - (changed.get(a.id) || 0);
    const involvement = item => Number(presentIds.has(item.from)) + Number(presentIds.has(item.to));
    const relationships = view.relationships.filter(item => item.status === 'active')
        .sort((a, b) => involvement(b) - involvement(a) || recent(a, b)).slice(0, 3);
    const deadline = item => readStoryDate(item.due)?.milliseconds ?? Infinity;
    const plans = view.plans.filter(item => ['accepted', 'proposed'].includes(item.status))
        .sort((a, b) => deadline(a) - deadline(b) || recent(a, b)).slice(0, 2);
    // Borrowed things usually carry a promise, so they outrank ordinary belongings.
    const itemRelevance = item => (presentIds.has(item.holder) ? 2 : location && item.location === location.id ? 1 : 0) + (item.loan ? 1 : 0);
    const items = view.items.filter(item => item.status !== 'destroyed' && item.quantity !== 0)
        .sort((a, b) => itemRelevance(b) - itemRelevance(a) || recent(a, b)).slice(0, 2);
    const people = (present.length ? present : [...view.people].sort(recent)).slice(0, 4);
    return { location, people, peopleLabel: present.length ? '在此' : '人物', relationships, plans, items,
        peopleRemaining: view.people.length - people.length,
        relationshipsRemaining: view.relationships.length - relationships.length,
        plansRemaining: view.plans.length - plans.length, itemsRemaining: view.items.length - items.length,
        itemsLabel: items.length && items.every(item => presentIds.has(item.holder)) ? '随身' : '物品' };
}

const pad = value => String(value).padStart(2, '0');
const shorten = (value, length) => { const chars = Array.from(String(value ?? '')); return chars.length > length ? chars.slice(0, length).join('') + '…' : chars.join(''); };
const firstChar = (value, fallback) => Array.from(String(value || fallback))[0];

// Time left on an open plan. Minute-precise story time and deadline give hours; otherwise the day-based label.
export function planRemaining(plan, view) {
    if (!['proposed', 'accepted'].includes(plan.status)) return '';
    const due = readStoryDate(plan.due), now = readStoryDate(view.clock?.date);
    if (due?.precision === 'minute' && now?.precision === 'minute') {
        const minutes = Math.round((due.milliseconds - now.milliseconds) / 60000);
        if (minutes < 0) return '已逾期';
        if (minutes < 48 * 60) {
            const hours = Math.floor(minutes / 60), rest = minutes % 60;
            return minutes ? '还剩 ' + [hours ? hours + ' 小时' : '', rest ? rest + ' 分' : ''].filter(Boolean).join(' ') : '即将到期';
        }
    }
    return planStatusLabel(plan).split(' · ').slice(1).join(' · ') || plan.dueDescription || '';
}

export function createRpStatePresentation({ escapeHtml: esc }) {
    const chevron = '<span class="rp-chevron" aria-hidden="true">›</span>';
    const tag = (value, type = '') => `<span class="rp-tag${type ? ' ' + type : ''}">${esc(value)}</span>`;
    const label = text => `<span class="rp-label">${esc(text)}</span>`;
    const link = (kind, id, html, css = '') => `<button type="button" class="${css}" data-rp-action="detail" data-rp-kind="${esc(kind)}" data-rp-id="${esc(id)}">${html}</button>`;
    const route = (action, html, css = 'rp-more', extra = '') => `<button type="button" class="${css}" data-rp-action="${action}" ${extra}>${html}</button>`;
    const more = (action, text) => route(action, `${esc(text)} ${chevron}`);
    const empty = text => `<p class="rp-empty">${esc(text)}</p>`;
    const head = (title, english = '', action = '', count = 0) => `<div class="rp-sec-head"><h3>${esc(title)}${english ? label(english) : ''}</h3>${action ? more(action, '全部' + (count ? ' ' + count : '')) : ''}</div>`;
    const fields = pairs => {
        const shown = pairs.filter(([, value]) => value != null && value !== '');
        return shown.length ? `<dl class="rp-facts">${shown.map(([name, value]) => `<dt>${esc(name)}</dt><dd>${esc(value)}</dd>`).join('')}</dl>` : '';
    };
    const row = (kind, id, glyph, title, sub, trailing = '', symbol = false) => link(kind, id,
        `<span class="rp-glyph${symbol ? ' is-symbol' : ''}" aria-hidden="true">${esc(glyph)}</span><span class="rp-row-main"><strong>${esc(title)}</strong>${sub ? `<small>${esc(sub)}</small>` : ''}</span>${trailing}${chevron}`, 'rp-row');
    const activeStates = person => (person.states || []).filter(state => state.active !== false && !state.ended && !state.endedAt);
    const isOpenPlan = plan => ['accepted', 'proposed'].includes(plan.status);

    function relationRow(item, view) {
        const arrow = item.mutual ? '↔' : '→';
        const kind = relationshipName(view, item).split(' · ').at(-1);
        const span = item.elapsedDays > 0 ? `${item.status === 'ended' ? '曾持续' : '已持续'} ${item.elapsedDays} 天` : '';
        return row('relationships', item.id, arrow, `${entityName(view, item.from)} ${arrow} ${entityName(view, item.to)}`,
            [kind, span].filter(Boolean).join(' · '), tag(item.status === 'active' ? '已成立' : stateLabels[item.status] || '状态未定', item.status === 'active' ? 'is-live' : ''), true);
    }
    function itemRow(item, view) {
        const where = item.holder ? entityName(view, item.holder) + ' 持有' : item.location ? locationTrail(view, item.location) : '持有者未记录';
        const badge = item.loan ? tag('借用', 'is-live') : ['damaged', 'destroyed'].includes(item.status) ? tag(stateLabels[item.status], 'is-alert')
            : item.quantity > 1 ? tag('×' + item.quantity) : '';
        return row('items', item.id, firstChar(item.name, '物'), item.name || '未命名物品', where + (item.loan ? ' · 借用中' : ''), badge);
    }
    function callRow(plan, view) {
        const due = readStoryDate(plan.due), now = readStoryDate(view.clock?.date);
        const sameDay = due && now && due.year === now.year && due.month === now.month && due.day === now.day;
        const when = !due ? '未定' : due.precision === 'minute' ? `${pad(due.hour)}:${pad(due.minute)}` : `${due.month}·${due.day}`;
        const whenNote = due?.precision === 'minute' && !sameDay ? `${due.month}·${due.day}` : '';
        const remaining = planRemaining(plan, view);
        const urgent = isOpenPlan(plan) && (plan.timing?.status === 'overdue' || /小时|分|即将|今日|逾期/.test(remaining));
        const people = (plan.participants || []).map(id => entityName(view, id)).join('、');
        return link('plans', plan.id, `<span class="rp-when${urgent ? ' is-soon' : ''}"><b>${esc(when)}</b>${whenNote ? `<small>${esc(whenNote)}</small>` : ''}</span><span class="rp-row-main"><strong>${esc(plan.title || '未命名约定')}</strong><small>${esc([people, remaining || plan.dueDescription].filter(Boolean).join(' · '))}</small></span>${tag(stateLabels[plan.status] || '状态未定', plan.timing?.status === 'overdue' && isOpenPlan(plan) ? 'is-alert' : urgent ? 'is-live' : '')}${chevron}`, 'rp-call');
    }
    function memo(item, view) {
        const data = item.data, guess = item.track !== 'claims';
        const heard = Array.isArray(data.heardBy) && data.heardBy.length ? data.heardBy.map(value => informationName(view, value)).join('、') + ' 知道' : guess ? '只在心里' : '';
        return link(item.track, item.id, `<span class="rp-memo-who"><span>${esc(informationName(view, data.speaker))}${data.subject ? ' → ' + esc(informationName(view, data.subject)) : ''}</span>${tag(guess ? '推测' : '说法', guess ? 'is-live' : '')}</span><q>${esc(data.description)}</q>${heard || item.floor != null ? `<span class="rp-memo-who"><span>${esc(heard)}</span>${item.floor != null ? `<span class="rp-mono">第 ${esc(item.floor)} 楼</span>` : ''}</span>` : ''}`, 'rp-memo' + (guess ? ' is-guess' : ''));
    }

    function directoryRow(entry, view) {
        const item = entry.record;
        if (entry.kind === 'people') {
            const present = view.scene?.present?.includes(item.id);
            return row('people', entry.id, firstChar(item.name, '人'), item.name || '未命名', entry.detail, present ? tag('在场', 'is-live') : '');
        }
        if (entry.kind === 'relationships') return relationRow(item, view);
        if (['claims', 'observations'].includes(entry.kind)) {
            const who = informationName(view, item.data.speaker) + (item.data.subject ? ' → ' + informationName(view, item.data.subject) : '');
            return row(entry.kind, entry.id, entry.kind === 'claims' ? '说' : '察', who, item.data.description, tag(entry.kind === 'claims' ? '说法' : '推测'), true);
        }
        if (entry.kind === 'items') return itemRow(item, view);
        if (entry.kind === 'plans') return row('plans', entry.id, '约', item.title || '未命名约定',
            [item.due?.replace('T', ' ') || item.dueDescription, planRemaining(item, view)].filter(Boolean).join(' · '), tag(stateLabels[item.status] || '状态未定', isOpenPlan(item) ? 'is-live' : ''), true);
        const current = view.scene?.location === item.id;
        return row('locations', entry.id, firstChar(item.name, '地'), item.name || '未命名地点', item.parent ? locationTrail(view, item.parent) : '', current ? tag('当前场景', 'is-live') : '');
    }
    function directoryRows(list, view) {
        const labels = { people: '人物', relationships: '关系', claims: '角色说法', observations: '推测', items: '物品', plans: '约定', locations: '地点' };
        return '<div class="rp-groups">' + Object.entries(labels).map(([kind, name]) => {
            const group = list.filter(entry => entry.kind === kind);
            return group.length ? `<section class="rp-group" data-rp-group="${kind}" aria-label="${name}"><div class="rp-group-head"><h4>${name}</h4>${label(group.length + ' 条')}</div><div class="rp-list">${group.map(entry => directoryRow(entry, view)).join('')}</div></section>` : '';
        }).join('') + '</div>';
    }
    // Change history as a timeline: one block per floor, each change as “verb · what”.
    function timelineRows(list) {
        const groups = [];
        for (const entry of list) {
            const floor = entry.record.order ?? entry.record.floor;
            let group = groups.at(-1);
            if (!group || group.floor !== floor) groups.push(group = { floor, rows: [] });
            group.rows.push(entry);
        }
        const quiet = new Set(['事实', '角色说法', '观察']);
        return `<div class="rp-timeline">${groups.map(group => `<section class="rp-take"><div class="rp-take-head"><h4>第 ${esc(group.floor ?? '未知')} 楼</h4></div>${group.rows.map(entry => {
            const [verb, ...rest] = String(entry.title).split(' · ');
            const lost = ['未采用', '待重新提取'].includes(entry.status);
            const what = rest.join(' · ') || verb;
            const note = lost ? entry.detail : entry.kind === 'candidate' ? entry.detail : '';
            return link(entry.kind, entry.id, `<span class="rp-verb">${esc(lost ? '没记上' : rest.length ? verb : '记录')}</span><span class="rp-row-main"><strong>${esc(lost ? entry.title : what)}</strong>${note ? `<small>${esc(note)}</small>` : ''}</span>${entry.status && !quiet.has(entry.status) && !lost ? tag(entry.status, ['待确认', '待复核', '已撤回'].includes(entry.status) ? 'is-alert' : '') : ''}${chevron}`, 'rp-event' + (lost ? ' is-lost' : ''));
        }).join('')}</section>`).join('')}</div>`;
    }
    function rows(list, view, { directory = false, timeline = false } = {}) {
        if (!list.length) return empty('暂无记录');
        if (directory) return directoryRows(list, view);
        if (timeline || !['people', 'relationships', 'items', 'plans', 'locations'].includes(list[0].kind)) return timelineRows(list);
        return `<div class="rp-list">${list.map(entry => entry.kind === 'plans' ? callRow(entry.record, view) : directoryRow(entry, view)).join('')}</div>`;
    }

    // At most six people: the current scene plus everyone directly related to it. Returns '' when it would not fit.
    function relationGraph(view, info = []) {
        const byId = new Map(view.people.map(person => [person.id, person]));
        const present = (view.scene?.present || []).filter(id => byId.has(id));
        const active = view.relationships.filter(item => item.status === 'active' && byId.has(item.from) && byId.has(item.to) && item.from !== item.to);
        const ids = new Set(present);
        const edges = present.length ? active.filter(item => ids.has(item.from) || ids.has(item.to)) : active;
        edges.forEach(item => { ids.add(item.from); ids.add(item.to); });
        const find = value => byId.get(value) || view.people.find(person => person.name === value || person.aliases?.includes(value));
        const guesses = info.map(item => ({ item, from: find(item.data.speaker), to: find(item.data.subject) }))
            .filter(guess => guess.from && guess.to && guess.from !== guess.to && ids.has(guess.from.id) && ids.has(guess.to.id)).slice(0, 3);
        if (ids.size < 2 || ids.size > 6 || !edges.length && !guesses.length) return '';
        const here = [...ids].filter(id => present.includes(id)), away = [...ids].filter(id => !present.includes(id));
        const layout = here.length && away.length ? [away, here] : here.length ? [here] : [away.slice(0, Math.ceil(away.length / 2)), away.slice(Math.ceil(away.length / 2))];
        const width = 360, top = 70, gap = 132, radius = 21, spot = new Map();
        layout.forEach((ids, line) => ids.forEach((id, index) => spot.set(id, { x: 30 + (index + .5) * (width - 60) / ids.length, y: top + line * gap, line, index })));
        const height = top + (layout.length - 1) * gap + 64, f = value => Math.round(value * 10) / 10, placed = [];
        const curve = (from, to, bend) => {
            const p = spot.get(from), q = spot.get(to), mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
            const length = Math.hypot(q.x - p.x, q.y - p.y) || 1, normal = { x: -(q.y - p.y) / length, y: (q.x - p.x) / length };
            const skip = p.line === q.line && Math.abs(p.index - q.index) > 1 ? -52 : 0;
            const control = { x: mid.x + normal.x * (bend + skip), y: mid.y + normal.y * (bend + skip) };
            const trim = (point) => { const dx = control.x - point.x, dy = control.y - point.y, d = Math.hypot(dx, dy) || 1; return { x: point.x + dx / d * (radius + 3), y: point.y + dy / d * (radius + 3) }; };
            const start = trim(p), end = trim(q);
            return { d: `M${f(start.x)} ${f(start.y)} Q${f(control.x)} ${f(control.y)} ${f(end.x)} ${f(end.y)}`,
                at: { x: .25 * start.x + .5 * control.x + .25 * end.x, y: .25 * start.y + .5 * control.y + .25 * end.y } };
        };
        const caption = (at, text) => {
            const w = Array.from(text).length * 12 + 12, box = { x: at.x - w / 2, y: at.y - 10, w, h: 20 };
            for (let tries = 0; tries < 4 && placed.some(other => box.x < other.x + other.w && other.x < box.x + box.w && box.y < other.y + other.h && other.y < box.y + box.h); tries++) box.y += 20;
            placed.push(box);
            return `<g class="rp-edge-label"><rect x="${f(box.x)}" y="${f(box.y)}" width="${f(box.w)}" height="20" rx="2"></rect><text x="${f(at.x)}" y="${f(box.y + 10)}">${esc(text)}</text></g>`;
        };
        let lines = '', captions = '';
        for (const item of edges) {
            const path = curve(item.from, item.to, 0);
            lines += `<path class="rp-edge" d="${path.d}" marker-end="url(#rp-graph-arrow)"${item.mutual ? ' marker-start="url(#rp-graph-arrow)"' : ''}></path>`;
            captions += caption(path.at, shorten(relationshipName(view, item).split(' · ').at(-1), 6));
        }
        for (const guess of guesses) {
            const path = curve(guess.from.id, guess.to.id, 26);
            lines += `<path class="rp-edge is-guess" d="${path.d}" marker-end="url(#rp-graph-arrow)"></path>`;
            captions += caption(path.at, (guess.item.track === 'claims' ? '说法：' : '推测：') + shorten(guess.item.data.description, 5));
        }
        const hereLine = here.length ? layout.indexOf(here) : -1;
        const scene = view.locations.find(item => item.id === view.scene?.location);
        const frame = hereLine < 0 ? '' : `<rect class="rp-scene-frame" x="12" y="${top + hereLine * gap - 48}" width="${width - 24}" height="104" rx="3"></rect><text class="rp-scene-frame-label" x="24" y="${top + hereLine * gap - 30}">${esc(shorten(scene?.name || '当前场景', 8))} · 在场</text>`;
        const nodes = [...spot].map(([id, at]) => {
            const person = byId.get(id);
            return `<g class="rp-node${present.includes(id) ? ' is-here' : ''}" data-rp-action="detail" data-rp-kind="people" data-rp-id="${esc(id)}" tabindex="0" role="button" aria-label="${esc(person.name)}的档案"><circle cx="${f(at.x)}" cy="${f(at.y)}" r="${radius}"></circle><text class="rp-node-initial" x="${f(at.x)}" y="${f(at.y)}">${esc(firstChar(person.name, '人'))}</text><text class="rp-node-name" x="${f(at.x)}" y="${f(at.y + 38)}">${esc(shorten(person.name, 5))}</text></g>`;
        }).join('');
        const summary = edges.map(item => `${entityName(view, item.from)}${item.mutual ? '与' : '对'}${entityName(view, item.to)}：${relationshipName(view, item).split(' · ').at(-1)}`).join('；');
        return `<div class="rp-graph"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(summary || '人物关系')}"><defs><marker id="rp-graph-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z"></path></marker></defs>${frame}${lines}${captions}${nodes}</svg><p class="rp-graph-legend"><span><i></i>已成立的关系</span>${guesses.length ? '<span><i class="is-dashed"></i>推测 / 说法</span>' : ''}</p></div>`;
    }

    function scene(view, lastBatch, historicalFloor) {
        const date = storyDateLabel(view.clock.date);
        const place = view.scene?.location ? locationTrail(view, view.scene.location) : '';
        const present = view.people.filter(item => view.scene?.present?.includes(item.id)).map(item => item.name);
        const floor = historicalFloor ?? lastBatch?.sourceFloor ?? lastBatch?.floor;
        return `<section class="rp-scene-card">${label((date.year || '此刻') + ' · ' + (historicalFloor == null ? '当前故事' : '历史快照') + (floor != null ? ` · 第 ${floor} 楼` : ''))}<h3 class="rp-detail-title" tabindex="-1">${esc(date.date || view.clock.description || '剧情时间待记录')}${date.time ? `<small>${esc(date.time)}</small>` : ''}</h3>${fields([['时间描述', date.date ? view.clock.description : ''], ['场景', place || '人物位置尚未记录'], ['在场', present.join('、')]])}</section>`;
    }

    function overview(view, lastBatch, historicalFloor, recentRows = [], facts = [], informationRows = [], meta = {}) {
        const selection = selectStoryOverview(view, facts);
        const date = readStoryDate(view.clock.date), dateLabel = storyDateLabel(view.clock.date);
        const floor = historicalFloor ?? lastBatch?.sourceFloor ?? lastBatch?.floor;
        const place = selection.location;
        const rootPlace = place ? locationTrail(view, place.id).split(' / ')[0] : '';
        const presentCount = view.scene?.present?.length || 0;
        const openPlans = view.plans.filter(isOpenPlan).length;
        const dateValue = date ? `${date.month}·${date.day}<small>${esc(dateLabel.year)} · ${esc(dateLabel.time.split(' · ')[0])}</small>` : esc(view.clock.description || '未记录');
        let html = `<section class="rp-slate${meta.animate ? ' is-clapping' : ''}" aria-label="当前场景"><div class="rp-clap" aria-hidden="true"><i class="rp-clap-top"></i><i class="rp-clap-bottom"></i></div>
<div class="rp-slate-head"><span class="rp-slate-title">${esc(rootPlace || '当前故事')}${date && view.clock.description ? ' · ' + esc(view.clock.description) : ''}</span>${label(historicalFloor == null ? meta.maintenance || '当前故事' : '历史快照 · 只读')}</div>
<div class="rp-slate-grid">
<div class="rp-cell">${label('场 · SCENE')}${place ? link('locations', place.id, `${esc(place.name)} ${chevron}`, 'rp-slate-value') : route('locations', `未记录 ${chevron}`, 'rp-slate-value is-empty')}</div>
<div class="rp-cell">${label('镜 · TAKE')}<span class="rp-slate-value">${floor != null ? `第 ${esc(floor)} 楼` : '—'}</span></div>
<div class="rp-cell">${label('日期 · DATE')}${route('clock', dateValue, 'rp-slate-value')}</div>
<div class="rp-cell">${label('时刻 · TIME')}<span class="rp-slate-value is-timecode">${date?.precision === 'minute' ? `${pad(date.hour)}:${pad(date.minute)}` : '—'}</span></div>
</div><div class="rp-slate-foot"><span>在场 <b>${presentCount}</b> · 人物 ${view.people.length} · 约定 ${openPlans}</span><span>${historicalFloor == null ? meta.processedFloor != null ? `已处理到 ${esc(meta.processedFloor)} 楼` : '尚未处理正文' : `第 ${esc(historicalFloor)} 楼时`}</span>${view.locations.length > 1 ? more('locations', `地点 ${view.locations.length}`) : ''}</div></section>`;

        if (view.people.length) html += `<section class="rp-sec rp-sec-cast">${head(presentCount ? '在场' : '人物', 'CAST', 'people', view.people.length)}<div class="rp-strip">${selection.people.map((person, index) => {
            const here = view.scene?.present?.includes(person.id), states = activeStates(person);
            return link('people', person.id, `<span class="rp-frame-no">${presentCount ? here ? '在场' : '不在场' : '人物'} · ${pad(index + 1)}</span><span class="rp-frame-initial" aria-hidden="true">${esc(firstChar(person.name, '人'))}</span><strong>${esc(person.name)}</strong><small>${esc(states[0]?.description || (person.location ? locationTrail(view, person.location) : '状态未记录'))}${states.length > 1 ? ` 等 ${states.length} 项` : ''}</small>`, 'rp-frame' + (here || !presentCount ? '' : ' is-away'));
        }).join('')}</div>${selection.peopleRemaining > 0 ? more('people', `其余 ${selection.peopleRemaining} 人`) : ''}</section>`;

        const notes = informationRows.filter(item => informationInvolves(item, selection.people)).slice(0, 2);
        if (view.relationships.length || informationRows.length) {
            const graph = relationGraph(view, informationRows);
            html += `<section class="rp-sec rp-sec-relations">${head('人物关系', 'RELATIONS', 'relationships', view.relationships.length)}${graph || (selection.relationships.length ? `<div class="rp-list">${selection.relationships.map(item => relationRow(item, view)).join('')}</div>` : view.relationships.length ? empty('没有进行中的关系') : '')}${!graph && selection.relationshipsRemaining > 0 ? more('relationships', `其余 ${selection.relationshipsRemaining} 段关系`) : ''}</section>`;
        }
        if (view.plans.length) html += `<section class="rp-sec rp-sec-plans">${head('通告单', 'CALL SHEET', 'plans', view.plans.length)}${selection.plans.length ? `<div class="rp-list">${selection.plans.map(item => callRow(item, view)).join('')}</div>` : empty('没有进行中的约定')}${selection.plansRemaining > 0 ? more('plans', `其余 ${selection.plansRemaining} 项约定`) : ''}</section>`;
        if (view.items.length) html += `<section class="rp-sec rp-sec-items">${head('道具表', 'PROPS', 'items', view.items.length)}${selection.items.length ? `<div class="rp-list">${selection.items.map(item => itemRow(item, view)).join('')}</div>` : empty('没有在用的道具')}${selection.itemsRemaining > 0 ? more('items', `其余 ${selection.itemsRemaining} 件物品`) : ''}</section>`;
        if (notes.length) html += `<section class="rp-sec rp-sec-notes">${head('场记笔记', 'NOTES', 'directory')}${notes.map(item => memo(item, view)).join('')}</section>`;
        html += `<div class="rp-overview-end">${more('history', '全部变化')}</div>`;
        return html;
    }

    function entityDetail(kind, item, core, view, floor, ledgerView = { projection: view }) {
        const title = kind === 'relationships' ? `${entityName(view, item.from)} ${item.mutual ? '↔' : '→'} ${entityName(view, item.to)}` : item.name || item.title;
        const captions = { people: '人物档案 · CAST', relationships: '人物关系', plans: '约定 · CALL', items: '道具 · PROP', locations: '地点 · LOCATION' };
        const lede = kind === 'people' ? (item.location ? locationTrail(view, item.location) + (view.scene?.present?.includes(item.id) ? ' · 在场' : '') : '')
            : kind === 'relationships' ? relationshipName(view, item).split(' · ').at(-1) + ' · ' + (stateLabels[item.status] || '状态未定')
                : kind === 'plans' ? [stateLabels[item.status], planRemaining(item, view)].filter(Boolean).join(' · ')
                    : kind === 'items' ? (item.loan ? '借用中' : stateLabels[item.status] || '') : locationTrail(view, item.parent) || '';
        let html = `<header class="rp-entry-head">${label(captions[kind])}<h3 tabindex="-1" class="rp-detail-title">${esc(title)}</h3>${lede ? `<p class="rp-lede">${esc(lede)}</p>` : ''}</header>`;
        const section = (name, body) => body ? `<section class="rp-entry-sec"><h4>${esc(name)}</h4>${body}</section>` : '';
        if (kind === 'people') {
            html += fields([['年龄', item.age?.value == null ? null : `${item.age.value} 岁`], ['别名', (item.aliases || []).join('、')], ['特征', (item.traits || []).join('；')]]);
            if (item.age?.basis === 'reported') html += `<p class="rp-note">年龄依据：${esc(item.age.asOf || '日期未定')}时的描述。</p>`;
            const states = (item.states || []).filter(state => state.active);
            html += section('当前状态', states.length ? `<ul class="rp-plain-list">${states.map(state => `<li>${esc(state.description)}${state.target ? ' → ' + esc(entityName(view, state.target)) : ''}<small>${esc({ private: '只有自己知道', author: '作者信息', observable: '看得出来' }[state.visibility] || '可见性未记录')}</small></li>`).join('')}</ul>` : '');
            const relations = view.relationships.filter(relation => relation.from === item.id || relation.to === item.id);
            html += section('关系', relations.length ? `<div class="rp-list">${relations.slice(0, 6).map(relation => relationRow(relation, view)).join('')}</div>` : '');
            const info = currentInformation(core, ledgerView, { floor }).filter(record => informationInvolves(record, [item])).slice(0, 5);
            html += section('相关说法与推测', info.map(record => memo(record, view)).join(''));
            const objects = view.items.filter(object => object.holder === item.id || object.owner === item.id);
            html += section('道具', objects.length ? `<div class="rp-list">${objects.slice(0, 6).map(object => itemRow(object, view)).join('')}</div>` : '');
            const plans = view.plans.filter(plan => plan.participants?.includes(item.id) && isOpenPlan(plan));
            html += section('接下来的约定', plans.length ? `<div class="rp-list">${plans.slice(0, 3).map(plan => callRow(plan, view)).join('')}</div>` : '');
        } else if (kind === 'relationships') {
            html += fields([['开始于', item.since], ['一起走过', item.elapsedDays > 0 ? `${item.elapsedDays} 天` : null], [item.status === 'ended' ? '结束于' : '下一纪念日', item.status === 'ended' ? item.endedAt : item.anniversary?.nextDate]]);
            const milestones = [...(item.milestones || []).map(event => ({ ...event, label: '共同经历' })), ...(item.conflicts || []).map(event => ({ ...event, label: '冲突' }))].sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))).slice(0, 10);
            html += section('共同经历与变化', milestones.length ? `<ul class="rp-plain-list">${milestones.map(event => `<li>${esc(event.description)}<small>${esc(event.date || '日期未定')} · ${event.label}</small></li>`).join('')}</ul>` : '');
            const plans = view.plans.filter(plan => plan.participants?.includes(item.from) && plan.participants?.includes(item.to));
            html += section('共同约定', plans.length ? `<div class="rp-list">${plans.slice(0, 3).map(plan => callRow(plan, view)).join('')}</div>` : '');
        } else if (kind === 'plans') html += fields([['参与者', (item.participants || []).map(id => entityName(view, id)).join('、')], ['约定日期', item.due?.replace('T', ' ') || item.dueDescription], ['履约状态', stateLabels[item.status]], ['结果', item.outcome]]);
        else if (kind === 'items') html += fields([['持有者', item.holder ? entityName(view, item.holder) : null], ['所有者', item.owner ? entityName(view, item.owner) : null], ['存放地点', item.location ? locationTrail(view, item.location) : null], ['数量', item.quantity], ['状态', stateLabels[item.status]]]);
        else {
            html += fields([['地点层级', locationTrail(view, item.id)]]);
            const present = view.people.filter(person => view.scene?.location === item.id && view.scene?.present?.includes(person.id));
            html += section('在此的人物', present.length ? `<div class="rp-list">${present.slice(0, 20).map(person => row('people', person.id, firstChar(person.name, '人'), person.name, activeStates(person)[0]?.description || '')).join('')}</div>` : empty('暂无人物位置记录'));
        }
        const facts = relatedFacts(core, view, kind, item.id, floor).slice(0, 5);
        html += facts.length ? section('来源与变化', `<div class="rp-list">${facts.map(fact => link('facts', fact.id, `<span class="rp-verb">第 ${esc(fact.floor)} 楼</span><span class="rp-row-main"><strong>${esc(describeRecord(fact, view))}</strong></span>${chevron}`, 'rp-event')).join('')}</div>`)
            : '<p class="rp-note">当前基线中的已知状态</p>';
        return html;
    }
    return { rows, scene, overview, entityDetail, relationGraph, empty, fields, tag, chip: tag, label, head, route, more };
}
