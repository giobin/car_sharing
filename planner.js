export const DAYS = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];
export const STORAGE_KEY = 'car-sharing-planner-v2';

export function emptyState() {
  return { version: 2, people: [], template: [], weeks: {}, importNotes: [], settings: { capacity: 4, travelMinutes: 45 } };
}

export function minutes(value) {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error('Inserisci un orario valido (HH:MM).');
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
}

export function time(value) {
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

export function parseDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Data non valida.');
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.toISOString().slice(0, 10) !== value) throw new Error('Data non valida.');
  return date;
}

export function addDays(value, amount) {
  const date = parseDate(value);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

export function monday(value) {
  const date = parseDate(value);
  return addDays(value, -((date.getUTCDay() + 6) % 7));
}

function settingsCheck(settings) {
  if (!settings || !Number.isInteger(settings.capacity) || settings.capacity < 1 || settings.capacity > 9) throw new Error('I posti per auto devono essere un numero intero da 1 a 9, conducente incluso.');
  if (!Number.isInteger(settings.travelMinutes) || settings.travelMinutes < 1 || settings.travelMinutes > 240) throw new Error('La durata della tratta deve essere un numero intero da 1 a 240 minuti.');
}

function idCheck(id) {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(id);
}

// An appointment at the other workplace makes the whole person's day
// independent. It must not disable their car for the rest of the week.
export function autonomousPeople(visits) {
  return new Set(visits.filter(v => v.site === 'falcade').map(v => v.personId));
}

export function validateVisits(visits, people, travelMinutes) {
  const issues = [];
  const names = new Map(people.map(p => [p.id, p.name]));
  const groups = new Map();
  const ids = new Set();
  const independentDays = new Set(visits.filter(v => v.site === 'falcade').map(v => `${v.day}/${v.personId}`));
  for (const visit of visits) {
    if (!idCheck(visit.id) || ids.has(visit.id)) throw new Error('Identificatore di fascia mancante o duplicato.');
    ids.add(visit.id);
    if (!names.has(visit.personId)) throw new Error('Una fascia fa riferimento a un collega inesistente.');
    if (!Number.isInteger(visit.day) || visit.day < 0 || visit.day > 6) throw new Error('Giorno della settimana non valido.');
    if (visit.site !== undefined && !['common', 'falcade'].includes(visit.site)) throw new Error('Sede non valida.');
    if (typeof visit.note !== 'undefined' && (typeof visit.note !== 'string' || visit.note.length > 2000)) throw new Error('Nota non valida o troppo lunga.');
    if (typeof visit.needsReview !== 'undefined' && typeof visit.needsReview !== 'boolean') throw new Error('Stato di verifica non valido.');
    if (typeof visit.canStayExtraHour !== 'undefined' && typeof visit.canStayExtraHour !== 'boolean') throw new Error('Disponibilità per l’ora aggiuntiva non valida.');
    const start = minutes(visit.start), end = minutes(visit.end);
    if (start >= end) throw new Error(`${names.get(visit.personId)}: l'uscita deve essere successiva all'ingresso.`);
    const key = `${visit.day}/${visit.personId}`;
    if (!independentDays.has(key) && (start < travelMinutes || end + travelMinutes >= 1440)) throw new Error(`${names.get(visit.personId)}: il viaggio deve concludersi nella stessa giornata.`);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(visit);
  }
  for (const group of groups.values()) {
    group.sort((a, b) => a.start.localeCompare(b.start));
    for (let i = 1; i < group.length; i++) {
      const a = group[i - 1], b = group[i];
      const gap = minutes(b.start) - minutes(a.end);
      if (gap < 0) throw new Error(`${names.get(a.personId)}, ${DAYS[a.day]}: le fasce si sovrappongono.`);
      if (!independentDays.has(`${a.day}/${a.personId}`) && gap < travelMinutes * 2) issues.push(`${names.get(a.personId)}, ${DAYS[a.day]}: tra l'uscita delle ${a.end} e l'ingresso delle ${b.start} servono almeno ${travelMinutes * 2} minuti per tornare al ritrovo e ripartire.`);
    }
  }
  return issues;
}

// Return a clean object: imported JSON never becomes HTML or an object prototype.
export function normalizeState(input) {
  if (input && input.version === undefined && Array.isArray(input.people) && Array.isArray(input.days)) input = migrateLegacy(input);
  if (!input || input.version !== 2 || !Array.isArray(input.people) || !Array.isArray(input.template) || !input.weeks || typeof input.weeks !== 'object' || Array.isArray(input.weeks)) throw new Error('Formato non riconosciuto. Importa un backup di Viaggi a scuola.');
  if (input.people.length > 100 || input.template.length > 1000 || Object.keys(input.weeks).length > 260) throw new Error('Il file contiene troppi dati.');
  settingsCheck(input.settings);
  const people = input.people.map(p => {
    if (!p || !idCheck(p.id) || typeof p.name !== 'string' || !p.name.trim() || p.name.length > 100 || typeof p.hasCar !== 'boolean') throw new Error('Dati dei colleghi non validi.');
    return { id: p.id, name: p.name.trim(), hasCar: p.hasCar };
  });
  if (new Set(people.map(p => p.id)).size !== people.length || new Set(people.map(p => p.name.toLocaleLowerCase('it'))).size !== people.length) throw new Error('Il file contiene colleghi duplicati.');
  const cleanVisits = rows => {
    if (!Array.isArray(rows) || rows.length > 1000) throw new Error('Elenco delle fasce non valido.');
    return rows.map(v => {
      if (!v || typeof v !== 'object') throw new Error('Fascia non valida.');
      return { id: v.id, personId: v.personId, day: v.day, start: v.start, end: v.end, site: v.site ?? 'common', canStayExtraHour: v.canStayExtraHour ?? false, note: v.note ?? '', needsReview: v.needsReview ?? false };
    });
  };
  const template = cleanVisits(input.template);
  validateVisits(template, people, input.settings.travelMinutes);
  const weeks = {};
  for (const [key, rows] of Object.entries(input.weeks)) {
    if (monday(key) !== key) throw new Error('La settimana deve iniziare di lunedì.');
    weeks[key] = cleanVisits(rows);
    validateVisits(weeks[key], people, input.settings.travelMinutes);
  }
  const importNotes = input.importNotes ?? [];
  if (!Array.isArray(importNotes) || importNotes.length > 100 || importNotes.some(n => typeof n !== 'string' || n.length > 2000)) throw new Error('Note di importazione non valide.');
  return { version: 2, people, template, weeks, importNotes: [...importNotes], settings: { capacity: input.settings.capacity, travelMinutes: input.settings.travelMinutes } };
}

function migrateLegacy(input) {
  const result = emptyState();
  result.people = input.people.map((p, i) => typeof p === 'string' ? { id: `person-${i}`, name: p, hasCar: false } : { id: `person-${i}`, name: p.name, hasCar: p.hasCar });
  const fold = name => name.trim().toLocaleLowerCase('it').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  let counter = 0;
  for (const day of input.days) {
    let weekday, rows;
    if (day.date) {
      const key = monday(day.date); weekday = (parseDate(day.date).getUTCDay() + 6) % 7; rows = result.weeks[key] ||= [];
    } else {
      weekday = DAYS.findIndex(name => typeof day.name === 'string' && fold(name) === fold(day.name));
      if (weekday < 0) throw new Error('Il vecchio file contiene un giorno senza data riconoscibile.');
      rows = result.template;
    }
    if (!Array.isArray(day.shifts)) throw new Error('Turni del vecchio file non validi.');
    for (const shift of day.shifts) {
      const person = result.people.find(p => p.name === shift.person);
      if (!person) throw new Error('Un turno del vecchio file contiene un collega sconosciuto.');
      rows.push({ id: `legacy-${counter++}`, personId: person.id, day: weekday, start: shift.start, end: shift.end, note: '', needsReview: false });
    }
  }
  return result;
}

export function applyTemplate(state, week, makeId, replace = false) {
  if (monday(week) !== week) throw new Error('Scegli una settimana valida.');
  if (Object.hasOwn(state.weeks, week) && !replace) throw new Error('Questa settimana è già stata preparata. Le sue modifiche sono state mantenute.');
  return { ...state, weeks: { ...state.weeks, [week]: state.template.map(v => ({ ...v, id: makeId() })) } };
}

// Minimum-cost feasible circulation. A selected edge is one teacher driving their
// own car for BOTH legs of a visit. Lower bounds cover every departure/return
// group. This minimizes total car journeys without teleporting parked cars.
function selectDrivers(groups, candidates, capacity, driveCounts) {
  const n = groups.length + 4, source = n - 4, sink = n - 3, superSource = n - 2, superSink = n - 1;
  const graph = Array.from({ length: n }, () => []), balance = Array(n).fill(0);
  function edge(a, b, lower, upper, cost) {
    const forward = { to: b, rev: graph[b].length, cap: upper - lower, cost };
    const backward = { to: a, rev: graph[a].length, cap: 0, cost: -cost };
    graph[a].push(forward); graph[b].push(backward);
    balance[a] -= lower; balance[b] += lower;
    return forward;
  }
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i], need = Math.ceil(g.members.length / capacity);
    if (g.direction === 'out') edge(source, i, need, candidates.length, 0);
    else edge(i, sink, need, candidates.length, 0);
  }
  // Primary objective: journey count. Secondary: previous driving load this
  // week. The base cost dominates the sum of all secondary costs.
  const weights = candidates.map(v => driveCounts.get(v.personId) || 0);
  const base = 1 + weights.reduce((sum, value) => sum + value, 0);
  const edges = candidates.map((v, i) => edge(v.out, v.back, 0, 1, base + weights[i]));
  edge(sink, source, 0, candidates.length, 0);
  let required = 0;
  for (let i = 0; i < superSource; i++) {
    if (balance[i] > 0) { edge(superSource, i, 0, balance[i], 0); required += balance[i]; }
    if (balance[i] < 0) edge(i, superSink, 0, -balance[i], 0);
  }
  let flow = 0;
  while (flow < required) {
    const distance = Array(n).fill(Infinity), previous = Array(n).fill(null);
    distance[superSource] = 0;
    for (let pass = 0; pass < n - 1; pass++) {
      let changed = false;
      for (let a = 0; a < n; a++) for (let j = 0; j < graph[a].length; j++) {
        const e = graph[a][j];
        if (e.cap > 0 && distance[a] + e.cost < distance[e.to]) {
          distance[e.to] = distance[a] + e.cost; previous[e.to] = [a, j]; changed = true;
        }
      }
      if (!changed) break;
    }
    if (!previous[superSink]) return null;
    let amount = required - flow;
    for (let b = superSink; b !== superSource;) { const [a, j] = previous[b]; amount = Math.min(amount, graph[a][j].cap); b = a; }
    for (let b = superSink; b !== superSource;) { const [a, j] = previous[b], e = graph[a][j]; e.cap -= amount; graph[b][e.rev].cap += amount; b = a; }
    flow += amount;
  }
  return new Set(candidates.filter((_, i) => edges[i].cap === 0).map(v => v.id));
}

export function planDay(visits, people, settings, driveCounts = new Map()) {
  settingsCheck(settings);
  const issues = validateVisits(visits, people, settings.travelMinutes);
  if (new Set(visits.map(v => v.day)).size > 1) throw new Error('Pianifica un giorno alla volta.');
  const byId = new Map(people.map(p => [p.id, p]));
  const autonomous = [...autonomousPeople(visits)];
  visits = visits.filter(v => !autonomous.includes(v.personId));
  for (const v of visits) if (v.needsReview) issues.push(`${byId.get(v.personId).name}: verifica la fascia ${v.start}–${v.end}${v.note ? ` (${v.note})` : ''}.`);
  if (issues.length) return { ok: false, issues, trips: [], carJourneys: 0, autonomous, extensions: [], searchLimited: false };
  const result = planFlexibleDay(visits, people, settings, driveCounts);
  return { ...result, autonomous };
}

// All members of a return group can leave at the latest of their scheduled
// ends. Moving that group earlier to this time cannot cost cars and reduces
// waiting, so no other minute inside the one-hour windows needs enumeration.
function planFlexibleDay(visits, people, settings, driveCounts) {
  const baseline = planFixedDay(visits, people, settings, driveCounts);
  const departures = new Map();
  for (const v of visits) departures.set(v.start, (departures.get(v.start) || 0) + 1);
  const lowerBound = [...departures.values()].reduce((sum, count) => sum + Math.ceil(count / settings.capacity) * 2, 0);
  const finish = (result, extensions = [], searchLimited = false) => ({ ...result, extensions, searchLimited });
  if (baseline.ok && baseline.carJourneys === lowerBound) return finish(baseline);
  // Waiting cannot fix a shortage of outbound seats.
  if (baseline.issues.some(issue => issue.startsWith('Andata,'))) return finish(baseline);
  const returnTimes = [...new Set(visits.map(v => v.end))].sort();
  const flexible = visits.flatMap((v, index) => {
    if (!v.canStayExtraHour) return [];
    const next = visits.filter(other => other.personId === v.personId && other.start > v.start).sort((a, b) => a.start.localeCompare(b.start))[0];
    const latest = Math.min(minutes(v.end) + 60, 1439 - settings.travelMinutes, next ? minutes(next.start) - 2 * settings.travelMinutes : Infinity);
    const ends = returnTimes.filter(end => end >= v.end && minutes(end) <= latest);
    return ends.length > 1 ? [{ index, ends }] : [];
  });
  if (!flexible.length) return finish(baseline);
  const rows = visits.map(v => ({ ...v }));
  const score = (result, waiting) => [result.carJourneys, waiting, result.trips.filter(t => t.direction === 'out').reduce((sum, trip) => sum + trip.cars.reduce((n, car) => n + (driveCounts.get(car.driver) || 0), 0), 0)];
  const better = (a, b) => a.some((value, i) => value < b[i] && a.slice(0, i).every((v, j) => v === b[j]));
  let best = baseline.ok ? baseline : null, bestScore = best ? score(best, 0) : [Infinity, Infinity, Infinity], extensions = [], checked = 0, searchLimited = false;
  function consider(waiting) {
    // Bound work for unusually large imported schedules. Only complete valid
    // plans can be returned, and the UI explicitly reports a truncated search.
    if (checked >= 5000) { searchLimited = true; return; }
    checked++;
    const result = planFixedDay(rows, people, settings, driveCounts);
    if (!result.ok) return;
    const candidateScore = score(result, waiting);
    if (!better(candidateScore, bestScore)) return;
    best = result; bestScore = candidateScore;
    extensions = rows.flatMap((v, i) => v.end === visits[i].end ? [] : [{ visitId: v.id, personId: v.personId, scheduledEnd: visits[i].end, returnTime: v.end, extraMinutes: minutes(v.end) - minutes(visits[i].end) }]);
  }
  // Try shared return times early, before exploring less useful combinations.
  for (const anchor of returnTimes) {
    let waiting = 0;
    for (const { index, ends } of flexible) {
      rows[index].end = ends.includes(anchor) ? anchor : visits[index].end;
      waiting += minutes(rows[index].end) - minutes(visits[index].end);
    }
    consider(waiting);
    if (searchLimited) break;
  }
  function search(index, waiting) {
    if (searchLimited || (bestScore[0] === lowerBound && waiting > bestScore[1])) return;
    if (index === flexible.length) { consider(waiting); return; }
    const entry = flexible[index];
    for (const end of entry.ends) {
      rows[entry.index].end = end;
      search(index + 1, waiting + minutes(end) - minutes(visits[entry.index].end));
      if (searchLimited) break;
    }
    rows[entry.index].end = visits[entry.index].end;
  }
  search(0, 0);
  if (best) return finish(best, extensions, searchLimited);
  return finish({ ...baseline, issues: searchLimited ? ['Le combinazioni di orari sono troppe: la ricerca non è completa. Specifica alcune uscite nella settimana e ricalcola.'] : baseline.issues }, [], searchLimited);
}

function planFixedDay(visits, people, settings, driveCounts) {
  const byId = new Map(people.map(p => [p.id, p])), issues = [];
  const groups = [], groupIndex = new Map();
  function addGroup(direction, at, visit) {
    const key = `${direction}/${at}`;
    if (!groupIndex.has(key)) { groupIndex.set(key, groups.length); groups.push({ direction, time: at, members: [], visits: [] }); }
    const index = groupIndex.get(key);
    groups[index].members.push(visit.personId); groups[index].visits.push(visit.id);
    return index;
  }
  const candidates = [];
  for (const v of visits) {
    const out = addGroup('out', v.start, v), back = addGroup('back', v.end, v);
    if (byId.get(v.personId).hasCar) candidates.push({ ...v, out, back });
  }
  for (const g of groups) {
    const available = g.members.filter(id => byId.get(id).hasCar).length;
    const need = Math.ceil(g.members.length / settings.capacity);
    if (available < need) issues.push(`${g.direction === 'out' ? 'Andata, ingresso' : 'Ritorno, uscita'} ${g.time}: ${g.members.length} persone, ${need} auto necessarie e ${available} disponibili. Colleghi: ${g.members.map(id => byId.get(id).name).join(', ')}.`);
  }
  if (issues.length) return { ok: false, issues, trips: [], carJourneys: 0 };
  const chosen = selectDrivers(groups, candidates, settings.capacity, driveCounts);
  if (!chosen) return { ok: false, issues: ['Non è possibile coprire tutte le corse con le auto disponibili.'], trips: [], carJourneys: 0 };
  const trips = groups.map(g => {
    const drivers = g.members.filter((_, i) => chosen.has(g.visits[i]));
    const cars = drivers.map(driver => ({ driver, passengers: [] }));
    for (const person of g.members) {
      if (drivers.includes(person)) continue;
      cars.find(car => car.passengers.length < settings.capacity - 1).passengers.push(person);
    }
    return { ...g, departure: g.direction === 'out' ? time(minutes(g.time) - settings.travelMinutes) : g.time,
      arrival: g.direction === 'out' ? g.time : time(minutes(g.time) + settings.travelMinutes), cars };
  }).sort((a, b) => a.departure.localeCompare(b.departure) || a.direction.localeCompare(b.direction));
  return { ok: true, issues: [], trips, carJourneys: chosen.size * 2 };
}
