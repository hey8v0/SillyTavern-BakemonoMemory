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
    const itemRelevance = item => presentIds.has(item.holder) ? 2 : location && item.location === location.id ? 1 : 0;
    const items = view.items.filter(item => item.status !== 'destroyed' && item.quantity !== 0)
        .sort((a, b) => itemRelevance(b) - itemRelevance(a) || recent(a, b)).slice(0, 2);
    const people = (present.length ? present : [...view.people].sort(recent)).slice(0, 4);
    return { location, people, peopleLabel: present.length ? '在此' : '人物', relationships, plans, items,
        peopleRemaining: view.people.length - people.length,
        relationshipsRemaining: view.relationships.length - relationships.length,
        plansRemaining: view.plans.length - plans.length, itemsRemaining: view.items.length - items.length,
        itemsLabel: items.length && items.every(item => presentIds.has(item.holder)) ? '随身' : '物品' };
}

export function createRpStatePresentation({ escapeHtml: esc }) {
    const icon = name => `<i class="fa-solid fa-${name}" aria-hidden="true"></i>`;
    const chip = (value, type = '') => `<span class="rp-chip ${type}">${esc(value)}</span>`;
    const avatar = (name, secondary = false) => `<span class="rp-avatar${secondary ? ' rp-avatar-secondary' : ''}" aria-hidden="true">${esc(Array.from(name || '人')[0])}</span>`;
    const link = (kind, id, html, css = '') => `<button type="button" class="${css}" data-rp-action="detail" data-rp-kind="${esc(kind)}" data-rp-id="${esc(id)}">${html}</button>`;
    const chevron = '<span class="rp-chevron" aria-hidden="true">›</span>';
    const empty = text => `<p class="rp-empty">${esc(text)}</p>`;
    const head = title => `<div class="rp-section-head"><h3>${esc(title)}</h3></div>`;
    const fields = pairs => `<dl class="rp-facts-grid">${pairs.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value == null || value === '' ? '尚未记录' : value)}</dd></div>`).join('')}</dl>`;

    function relationship(item, view) {
        const from = entityName(view, item.from), to = entityName(view, item.to);
        const label = relationshipName(view, item).split(' · ').at(-1);
        const milestone = [...(item.milestones || []), ...(item.conflicts || [])].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))[0];
        const span = item.elapsedDays == null ? '' : ` · ${item.status === 'ended' ? '曾持续' : '已持续'} ${item.elapsedDays} 天`;
        return link('relationships', item.id, `<span class="rp-relation-top"><span class="rp-duo">${avatar(from, true)}${avatar(to)}</span><span class="rp-row-copy"><strong>${esc(from)} <span class="rp-arrow">${item.mutual ? '↔' : '→'}</span> ${esc(to)}</strong><small>${esc(label)} · ${esc(stateLabels[item.status] || '状态未定')}${esc(span)}</small></span>${chevron}</span>${milestone ? `<span class="rp-relation-bottom">${chip('最近')}<span>${esc(milestone.description)}</span></span>` : ''}`, 'rp-relation-card');
    }

    function appointment(item, view) {
        const date = readStoryDate(item.due);
        return link('plans', item.id, `<span class="rp-calendar"><small>${date ? `${date.month} 月` : '未定'}</small><b>${date ? date.day : '—'}</b></span><span class="rp-row-copy"><strong>${esc(item.title || '未命名约定')}</strong><small>${esc((item.participants || []).map(id => entityName(view, id)).join('、'))}</small>${chip(planStatusLabel(item), item.timing?.status === 'overdue' && ['accepted', 'proposed'].includes(item.status) ? 'rp-attention' : '')}</span>${chevron}`, 'rp-appointment');
    }

    function person(item, view) {
        const sub = [item.location ? '最后已知：' + locationTrail(view, item.location) : '位置尚未记录',
            ...(item.states || []).filter(state => state.active).slice(0, 1).map(state => state.description)];
        return link('people', item.id, `${avatar(item.name)}<span class="rp-row-copy"><strong>${esc(item.name)}</strong><small>${esc(sub.join(' · '))}</small></span>${chevron}`, 'rp-person rp-row');
    }

    function directoryRow(row, view) {
        const item = row.record;
        let title = row.title, detail = row.detail, symbol = '', badge = '';
        if (row.kind === 'people') symbol = `<span class="rp-directory-avatar" aria-hidden="true">${esc(Array.from(item.name || '人')[0])}</span>`;
        else if (row.kind === 'relationships') {
            title = entityName(view, item.from) + (item.mutual ? ' ↔ ' : ' → ') + entityName(view, item.to);
            detail = relationshipName(view, item).split(' · ').at(-1);
            badge = item.status === 'active' ? '已成立' : stateLabels[item.status] || '';
        } else if (['claims', 'observations'].includes(row.kind)) {
            title = informationName(view, item.data.speaker) + (item.data.subject ? ' → ' + informationName(view, item.data.subject) : '');
            detail = item.data.description; badge = row.kind === 'claims' ? '说法' : '观察';
        } else {
            symbol = `<span class="rp-directory-symbol">${icon(({ items: 'key', plans: 'calendar-days', locations: 'location-dot' })[row.kind])}</span>`;
            if (row.kind === 'items') {
                detail = [item.holder ? entityName(view, item.holder) + '持有' : item.location ? locationTrail(view, item.location) : '', item.loan ? '借用中' : ''].filter(Boolean).join(' · ');
                if (['damaged', 'destroyed'].includes(item.status)) badge = stateLabels[item.status];
            } else if (row.kind === 'plans') detail = [item.due?.replace('T', ' ') || item.dueDescription, planStatusLabel(item)].filter(Boolean).join(' · ');
            else detail = [item.parent ? locationTrail(view, item.parent) : '', view.scene?.location === item.id ? '当前场景' : ''].filter(Boolean).join(' · ');
        }
        return link(row.kind, row.id, `${symbol}<span class="rp-directory-copy"><strong>${esc(title)}</strong>${detail ? `<small>${esc(detail)}</small>` : ''}</span>${badge ? `<span class="rp-directory-badge">${esc(badge)}</span>` : ''}${chevron}`, 'rp-directory-row');
    }
    function directoryRows(rows, view) {
        const labels = { people: '人物', relationships: '关系', claims: '角色说法', observations: '观察', items: '物品', plans: '约定', locations: '地点' };
        return '<div class="rp-directory-list">' + Object.entries(labels).map(([kind, label]) => {
            const group = rows.filter(row => row.kind === kind);
            return group.length ? `<section class="rp-directory-group" data-rp-group="${kind}" aria-label="${label}">${kind === 'people' ? '' : `<h4>${label}</h4>`}${group.map(row => directoryRow(row, view)).join('')}</section>` : '';
        }).join('') + '</div>';
    }
    function rows(rows, view, { recent = false, directory = false } = {}) {
        if (!rows.length) return empty('暂无记录');
        if (directory) return directoryRows(rows, view);
        const kind = rows[0].kind;
        if (kind === 'people') return `<div class="rp-sheet rp-person-list">${rows.map(row => person(row.record, view)).join('')}</div>`;
        if (kind === 'relationships') return `<div class="rp-card-list">${rows.map(row => relationship(row.record, view)).join('')}</div>`;
        if (kind === 'plans') return `<div class="rp-card-list">${rows.map(row => appointment(row.record, view)).join('')}</div>`;
        if (kind === 'items') return `<div class="rp-item-grid">${rows.map(({ record: item }) => `<section class="rp-sheet rp-item-card"><div class="rp-item-title"><span class="rp-object-icon">${icon('box-open')}</span><span class="rp-row-copy"><strong>${esc(item.name)}</strong>${chip(item.loan ? '借用中' : stateLabels[item.status] || '状态未定')}</span>${link('items', item.id, '详情 ›', 'rp-link')}</div>${fields([['持有者', entityName(view, item.holder)], ['所有者', entityName(view, item.owner)]])}</section>`).join('')}</div>`;
        if (kind === 'locations') return `<div class="rp-card-list">${rows.map(({ record: item }) => {
            const present = view.people.filter(person => view.scene?.location === item.id && view.scene?.present?.includes(person.id));
            return link('locations', item.id, `<span class="rp-eyebrow">${esc(locationTrail(view, item.id))}</span><strong>${esc(item.name)}</strong>${present.length ? chip(`${present.length} 人在此`) + `<small>${esc(present.slice(0, 4).map(person => person.name).join('、'))}${present.length > 4 ? '…' : ''}</small>` : '<small>暂无人物位置记录</small>'}`, 'rp-place-card');
        }).join('')}</div>`;
        if (recent) return `<div class="rp-recent">${rows.map(row => link(row.kind, row.id, `<span class="rp-floor">${row.record.floor} 楼</span><span class="rp-row-copy">${esc(row.title)}</span>${chevron}`, 'rp-change-row')).join('')}</div>`;
        const groups = [];
        for (const row of rows) {
            let group = groups.at(-1);
            if (!group || group.floor !== row.record.floor) groups.push(group = { floor: row.record.floor, rows: [] });
            group.rows.push(row);
        }
        return groups.map(group => `<section class="rp-history-group"><h3>第 ${esc(group.floor ?? '未知')} 楼</h3>${group.rows.map(row => link(row.kind, row.id, `${chip(row.status, ['待确认', '待复核', '已撤回'].includes(row.status) ? 'rp-attention' : '')}<strong>${esc(row.title)}</strong>${row.kind === 'candidate' ? `<small>${esc(row.detail)}</small>` : ''}`, 'rp-history-entry')).join('')}</section>`).join('');
    }

    function scene(view, lastBatch, historicalFloor) {
        const date = storyDateLabel(view.clock.date);
        const positions = [...new Set(view.people.map(item => item.location).filter(Boolean))];
        const places = (view.scene?.location ? [view.scene.location] : []).map(id => locationTrail(view, id)).filter(Boolean);
        const located = view.people.filter(item => view.scene?.present?.includes(item.id)).slice(0, 4);
        return `<section class="rp-overview rp-sheet"><div class="rp-scene-top"><span class="rp-eyebrow">${date.year ? esc(date.year) : '此刻'} · ${historicalFloor == null ? '当前故事' : '历史快照'}</span>${historicalFloor != null || lastBatch ? `<span class="rp-floor">第 ${esc(historicalFloor ?? lastBatch.sourceFloor ?? lastBatch.floor)} 楼</span>` : ''}</div><h3>${esc(date.date || view.clock.description || '剧情时间待记录')}${date.time ? `<span class="rp-scene-period">${esc(date.time)}</span>` : ''}</h3>${date.date && view.clock.description ? `<p>${esc(view.clock.description)}</p>` : ''}<p class="rp-scene-place">${icon('location-dot')}${esc(places.join('；') || '人物位置尚未记录')}${positions.length > 3 ? '…' : ''}</p>${located.length ? `<div class="rp-cast"><span class="rp-eyebrow">${positions.length === 1 ? '在此' : '人物'}</span>${located.map(item => link('people', item.id, `${avatar(item.name)}${esc(item.name)}`, 'rp-cast-person')).join('')}</div>` : ''}</section>`;
    }

    function information(item, view) {
        const data = item.data;
        return link(item.track, item.id, `<span class="rp-story-copy"><strong>${esc(informationName(view, data.speaker))}${data.subject ? ' → ' + esc(informationName(view, data.subject)) : ''}</strong><small>${esc(data.description)}</small></span>${chip(item.track === 'claims' ? '说法' : '观察')}${chevron}`, 'rp-story-entry rp-story-information');
    }
    function overview(view, lastBatch, historicalFloor, recentRows = [], facts = [], informationRows = []) {
        const selection = selectStoryOverview(view, facts), date = storyDateLabel(view.clock.date);
        const route = (action, html, css = 'rp-story-more') => `<button type="button" class="${css}" data-rp-action="${action}">${html}</button>`;
        const more = (action, count, unit) => count > 0 ? route(action, `其余 ${count} ${unit} ${chevron}`) : '';
        const heading = (text, action = '', count = 0) => `<div class="rp-story-section-head"><h4>${esc(text)}</h4>${action ? route(action, '全部' + (count ? ' ' + count : '') + ' ›') : ''}</div>`;
        const dateText = esc(date.date || view.clock.description || '时间未记录');
        const time = view.clock.date?.includes('T') ? view.clock.date.split('T')[1] : '';
        const weekday = date.time.split(' · ')[0];
        let html = `<section class="rp-story-sheet" aria-label="当前故事总览"><div class="rp-story-tools">${route('directory', '全部记录')}${route('context-preview', '注入预览')}</div><div class="rp-story-scene"><div class="rp-scene-top"><span class="rp-eyebrow">${date.year ? esc(date.year) : '此刻'} · ${historicalFloor == null ? '当前故事' : '历史快照'}</span>${historicalFloor != null || lastBatch ? `<span class="rp-floor">第 ${esc(historicalFloor ?? lastBatch.sourceFloor ?? lastBatch.floor)} 楼</span>` : ''}</div><h3 class="rp-story-heading" tabindex="-1">${route('clock', `<span class="rp-story-date-block"><span class="rp-story-date">${dateText}</span><span class="rp-story-weekday">${esc([weekday, date.date ? view.clock.description : ''].filter(Boolean).join(' · '))}</span></span>${time ? `<span class="rp-story-time">${esc(time)}</span>` : ''}`, 'rp-story-clock')}</h3>`;
        const placeHtml = `${icon('location-dot')}<span class="rp-story-place-name">${esc(selection.location ? locationTrail(view, selection.location.id) : '场景未记录')}</span>${chevron}`;
        html += `<div class="rp-story-place">${selection.location ? link('locations', selection.location.id, placeHtml, 'rp-story-place-link') : route('locations', placeHtml, 'rp-story-place-link')}${selection.location ? more('locations', view.locations.length - 1, '处地点') : ''}</div></div>`;
        if (view.people.length) html += `<div class="rp-story-cast">${heading(selection.peopleLabel === '在此' ? '在场 · ' + (view.scene?.present?.length || 0) : '人物', 'people', view.people.length)}${selection.people.map(item => {
            const active = (item.states || []).filter(state => state.active !== false && !state.ended && !state.endedAt);
            const status = active.slice(0, 2).map(state => state.description).join('；');
            return link('people', item.id, `${avatar(item.name)}<span class="rp-story-copy"><strong>${esc(item.name)}</strong><small>${esc(status || (item.location ? locationTrail(view, item.location) : '状态未记录'))}</small></span>${active.length > 2 ? chip('+' + (active.length - 2)) : ''}${chevron}`, 'rp-story-person');
        }).join('')}</div>`;
        const info = informationRows.filter(item => informationInvolves(item, selection.people)).slice(0, 2);
        if (view.relationships.length || info.length) html += `<div class="rp-story-relations">${selection.relationships.length || info.length ? heading('关系与说法', 'relationships') : ''}${selection.relationships.map(item => {
            const names = `${esc(entityName(view, item.from))} <span class="rp-arrow">${item.mutual ? '↔' : '→'}</span> ${esc(entityName(view, item.to))}`;
            const type = relationshipName(view, item).split(' · ').at(-1);
            return link('relationships', item.id, `<span class="rp-story-copy"><strong>${names}</strong><small>${esc(type)}</small></span>${chip('已成立')}${chevron}`, 'rp-story-relation rp-story-entry');
        }).join('')}${info.map(item => information(item, view)).join('')}${more('relationships', selection.relationshipsRemaining, '段关系')}</div>`;
        if (view.items.length) html += `<div class="rp-story-items">${selection.items.length ? heading('随身与场景物品', 'items') : ''}${selection.items.map(item => link('items', item.id, `${icon('key')}<span class="rp-story-copy"><strong>${esc(item.name)}</strong><small>${esc(item.holder ? entityName(view, item.holder) + ' 持有' : item.location ? locationTrail(view, item.location) : '持有者未记录')}${item.loan ? ' · 借用' : ''}</small></span>${chevron}`, 'rp-story-item rp-story-entry')).join('')}${more('items', selection.itemsRemaining, '件物品')}</div>`;
        if (view.plans.length) html += `<div class="rp-story-plans">${selection.plans.length ? heading('尚未完成', 'plans') : ''}${selection.plans.map(item => link('plans', item.id, `${icon('calendar-days')}<span class="rp-story-copy"><strong>${esc(item.title || '未命名约定')}</strong><small>${esc(planStatusLabel(item))}${item.due || item.dueDescription ? ' · ' + esc(item.due?.replace('T', ' ') || item.dueDescription) : ''}</small></span>${chevron}`, 'rp-story-plan rp-story-entry')).join('')}${more('plans', selection.plansRemaining, '项约定')}</div>`;
        html += `<div class="rp-story-recent">${route('history', `变化记录 ${chevron}`)}</div></section>`;
        return html;
    }

    function entityDetail(kind, item, core, view, floor, ledgerView = { projection: view }) {
        const title = kind === 'relationships' ? relationshipName(view, item).replace(' → ', item.mutual ? ' ↔ ' : ' → ') : item.name || item.title;
        const captions = { people: '人物档案', relationships: '人物关系', plans: '共同约定', items: '物品档案', locations: '地点档案' };
        let html = `<div class="rp-detail-hero">${kind === 'people' ? avatar(item.name) : ''}<div><span class="rp-eyebrow">${captions[kind]}</span><h3 tabindex="-1" class="rp-detail-title">${esc(title)}</h3></div></div>`;
        html += `<button type="button" class="rp-link" data-rp-action="${kind}">全部${({ people: '人物', relationships: '关系', plans: '约定', items: '物品', locations: '地点' })[kind]} ›</button>`;
        if (kind === 'people') {
            html += fields([['最近确认位置', item.location ? locationTrail(view, item.location) : null], ['年龄', item.age?.value == null ? null : `${item.age.value} 岁`], ['别名', (item.aliases || []).join('、')], ['特征', (item.traits || []).join('；')]]);
            if (item.age?.basis === 'reported') html += `<p class="rp-note">年龄依据：${esc(item.age.asOf || '日期未定')}时的描述。</p>`;
            const states = (item.states || []).filter(state => state.active);
            if (states.length) html += head('当前状态') + `<ul class="rp-plain-list">${states.map(state => `<li>${esc(state.description)}${state.target ? ' → ' + esc(entityName(view, state.target)) : ''} · ${esc({ private: '私人状态', author: '作者信息', observable: '可观察' }[state.visibility] || '可见性未记录')}</li>`).join('')}</ul>`;
            const relationships = view.relationships.filter(relation => relation.from === item.id || relation.to === item.id);
            if (relationships.length) html += head('与 TA 有关的人') + relationships.slice(0, 3).map(relation => relationship(relation, view)).join('');
            const info = currentInformation(core, ledgerView, { floor }).filter(record => informationInvolves(record, [item])).slice(0, 5);
            if (info.length) html += head('相关说法与观察') + info.map(record => information(record, view)).join('');
            const items = view.items.filter(object => object.holder === item.id || object.owner === item.id);
            if (items.length) html += head('相关物品') + `<div class="rp-chips">${items.slice(0, 5).map(object => link('items', object.id, esc(object.name) + (object.loan ? ' · 借用' : ''), 'rp-entity-link')).join('')}</div>`;
            const plans = view.plans.filter(plan => plan.participants.includes(item.id) && ['accepted', 'proposed'].includes(plan.status));
            if (plans.length) html += head('接下来的约定') + plans.slice(0, 3).map(plan => appointment(plan, view)).join('');
        } else if (kind === 'relationships') {
            html += chip(stateLabels[item.status] || '状态未定') + fields([['关系开始于', item.since], ['一起走过', item.elapsedDays == null ? null : `${item.elapsedDays} 天`], [item.status === 'ended' ? '结束于' : '下一纪念日', item.status === 'ended' ? item.endedAt : item.anniversary?.nextDate]]);
            const milestones = [...(item.milestones || []).map(event => ({ ...event, label: '共同经历' })), ...(item.conflicts || []).map(event => ({ ...event, label: '冲突' }))].sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))).slice(0, 10);
            if (milestones.length) html += head('共同经历与变化') + milestones.map(event => `<section class="rp-history-group"><small>${esc(event.date || '日期未定')} · ${event.label}</small><p>${esc(event.description)}</p></section>`).join('');
            const plans = view.plans.filter(plan => plan.participants.includes(item.from) && plan.participants.includes(item.to));
            if (plans.length) html += head('共同约定') + plans.slice(0, 3).map(plan => appointment(plan, view)).join('');
        } else if (kind === 'plans') html += chip(planStatusLabel(item)) + fields([['参与者', item.participants.map(id => entityName(view, id)).join('、')], ['约定日期', item.due], ['履约状态', stateLabels[item.status]], ['结果', item.outcome || '尚无结果']]);
        else if (kind === 'items') html += chip(item.loan ? '借用中' : stateLabels[item.status] || '状态未定') + fields([['持有者', entityName(view, item.holder)], ['所有者', entityName(view, item.owner)], ['存放地点', item.location ? locationTrail(view, item.location) : null], ['数量', item.quantity], ['状态', stateLabels[item.status]]]);
        else {
            html += fields([['地点层级', locationTrail(view, item.id)]]);
            const present = view.people.filter(person => view.scene?.location === item.id && view.scene?.present?.includes(person.id));
            html += head('在此的人物') + (present.length ? `<div class="rp-sheet">${present.slice(0, 20).map(item => person(item, view)).join('')}</div>` : empty('暂无人物位置记录'));
        }
        const facts = relatedFacts(core, view, kind, item.id, floor).slice(0, 5);
        if (facts.length) html += `<details class="rp-evidence-editor"><summary>来源与变化记录</summary>${facts.map(fact => link('facts', fact.id, `<span class="rp-floor">${esc(fact.floor)} 楼</span><span>${esc(describeRecord(fact, view))}</span>${chevron}`, 'rp-change-row')).join('')}</details>`;
        else html += '<small class="rp-baseline-note">当前基线中的已知状态</small>';
        return html;
    }
    return { rows, scene, overview, entityDetail, empty, fields, chip, head };
}
